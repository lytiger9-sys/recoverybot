import mongoose from "mongoose";
import { License } from "../models/License.js";
import { RecoveryHostLock } from "../models/RecoveryHostLock.js";
import { RecoveryHostTask } from "../models/RecoveryHostTask.js";
import { RecoveryRun } from "../models/RecoveryRun.js";
import { isHostBotOnline } from "../discord/hostBotRegistry.js";
import { publishRecoveryRunLog } from "../discord/recoveryLogPublisher.js";

let draining = false;
let startTimer;

function compareQueuedRuns(left, right, activeLocks) {
  const leftContinuesGuild = activeLocks.some((lock) => String(lock.targetGuildId) === String(left.targetGuildId) && left.hostIds.some((hostId) => String(hostId) === String(lock.hostId)));
  const rightContinuesGuild = activeLocks.some((lock) => String(lock.targetGuildId) === String(right.targetGuildId) && right.hostIds.some((hostId) => String(hostId) === String(lock.hostId)));
  if (leftContinuesGuild !== rightContinuesGuild) return leftContinuesGuild ? -1 : 1;
  if (left.hostIds.length !== right.hostIds.length) return left.hostIds.length - right.hostIds.length;
  const leftGuildId = BigInt(left.targetGuildId);
  const rightGuildId = BigInt(right.targetGuildId);
  if (leftGuildId !== rightGuildId) return leftGuildId < rightGuildId ? -1 : 1;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function scheduleDrain(delay = 100) {
  if (startTimer) return;
  startTimer = setTimeout(() => {
    startTimer = undefined;
    void drainQueue();
  }, delay);
  startTimer.unref?.();
}

async function claimRun(run) {
  if (!run.hostIds.length || !run.hostIds.every((hostId) => isHostBotOnline(hostId))) return false;
  const session = await mongoose.startSession();
  try {
    let claimed = false;
    await session.withTransaction(async () => {
      const lockRows = [...run.hostIds]
        .sort((left, right) => String(left).localeCompare(String(right)))
        .map((hostId) => ({ hostId, runId: run._id, targetGuildId: run.targetGuildId }));
      await RecoveryHostLock.insertMany(lockRows, { session, ordered: true });
      const result = await RecoveryRun.updateOne(
        { _id: run._id, status: "QUEUED" },
        { $set: { status: "RUNNING", startedAt: new Date(), currentHostId: run.hostIds[0] } },
        { session },
      );
      if (!result.modifiedCount) throw new Error("RECOVERY_RUN_ALREADY_CLAIMED");
      await RecoveryHostTask.insertMany(run.hostIds.map((hostId, sequence) => ({
        runId: run._id, hostId, sequence, status: sequence === 0 ? "QUEUED" : "WAITING",
      })), { session, ordered: true });
      claimed = true;
    });
    return claimed;
  } catch (error) {
    if (error?.code === 11000 || error?.message === "RECOVERY_RUN_ALREADY_CLAIMED") return false;
    throw error;
  } finally {
    await session.endSession();
  }
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  let waitingForBots = false;
  try {
    const [queued, activeLocks] = await Promise.all([
      RecoveryRun.find({ status: "QUEUED" }).sort({ createdAt: 1 }).lean(),
      RecoveryHostLock.find().select("hostId targetGuildId").lean(),
    ]);
    queued.sort((left, right) => compareQueuedRuns(left, right, activeLocks));
    for (const run of queued) {
      if (!run.hostIds.every((hostId) => isHostBotOnline(hostId))) {
        waitingForBots = true;
        continue;
      }
      try {
        if (await claimRun(run)) scheduleDrain(0);
      } catch (error) {
        if (error?.code !== 11000) console.error("Recovery queue claim failed:", error?.name ?? "UnknownError");
        waitingForBots = true;
      }
    }
  } catch (error) {
    console.error("Recovery queue scan failed:", error?.name ?? "UnknownError");
    waitingForBots = true;
  } finally {
    draining = false;
    if (waitingForBots) scheduleDrain(5000);
  }
}

async function publishFinalLog(runId) {
  const run = await RecoveryRun.findById(runId).lean();
  if (!run || run.logPublishedAt) return;
  await publishRecoveryRunLog(run);
  await RecoveryRun.updateOne({ _id: runId, logPublishedAt: null }, { $set: { logPublishedAt: new Date() } });
}

async function failRun(run, message, reasonCode) {
  const changed = await RecoveryRun.updateOne({ _id: run._id, status: "RUNNING" }, {
    $set: { status: "FAILED", message, completedAt: new Date(), estimatedRemainingSeconds: 0 },
    $inc: { ["failureReasons." + reasonCode]: 1 },
  });
  if (!changed.modifiedCount) return;
  await RecoveryHostTask.updateMany({ runId: run._id, status: { $in: ["WAITING", "QUEUED", "RUNNING"] } }, {
    $set: { status: "CANCELLED", completedAt: new Date(), failureReason: message },
  });
  if (run.licenseId) await License.updateOne({ _id: run.licenseId, status: "IN_PROGRESS" }, { $set: {
    status: "FAILED", completedAt: new Date(), activeRequestId: null,
    recoverySucceeded: Number(run.succeeded ?? 0) + Number(run.alreadyMember ?? 0),
    recoveryTotal: Number(run.total ?? 0), failureReason: message,
  } });
  await RecoveryHostLock.deleteMany({ runId: run._id });
  await publishFinalLog(run._id);
}

async function synchronizeRuns() {
  const running = await RecoveryRun.find({ status: "RUNNING" }).lean();
  for (const run of running) {
    const activeTask = await RecoveryHostTask.findOne({ runId: run._id, status: "RUNNING" }).lean();
    if (activeTask && Date.now() - new Date(activeTask.heartbeatAt ?? activeTask.updatedAt).getTime() > 60_000) {
      await failRun(run, "호기 프로세스의 작업 응답이 끊겨 복구를 중단했습니다.", "host_worker_timeout");
      continue;
    }
    const queuedTask = await RecoveryHostTask.findOne({ runId: run._id, status: "QUEUED" }).lean();
    if (queuedTask && !isHostBotOnline(queuedTask.hostId)) {
      await failRun(run, "다음 순서 호기 봇이 오프라인이 되어 복구를 중단했습니다.", "host_offline");
      continue;
    }
    if (queuedTask && Date.now() - new Date(queuedTask.updatedAt ?? queuedTask.createdAt).getTime() > 60_000) {
      await failRun(run, "호기 프로세스가 대기 작업을 가져가지 않아 복구를 중단했습니다.", "host_worker_timeout");
      continue;
    }
    const pending = await RecoveryHostTask.exists({ runId: run._id, status: { $in: ["WAITING", "QUEUED", "RUNNING"] } });
    if (pending) continue;
    const taskCount = await RecoveryHostTask.countDocuments({ runId: run._id });
    if (taskCount === 0 && Number(run.processed ?? 0) < Number(run.total ?? 0)) {
      await failRun(run, "호기별 작업 큐 정보가 없어 복구를 이어갈 수 없습니다.", "host_tasks_missing");
      continue;
    }
    const latestRun = await RecoveryRun.findById(run._id).lean();
    if (Number(latestRun?.processed ?? 0) < Number(latestRun?.total ?? 0)) {
      await failRun(latestRun ?? run, "모든 대상 계정의 복구 시도를 마치지 못했습니다.", "run_incomplete");
      continue;
    }
    const completedAt = new Date();
    const changed = await RecoveryRun.updateOne({ _id: run._id, status: "RUNNING" }, { $set: {
      status: "COMPLETED", message: "", completedAt, estimatedRemainingSeconds: 0,
    } });
    if (!changed.modifiedCount) continue;
    if (run.licenseId) await License.updateOne({ _id: run.licenseId, status: "IN_PROGRESS" }, { $set: {
      status: "COMPLETED", completedAt, activeRequestId: null,
      recoverySucceeded: Number(latestRun?.succeeded ?? 0) + Number(latestRun?.alreadyMember ?? 0),
      recoveryTotal: Number(latestRun?.total ?? 0), failureReason: "",
    } });
    await RecoveryHostLock.deleteMany({ runId: run._id });
    await publishFinalLog(run._id);
  }
  const failedRuns = await RecoveryRun.find({ status: "FAILED", logPublishedAt: null }).lean();
  for (const run of failedRuns) {
    await RecoveryHostLock.deleteMany({ runId: run._id });
    await publishFinalLog(run._id).catch((error) => console.error("Recovery failure log failed:", error?.name ?? "UnknownError"));
  }
}

export function enqueueRecoveryRun(runId) {
  scheduleDrain(100);
  return runId;
}

export async function recoverInterruptedRuns() {
  await synchronizeRuns();
}

export function startRecoveryQueue() {
  scheduleDrain(0);
  const monitor = setInterval(() => {
    void synchronizeRuns()
      .then(() => scheduleDrain(0))
      .catch((error) => console.error("Recovery coordinator failed:", error?.name ?? "UnknownError"));
  }, 5000);
  monitor.unref?.();
}

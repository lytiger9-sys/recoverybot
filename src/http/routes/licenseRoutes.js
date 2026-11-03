import { Router } from "express";
import mongoose from "mongoose";
import { BotHost } from "../../models/BotHost.js";
import { License } from "../../models/License.js";
import { Product } from "../../models/Product.js";
import { RestoredUser } from "../../models/RestoredUser.js";
import { RecoveryRun } from "../../models/RecoveryRun.js";
import { requireAdmin } from "../../middleware/adminAuth.js";
import { createLicenseDefinition, expireOutdatedLicenses, LicenseError } from "../../services/LicenseService.js";
import { checkHostsInGuild } from "../../services/RecoveryService.js";
import { enqueueRecoveryRun } from "../../services/RecoveryQueue.js";
import { isHostBotOnline } from "../../discord/hostBotRegistry.js";
import { config } from "../../config/env.js";

export const licenseRoutes = Router();
licenseRoutes.use(requireAdmin);

licenseRoutes.get("/", async (request, response) => {
  await expireOutdatedLicenses();
  const status = String(request.query.status ?? "ALL").toUpperCase();
  const queryText = String(request.query.q ?? "").trim().slice(0, 100);
  const hostId = String(request.query.hostId ?? "").trim();
  const filter = {};
  if (status !== "ALL" && ["ISSUED", "IN_PROGRESS", "REJECTED", "COMPLETED", "FAILED", "EXPIRED"].includes(status)) filter.status = status;
  if (hostId && mongoose.isValidObjectId(hostId)) filter.hostIds = new mongoose.Types.ObjectId(hostId);
  if (queryText) {
    const escaped = queryText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { code: { $regex: escaped, $options: "i" } },
      { productName: { $regex: escaped, $options: "i" } },
      { purchaserDiscordId: queryText },
    ];
  }
  const page = Math.max(1, Number.parseInt(request.query.page, 10) || 1);
  const pageSize = 50;
  const [licenses, total] = await Promise.all([
    License.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    License.countDocuments(filter),
  ]);
  const hostIds = [...new Set(licenses.flatMap((item) => item.hostIds.map(String)))];
  const hosts = await BotHost.find({ _id: { $in: hostIds } }).select("name").lean();
  const hostNames = new Map(hosts.map((host) => [String(host._id), host.name]));
  return response.json({
    licenses: licenses.map((item) => ({ ...item, hostNames: item.hostIds.map((id) => hostNames.get(String(id)) ?? "삭제된 호기") })),
    total,
    page,
    pageSize,
  });
});

licenseRoutes.post("/:licenseId/resume", async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.licenseId)) return response.status(400).json({ error: "라이선스 ID가 올바르지 않습니다." });
  const license = await License.findById(request.params.licenseId).lean();
  if (!license) return response.status(404).json({ error: "라이선스를 찾을 수 없습니다." });
  if (license.status !== "FAILED" || !license.recoveryRunId) return response.status(409).json({ error: "실패한 복구가 연결된 라이선스만 이어할 수 있습니다." });

  const previousRun = await RecoveryRun.findOne({ _id: license.recoveryRunId, licenseId: license._id, status: "FAILED" }).lean();
  if (!previousRun) return response.status(409).json({ error: "이전 실패 작업 정보를 찾을 수 없습니다." });
  const hosts = await BotHost.find({ _id: { $in: license.hostIds }, enabled: true }).sort({ createdAt: 1 }).lean();
  if (hosts.length !== license.hostIds.length) return response.status(409).json({ error: "라이선스에 포함된 호기 중 사용할 수 없는 호기가 있습니다." });
  const offlineHosts = hosts.filter((host) => !isHostBotOnline(host._id));
  if (offlineHosts.length) return response.status(409).json({ error: "다음 호기 봇이 오프라인입니다: " + offlineHosts.map((host) => host.name).join(", ") });

  const checks = await checkHostsInGuild(hosts, previousRun.targetGuildId);
  const blockedHosts = checks.filter((item) => !item.present || !item.canAddMembers);
  if (blockedHosts.length) return response.status(409).json({ error: "이전 대상 서버에서 호기 초대와 멤버 추가 권한을 확인해 주세요: " + blockedHosts.map((host) => host.name).join(", ") });
  const completedUserIds = Array.isArray(previousRun.completedUserIds) ? previousRun.completedUserIds : [];
  const targetFilter = { hostId: { $in: license.hostIds }, status: "ACTIVE", _id: { $nin: completedUserIds } };
  if (Array.isArray(previousRun.targetUserIds)) targetFilter._id.$in = previousRun.targetUserIds;
  const remainingUsers = await RestoredUser.find(targetFilter).select("_id").lean();
  const total = remainingUsers.length;
  if (!total) return response.status(409).json({ error: "다시 시도할 ACTIVE 멤버가 없습니다. 이미 성공했거나 재인증이 필요한 계정만 남았습니다." });
  const overallTotal = Number(previousRun.overallTotal ?? previousRun.total ?? license.recoveryTotal ?? license.expectedMemberCount ?? total);

  const locked = await License.findOneAndUpdate(
    { _id: license._id, status: "FAILED", recoveryRunId: previousRun._id },
    { $set: { status: "IN_PROGRESS", recoverySucceeded: completedUserIds.length, recoveryTotal: overallTotal, failureReason: "", activeRequestId: null } },
    { returnDocument: "after" },
  );
  if (!locked) return response.status(409).json({ error: "라이선스 상태가 변경됐습니다. 목록을 새로고침해 주세요." });

  let run;
  try {
    run = await RecoveryRun.create({
      hostIds: license.hostIds,
      targetGuildId: previousRun.targetGuildId,
      targetUserIds: remainingUsers.map((user) => user._id),
      completedUserIds,
      overallTotal,
      total,
      status: "QUEUED",
      delayMs: config.recoveryDelayMs,
      estimatedRemainingSeconds: Math.ceil(total * (config.recoveryDelayMs + 500) / 1000),
      licenseId: license._id,
      retryOfRunId: previousRun._id,
    });
    const linked = await License.updateOne(
      { _id: license._id, status: "IN_PROGRESS", recoveryRunId: previousRun._id },
      { $set: { recoveryRunId: run._id, usedAt: new Date() } },
    );
    if (!linked.modifiedCount) throw new Error("재시도 작업을 라이선스에 연결하지 못했습니다.");
  } catch (error) {
    if (run) await RecoveryRun.deleteOne({ _id: run._id, status: "QUEUED" });
    await License.updateOne(
      { _id: license._id, status: "IN_PROGRESS", recoveryRunId: previousRun._id },
      { $set: { status: "FAILED", recoverySucceeded: completedUserIds.length, recoveryTotal: overallTotal, failureReason: license.failureReason ?? "" } },
    );
    throw error;
  }
  enqueueRecoveryRun(run._id);
  return response.status(202).json({ runId: run.id, total, skipped: completedUserIds.length, targetGuildId: previousRun.targetGuildId, status: run.status });
});

licenseRoutes.post("/", async (request, response) => {
  try {
    const result = await createLicenseDefinition(request.body ?? {}, request.admin?.id ?? request.admin?.username ?? "ADMIN");
    if (result.kind === "PRODUCT") {
      return response.status(201).json({ kind: result.kind, product: result.product });
    }
    const hostNames = result.hosts.map((host) => host.name);
    return response.status(201).json({
      kind: result.kind,
      license: {
        _id: result.license._id,
        code: result.license.code,
        status: result.license.status,
        hostNames,
        expectedMemberCount: result.license.expectedMemberCount,
        expiresAt: result.license.expiresAt,
        durationDays: result.license.durationDays,
      },
    });
  } catch (error) {
    if (error instanceof LicenseError) return response.status(400).json({ error: error.message, code: error.code });
    throw error;
  }
});

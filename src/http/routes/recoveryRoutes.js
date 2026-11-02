import { Router } from "express";
import mongoose from "mongoose";
import { BotHost } from "../../models/BotHost.js";
import { RestoredUser } from "../../models/RestoredUser.js";
import { RecoveryRun } from "../../models/RecoveryRun.js";
import { requireAdmin } from "../../middleware/adminAuth.js";
import { config } from "../../config/env.js";
import { checkHostsInGuild } from "../../services/RecoveryService.js";
import { enqueueRecoveryRun } from "../../services/RecoveryQueue.js";

export const recoveryRoutes = Router();
recoveryRoutes.use(requireAdmin);

recoveryRoutes.get("/hosts", async (_request, response) => {
  const hosts = await BotHost.find({ enabled: true }).select("name inviteLink").sort({ createdAt: 1 }).lean();
  const counts = await RestoredUser.aggregate([
    { $match: { status: "ACTIVE", hostId: { $in: hosts.map((host) => host._id) } } },
    { $group: { _id: "$hostId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(counts.map((item) => [String(item._id), item.count]));
  return response.json({ hosts: hosts.map((host) => ({
    _id: host._id,
    name: host.name,
    inviteLink: host.inviteLink ?? "",
    activeMemberCount: countMap.get(String(host._id)) ?? 0,
  })) });
});

recoveryRoutes.get("/runs", async (_request, response) => {
  const runs = await RecoveryRun.find().sort({ createdAt: -1 }).limit(10).lean();
  return response.json({ runs: runs.map((run) => ({
    ...run,
    failureReasons: run.failureReasons instanceof Map ? Object.fromEntries(run.failureReasons) : (run.failureReasons ?? {}),
  })) });
});

recoveryRoutes.post("/runs", async (request, response) => {
  const rawIds = Array.isArray(request.body?.hostIds) ? request.body.hostIds : [];
  const hostIds = [...new Set(rawIds.map(String))];
  const guildId = String(request.body?.guildId ?? "").trim();
  if (!hostIds.length || hostIds.length > 50 || hostIds.some((id) => !mongoose.isValidObjectId(id))) {
    return response.status(400).json({ error: "복구할 호기를 하나 이상 선택해 주세요." });
  }
  if (!/^\d{17,22}$/.test(guildId)) return response.status(400).json({ error: "Discord 서버 ID를 확인해 주세요." });

  const hosts = await BotHost.find({ _id: { $in: hostIds }, enabled: true }).lean();
  if (hosts.length !== hostIds.length) return response.status(404).json({ error: "선택한 호기 중 사용할 수 없는 호기가 있습니다." });
  const presence = await checkHostsInGuild(hosts, guildId);
  const missing = presence.filter((item) => !item.present);
  const permissionMissing = presence.filter((item) => item.present && !item.canAddMembers);
  if (missing.length || permissionMissing.length) {
    return response.status(409).json({
      error: "봇이 서버에 없거나 멤버 추가 권한이 부족합니다. 초대와 권한을 확인해 주세요.",
      missingHosts: missing.map(({ name, status }) => ({ name, status })),
      permissionHosts: permissionMissing.map(({ name }) => name),
    });
  }

  const total = await RestoredUser.countDocuments({ hostId: { $in: hostIds }, status: "ACTIVE" });
  if (!total) return response.status(409).json({ error: "선택한 호기에 복구할 ACTIVE 멤버가 없습니다." });
  const run = await RecoveryRun.create({
    hostIds,
    targetGuildId: guildId,
    total,
    status: "QUEUED",
    delayMs: config.recoveryDelayMs,
    estimatedRemainingSeconds: Math.ceil(total * (config.recoveryDelayMs + 500) / 1000),
  });
  enqueueRecoveryRun(run._id);
  return response.status(202).json({ runId: run.id, total, status: run.status });
});







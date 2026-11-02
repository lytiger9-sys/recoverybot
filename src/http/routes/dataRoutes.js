import { Router } from "express";
import mongoose from "mongoose";
import { BotHost } from "../../models/BotHost.js";
import { RestoredUser } from "../../models/RestoredUser.js";
import { config } from "../../config/env.js";
import { decryptSecret } from "../../security/secretEncryption.js";
import { requireAdmin } from "../../middleware/adminAuth.js";

export const dataRoutes = Router();
dataRoutes.use(requireAdmin);

function parseHostIds(raw) {
  const values = (Array.isArray(raw) ? raw : [raw])
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length || values.length > 50 || values.some((id) => !mongoose.isValidObjectId(id))) return null;
  return [...new Set(values)];
}

function resolveSecret(value) {
  return typeof value === "string" ? value : decryptSecret(value, config.tokenEncryptionKey);
}

function validateAndBuildRecords(backup, hostIds) {
  const records = [];
  const seen = new Set();

  for (const hostId of hostIds) {
    const hostBlock = backup.hosts[hostId];
    if (!hostBlock || !hostBlock.accounts || typeof hostBlock.accounts !== "object") {
      throw new Error("백업 파일의 호기 데이터 형식이 올바르지 않습니다.");
    }

    for (const [discordUserId, account] of Object.entries(hostBlock.accounts)) {
      if (!/^\d{1,30}$/.test(discordUserId) || !account || typeof account !== "object") {
        throw new Error("백업 파일의 유저 데이터 형식이 올바르지 않습니다.");
      }

      const recordKey = hostId + ":" + discordUserId;
      if (seen.has(recordKey)) throw new Error("백업 파일에 중복된 유저가 있습니다.");
      seen.add(recordKey);

      if (
        typeof account.username !== "string" ||
        !account.username.trim() ||
        account.username.length > 120 ||
        typeof account.access_token !== "string" ||
        !account.access_token ||
        typeof account.refresh_token !== "string" ||
        !account.refresh_token
      ) {
        throw new Error("평문 JSON의 유저 정보 또는 토큰 값을 확인해 주세요.");
      }

      const status = String(account.status ?? "ACTIVE");
      if (!["ACTIVE", "INACTIVE", "REVOKED"].includes(status)) {
        throw new Error("백업 파일의 상태 값이 올바르지 않습니다.");
      }

      const lastUpdated = new Date(account.last_updated);
      if (Number.isNaN(lastUpdated.getTime())) {
        throw new Error("백업 파일의 갱신 시각이 올바르지 않습니다.");
      }

      try {
        const accessToken = account.access_token;
        const refreshToken = account.refresh_token;
        const email = account.email ? String(account.email) : undefined;
        if (accessToken.length > 8192 || refreshToken.length > 8192 || (email && email.length > 320)) throw new Error("INVALID_SECRET_LENGTH");
      } catch {
        throw new Error("평문 JSON의 토큰 값을 확인해 주세요.");
      }
      if (account.email && typeof account.email !== "string") throw new Error("평문 JSON의 이메일 값이 올바르지 않습니다.");

      records.push({
        hostId: new mongoose.Types.ObjectId(hostId),
        discordUserId,
        username: account.username.trim(),
        accessToken: account.access_token,
        refreshToken: account.refresh_token,
        email: account.email || undefined,
        status,
        lastUpdated,
      });
    }
  }

  return records;
}

dataRoutes.get("/export", async (request, response) => {
  const hostIds = parseHostIds(request.query.hostIds);
  if (!hostIds) return response.status(400).json({ error: "호기를 하나 이상 선택해 주세요." });
  if (hostIds.length !== 1) return response.status(400).json({ error: "평문 JSON은 호기 하나씩 선택해 추출해 주세요." });

  const host = await BotHost.findById(hostIds[0]).select("name").lean();
  if (!host) return response.status(404).json({ error: "선택한 호기를 찾을 수 없습니다." });

  const users = await RestoredUser.find({ hostId: { $in: hostIds } })
    .select("hostId discordUserId username accessToken refreshToken email status lastUpdated")
    .lean();

  const accounts = {};
  for (const user of users) {
    accounts[user.discordUserId] = {
      username: user.username,
      access_token: resolveSecret(user.accessToken),
      refresh_token: resolveSecret(user.refreshToken),
      email: user.email ? resolveSecret(user.email) : null,
      status: user.status,
      last_updated: user.lastUpdated.toISOString(),
    };
  }

  const date = new Date().toISOString().slice(0, 10);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Disposition", 'attachment; filename="recovery-host-data-plaintext-' + date + '.json"');
  return response.send(JSON.stringify(accounts, null, 2));
});

dataRoutes.post("/import", async (request, response) => {
  const backup = request.body?.backup;
  const plainHostId = String(request.body?.plainHostId ?? "");

  if (backup && typeof backup === "object" && !Array.isArray(backup)) {
    if (!mongoose.isValidObjectId(plainHostId) || !(await BotHost.exists({ _id: plainHostId }))) {
      return response.status(400).json({ error: "평문 JSON을 넣을 대상 호기를 하나 선택해 주세요." });
    }
    const wrapped = {
      hosts: { [plainHostId]: { accounts: backup } },
    };
    let records;
    try {
      records = validateAndBuildRecords(wrapped, [plainHostId]);
    } catch (error) {
      return response.status(400).json({ error: error.message });
    }
    if (records.length) await RestoredUser.bulkWrite(records.map((record) => ({
      updateOne: {
        filter: { hostId: record.hostId, discordUserId: record.discordUserId },
        update: { $set: record },
        upsert: true,
      },
    })));
    return response.json({ imported: records.length, hosts: 1, mode: "merge", format: "plaintext" });
  }

  return response.status(400).json({ error: "유저 ID가 최상위 키인 평문 JSON과 대상 호기를 지정해 주세요." });
});

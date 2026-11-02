import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { AutoRechargeSettings } from "../models/AutoRechargeSettings.js";
import { RechargeRequest } from "../models/RechargeRequest.js";
import { ProcessedDepositNotification } from "../models/ProcessedDepositNotification.js";
import { UserBalance } from "../models/UserBalance.js";
import { BalanceLedger } from "../models/BalanceLedger.js";
import { config } from "../config/env.js";
import { decryptSecret } from "../security/secretEncryption.js";
import { normalizeName, sendConfiguredLog, updateRechargeRequestLog } from "../discord/BotRuntime.js";

let socket;
let generation = 0;
let reconnectTimer;
let expiryTimer;

function parseDepositBody(body) {
  const match = String(body ?? "").trim().match(/^(.{1,40}?)님이\s*([\d,]+)\s*원(?:을|를)?\s*보냈어요[.!]?$/u);
  if (!match) return null;
  const amountMinor = Number(match[2].replaceAll(",", ""));
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) return null;
  return { depositorKey: normalizeName(match[1]), amountMinor };
}

async function recordDeposit(push, settings) {
  if (!push?.iden || push.type !== "mirror" || push.encrypted) return;
  const applicationName = String(push.application_name ?? "").trim();
  if (normalizeName(applicationName) !== normalizeName(settings.notificationAppName)) return;

  const parsed = parseDepositBody(push.body);
  const iden = String(push.iden);
  const notification = {
    pushbulletIden: iden,
    notificationAppName: applicationName,
    depositorKeyHash: parsed ? createHash("sha256").update(parsed.depositorKey).digest("hex") : "",
    amountMinor: parsed?.amountMinor ?? null,
    outcome: "IGNORED",
  };
  if (!parsed) {
    await ProcessedDepositNotification.create(notification).catch((error) => { if (error?.code !== 11000) throw error; });
    return;
  }

  const match = await RechargeRequest.findOne({
    depositorNameKey: parsed.depositorKey,
    amountMinor: parsed.amountMinor,
    status: "PENDING",
    matchingSuppressed: { $ne: true },
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: 1, _id: 1 }).select("_id discordUserId").lean();
  if (!match) {
    notification.outcome = "UNMATCHED";
    await ProcessedDepositNotification.create(notification).catch((error) => { if (error?.code !== 11000) throw error; });
    await sendConfiguredLog(settings.depositLogChannelId, "일치하는 충전 요청이 없는 입금 알림을 확인해 주세요.");
    return;
  }

  const session = await mongoose.startSession();
  let creditedUserId = "";
  try {
    await session.withTransaction(async () => {
      await ProcessedDepositNotification.create([{ ...notification, outcome: "MATCHED", rechargeRequestId: match._id }], { session });
      const result = await RechargeRequest.updateOne(
        { _id: match._id, status: "PENDING", expiresAt: { $gt: new Date() } },
        { $set: { status: "PAID", paidNotificationId: iden, paidAt: new Date() } },
        { session },
      );
      if (!result.modifiedCount) throw new Error("Recharge request already processed");
      await RechargeRequest.updateMany({
        _id: { $ne: match._id },
        depositorNameKey: parsed.depositorKey,
        amountMinor: parsed.amountMinor,
        status: "PENDING",
        expiresAt: { $gt: new Date() },
      }, { $set: { matchingSuppressed: true } }, { session });
      await UserBalance.findOneAndUpdate(
        { discordUserId: match.discordUserId },
        { $inc: { cashMinor: parsed.amountMinor }, $setOnInsert: { currency: "KRW" } },
        { upsert: true, returnDocument: "after", session, setDefaultsOnInsert: true },
      );
      await BalanceLedger.create([{
        discordUserId: matches[0].discordUserId,
        entryType: "AUTO_RECHARGE",
        amountMinor: parsed.amountMinor,
        currency: "KRW",
        referenceId: iden,
        note: "Pushbullet 자동충전",
      }], { session });
      creditedUserId = match.discordUserId;
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return;
  } finally { await session.endSession(); }

  await updateRechargeRequestLog(match._id).catch((error) => console.error("Recharge status log update failed:", error?.name ?? "UnknownError"));
  await sendConfiguredLog(settings.depositLogChannelId, "입금 알림을 충전 요청과 일치시켜 반영했습니다.");
}

export async function expirePendingRechargeRequests() {
  const now = new Date();
  const due = await RechargeRequest.find({ status: "PENDING", expiresAt: { $lte: now } }).select("_id").limit(200).lean();
  for (const request of due) {
    const updated = await RechargeRequest.updateOne(
      { _id: request._id, status: "PENDING", expiresAt: { $lte: now } },
      { $set: { status: "EXPIRED" } },
    );
    if (updated.modifiedCount) {
      await updateRechargeRequestLog(request._id).catch((error) => console.error("Recharge expiry log update failed:", error?.name ?? "UnknownError"));
    }
  }
  const unsynced = await RechargeRequest.find({
    chargeLogMessageId: { $ne: "" },
    $expr: { $ne: ["$status", "$chargeLogStatus"] },
    status: { $in: ["PAID", "EXPIRED"] },
  }).select("_id status").limit(200).lean();
  for (const request of unsynced) {
    await updateRechargeRequestLog(request._id).catch((error) => console.error("Recharge status log retry failed:", error?.name ?? "UnknownError"));
  }
}

function scheduleExpiryCheck() {
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(async () => {
    try { await expirePendingRechargeRequests(); }
    catch (error) { console.error("Recharge expiry processing failed:", error?.name ?? "UnknownError"); }
    scheduleExpiryCheck();
  }, 10_000);
  expiryTimer.unref?.();
}

function connectStream(token, currentGeneration) {
  if (currentGeneration !== generation) return;
  const ws = new WebSocket("wss://stream.pushbullet.com/websocket/" + encodeURIComponent(token));
  socket = ws;
  ws.addEventListener("open", () => console.log("Pushbullet notification stream connected."));
  ws.addEventListener("message", async (event) => {
    try {
      const payload = JSON.parse(String(event.data));
      if (payload.type !== "push" || payload.push?.type !== "mirror") return;
      const settings = await AutoRechargeSettings.findOne({ key: "default" }).lean();
      if (settings?.enabled) await recordDeposit(payload.push, settings);
    } catch (error) { console.error("Pushbullet event handling failed:", error?.name ?? "UnknownError"); }
  });
  ws.addEventListener("error", () => console.error("Pushbullet notification stream error."));
  ws.addEventListener("close", () => {
    if (currentGeneration !== generation) return;
    reconnectTimer = setTimeout(() => connectStream(token, currentGeneration), 5000);
  });
}

export async function refreshPushbulletListener() {
  scheduleExpiryCheck();
  generation += 1;
  const currentGeneration = generation;
  clearTimeout(reconnectTimer);
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  socket = undefined;
  const settings = await AutoRechargeSettings.findOne({ key: "default" }).lean();
  if (!settings?.enabled || !settings.pushbulletToken) { return; }
  const token = decryptSecret(settings.pushbulletToken, config.tokenEncryptionKey);
  connectStream(token, currentGeneration);
}

export async function stopPushbulletListener() {
  generation += 1;
  clearTimeout(reconnectTimer);
  clearTimeout(expiryTimer);
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  socket = undefined;
}




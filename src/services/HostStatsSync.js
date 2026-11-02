import { BotHost } from "../models/BotHost.js";
import { RestoredUser } from "../models/RestoredUser.js";
import { getHostBotStatus } from "../discord/BotRuntime.js";

let midnightTimer;

export async function syncHostStats(hostId, { allowOffline = false } = {}) {
  const status = getHostBotStatus(hostId);
  if (!status.online && !allowOffline) return { synced: false, reason: "호기 봇이 오프라인입니다." };

  const [memberCount, activeMemberCount] = await Promise.all([
    RestoredUser.countDocuments({ hostId }),
    RestoredUser.countDocuments({ hostId, status: "ACTIVE" }),
  ]);
  const statsSyncedAt = new Date();
  const result = await BotHost.updateOne({ _id: hostId }, { $set: { memberCount, activeMemberCount, statsSyncedAt } });
  if (!result.matchedCount) return { synced: false, reason: "호기를 찾을 수 없습니다." };
  return { synced: true, online: status.online, memberCount, activeMemberCount, statsSyncedAt };
}

export async function syncOnlineHostStats() {
  const hosts = await BotHost.find({ enabled: true }).select("_id").lean();
  const results = await Promise.allSettled(hosts.map((host) => syncHostStats(host._id)));
  return results.filter((result) => result.status === "fulfilled" && result.value.synced).length;
}

function millisecondsUntilKoreaMidnight(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const nextUtcMidnight = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + 1);
  const nextKoreaMidnight = nextUtcMidnight - 9 * 60 * 60 * 1000;
  return Math.max(1000, nextKoreaMidnight - now.getTime());
}

function scheduleNextSync() {
  clearTimeout(midnightTimer);
  midnightTimer = setTimeout(async () => {
    try { await syncOnlineHostStats(); }
    catch (error) { console.error("Scheduled host stats sync failed:", error?.name ?? "UnknownError"); }
    scheduleNextSync();
  }, millisecondsUntilKoreaMidnight());
  midnightTimer.unref?.();
}

export async function startHostStatsSync() {
  try { await syncOnlineHostStats(); }
  catch (error) { console.error("Initial host stats sync failed:", error?.name ?? "UnknownError"); }
  scheduleNextSync();
}

export function stopHostStatsSync() {
  clearTimeout(midnightTimer);
  midnightTimer = undefined;
}

import { Router } from "express";
import { AutoRechargeSettings } from "../../models/AutoRechargeSettings.js";
import { config } from "../../config/env.js";
import { encryptSecret } from "../../security/secretEncryption.js";
import { requireAdmin } from "../../middleware/adminAuth.js";
import { refreshPushbulletListener } from "../../services/PushbulletListener.js";

export const autoRechargeRoutes = Router();
autoRechargeRoutes.use(requireAdmin);

async function getSettings() {
  return AutoRechargeSettings.findOneAndUpdate(
    { key: "default" },
    { $setOnInsert: { enabled: false } },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
  );
}

function isHttpsUrl(value) {
  if (!value) return true;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function channelId(value) {
  return value === "" || /^\d{17,22}$/.test(value);
}

function publicSettings(settings) {
  const fields = [
    "enabled", "accountBank", "accountNumber", "accountHolder", "minimumTopupMinor", "notificationAppName",
    "reviewLogChannelId", "purchaseLogChannelId", "chargeLogChannelId", "depositLogChannelId",
    "embedTitle", "embedDescription", "embedColor", "embedFooter", "embedImageUrl", "updatedAt",
  ];
  return Object.fromEntries(fields.map((key) => [key, settings[key]]).concat([["hasToken", Boolean(settings.pushbulletToken)]]));
}

autoRechargeRoutes.get("/", async (_request, response) => response.json(publicSettings(await getSettings())));

autoRechargeRoutes.put("/", async (request, response) => {
  const settings = await getSettings();
  const body = request.body ?? {};
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") return response.status(400).json({ error: "자동충전 사용 상태가 올바르지 않습니다." });
  if (body.clearToken !== undefined && typeof body.clearToken !== "boolean") return response.status(400).json({ error: "토큰 삭제 옵션이 올바르지 않습니다." });
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (token.length > 4096 || (token && body.clearToken)) return response.status(400).json({ error: "Pushbullet 토큰 입력을 확인해 주세요." });

  const textFields = {
    accountBank: [80, "은행 이름"], accountNumber: [80, "계좌번호"], accountHolder: [80, "예금주"],
    notificationAppName: [100, "입금 알림 앱 이름"], embedTitle: [256, "임베드 제목"],
    embedDescription: [4000, "임베드 설명"], embedColor: [7, "임베드 색상"], embedFooter: [2048, "푸터"], embedImageUrl: [2048, "이미지 URL"],
    reviewLogChannelId: [22, "검토 로그 채널"], purchaseLogChannelId: [22, "구매 로그 채널"],
    chargeLogChannelId: [22, "충전 로그 채널"], depositLogChannelId: [22, "입금 로그 채널"],
  };
  for (const [field, [max, label]] of Object.entries(textFields)) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== "string" || body[field].trim().length > max) return response.status(400).json({ error: label + " 값을 확인해 주세요." });
    settings[field] = body[field].trim();
  }
  const minimum = Number(body.minimumTopupMinor ?? settings.minimumTopupMinor);
  if (!Number.isSafeInteger(minimum) || minimum < 1) return response.status(400).json({ error: "최소 충전 금액은 1원 이상의 정수여야 합니다." });
  settings.minimumTopupMinor = minimum;
  if (!/^#[0-9A-Fa-f]{6}$/.test(settings.embedColor)) return response.status(400).json({ error: "임베드 색상은 #RRGGBB 형식으로 입력해 주세요." });
  if (!isHttpsUrl(settings.embedImageUrl)) return response.status(400).json({ error: "이미지 URL은 HTTPS 주소로 입력해 주세요." });
  for (const field of ["reviewLogChannelId", "purchaseLogChannelId", "chargeLogChannelId", "depositLogChannelId"]) {
    if (!channelId(settings[field])) return response.status(400).json({ error: "로그 채널 ID를 확인해 주세요." });
  }

  if (token) settings.pushbulletToken = encryptSecret(token, config.tokenEncryptionKey);
  else if (body.clearToken) settings.pushbulletToken = undefined;
  if (body.enabled !== undefined) settings.enabled = body.enabled;
  if (settings.enabled) {
    if (!settings.pushbulletToken) return response.status(400).json({ error: "자동충전을 켜려면 Pushbullet 토큰을 설정해 주세요." });
    if (!settings.accountBank || !settings.accountNumber || !settings.accountHolder || !settings.notificationAppName) {
      return response.status(400).json({ error: "은행·계좌·예금주·입금 알림 앱 이름을 먼저 설정해 주세요." });
    }
    if (!settings.chargeLogChannelId) return response.status(400).json({ error: "충전 요청 상태를 기록할 충전 로그 채널을 설정해 주세요." });
  }

  await settings.save();
  await refreshPushbulletListener();
  return response.json(publicSettings(settings));
});



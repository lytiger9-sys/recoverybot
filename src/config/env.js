import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Missing required environment variable: " + name);
  return value;
}

const encryptionKey = Buffer.from(required("TOKEN_ENCRYPTION_KEY"), "base64");
if (encryptionKey.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");

const recoveryDelayMs = Number(process.env.RECOVERY_DELAY_MS ?? 2000);
if (!Number.isInteger(recoveryDelayMs) || recoveryDelayMs < 1000 || recoveryDelayMs > 60000) throw new Error("RECOVERY_DELAY_MS must be between 1000 and 60000 milliseconds.");

const recoveryApprovalChannelId = process.env.RECOVERY_APPROVAL_CHANNEL_ID?.trim() || "";
const recoveryLogChannelId = process.env.RECOVERY_LOG_CHANNEL_ID?.trim() || "";
const authLogChannelId = process.env.AUTH_LOG_CHANNEL_ID?.trim() || "";
const recoveryAdminUserId = process.env.RECOVERY_ADMIN_USER_ID?.trim() || "";
if (recoveryApprovalChannelId && !/^\d{17,22}$/.test(recoveryApprovalChannelId)) throw new Error("RECOVERY_APPROVAL_CHANNEL_ID must be a Discord channel ID.");
if (recoveryLogChannelId && !/^\d{17,22}$/.test(recoveryLogChannelId)) throw new Error("RECOVERY_LOG_CHANNEL_ID must be a Discord channel ID.");
if (authLogChannelId && !/^\d{17,22}$/.test(authLogChannelId)) throw new Error("AUTH_LOG_CHANNEL_ID must be a Discord channel ID.");
if (recoveryAdminUserId && !/^\d{17,22}$/.test(recoveryAdminUserId)) throw new Error("RECOVERY_ADMIN_USER_ID must be a Discord user ID.");

const publicBaseUrl = (process.env.PUBLIC_BASE_URL ?? "http://localhost:" + port).trim().replace(/\/$/, "");
let parsedBaseUrl;
try { parsedBaseUrl = new URL(publicBaseUrl); } catch { throw new Error("PUBLIC_BASE_URL must be a valid URL."); }
if (process.env.NODE_ENV === "production" && parsedBaseUrl.protocol !== "https:") {
  throw new Error("PUBLIC_BASE_URL must use HTTPS in production.");
}

export const config = Object.freeze({
  port,
  mongodbUri: required("MONGODB_URI"),
  tokenEncryptionKey: encryptionKey,
  mainBotToken: process.env.MAIN_BOT_TOKEN?.trim() || "",
  publicBaseUrl,
  recoveryDelayMs,
  recoveryApprovalChannelId,
  recoveryLogChannelId,
  authLogChannelId,
  recoveryAdminUserId,
});


import { createHash, randomBytes } from "node:crypto";
import { AdminSession } from "../models/AdminSession.js";
import { config } from "../config/env.js";
const COOKIE_NAME = "recovery_admin_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const hashId = (value) => createHash("sha256").update(value).digest("hex");
export function readSessionCookie(request) {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [name, ...values] = part.trim().split("=");
    if (name === COOKIE_NAME) return values.join("=");
  }
  return null;
}
export async function createAdminSession(adminId) {
  const sessionId = randomBytes(32).toString("base64url");
  await AdminSession.create({
    sessionIdHash: hashId(sessionId),
    adminId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return sessionId;
}
export async function findAdminSession(request) {
  const sessionId = readSessionCookie(request);
  if (!sessionId) return null;
  const session = await AdminSession.findOne({
    sessionIdHash: hashId(sessionId),
    expiresAt: { $gt: new Date() },
  }).populate("adminId");
  if (!session?.adminId?.enabled) return null;
  return { session, admin: session.adminId };
}
export function setSessionCookie(response, sessionId) {
  const secure = config.secureCookies ? "; Secure" : "";
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  response.setHeader("Set-Cookie", COOKIE_NAME + "=" + sessionId +
    "; HttpOnly; Path=/; SameSite=Strict; Max-Age=" + maxAge + secure);
}
export async function clearAdminSession(request, response) {
  const sessionId = readSessionCookie(request);
  if (sessionId) await AdminSession.deleteOne({ sessionIdHash: hashId(sessionId) });
  const secure = config.secureCookies ? "; Secure" : "";
  response.setHeader("Set-Cookie", COOKIE_NAME + "=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0" + secure);
}

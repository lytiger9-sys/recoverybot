import { findAdminSession } from "../services/SessionService.js";
import { config } from "../config/env.js";

export function isSameOrigin(request) {
  const origin = request.get("origin");
  if (!origin) return false;
  try {
    const requestOrigin = request.protocol + "://" + request.get("host");
    const suppliedOrigin = new URL(origin).origin;
    const configuredOrigin = new URL(config.publicBaseUrl).origin;
    return suppliedOrigin === requestOrigin || suppliedOrigin === configuredOrigin;
  } catch {
    return false;
  }
}
export async function requireAdmin(request, response, next) {
  try {
    const auth = await findAdminSession(request);
    if (!auth) return response.status(401).json({ error: "로그인이 필요합니다." });
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !isSameOrigin(request)) {
      return response.status(403).json({ error: "요청 출처를 확인할 수 없습니다." });
    }
    request.admin = auth.admin;
    return next();
  } catch (error) {
    return next(error);
  }
}
export async function requireAdminPage(request, response, next) {
  try {
    const auth = await findAdminSession(request);
    if (!auth) return response.redirect("/login");
    request.admin = auth.admin;
    return next();
  } catch (error) {
    return next(error);
  }
}

import { Router } from "express";
import { Admin } from "../../models/Admin.js";
import { isSameOrigin } from "../../middleware/adminAuth.js";
import { loginRateLimit } from "../../middleware/loginRateLimit.js";
import { verifyPassword } from "../../security/passwords.js";
import { clearAdminSession, createAdminSession, findAdminSession, setSessionCookie } from "../../services/SessionService.js";
export const authRoutes = Router();
authRoutes.post("/login", loginRateLimit, async (request, response) => {
  if (!isSameOrigin(request)) return response.status(403).json({ error: "요청 출처를 확인할 수 없습니다." });
  const username = String(request.body?.username ?? "").trim();
  const password = String(request.body?.password ?? "");
  if (!username || !password || username.length > 120 || password.length > 1024) {
    return response.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
  }
  const admin = await Admin.findOne({ username, enabled: true });
  if (!admin || !(await verifyPassword(password, admin.passwordHash))) {
    return response.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
  }
  await clearAdminSession(request, response);
  setSessionCookie(response, await createAdminSession(admin._id));
  return response.json({ admin: { username: admin.username } });
});
authRoutes.get("/me", async (request, response, next) => {
  try {
    const auth = await findAdminSession(request);
    if (!auth) return response.status(401).json({ error: "로그인이 필요합니다." });
    return response.json({ admin: { username: auth.admin.username } });
  } catch (error) {
    return next(error);
  }
});
authRoutes.delete("/session", async (request, response, next) => {
  try {
    if (!isSameOrigin(request)) return response.status(403).json({ error: "요청 출처를 확인할 수 없습니다." });
    await clearAdminSession(request, response);
    return response.status(204).end();
  } catch (error) {
    return next(error);
  }
});


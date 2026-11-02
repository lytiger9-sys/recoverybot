const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attemptsByIp = new Map();

export function loginRateLimit(request, response, next) {
  const key = request.ip ?? request.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  let entry = attemptsByIp.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    attemptsByIp.set(key, entry);
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const retrySeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    response.setHeader("Retry-After", String(retrySeconds));
    return response.status(429).json({ error: "로그인 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요." });
  }

  entry.count += 1;
  response.on("finish", () => {
    if (response.statusCode < 400) attemptsByIp.delete(key);
  });

  return next();
}

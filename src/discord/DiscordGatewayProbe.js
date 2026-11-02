export async function probeDiscordGatewayRest(token, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response;
  try {
    const normalizedToken = token.replace(/^(Bot|Bearer)\s*/i, "");
    response = await fetch("https://discord.com/api/v10/gateway/bot", {
      headers: { Authorization: "Bot " + normalizedToken },
      signal: controller.signal,
    });
  } catch (error) {
    console.error(label + " Discord REST probe failed:", {
      name: error?.name ?? "UnknownError",
      message: error?.message ?? "Request failed",
      causeCode: error?.cause?.code ?? "",
      causeMessage: error?.cause?.message ?? "",
    });
    throw new Error(label + " Discord REST probe failed before login.", { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  const body = await response.json().catch(() => ({}));
  const retryAfter = response.headers.get("retry-after") || response.headers.get("x-ratelimit-reset-after") || body.retry_after || "";
  const rateLimitScope = response.headers.get("x-ratelimit-scope") ?? "";
  console.log(label + " Discord REST probe status:", response.status, {
    rateLimitScope,
    retryAfterSeconds: retryAfter,
    global: typeof body.global === "boolean" ? body.global : null,
  });
  if (response.status !== 200) {
    const error = new Error(label + " Discord REST probe returned HTTP " + response.status + (retryAfter ? "; retry after " + retryAfter + "s" : ""));
    error.status = response.status;
    error.retryAfterMs = Number.isFinite(Number(retryAfter)) ? Math.max(0, Number(retryAfter) * 1000) : 60_000;
    error.rateLimitScope = rateLimitScope || (body.global ? "global" : "");
    throw error;
  }
}

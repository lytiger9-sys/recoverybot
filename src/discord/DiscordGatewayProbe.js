export async function probeDiscordGatewayRest(token, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const normalizedToken = token.replace(/^(Bot|Bearer)\s*/i, "");
    const response = await fetch("https://discord.com/api/v10/gateway/bot", {
      headers: { Authorization: "Bot " + normalizedToken },
      signal: controller.signal,
    });
    console.log(label + " Discord REST probe status:", response.status);
    await response.body?.cancel().catch(() => {});
  } catch (error) {
    console.error(label + " Discord REST probe failed:", {
      name: error?.name ?? "UnknownError",
      message: error?.message ?? "Request failed",
      causeCode: error?.cause?.code ?? "",
      causeMessage: error?.cause?.message ?? "",
    });
  } finally {
    clearTimeout(timeout);
  }
}

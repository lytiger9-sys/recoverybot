import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { BotHost } from "../../models/BotHost.js";
import { AuthPanel } from "../../models/AuthPanel.js";
import { OAuthState } from "../../models/OAuthState.js";
import { RestoredUser } from "../../models/RestoredUser.js";
import { config } from "../../config/env.js";
import { decryptSecret } from "../../security/secretEncryption.js";
import { publishAuthLog } from "../../discord/authLogPublisher.js";

export const oauthRoutes = Router();
const hashState = (state) => createHash("sha256").update(state).digest("hex");
const callbackUrl = () => config.publicBaseUrl + "/oauth/callback";

async function startOAuth(request, response, panelId = null) {
  if (!mongoose.isValidObjectId(request.params.hostId)) return response.status(404).send("호기를 찾을 수 없습니다.");
  let panel = null;
  if (panelId !== null) {
    if (!mongoose.isValidObjectId(panelId)) return response.status(404).send("인증 패널을 찾을 수 없습니다.");
    panel = await AuthPanel.findOne({ _id: panelId, hostId: request.params.hostId }).lean();
    if (!panel) return response.status(404).send("인증 패널을 찾을 수 없습니다.");
  }
  const host = await BotHost.findOne({ _id: request.params.hostId, enabled: true }).select("clientId").lean();
  if (!host) return response.status(404).send("호기를 찾을 수 없습니다.");
  const state = randomBytes(32).toString("base64url");
  await OAuthState.create({ hostId: host._id, authPanelId: panel?._id ?? null, stateHash: hashState(state), expiresAt: new Date(Date.now() + 10 * 60_000) });
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: host.clientId,
    response_type: "code",
    redirect_uri: callbackUrl(),
    scope: "identify email guilds.join",
    state,
    prompt: "consent",
  }).toString();
  return response.redirect(url.toString());
}

oauthRoutes.get("/start/:hostId", (request, response) => startOAuth(request, response));
oauthRoutes.get("/start/:hostId/:panelId", (request, response) => startOAuth(request, response, request.params.panelId));

oauthRoutes.get("/callback", async (request, response) => {
  const { code, state, error, iss } = request.query;
  if (iss && iss !== "https://discord.com") return response.status(400).send("인증 서버를 확인할 수 없습니다.");
  if (error) return response.status(400).send("Discord 인증이 취소되었거나 거부됐습니다. 이 창을 닫아 주세요.");
  if (typeof code !== "string" || typeof state !== "string" || state.length > 256) {
    return response.status(400).send("인증 요청이 올바르지 않습니다.");
  }

  const attempt = await OAuthState.findOneAndDelete({ stateHash: hashState(state), expiresAt: { $gt: new Date() } }).lean();
  if (!attempt) return response.status(400).send("인증 요청이 만료되었거나 이미 사용됐습니다. 다시 인증해 주세요.");

  const host = await BotHost.findOne({ _id: attempt.hostId, enabled: true }).lean();
  if (!host) return response.status(400).send("호기가 비활성화되어 인증을 완료할 수 없습니다.");
  const authPanel = attempt.authPanelId
    ? await AuthPanel.findOne({ _id: attempt.authPanelId, hostId: host._id }).lean()
    : null;
  if (attempt.authPanelId && !authPanel) return response.status(400).send("인증 패널 설정을 찾을 수 없습니다. 새 패널에서 다시 인증해 주세요.");
  const clientSecret = decryptSecret(host.clientSecret, config.tokenEncryptionKey);
  const credentials = Buffer.from(host.clientId + ":" + clientSecret).toString("base64");
  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + credentials, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl() }),
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token || !tokenData.refresh_token || !String(tokenData.scope ?? "").split(" ").includes("guilds.join")) {
    console.error("OAuth token exchange failed with status", tokenResponse.status);
    return response.status(400).send("OAuth 토큰을 발급받지 못했습니다. 다시 시도해 주세요.");
  }

  const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: "Bearer " + tokenData.access_token },
  });
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok || !/^\d{17,22}$/.test(String(user.id ?? ""))) {
    return response.status(400).send("Discord 사용자 정보를 확인하지 못했습니다.");
  }

  await RestoredUser.findOneAndUpdate(
    { hostId: host._id, discordUserId: user.id },
    {
      $set: {
        username: user.global_name || user.username,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        email: user.email || undefined,
        status: "ACTIVE",
        lastUpdated: new Date(),
        tokenExpiresAt: new Date(Date.now() + Number(tokenData.expires_in ?? 604800) * 1000),
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
  );
  let authPanelDetails = null;
  if (authPanel) {
    const botToken = decryptSecret(host.botToken, config.tokenEncryptionKey);
    authPanelDetails = await resolveAuthPanelDetails(authPanel, botToken);
    const joinResponse = await fetch(`https://discord.com/api/v10/guilds/${authPanel.guildId}/members/${user.id}`, {
      method: "PUT",
      headers: { Authorization: "Bot " + botToken, "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: tokenData.access_token }),
    });
    if (!joinResponse.ok) {
      console.error("OAuth guild join failed with status", joinResponse.status);
      await publishAuthLog({ user, host, guildName: authPanelDetails.guildName, roleName: authPanelDetails.roleName, success: false, reason: "서버 입장 실패 · HTTP " + joinResponse.status });
      return response.status(502).type("html").send(oauthResultPage({
        title: "인증은 완료됐지만 서버 입장에 실패했습니다.",
        message: "호기 봇이 대상 서버에 있고 초대 만들기 권한을 갖는지 확인해 주세요.",
        footer: "인증 정보는 저장되었습니다.",
      }));
    }
    const roleResponse = await fetch(`https://discord.com/api/v10/guilds/${authPanel.guildId}/members/${user.id}/roles/${authPanel.roleId}`, {
      method: "PUT",
      headers: { Authorization: "Bot " + botToken },
    });
    if (!roleResponse.ok) {
      console.error("OAuth role assignment failed with status", roleResponse.status);
      await publishAuthLog({ user, host, guildName: authPanelDetails.guildName, roleName: authPanelDetails.roleName, success: false, reason: "역할 지급 실패 · HTTP " + roleResponse.status });
      return response.status(502).type("html").send(oauthResultPage({
        title: "인증은 완료됐지만 역할 지급에 실패했습니다.",
        message: "호기 봇의 역할 관리 권한과 역할 순서를 확인해 주세요.",
        details: [["서버", authPanelDetails.guildName], ["지급 역할", authPanelDetails.roleName]],
        footer: "인증 정보는 저장되었습니다.",
      }));
    }
  }
  const displayName = user.global_name || user.username;
  await publishAuthLog({
    user,
    host,
    guildName: authPanelDetails?.guildName,
    roleName: authPanelDetails?.roleName,
    success: true,
    reason: "디스코드 인증을 완료했습니다.",
  });
  return response.type("html").send(oauthResultPage({
    title: "인증이 완료되었습니다.",
    message: displayName + " 님의 인증 정보가 저장되었습니다.",
    details: authPanelDetails ? [["서버", authPanelDetails.guildName], ["지급 역할", authPanelDetails.roleName]] : [],
    footer: authPanel ? "역할 지급이 완료되었습니다. 이제 창을 닫아도 됩니다." : "이제 창을 닫아도 됩니다.",
    success: true,
  }));
});

async function resolveAuthPanelDetails(authPanel, botToken) {
  const headers = { Authorization: "Bot " + botToken };
  const [guildResponse, rolesResponse] = await Promise.all([
    fetch(`https://discord.com/api/v10/guilds/${authPanel.guildId}`, { headers }).catch(() => null),
    fetch(`https://discord.com/api/v10/guilds/${authPanel.guildId}/roles`, { headers }).catch(() => null),
  ]);
  const guild = guildResponse?.ok ? await guildResponse.json().catch(() => ({})) : {};
  const roles = rolesResponse?.ok ? await rolesResponse.json().catch(() => []) : [];
  const role = Array.isArray(roles) ? roles.find((item) => item.id === authPanel.roleId) : null;
  return {
    guildName: guild.name || authPanel.guildName || authPanel.guildId || "서버 정보 없음",
    roleName: role?.name || authPanel.roleName || (authPanel.roleId ? "역할 정보를 불러오지 못했습니다." : "설정된 역할 없음"),
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function oauthResultPage({ title, message, details = [], footer = "", success = false }) {
  const detailMarkup = details.map(([label, value]) => `<div class="oauth-result-detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  const iconMarkup = success
    ? '<div class="oauth-result-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 12.5 4 4L18.5 8"/></svg></div>'
    : '<div class="oauth-result-icon oauth-result-icon-error" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 8v5m0 3h.01"/><circle cx="12" cy="12" r="9"/></svg></div>';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b0b0b"><link rel="icon" type="image/png" href="/assets/veloxcore-logo.png"><link rel="stylesheet" href="/assets/style.css"><title>${escapeHtml(title)} | Veloxcore Recovery</title></head><body data-page="oauth-result"><header class="topbar"><div class="brand"><img src="/assets/veloxcore-logo.png" alt=""><span>𝗩𝗲𝗹𝗼𝘅𝗰𝗼𝗿𝗲 𝗥𝗲𝗰𝗼𝘃𝗲𝗿𝘆</span></div></header><main class="oauth-result-main"><section class="panel oauth-result-card" aria-live="polite">${iconMarkup}<p class="eyebrow">${success ? "AUTHENTICATION" : "AUTHENTICATION NOTICE"}</p><h1>${escapeHtml(title)}</h1><p class="oauth-result-message">${escapeHtml(message)}</p><div class="oauth-result-details">${detailMarkup}</div><hr><footer>${escapeHtml(footer)}</footer></section></main></body></html>`;
}




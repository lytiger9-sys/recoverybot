import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import { config } from "../config/env.js";

let authLogClient;

export function setAuthLogClient(client) {
  authLogClient = client;
}

function safeText(value, limit = 500) {
  return String(value || "정보 없음").replace(/[\r\n]+/g, " ").slice(0, limit);
}

export async function publishAuthLog({ user, host, guildName, roleName, success, reason }) {
  if (!config.authLogChannelId) return;
  if (!authLogClient?.isReady()) {
    console.warn("Authentication log was skipped: main bot is offline.");
    return;
  }

  try {
    const channel = await authLogClient.channels.fetch(config.authLogChannelId);
    if (!channel?.isTextBased()) throw new Error("Authentication log channel is unavailable.");

    const displayName = safeText(user.global_name || user.username, 100);
    const username = safeText(user.username, 100);
    const lines = [
      "# 디스코드 인증 로그",
      "**상태**\n" + (success ? "성공" : "실패"),
      "**유저**\n표시 이름: " + displayName + "\n계정명: @" + username + "\n멘션: <@" + user.id + ">",
      "**유저 ID**\n" + user.id,
      "**서버**\n" + safeText(guildName || (host?.name ? host.name + " 인증" : "인증 패널 없음")),
      "**지급 역할**\n" + safeText(roleName || "없음", 100),
      "**사유**\n" + safeText(reason || (success ? "디스코드 인증을 완료했습니다." : "인증 처리에 실패했습니다.")),
      "-# " + new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
    ];
    await channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [new ContainerBuilder()
        .setAccentColor(success ? 0x57f287 : 0xed4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n\n")))],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error("Authentication log publish failed:", error?.message ?? error?.name ?? "UnknownError");
  }
}

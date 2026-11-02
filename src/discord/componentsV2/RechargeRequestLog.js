import { ContainerBuilder, TextDisplayBuilder } from "discord.js";

const states = {
  PENDING: { label: "대기 중", color: 0xfee75c },
  PAID: { label: "완료", color: 0x57f287 },
  EXPIRED: { label: "만료", color: 0xed4245 },
};

export function buildRechargeRequestLog(request) {
  const state = states[request.status] ?? states.PENDING;
  const createdAt = new Date(request.createdAt ?? Date.now()).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const expiresAt = new Date(request.expiresAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  return new ContainerBuilder().setAccentColor(state.color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      "# 자동충전 요청 · " + state.label,
      "요청자: <@" + request.discordUserId + "> (`" + request.discordUserId + "`)",
      "입금자명: **" + request.depositorName + "**",
      "요청 금액: **" + Number(request.amountMinor).toLocaleString("ko-KR") + "원**",
      "요청 시각: " + createdAt,
      "만료 시각: " + expiresAt,
    ].join("\n")));
}

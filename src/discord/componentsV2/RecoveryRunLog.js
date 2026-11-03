import { ContainerBuilder, TextDisplayBuilder } from "discord.js";

const failureLabels = {
  oauth_revoked: "OAuth 토큰이 만료되었거나 사용자가 인증을 취소함",
  discord_401: "Discord 인증 실패",
  discord_403: "봇 권한 또는 OAuth 권한 부족",
  discord_404: "대상 서버 또는 유저를 찾을 수 없음",
  discord_429: "재시도 후에도 Discord 요청 제한에 도달함",
  discord_5xx: "Discord 서버 오류",
  discord_error: "Discord API 요청 실패",
  network_error: "Discord API 연결 오류",
  member_check_failed: "Discord에서 대상 유저의 가입 상태를 확인할 수 없음",
  membership_mismatch: "Discord 응답과 서버의 실제 가입 상태가 일치하지 않음",
  run_incomplete: "호기 중단 또는 대상 변경으로 미처리",
  host_offline: "호기 봇 오프라인",
  host_auth_failed: "호기 봇 인증 실패",
  host_left_guild: "호기 봇이 서버에서 나감",
  bot_permission_lost: "호기 봇 권한 상실",
  process_restarted: "프로세스 재시작으로 중단",
  unexpected_error: "예상하지 못한 계정 처리 오류",
};

function readFailureReasons(value) {
  if (value instanceof Map) return [...value.entries()];
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

export function buildRecoveryRunLog(run, hosts, license, context = {}) {
  const total = Number(run.total ?? 0);
  const overallTotal = Number(run.overallTotal ?? total);
  const successCount = Array.isArray(run.completedUserIds)
    ? run.completedUserIds.length
    : Number(run.succeeded ?? 0) + Number(run.alreadyMember ?? 0);
  const isFailed = run.status === "FAILED";
  const title = isFailed ? "복구 실패 로그" : "복구 성공 로그";
  const lines = [
    "결과: **" + (isFailed ? "실패" : "성공") + "**",
    "이번 작업 시도: **" + Number(run.processed ?? 0).toLocaleString("ko-KR") + "/" + total.toLocaleString("ko-KR") + "명**",
    "누적 가입 완료: **" + successCount.toLocaleString("ko-KR") + "/" + overallTotal.toLocaleString("ko-KR") + "명**",
    "실패 인원: **" + Number(run.failed ?? 0).toLocaleString("ko-KR") + "명**",
    "이미 서버에 있던 인원: **" + Number(run.alreadyMember ?? 0).toLocaleString("ko-KR") + "명**",
    "대상 서버: **" + (context.guildName || run.targetGuildName || "서버명 확인 불가") + "** (`" + run.targetGuildId + "`)",
    "실행자: " + (context.initiator?.discordId && /^\d{17,22}$/.test(context.initiator.discordId)
      ? "<@" + context.initiator.discordId + ">"
      : "**" + (context.initiator?.username || run.initiatorUsername || "정보 없음") + "**")
      + ((context.initiator?.username || run.initiatorUsername) ? " (" + String(context.initiator?.username || run.initiatorUsername).replace(/`/g, "'") + ")" : ""),
    "실행 구분: **" + (run.licenseId ? "라이선스 복구" : "관리자 직접 복구") + "**",
    "사용 호기: **" + (hosts.map((host) => host.name).join(", ") || "삭제된 호기") + "**",
  ];
  if (license?.productName) lines.push("상품: **" + license.productName + "**");
  if (license?.code) lines.push("라이선스: `" + license.code + "`");

  const reasons = readFailureReasons(run.failureReasons)
    .filter(([, count]) => Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, 8);
  if (reasons.length) {
    lines.push("실패 사유:");
    for (const [code, count] of reasons) {
      lines.push("• " + (failureLabels[code] ?? "기타 오류") + " — " + Number(count).toLocaleString("ko-KR") + "명");
    }
  }
  if (run.message) lines.push("작업 오류: " + String(run.message).slice(0, 500));

  return new ContainerBuilder()
    .setAccentColor(isFailed ? 0xed4245 : 0x57f287)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("# " + title + "\n" + lines.join("\n")));
}

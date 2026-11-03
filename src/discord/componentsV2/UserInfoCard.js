import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";

function won(value) {
  return Number(value ?? 0).toLocaleString("ko-KR") + "원";
}

export function buildUserInfoCard(user, info) {
  const licenseSummary = "구매 " + Number(info.purchasedLicenseCount).toLocaleString("ko-KR") + "개 · 사용 가능 " + Number(info.availableLicenseCount).toLocaleString("ko-KR") + "개";
  const content = new TextDisplayBuilder().setContent([
    "# 내 정보",
    "<@" + user.id + "> · " + user.username,
    "",
    "잔액: **" + won(info.balance) + "**",
    "누적 구매 금액: **" + won(info.totalPurchaseAmount) + "**",
    "보유 라이선스: **" + licenseSummary + "**",
    "할인 우선순위: 적용 중인 할인 없음",
    "미작성 후기: **" + Number(info.pendingReviewCount).toLocaleString("ko-KR") + "개**",
  ].join("\n"));

  return new ContainerBuilder().setAccentColor(0x5865f2)
    .addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(content)
      .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: user.displayAvatarURL({ size: 128 }) } }).setDescription(user.username + " 프로필 사진")));
}

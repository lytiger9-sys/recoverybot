import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  SectionBuilder,
  TextInputBuilder,
  TextInputStyle,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";

export function buildLicenseInfoCard(title, lines, color = 0xc8a45b, thumbnailUrl = null) {
  const content = new TextDisplayBuilder().setContent(`# ${title}\n${lines.join("\n")}`);
  const container = new ContainerBuilder().setAccentColor(color);
  if (thumbnailUrl) {
    container.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(content)
      .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: thumbnailUrl } }).setDescription(title)));
  } else {
    container.addTextDisplayComponents(content);
  }
  return container;
}

export function buildLicenseDeliveryCard(license, hosts, expectedMemberCount) {
  const duration = license.durationDays ? license.durationDays + "일" : "영구";
  const expires = license.expiresAt ? new Date(license.expiresAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "없음 (영구)";
  return buildLicenseInfoCard("라이선스 발급 완료", [
    "라이선스: `" + license.code + "`",
    "배정 호기: **" + hosts.map((host) => host.name).join(", ") + "**",
    "예상 복구 인원: **" + Number(expectedMemberCount).toLocaleString("ko-KR") + "명**",
    "유효기간: **" + duration + "**",
    "만료 시각: **" + expires + "**",
    "라이선스는 복구 승인 후 1회 사용할 수 있습니다.",
  ]);
}

export function buildProductMenu(products) {
  const container = new ContainerBuilder().setAccentColor(0xc8a45b)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("# 상품 선택\n구매할 라이선스 상품을 선택해 주세요."));
  if (!products.length) return container.addTextDisplayComponents(new TextDisplayBuilder().setContent("현재 구매 가능한 상품이 없습니다."));
  const menu = new StringSelectMenuBuilder().setCustomId("license:product-select").setPlaceholder("라이선스 상품").addOptions(
    products.slice(0, 25).map((product) => new StringSelectMenuOptionBuilder()
      .setLabel(product.name.slice(0, 100))
      .setDescription((Number(product.priceMinor).toLocaleString("ko-KR") + "원 · 예상 " + product.minimumActiveMembers + "–" + product.maximumActiveMembers + "명").slice(0, 100))
      .setValue(String(product._id))),
  );
  return container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
}

export function buildPurchaseReviewMenu(purchases) {
  const container = new ContainerBuilder().setAccentColor(0x77797e)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("# 구매 후기\n후기를 작성할 구매 내역을 선택해 주세요."));
  if (!purchases.length) {
    return container.addTextDisplayComponents(new TextDisplayBuilder().setContent("후기를 작성할 구매 내역이 없습니다."));
  }
  const menu = new StringSelectMenuBuilder().setCustomId("license:review-select")
    .setPlaceholder("후기를 작성할 구매 선택")
    .addOptions(purchases.map((purchase) => new StringSelectMenuOptionBuilder()
      .setLabel(String(purchase.productName || "라이선스 상품").slice(0, 100))
      .setDescription(new Date(purchase.createdAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }))
      .setValue(String(purchase._id))));
  return container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
}

export function buildPurchaseReviewModal(licenseId, productName) {
  const rating = new TextInputBuilder()
    .setCustomId("rating")
    .setLabel("별점 (1~5 숫자)")
    .setStyle(TextInputStyle.Short)
    .setMinLength(1)
    .setMaxLength(1)
    .setPlaceholder("5")
    .setRequired(true);
  const content = new TextInputBuilder()
    .setCustomId("content")
    .setLabel("후기 내용")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(2)
    .setMaxLength(1000)
    .setPlaceholder(productName + " 구매 후기를 적어 주세요.")
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId("license:review-submit:" + licenseId)
    .setTitle("구매 후기 작성")
    .addComponents(
      new ActionRowBuilder().addComponents(rating),
      new ActionRowBuilder().addComponents(content),
    );
}

export function buildPurchaseReviewLog(review, reviewer) {
  const purchasedAt = new Date(review.purchasedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  return new ContainerBuilder().setAccentColor(0xc8a45b)
    .addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent([
      "# 새 후기",
      "유저: <@" + reviewer.id + "> (" + reviewer.username + ")",
      "제품: " + review.productName,
      "구매일: " + purchasedAt,
      "별점: **" + "⭐".repeat(review.rating) + "** (" + review.rating + "/5)",
      "",
      review.content,
    ].join("\n"))).setThumbnailAccessory(new ThumbnailBuilder({ media: { url: reviewer.displayAvatarURL({ size: 128 }) } }).setDescription(reviewer.username + " 프로필 사진")));
}

export function buildProductConfirm(product, hosts, expectedCount) {
  const hostNames = hosts.map((host) => host.name).join(", ");
  const duration = product.validityDays ? product.validityDays + "일" : "영구";
  const lines = [
    "상품: **" + product.name + "**",
    "가격: **" + Number(product.priceMinor).toLocaleString("ko-KR") + "원**",
    "배정 호기: **" + hostNames + "**",
    "예상 복구 인원: **" + expectedCount.toLocaleString("ko-KR") + "명**",
    "유효기간: **" + duration + "**",
    "구매하면 1회용 라이선스가 발급됩니다.",
  ];
  return new ContainerBuilder().setAccentColor(0xc8a45b)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("# 구매 확인\n" + lines.join("\n")))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("license:purchase:" + product._id + ":" + product.priceMinor).setLabel("구매 확정").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("license:cancel").setLabel("취소").setStyle(ButtonStyle.Secondary),
    ));
}

export function buildApprovalPanel(request, license, hosts, state = "PENDING") {
  const stateText = {
    PENDING: "승인 대기 중",
    APPROVED: request.autoApproved ? "관리자 요청으로 자동 승인됨" : "관리자가 승인함 · 복구 진행 중",
    REJECTED: "거절됨",
    FAILED: "복구 시작 실패",
    EXPIRED: "라이선스 만료됨",
  }[state] ?? state;
  const container = new ContainerBuilder().setAccentColor(state === "REJECTED" || state === "FAILED" || state === "EXPIRED" ? 0xed4245 : state === "APPROVED" ? 0x57f287 : 0xfee75c)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      "# 라이선스 복구 승인 요청",
      "요청자: <@" + request.requesterDiscordId + "> (`" + request.requesterDiscordId + "`)",
      "라이선스: `" + license.code + "`",
      "대상 서버: **" + (request.targetGuildName || "알 수 없음") + "** (`" + request.targetGuildId + "`)",
      "복구 호기: **" + hosts.map((host) => host.name).join(", ") + "**",
      "예상 복구 인원: **" + Number(license.expectedMemberCount).toLocaleString("ko-KR") + "명**",
      "요청 상태: **" + stateText + "**",
    ].join("\n")));
  if (state === "PENDING") {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("license:approve:" + request._id).setLabel("승인").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("license:reject:" + request._id).setLabel("거절").setStyle(ButtonStyle.Danger),
    ));
  }
  return container;
}

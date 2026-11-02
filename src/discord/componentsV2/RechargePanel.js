import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MediaGalleryBuilder, SeparatorBuilder, TextDisplayBuilder } from "discord.js";

function parseAccentColor(value) {
  return /^#[\da-f]{6}$/i.test(value ?? "") ? Number.parseInt(value.slice(1), 16) : 0xc8a45b;
}

export function buildRechargePanel(settings) {
  const title = settings?.embedTitle || "자동충전";
  const description = settings?.embedDescription || "아래 버튼을 눌러 입금 요청을 등록해 주세요.";
  const minimum = Number(settings?.minimumTopupMinor ?? 100).toLocaleString("ko-KR");
  const container = new ContainerBuilder().setAccentColor(parseAccentColor(settings?.embedColor))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${description}\n\n- 최소 충전 금액은 ${minimum}원입니다.`,
    ));
  if (settings?.embedImageUrl) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems((item) => item.setURL(settings.embedImageUrl)));
  container.addSeparatorComponents(new SeparatorBuilder()).addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("recharge:open").setLabel("입금").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("recharge:balance").setLabel("내정보").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("license:product-open").setLabel("상품").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("license:review-open").setLabel("후기").setStyle(ButtonStyle.Secondary),
  ));
  if (settings?.embedFooter?.trim()) {
    container.addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# *${settings.embedFooter.trim()}*`));
  }
  return container;
}

export function buildRechargeInfoCard({ title, lines, color = 0xc8a45b }) {
  return new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}\n${lines.join("\n")}`));
}

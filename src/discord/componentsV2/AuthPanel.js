import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder } from "discord.js";

export function buildAuthPanel(hostName, authUrl) {
  return new ContainerBuilder().setAccentColor(0x5865f2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${hostName} 계정 인증\n계정을 복구 목록에 등록하려면 버튼을 눌러 웹사이트에서 Discord 인증을 완료해 주세요.`))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Discord 계정 인증").setStyle(ButtonStyle.Link).setURL(authUrl),
    ));
}

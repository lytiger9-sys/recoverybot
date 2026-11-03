import { MessageFlags } from "discord.js";
import { BotHost } from "../models/BotHost.js";
import { License } from "../models/License.js";
import { LicenseApprovalRequest } from "../models/LicenseApprovalRequest.js";
import { config } from "../config/env.js";
import { buildRecoveryRunLog } from "./componentsV2/RecoveryRunLog.js";

let logClient;

export function setRecoveryLogClient(client) {
  logClient = client;
}

export async function publishRecoveryRunLog(run) {
  if (!config.recoveryLogChannelId || !logClient?.isReady()) return;
  const channel = await logClient.channels.fetch(config.recoveryLogChannelId);
  if (!channel?.isTextBased()) throw new Error("복구 로그 채널을 찾을 수 없습니다.");
  const [hosts, license, approvalRequest] = await Promise.all([
    BotHost.find({ _id: { $in: run.hostIds } }).select("name").sort({ createdAt: 1 }).lean(),
    run.licenseId ? License.findById(run.licenseId).select("code productName").lean() : null,
    run.licenseApprovalRequestId ? LicenseApprovalRequest.findById(run.licenseApprovalRequestId).select("requesterDiscordId requesterUsername targetGuildName").lean() : null,
  ]);
  const guildName = run.targetGuildName || approvalRequest?.targetGuildName || "";
  const initiator = {
    discordId: run.initiatorDiscordId || approvalRequest?.requesterDiscordId || "",
    username: run.initiatorUsername || approvalRequest?.requesterUsername || "",
  };
  const mentionIds = /^\d{17,22}$/.test(initiator.discordId) ? [initiator.discordId] : [];
  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [buildRecoveryRunLog(run, hosts, license, { guildName, initiator })],
    allowedMentions: { parse: [], users: mentionIds },
  });
}

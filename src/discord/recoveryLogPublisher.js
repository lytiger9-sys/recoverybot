import { MessageFlags } from "discord.js";
import { BotHost } from "../models/BotHost.js";
import { License } from "../models/License.js";
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
  const [hosts, license] = await Promise.all([
    BotHost.find({ _id: { $in: run.hostIds } }).select("name").sort({ createdAt: 1 }).lean(),
    run.licenseId ? License.findById(run.licenseId).select("code productName").lean() : null,
  ]);
  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [buildRecoveryRunLog(run, hosts, license)],
    allowedMentions: { parse: [] },
  });
}

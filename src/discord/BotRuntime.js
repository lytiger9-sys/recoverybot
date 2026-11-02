import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, MessageFlags,
  GatewayIntentBits, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder,
  TextInputBuilder, TextInputStyle,
} from "discord.js";
import { BotHost } from "../models/BotHost.js";
import { AutoRechargeSettings } from "../models/AutoRechargeSettings.js";
import { RechargeRequest } from "../models/RechargeRequest.js";
import { config } from "../config/env.js";
import { UserBalance } from "../models/UserBalance.js";
import { buildRechargeInfoCard, buildRechargePanel } from "./componentsV2/RechargePanel.js";
import { buildRechargeRequestLog } from "./componentsV2/RechargeRequestLog.js";
import { buildApprovalPanel, buildLicenseDeliveryCard, buildLicenseInfoCard, buildProductConfirm, buildProductMenu, buildPurchaseReviewLog, buildPurchaseReviewMenu, buildPurchaseReviewModal } from "./componentsV2/LicensePanels.js";
import { License } from "../models/License.js";
import { setRecoveryLogClient } from "./recoveryLogPublisher.js";
import { clearHostBotStatus, getHostBotStatus as getStoredHostBotStatus, retainHostBotStatuses, setHostBotStatus } from "./hostBotRegistry.js";
import {
  abandonLicenseUseRequest,
  autoApproveLicenseRequest,
  createLicenseUseRequest,
  decideLicenseRequest,
  findProductHostCombination,
  getAvailableLicenseProducts,
  purchaseLicenseProduct,
} from "../services/LicenseService.js";
import { adjustUserBalance, BalanceAdjustmentError } from "../services/AdminBalanceService.js";
import { getPurchasesAwaitingReview, getReviewablePurchase, submitPurchaseReview } from "../services/PurchaseReviewService.js";
import { startMainBotPresence } from "../services/MainBotPresence.js";
import { probeDiscordGatewayRest } from "./DiscordGatewayProbe.js";

let mainClient;
let refreshTimer;
let stopMainBotPresence;
let mainBotLoginInProgress = false;
let nextMainBotAttemptAt = 0;
const adminPermission = PermissionFlagsBits.Administrator.toString();
const rechargePanelCommand = new SlashCommandBuilder()
  .setName("recharge-panel").setDescription("자동충전 패널을 지정 채널에 게시합니다.")
  .setDefaultMemberPermissions(adminPermission)
  .addChannelOption((option) => option.setName("channel").setDescription("게시 채널").addChannelTypes(ChannelType.GuildText).setRequired(true));
const manualRechargeCommand = new SlashCommandBuilder()
  .setName("수동충전").setDescription("유저 잔액을 수동으로 충전하거나 차감합니다.")
  .setDefaultMemberPermissions(adminPermission)
  .addUserOption((option) => option.setName("유저").setDescription("잔액을 조정할 유저").setRequired(true))
  .addIntegerOption((option) => option.setName("금액").setDescription("원 단위 금액, 음수는 차감").setMinValue(-Number.MAX_SAFE_INTEGER).setMaxValue(Number.MAX_SAFE_INTEGER).setRequired(true));
const recoverCommand = new SlashCommandBuilder()
  .setName("recover").setDescription("라이선스로 지정한 서버의 복구를 요청합니다.")
  .addStringOption((option) => option.setName("license").setDescription("VC-로 시작하는 14자리 라이선스 코드").setMinLength(17).setMaxLength(17).setRequired(true))
  .addStringOption((option) => option.setName("server_id").setDescription("복구할 대상 서버 ID").setMinLength(17).setMaxLength(22).setRequired(true));

function normalizeName(value) { return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[\s\u200b-\u200d\ufeff]/g, ""); }
async function getRechargeSettings() { return AutoRechargeSettings.findOne({ key: "default" }).lean(); }

async function postLicenseApproval(request, license, hosts, state = "PENDING") {
  if (!mainClient?.isReady() || !config.recoveryApprovalChannelId) throw new Error("승인 채널 또는 메인봇이 설정되지 않았습니다.");
  const channel = await mainClient.channels.fetch(config.recoveryApprovalChannelId);
  if (!channel?.isTextBased()) throw new Error("승인 채널을 찾을 수 없습니다.");
  return channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [buildApprovalPanel(request, license, hosts, state)],
    allowedMentions: { parse: [] },
  });
}

async function postLicensePurchaseLog(channelId, title, lines, thumbnailUrl) {
  if (!mainClient?.isReady() || !channelId) return;
  const channel = await mainClient.channels.fetch(channelId);
  if (!channel?.isTextBased()) return;
  await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [buildLicenseInfoCard(title, lines, 0xc8a45b, thumbnailUrl)],
    allowedMentions: { parse: [] },
  });
}

export async function postRechargeRequestLog(request) {
  if (!mainClient?.isReady() || !request.chargeLogChannelId) throw new Error("충전 로그 채널 또는 메인봇이 설정되지 않았습니다.");
  const channel = await mainClient.channels.fetch(request.chargeLogChannelId);
  if (!channel?.isTextBased()) throw new Error("충전 로그 채널을 찾을 수 없습니다.");
  return channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [buildRechargeRequestLog(request)],
    allowedMentions: { parse: [] },
  });
}

export async function updateRechargeRequestLog(requestId) {
  const request = await RechargeRequest.findById(requestId).lean();
  if (!request?.chargeLogChannelId || !request.chargeLogMessageId || !mainClient?.isReady()) return false;
  const channel = await mainClient.channels.fetch(request.chargeLogChannelId);
  if (!channel?.isTextBased() || !channel.messages) return false;
  const message = await channel.messages.fetch(request.chargeLogMessageId);
  await message.edit({
    components: [buildRechargeRequestLog(request)],
    allowedMentions: { parse: [] },
  });
  await RechargeRequest.updateOne({ _id: request._id, status: request.status }, { $set: { chargeLogStatus: request.status } });
  return true;
}

function ephemeralV2(interaction, title, lines) {
  return interaction.reply({
    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    components: [buildLicenseInfoCard(title, lines)],
  });
}
async function notifyLicenseRequester(request, title, lines) {
  if (!mainClient?.isReady()) return;
  try {
    const user = await mainClient.users.fetch(request.requesterDiscordId);
    await user.send({ flags: MessageFlags.IsComponentsV2, components: [buildLicenseInfoCard(title, lines)] });
  } catch { /* Request status remains authoritative if DMs are unavailable. */ }
}

async function sendConfiguredLog(channelId, content) {
  if (!channelId || !mainClient) return;
  try {
    const channel = await mainClient.channels.fetch(channelId);
    if (channel?.isTextBased()) await channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [buildLicenseInfoCard("자동충전 알림", [content])],
      allowedMentions: { parse: [] },
    });
  } catch { /* Logging failure does not change request state. */ }
}

function configureClient(client) {
  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "recover") {
          const targetGuildId = interaction.options.getString("server_id", true).trim();
          if (!/^\d{17,22}$/.test(targetGuildId)) {
            return ephemeralV2(interaction, "서버 ID 확인", ["복구할 Discord 서버 ID를 확인해 주세요."]);
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
          try {
            const result = await submitLicenseRecoveryRequest({
              code: interaction.options.getString("license", true),
              requesterDiscordId: interaction.user.id,
              requesterUsername: interaction.user.username,
              targetGuildId,
              targetGuildName: "",
            });
            const lines = result.state === "PENDING"
              ? ["관리자 승인 요청을 보냈습니다. 승인되면 각 호기가 순서대로 복구합니다."]
              : result.state === "APPROVED"
                ? ["관리자 요청으로 자동 승인되어 각 호기에 복구 작업을 전달했습니다."]
                : [result.error || "복구 요청을 처리하지 못했습니다."];
            lines.push("대상 서버 ID: `" + targetGuildId + "`");
            lines.push("호기: **" + (result.hostNames ?? []).join(", ") + "**");
            lines.push("예상 복구 인원: **" + Number(result.expectedMemberCount ?? 0).toLocaleString("ko-KR") + "명**");
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [buildLicenseInfoCard("라이선스 복구 요청", lines, result.state === "FAILED" ? 0xed4245 : 0x77797e)] });
          } catch (error) {
            return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [buildLicenseInfoCard("복구 요청 실패", [error?.message ?? "요청을 처리하지 못했습니다."], 0xed4245)] });
          }
        }
        if (interaction.commandName === "수동충전") {
          if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return ephemeralV2(interaction, "권한 없음", ["서버 관리자만 사용할 수 있습니다."]);
          }
          const target = interaction.options.getUser("유저", true);
          const amountMinor = interaction.options.getInteger("금액", true);
          await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
          try {
            const adjustment = await adjustUserBalance({
              discordUserId: target.id,
              amountMinor,
              adminId: interaction.user.id,
              adminName: interaction.user.username,
            });
            return interaction.editReply({
              flags: MessageFlags.IsComponentsV2,
              components: [buildLicenseInfoCard("수동 충전 처리 완료", [
                "유저: <@" + target.id + "> (`" + target.id + "`)",
                "조정 금액: **" + (amountMinor > 0 ? "+" : "") + amountMinor.toLocaleString("ko-KR") + "원**",
                "이전 잔액: **" + adjustment.previousCashMinor.toLocaleString("ko-KR") + "원**",
                "현재 잔액: **" + adjustment.cashMinor.toLocaleString("ko-KR") + "원**",
              ], 0x57f287)],
            });
          } catch (error) {
            const detail = error instanceof BalanceAdjustmentError ? error.message : "잔액을 조정하지 못했습니다.";
            return interaction.editReply({
              flags: MessageFlags.IsComponentsV2,
              components: [buildLicenseInfoCard("수동 충전 실패", [detail], 0xed4245)],
            });
          }
        }
        if (interaction.commandName === "recharge-panel") {
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return ephemeralV2(interaction, "권한 없음", ["서버 관리자만 사용할 수 있습니다."]);
          const channel = interaction.options.getChannel("channel", true);
          const settings = await getRechargeSettings();
          await channel.send({ flags: MessageFlags.IsComponentsV2, components: [buildRechargePanel(settings)] });
          return ephemeralV2(interaction, "충전 패널 게시 완료", ["충전 패널을 " + channel.toString() + " 채널에 게시했습니다."]);
        }
      }
      if (interaction.isButton() && interaction.customId === "license:product-open") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
        const available = await getAvailableLicenseProducts(getHostBotStatus);
        return interaction.editReply({
          flags: MessageFlags.IsComponentsV2,
          components: [buildProductMenu(available.map(({ product }) => product))],
        });
      }
      if (interaction.isButton() && interaction.customId === "license:review-open") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
        const purchases = await getPurchasesAwaitingReview(interaction.user.id);
        return interaction.editReply({
          flags: MessageFlags.IsComponentsV2,
          components: [buildPurchaseReviewMenu(purchases)],
        });
      }
      if (interaction.isStringSelectMenu() && interaction.customId === "license:review-select") {
        const purchase = await getReviewablePurchase(interaction.user.id, interaction.values[0]);
        if (!purchase) {
          return interaction.reply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            components: [buildLicenseInfoCard("구매 내역을 찾을 수 없음", ["본인의 아직 후기 작성 전인 구매 내역만 선택할 수 있습니다."], 0xed4245)],
          });
        }
        return interaction.showModal(buildPurchaseReviewModal(purchase._id, purchase.productName));
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith("license:review-submit:")) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
        try {
          const settings = await getRechargeSettings();
          if (!settings?.reviewLogChannelId) throw new Error("웹사이트의 자동충전 설정에서 리뷰 로그 채널을 설정해 주세요.");
          const licenseId = interaction.customId.slice("license:review-submit:".length);
          const review = await submitPurchaseReview({
            discordUserId: interaction.user.id,
            licenseId,
            rating: interaction.fields.getTextInputValue("rating").trim(),
            content: interaction.fields.getTextInputValue("content"),
          });
          let posted = true;
          try {
            if (!mainClient?.isReady()) throw new Error("메인봇이 오프라인입니다.");
            const channel = await mainClient.channels.fetch(settings.reviewLogChannelId);
            if (!channel?.isTextBased()) throw new Error("후기 채널을 찾을 수 없습니다.");
            await channel.send({
              flags: MessageFlags.IsComponentsV2,
              components: [buildPurchaseReviewLog(review, interaction.user)],
              allowedMentions: { users: [interaction.user.id] },
            });
          } catch (error) {
            posted = false;
            console.error("Purchase review log failed:", error?.name ?? "UnknownError");
          }
          return interaction.editReply({
            flags: MessageFlags.IsComponentsV2,
            components: [buildLicenseInfoCard("후기 등록 완료", [
              "상품: **" + review.productName + "**",
              "구매 일시: **" + new Date(review.purchasedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) + "**",
              "별점: **" + "⭐".repeat(review.rating) + "** (" + review.rating + "/5)",
              posted ? "후기를 등록하고 후기 채널에 게시했습니다. 감사합니다." : "후기는 저장했지만 후기 채널 게시에 실패했습니다. 관리자에게 알려 주세요.",
            ], 0x57f287)],
          });
        } catch (error) {
          return interaction.editReply({
            flags: MessageFlags.IsComponentsV2,
            components: [buildLicenseInfoCard("후기 등록 실패", [error?.message ?? "후기를 저장하지 못했습니다."], 0xed4245)],
          });
        }
      }
      if (interaction.isStringSelectMenu() && interaction.customId === "license:product-select") {
        await interaction.deferUpdate();
        const productId = interaction.values[0];
        const available = await getAvailableLicenseProducts(getHostBotStatus);
        const selected = available.find(({ product }) => String(product._id) === productId);
        if (!selected) return interaction.editReply({ components: [buildLicenseInfoCard("상품 구매 불가", ["현재 배정 가능한 호기 조합이 없습니다. 나중에 다시 확인해 주세요."]) ] });
        return interaction.editReply({ components: [buildProductConfirm(selected.product, selected.combination.hosts, selected.combination.total)] });
      }
      if (interaction.isButton() && interaction.customId === "license:cancel") {
        return interaction.update({ components: [buildLicenseInfoCard("구매 취소", ["상품 구매를 취소했습니다."])] });
      }
      if (interaction.isButton() && interaction.customId.startsWith("license:purchase:")) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
        try {
          const rechargeSettings = await getRechargeSettings();
          if (!rechargeSettings?.purchaseLogChannelId) throw new Error("관리자가 라이선스 구매 로그 채널을 설정해야 합니다.");
          const [, , productId, expectedPrice] = interaction.customId.split(":");
          const purchase = await purchaseLicenseProduct(productId, interaction.user.id, getHostBotStatus, Number(expectedPrice));
          const receipt = buildLicenseDeliveryCard(purchase.license, purchase.hosts, purchase.expectedMemberCount);
          await interaction.user.send({ flags: MessageFlags.IsComponentsV2, components: [receipt] }).catch(() => {});
          await postLicensePurchaseLog(rechargeSettings.purchaseLogChannelId, "라이선스 구매 기록", [
            "구매자: <@" + interaction.user.id + "> (`" + interaction.user.id + "`)",
            "상품: **" + purchase.product.name + "** · **" + Number(purchase.product.priceMinor).toLocaleString("ko-KR") + "원**",
            "배정 호기: **" + purchase.hosts.map((item) => item.name).join(", ") + "**",
            "예상 복구 인원: **" + purchase.expectedMemberCount.toLocaleString("ko-KR") + "명**",
          ], interaction.user.displayAvatarURL({ size: 128 })).catch((error) => console.error("License audit log failed:", error?.name ?? "UnknownError"));
          return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [receipt] });
        } catch (error) {
          const lines = error?.code === "INSUFFICIENT_BALANCE" ? ["보유 캐시가 부족합니다."] : [error?.message ?? "구매를 완료하지 못했습니다."];
          return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [buildLicenseInfoCard("구매 실패", lines, 0xed4245)] });
        }
      }
      if (interaction.isButton() && (interaction.customId.startsWith("license:approve:") || interaction.customId.startsWith("license:reject:"))) {
        if (!config.recoveryAdminUserId || interaction.user.id !== config.recoveryAdminUserId) {
          return ephemeralV2(interaction, "권한 없음", ["설정된 복구 관리자만 승인 요청을 처리할 수 있습니다."]);
        }
        await interaction.deferUpdate();
        const [prefix, decision, requestId] = interaction.customId.split(":");
        const result = await decideLicenseRequest(requestId, decision === "approve" ? "APPROVED" : "REJECTED", interaction.user.id);
        const hosts = await BotHost.find({ _id: { $in: result.request.hostIds } }).sort({ createdAt: 1 }).lean();
        await interaction.editReply({ components: [buildApprovalPanel(result.request, result.license, hosts, result.state)], allowedMentions: { parse: [] } });
        if (result.state === "REJECTED") {
          const message = result.license.status === "REJECTED"
            ? "두 차례 거절되어 이 라이선스는 더 사용할 수 없습니다."
            : "복구 요청이 거절됐습니다. 라이선스는 다시 발급완료 상태라 재요청할 수 있습니다.";
          await notifyLicenseRequester(result.request, "복구 요청 거절", [message]);
        } else if (result.state === "APPROVED") {
          await notifyLicenseRequester(result.request, "복구 승인 완료", ["관리자가 승인해 복구를 시작했습니다.", "호기: **" + hosts.map((item) => item.name).join(", ") + "**"]);
        } else if (result.state === "EXPIRED") {
          await notifyLicenseRequester(result.request, "라이선스 만료", ["승인 대기 중 라이선스 유효기간이 만료됐습니다."]);
        } else {
          await notifyLicenseRequester(result.request, "복구 시작 실패", [result.error?.message ?? "승인은 처리됐지만 복구를 시작하지 못했습니다. 라이선스는 다시 사용할 수 있습니다."]);
        }
        return;
      }
      if (interaction.isButton() && interaction.customId === "recharge:balance") {
        const balance = await UserBalance.findOne({ discordUserId: interaction.user.id }).lean();
        const cash = Number(balance?.cashMinor ?? 0).toLocaleString("ko-KR");
        return interaction.reply({
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
          components: [buildRechargeInfoCard({ title: "내 잔액", lines: ["보유 캐시: **" + cash + "원**"] })],
        });
      }
      if (interaction.isButton() && interaction.customId === "recharge:open") {
        const modal = new ModalBuilder().setCustomId("recharge:request").setTitle("자동충전 요청");
        modal.addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("depositorName").setLabel("입금자명").setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(40).setRequired(true)),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("amount").setLabel("입금할 금액 (원)").setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(12).setPlaceholder("예: 5000").setRequired(true)),
        );
        return interaction.showModal(modal);
      }
      if (interaction.isModalSubmit() && interaction.customId === "recharge:request") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
        const settings = await getRechargeSettings();
        if (!settings?.enabled) return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [buildRechargeInfoCard({ title: "충전 중지", lines: ["자동충전이 현재 중지되어 있습니다."] })] });
        const depositorName = interaction.fields.getTextInputValue("depositorName").trim();
        const amountRaw = interaction.fields.getTextInputValue("amount").trim().replace(/[ ,]/g, "");
        const amountMinor = Number(amountRaw);
        const minAmount = Number(settings.minimumTopupMinor ?? 100);
        if (!depositorName || !Number.isSafeInteger(amountMinor) || amountMinor < minAmount) return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [buildRechargeInfoCard({ title: "입력 확인", lines: ["입금자명과 금액을 확인해 주세요.", "최소 충전 금액: **" + minAmount.toLocaleString("ko-KR") + "원**"] })] });
        const pending = await RechargeRequest.findOne({ discordUserId: interaction.user.id, status: "PENDING", expiresAt: { $gt: new Date() } }).lean();
        if (pending) return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [buildRechargeInfoCard({ title: "요청 처리 중", lines: ["이미 처리 대기 중인 충전 요청이 있습니다.", "기존 요청을 완료하거나 만료 후 다시 신청해 주세요."] })] });
        if (!settings.chargeLogChannelId) return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [buildRechargeInfoCard({ title: "로그 채널 미설정", lines: ["관리자가 자동충전 요청 로그 채널을 설정하지 않았습니다."] })] });
        if (!settings.accountBank || !settings.accountNumber || !settings.accountHolder) return interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [buildRechargeInfoCard({ title: "계좌 미설정", lines: ["관리자가 충전 계좌 정보를 설정하지 않았습니다."] })] });
        const request = await RechargeRequest.create({
          discordUserId: interaction.user.id,
          depositorName,
          depositorNameKey: normalizeName(depositorName),
          amountMinor,
          accountBank: settings.accountBank,
          accountNumber: settings.accountNumber,
          accountHolder: settings.accountHolder,
          expiresAt: new Date(Date.now() + 10 * 60_000),
          chargeLogChannelId: settings.chargeLogChannelId,
        });
        try {
          const logMessage = await postRechargeRequestLog(request);
          request.chargeLogMessageId = logMessage.id;
          request.chargeLogStatus = "PENDING";
          await request.save();
        } catch (error) {
          await RechargeRequest.deleteOne({ _id: request._id, status: "PENDING" });
          throw error;
        }
        return interaction.editReply({
          flags: MessageFlags.IsComponentsV2,
          components: [buildRechargeInfoCard({
            title: "입금 요청 완료",
            lines: [
              "은행: **" + request.accountBank + "**",
              "계좌번호: **" + request.accountNumber + "**",
              "예금주: **" + request.accountHolder + "**",
              "입금자명: **" + depositorName + "**",
              "금액: **" + amountMinor.toLocaleString("ko-KR") + "원**",
              "요청 후 **10분 안에** 입금해 주세요. 입금자명과 금액이 모두 일치해야 충전됩니다.",
            ],
          })],
        });
      }
    } catch (error) {
      console.error("Discord interaction failed:", error?.name ?? "UnknownError");
      const failureCard = buildRechargeInfoCard({ title: "처리 실패", lines: ["요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."] });
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2, components: [failureCard] }).catch(() => {});
      } else if (interaction.isRepliable() && interaction.deferred) {
        await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [failureCard] }).catch(() => {});
      }
    }
  });
}

async function startMainClient(token) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.on("error", (error) => console.error("Main bot client error:", error?.message ?? error?.name ?? "UnknownError"));
  client.on("debug", (message) => {
    if (/Preparing to connect to the gateway|Fetched Gateway Information|Connecting to wss:|Waiting for identify|Sending IDENTIFY|network error/i.test(message)) {
      console.log("Main bot gateway stage:", message);
    }
  });
  client.on("shardError", (error, shardId) => console.error("Main bot gateway error:", { shardId, message: error?.message ?? error?.name ?? "UnknownError" }));
  client.on("shardDisconnect", (event, shardId) => console.error("Main bot gateway disconnected:", { shardId, code: event?.code, reason: event?.reason?.toString?.() ?? "" }));
  client.once("ready", async () => {
    console.log("Main bot online:", client.user?.tag ?? client.user?.username ?? "unknown");
    stopMainBotPresence?.();
    stopMainBotPresence = startMainBotPresence(client);
    try { await client.application.commands.set([rechargePanelCommand, manualRechargeCommand, recoverCommand].map((command) => command.toJSON())); }
    catch (error) { console.error("Discord command sync failed:", error?.message ?? error?.name ?? "UnknownError"); }
  });
  configureClient(client);
  console.log("Connecting main bot to Discord...");
  await probeDiscordGatewayRest(token, "Main bot");
  let loginTimeout;
  try {
    await Promise.race([
      client.login(token),
      new Promise((_, reject) => { loginTimeout = setTimeout(() => reject(new Error("Discord Gateway login timed out after 30 seconds.")), 30_000); }),
    ]);
    console.log("Main bot gateway connected; waiting for READY.");
  } catch (error) {
    client.destroy();
    throw error;
  } finally {
    clearTimeout(loginTimeout);
  }
  return client;
}

async function ensureMainBotConnected() {
  if (!config.mainBotToken) {
    console.error("Main bot was not started: MAIN_BOT_TOKEN is empty in the runner environment.");
    return;
  }
  if (mainClient || mainBotLoginInProgress || Date.now() < nextMainBotAttemptAt) return;
  mainBotLoginInProgress = true;
  try {
    mainClient = await startMainClient(config.mainBotToken);
  } catch (error) {
    const retryMs = error?.status === 429 ? (error.retryAfterMs ?? 60_000) + 5_000 : 30_000;
    nextMainBotAttemptAt = Date.now() + retryMs;
    console.error("Main bot retry deferred:", Math.ceil(retryMs / 1000), "seconds");
    console.error("Main bot login failed:", error?.message ?? error?.name ?? "UnknownError");
  } finally {
    mainBotLoginInProgress = false;
  }
}

export async function startBotRuntime() {
  if (!config.recoveryLogChannelId) console.warn("Recovery result logging is disabled; set RECOVERY_LOG_CHANNEL_ID in .env.");
  await ensureMainBotConnected();
  setRecoveryLogClient(mainClient);
  await refreshHostBots();
  refreshTimer = setInterval(() => {
    void ensureMainBotConnected().then(() => setRecoveryLogClient(mainClient));
    void refreshHostBots().catch((error) => console.error("Host bot refresh failed:", error?.name ?? "UnknownError"));
  }, 15_000);
  refreshTimer.unref?.();
}

export async function refreshHostBots() {
  const hosts = await BotHost.find().lean();
  retainHostBotStatuses(hosts.map((host) => host._id));
  for (const host of hosts) {
    const id = String(host._id);
    if (!host.enabled) {
      clearHostBotStatus(id);
      continue;
    }
    const heartbeatAt = host.runtimeHeartbeatAt ? new Date(host.runtimeHeartbeatAt) : null;
    setHostBotStatus(id, {
      online: Boolean(heartbeatAt && Date.now() - heartbeatAt.getTime() < 45_000),
      username: host.runtimeUsername,
      heartbeatAt,
    });
  }
}
export function getHostBotStatus(hostId) {
  return getStoredHostBotStatus(hostId);
}
export function getMainBotStatus() {
  return Boolean(mainClient?.isReady());
}
export async function stopBotRuntime() {
  clearInterval(refreshTimer);
  refreshTimer = undefined;
  stopMainBotPresence?.();
  stopMainBotPresence = undefined;
  mainClient?.destroy();
}
export { normalizeName, sendConfiguredLog };

export async function submitLicenseRecoveryRequest(input) {
  if (!mainClient?.isReady()) throw new Error("메인봇이 오프라인입니다. 잠시 후 다시 요청해 주세요.");
  const result = await createLicenseUseRequest(input);
  if (result.autoApproved) {
    const approval = await autoApproveLicenseRequest(result);
    await postLicenseApproval(approval.request, approval.license, result.hosts, approval.state)
      .catch((error) => console.error("Auto-approved request log failed:", error?.name ?? "UnknownError"));
    return {
      state: approval.state,
      error: approval.error?.message ?? "",
      autoApproved: true,
      hostNames: result.hosts.map((host) => host.name),
      expectedMemberCount: Number(result.license.expectedMemberCount ?? 0),
    };
  }
  try { await postLicenseApproval(result.request, result.license, result.hosts); }
  catch (error) {
    await abandonLicenseUseRequest(result.request._id, result.license._id);
    throw error;
  }
  return {
    state: "PENDING",
    autoApproved: false,
    hostNames: result.hosts.map((host) => host.name),
    expectedMemberCount: Number(result.license.expectedMemberCount ?? 0),
  };
}






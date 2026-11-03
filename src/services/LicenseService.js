import { randomInt } from "node:crypto";
import mongoose from "mongoose";
import { BotHost } from "../models/BotHost.js";
import { BalanceLedger } from "../models/BalanceLedger.js";
import { License } from "../models/License.js";
import { LicenseApprovalRequest } from "../models/LicenseApprovalRequest.js";
import { Product } from "../models/Product.js";
import { RecoveryRun } from "../models/RecoveryRun.js";
import { RestoredUser } from "../models/RestoredUser.js";
import { UserBalance } from "../models/UserBalance.js";
import { config } from "../config/env.js";
import { checkHostsInGuild } from "./RecoveryService.js";
import { enqueueRecoveryRun } from "./RecoveryQueue.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export class LicenseError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function normalizeHostIds(hostIds) {
  const ids = [...new Set((Array.isArray(hostIds) ? hostIds : []).map(String))];
  if (!ids.length || ids.some((id) => !mongoose.isValidObjectId(id))) throw new LicenseError("INVALID_HOSTS", "호기를 하나 이상 선택해 주세요.");
  return ids.map((id) => new mongoose.Types.ObjectId(id));
}

function licenseCode() {
  return "VC-" + randomInt(0, 100_000_000_000_000).toString().padStart(14, "0");
}

async function uniqueLicenseCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = licenseCode();
    if (!await License.exists({ code })) return code;
  }
  throw new LicenseError("CODE_COLLISION", "라이선스 코드를 만들지 못했습니다. 다시 시도해 주세요.");
}

function getExpiry(durationDays, now = new Date()) {
  if (durationDays === null) return null;
  if (durationDays === undefined || durationDays === "") throw new LicenseError("INVALID_DURATION", "유효기간을 일수 또는 영구로 설정해 주세요.");
  const days = Number(durationDays);
  if (!Number.isSafeInteger(days) || days < 1 || days > 36500) throw new LicenseError("INVALID_DURATION", "유효기간은 1일 이상의 정수 또는 영구로 설정해 주세요.");
  return { days, expiresAt: new Date(now.getTime() + days * DAY_MS) };
}

async function countActiveMembers(hostIds) {
  const counts = await Promise.all(hostIds.map((hostId) => RestoredUser.countDocuments({ hostId, status: "ACTIVE" })));
  return counts.reduce((sum, count) => sum + count, 0);
}

export async function createLicenseDefinition(input, issuedBy = "") {
  const expiry = getExpiry(input.permanent ? null : input.validityDays);
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 120) throw new LicenseError("INVALID_NAME", "라이선스 또는 상품 이름을 확인해 주세요.");

  if (input.productize === true) {
    if (!await BotHost.exists({ enabled: true })) throw new LicenseError("HOST_NOT_FOUND", "등록된 사용 가능 호기가 없습니다.");
    const priceMinor = Number(input.priceMinor);
    const minimumActiveMembers = Number(input.minimumActiveMembers);
    const maximumActiveMembers = Number(input.maximumActiveMembers);
    if (!Number.isSafeInteger(priceMinor) || priceMinor < 1 || !Number.isSafeInteger(minimumActiveMembers) || minimumActiveMembers < 0 || !Number.isSafeInteger(maximumActiveMembers) || maximumActiveMembers < minimumActiveMembers) {
      throw new LicenseError("INVALID_PRODUCT", "가격과 예상 복구 인원 범위를 확인해 주세요.");
    }
    const product = await Product.create({
      name,
      priceMinor,
      currency: "KRW",
      enabled: true,
      hostIds: [],
      allHosts: true,
      minimumActiveMembers,
      maximumActiveMembers,
      validityDays: expiry?.days ?? null,
      isLicenseProduct: true,
    });
    return { kind: "PRODUCT", product };
  }

  const hostIds = normalizeHostIds(input.hostIds);
  const hosts = await BotHost.find({ _id: { $in: hostIds } }).sort({ createdAt: 1 }).lean();
  if (hosts.length !== hostIds.length) throw new LicenseError("HOST_NOT_FOUND", "선택한 호기를 찾을 수 없습니다.");

  const code = await uniqueLicenseCode();
  const expectedMemberCount = await countActiveMembers(hostIds);
  const license = await License.create({
    code,
    status: expiry?.expiresAt ? "ISSUED" : "ISSUED",
    hostIds,
    productName: name,
    expectedMemberCount,
    durationDays: expiry?.days ?? null,
    expiresAt: expiry?.expiresAt ?? null,
    issuedBy: String(issuedBy),
  });
  return { kind: "LICENSE", license, hosts };
}

function recentUseTime(host) { return host.lastRecoveryAt ? new Date(host.lastRecoveryAt).getTime() : 0; }
function compareHostPreference(left, right) {
  const byLastUse = recentUseTime(left) - recentUseTime(right);
  if (byLastUse) return byLastUse;
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}
function compareCombination(left, right) {
  if (!right) return -1;
  if (left.hosts.length !== right.hosts.length) return left.hosts.length - right.hosts.length;
  for (let index = 0; index < left.hosts.length; index += 1) {
    const order = compareHostPreference(left.hosts[index], right.hosts[index]);
    if (order) return order;
  }
  const leftMidDistance = Math.abs(left.total - left.midpoint);
  const rightMidDistance = Math.abs(right.total - right.midpoint);
  if (leftMidDistance !== rightMidDistance) return leftMidDistance - rightMidDistance;
  return 0;
}

export async function findProductHostCombination(product, getBotStatus) {
  const minimum = Number(product.minimumActiveMembers);
  const maximum = Number(product.maximumActiveMembers);
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum < 0 || maximum < minimum) return null;
  const hostFilter = product.allHosts ? { enabled: true } : { _id: { $in: product.hostIds ?? [] }, enabled: true };
  const candidates = await BotHost.find(hostFilter).sort({ createdAt: 1 }).lean();
  const online = candidates.filter((host) => getBotStatus(host._id).online);
  if (!online.length) return null;
  const hostIds = online.map((host) => host._id);
  const [counts, recentRuns] = await Promise.all([
    Promise.all(hostIds.map((hostId) => RestoredUser.countDocuments({ hostId, status: "ACTIVE" }))),
    RecoveryRun.aggregate([
      { $match: { hostIds: { $in: hostIds }, startedAt: { $ne: null } } },
      { $unwind: "$hostIds" },
      { $match: { hostIds: { $in: hostIds } } },
      { $sort: { startedAt: -1 } },
      { $group: { _id: "$hostIds", lastRecoveryAt: { $first: "$startedAt" } } },
    ]),
  ]);
  const lastRunByHostId = new Map(recentRuns.map((run) => [String(run._id), run.lastRecoveryAt]));
  const entries = online.map((host, index) => ({
    ...host,
    lastRecoveryAt: lastRunByHostId.get(String(host._id)) ?? host.lastRecoveryAt,
    expectedCount: counts[index],
  })).sort(compareHostPreference);
  const bestByTotal = new Map([[0, { hosts: [], total: 0, midpoint: (minimum + maximum) / 2 }]]);
  for (const host of entries) {
    const prior = [...bestByTotal.entries()];
    for (const [total, combination] of prior) {
      const nextTotal = total + host.expectedCount;
      if (nextTotal > maximum) continue;
      const candidate = { hosts: [...combination.hosts, host], total: nextTotal, midpoint: (minimum + maximum) / 2 };
      if (compareCombination(candidate, bestByTotal.get(nextTotal)) < 0) bestByTotal.set(nextTotal, candidate);
    }
  }
  const options = [...bestByTotal.values()].filter((item) => item.hosts.length && item.total >= minimum && item.total <= maximum);
  options.sort(compareCombination);
  return options[0] ?? null;
}

export async function getAvailableLicenseProducts(getBotStatus) {
  const products = await Product.find({ enabled: true, isLicenseProduct: true, currency: "KRW" }).sort({ createdAt: 1 }).lean();
  const available = [];
  for (const product of products) {
    const combination = await findProductHostCombination(product, getBotStatus);
    if (combination) available.push({ product, combination });
  }
  return available;
}

export async function purchaseLicenseProduct(productId, discordUserId, getBotStatus, expectedPriceMinor) {
  if (!mongoose.isValidObjectId(productId)) throw new LicenseError("PRODUCT_NOT_FOUND", "상품을 찾을 수 없습니다.");
  const product = await Product.findOne({ _id: productId, enabled: true, isLicenseProduct: true, currency: "KRW" }).lean();
  if (!product) throw new LicenseError("PRODUCT_NOT_FOUND", "상품을 찾을 수 없습니다.");
  const combination = await findProductHostCombination(product, getBotStatus);
  if (!combination) throw new LicenseError("NO_HOST_COMBINATION", "현재 인원 범위와 호기 상태에 맞는 배정 조합이 없습니다.");
  const code = await uniqueLicenseCode();
  const now = new Date();
  const expiresAt = product.validityDays ? new Date(now.getTime() + product.validityDays * DAY_MS) : null;
  const session = await mongoose.startSession();
  let createdLicense;
  try {
    await session.withTransaction(async () => {
      const currentProduct = await Product.findOne({ _id: product._id, enabled: true, isLicenseProduct: true, currency: "KRW" }).session(session).lean();
      if (!currentProduct) throw new LicenseError("PRODUCT_UNAVAILABLE", "상품이 판매 중지되었습니다.");
      if (Number(currentProduct.priceMinor) !== Number(expectedPriceMinor)) throw new LicenseError("PRICE_CHANGED", "상품 가격이 변경됐습니다. 상품 목록을 다시 열어 확인해 주세요.");
      const balanceUpdate = await UserBalance.updateOne(
        { discordUserId, currency: "KRW", cashMinor: { $gte: Number(currentProduct.priceMinor) } },
        { $inc: { cashMinor: -Number(currentProduct.priceMinor) } },
        { session },
      );
      if (!balanceUpdate.modifiedCount) throw new LicenseError("INSUFFICIENT_BALANCE", "보유 캐시가 부족합니다.");
      const [license] = await License.create([{
        code,
        status: "ISSUED",
        hostIds: combination.hosts.map((host) => host._id),
        productId: currentProduct._id,
        productName: currentProduct.name,
        purchaserDiscordId: discordUserId,
        expectedMemberCount: combination.total,
        durationDays: currentProduct.validityDays ?? null,
        expiresAt,
        issuedBy: "AUTO_PURCHASE",
      }], { session });
      await BalanceLedger.create([{
        discordUserId,
        entryType: "PURCHASE",
        amountMinor: -Number(currentProduct.priceMinor),
        currency: "KRW",
        referenceId: "license-purchase:" + license._id,
        note: "라이선스 구매 · " + currentProduct.name,
      }], { session });
      createdLicense = license;
    });
  } finally { await session.endSession(); }
  return { license: createdLicense, product, hosts: combination.hosts, expectedMemberCount: combination.total };
}

export async function expireOutdatedLicenses() {
  const now = new Date();
  const expirableFilter = {
    status: { $in: ["ISSUED", "IN_PROGRESS"] },
    recoveryRunId: null,
    expiresAt: { $ne: null, $lte: now },
  };
  const expirable = await License.find(expirableFilter).select("_id activeRequestId").lean();
  if (!expirable.length) return;
  await License.updateMany({
    ...expirableFilter,
    _id: { $in: expirable.map((license) => license._id) },
  }, { $set: { status: "EXPIRED", activeRequestId: null } });
  const pendingRequestIds = expirable.map((license) => license.activeRequestId).filter(Boolean);
  if (pendingRequestIds.length) {
    await LicenseApprovalRequest.updateMany(
      { _id: { $in: pendingRequestIds }, status: "PENDING" },
      { $set: { status: "FAILED", decidedAt: now } },
    );
  }
}

async function releaseUnstartedFailedRequest(request, license) {
  const current = await License.findById(license._id).lean();
  if (current?.status === "IN_PROGRESS" && !current.recoveryRunId && String(current.activeRequestId) === String(request._id)) {
    const expired = current.expiresAt && current.expiresAt <= new Date();
    await License.updateOne({ _id: current._id, status: "IN_PROGRESS", activeRequestId: request._id }, {
      $set: { status: expired ? "EXPIRED" : "ISSUED", activeRequestId: null },
    });
  }
  await LicenseApprovalRequest.updateOne({ _id: request._id, status: "APPROVED" }, { $set: { status: "FAILED" } });
}

export async function createLicenseUseRequest({ code, commandHostId, requesterDiscordId, requesterUsername, targetGuildId, targetGuildName }) {
  const normalizedCode = String(code ?? "").trim().toUpperCase();
  let license = await License.findOne({ code: normalizedCode });
  if (!license) throw new LicenseError("LICENSE_NOT_FOUND", "라이선스 코드를 찾을 수 없습니다.");
  if (license.expiresAt && license.expiresAt <= new Date() && license.status === "ISSUED") {
    license.status = "EXPIRED";
    await license.save();
    throw new LicenseError("LICENSE_EXPIRED", "라이선스 유효기간이 만료됐습니다.");
  }
  if (license.status !== "ISSUED") throw new LicenseError("LICENSE_UNAVAILABLE", "현재 상태에서는 사용할 수 없는 라이선스입니다.");
  const requestHostId = commandHostId ?? license.hostIds[0];
  if (!license.hostIds.some((hostId) => String(hostId) === String(requestHostId))) {
    throw new LicenseError("HOST_MISMATCH", "이 라이선스는 현재 호기에서 사용할 수 없습니다.");
  }
  const hosts = await BotHost.find({ _id: { $in: license.hostIds }, enabled: true }).sort({ createdAt: 1 }).lean();
  if (hosts.length !== license.hostIds.length) throw new LicenseError("HOST_DISABLED", "라이선스에 포함된 호기 중 비활성화된 호기가 있습니다.");
  const checks = await checkHostsInGuild(hosts, targetGuildId);
  const blocked = checks.filter((item) => !item.present || !item.canAddMembers);
  if (blocked.length) throw new LicenseError("HOST_NOT_READY", "대상 서버에 모든 호기를 초대하고 멤버 추가 권한을 확인해 주세요: " + blocked.map((item) => item.name).join(", "));
  const resolvedGuildName = checks.find((item) => item.guildName)?.guildName || targetGuildName || "";

  const requestId = new mongoose.Types.ObjectId();
  const expirationFilter = license.expiresAt ? { expiresAt: { $gt: new Date() } } : { expiresAt: null };
  const locked = await License.findOneAndUpdate(
    { _id: license._id, status: "ISSUED", ...expirationFilter },
    { $set: { status: "IN_PROGRESS", activeRequestId: requestId } },
    { returnDocument: "after" },
  );
  if (!locked) throw new LicenseError("LICENSE_UNAVAILABLE", "라이선스가 이미 사용 중이거나 만료됐습니다.");

  try {
    const request = await LicenseApprovalRequest.create({
      _id: requestId,
      licenseId: locked._id,
      requesterDiscordId,
      requesterUsername,
      commandHostId: requestHostId,
      hostIds: locked.hostIds,
      targetGuildId,
      targetGuildName: resolvedGuildName,
      status: "PENDING",
    });
    return { request, license: locked, hosts, autoApproved: requesterDiscordId === config.recoveryAdminUserId };
  } catch (error) {
    await License.updateOne({ _id: locked._id, status: "IN_PROGRESS", activeRequestId: requestId }, { $set: { status: "ISSUED", activeRequestId: null } });
    throw error;
  }
}

export async function abandonLicenseUseRequest(requestId, licenseId) {
  await Promise.all([
    LicenseApprovalRequest.updateOne({ _id: requestId, status: "PENDING" }, { $set: { status: "FAILED" } }),
    License.updateOne({ _id: licenseId, status: "IN_PROGRESS", activeRequestId: requestId }, { $set: { status: "ISSUED", activeRequestId: null } }),
  ]);
}

async function startApprovedRecovery(request, license) {
  if (license.expiresAt && license.expiresAt <= new Date()) {
    await License.updateOne({ _id: license._id, activeRequestId: request._id }, { $set: { status: "EXPIRED", activeRequestId: null } });
    await LicenseApprovalRequest.updateOne({ _id: request._id }, { $set: { status: "FAILED" } });
    throw new LicenseError("LICENSE_EXPIRED", "승인 대기 중 라이선스가 만료됐습니다.");
  }
  const hosts = await BotHost.find({ _id: { $in: license.hostIds }, enabled: true }).sort({ createdAt: 1 }).lean();
  const checks = await checkHostsInGuild(hosts, request.targetGuildId);
  const blocked = checks.filter((item) => !item.present || !item.canAddMembers);
  if (hosts.length !== license.hostIds.length || blocked.length) {
    await License.updateOne({ _id: license._id, status: "IN_PROGRESS", activeRequestId: request._id }, { $set: { status: "ISSUED", activeRequestId: null } });
    await LicenseApprovalRequest.updateOne({ _id: request._id }, { $set: { status: "FAILED" } });
    throw new LicenseError("HOST_NOT_READY", "승인 후 호기 상태가 변경되어 복구를 시작하지 못했습니다.");
  }
  const targetUsers = await RestoredUser.find({ hostId: { $in: license.hostIds }, status: "ACTIVE" }).select("_id").lean();
  const total = targetUsers.length;
  const run = await RecoveryRun.create({
    hostIds: license.hostIds,
    targetGuildId: request.targetGuildId,
    targetUserIds: targetUsers.map((user) => user._id),
    overallTotal: total,
    total,
    delayMs: config.recoveryDelayMs,
    licenseId: license._id,
    licenseApprovalRequestId: request._id,
    expectedMemberCountAtRun: license.expectedMemberCount,
  });
  await Promise.all([
    License.updateOne({ _id: license._id, status: "IN_PROGRESS", activeRequestId: request._id }, { $set: { recoveryRunId: run._id, usedAt: new Date() } }),
    LicenseApprovalRequest.updateOne({ _id: request._id }, { $set: { recoveryRunId: run._id } }),
  ]);
  enqueueRecoveryRun(run._id);
  return run;
}

export async function decideLicenseRequest(requestId, decision, decidedBy) {
  if (!mongoose.isValidObjectId(requestId) || !["APPROVED", "REJECTED"].includes(decision)) throw new LicenseError("INVALID_DECISION", "승인 요청 정보가 올바르지 않습니다.");
  const request = await LicenseApprovalRequest.findOneAndUpdate(
    { _id: requestId, status: "PENDING" },
    { $set: { status: decision, decidedBy, decidedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!request) throw new LicenseError("ALREADY_DECIDED", "이미 처리된 요청입니다.");
  let license = await License.findById(request.licenseId);
  if (license && license.expiresAt && license.expiresAt <= new Date() && !license.recoveryRunId) {
    license.status = "EXPIRED";
    await license.save();
    await LicenseApprovalRequest.updateOne({ _id: request._id }, { $set: { status: "FAILED" } });
    return { request: await LicenseApprovalRequest.findById(request._id).lean(), license: license.toObject(), state: "EXPIRED" };
  }
  if (!license || license.status !== "IN_PROGRESS" || String(license.activeRequestId) !== String(request._id)) {
    await LicenseApprovalRequest.updateOne({ _id: request._id }, { $set: { status: "FAILED" } });
    throw new LicenseError("LICENSE_UNAVAILABLE", "요청에 연결된 라이선스 상태를 확인할 수 없습니다.");
  }
  if (decision === "REJECTED") {
    const rejectionCount = license.rejectionCount + 1;
    const status = rejectionCount >= 2 ? "REJECTED" : "ISSUED";
    await License.updateOne({ _id: license._id, status: "IN_PROGRESS", activeRequestId: request._id }, {
      $set: { rejectionCount, status, activeRequestId: null },
    });
    return { request, license: await License.findById(license._id).lean(), state: "REJECTED" };
  }
  try {
    const run = await startApprovedRecovery(request, license);
    return { request, license: await License.findById(license._id).lean(), run, state: "APPROVED" };
  } catch (error) {
    await releaseUnstartedFailedRequest(request, license);
    return { request: await LicenseApprovalRequest.findById(request._id).lean(), license: await License.findById(license._id).lean(), state: "FAILED", error };
  }
}

export async function autoApproveLicenseRequest({ request, license }) {
  const approved = await LicenseApprovalRequest.findOneAndUpdate(
    { _id: request._id, status: "PENDING" },
    { $set: { status: "APPROVED", autoApproved: true, decidedBy: config.recoveryAdminUserId, decidedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!approved) throw new LicenseError("ALREADY_DECIDED", "요청 상태를 변경하지 못했습니다.");
  try {
    const run = await startApprovedRecovery(approved, license);
    return { request: approved, license: await License.findById(license._id).lean(), run, state: "APPROVED" };
  } catch (error) {
    await releaseUnstartedFailedRequest(approved, license);
    return { request: await LicenseApprovalRequest.findById(approved._id).lean(), license: await License.findById(license._id).lean(), state: "FAILED", error };
  }
}

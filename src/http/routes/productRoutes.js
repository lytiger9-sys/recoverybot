import { Router } from "express";
import mongoose from "mongoose";
import { Product } from "../../models/Product.js";
import { BotHost } from "../../models/BotHost.js";
import { RestoredUser } from "../../models/RestoredUser.js";
import { requireAdmin } from "../../middleware/adminAuth.js";
import { createLicenseDefinition, LicenseError } from "../../services/LicenseService.js";
export const productRoutes = Router();
productRoutes.use(requireAdmin);
productRoutes.get("/", async (_request, response) => {
  const products = await Product.find().sort({ createdAt: 1 }).lean();
  return response.json({ products });
});
productRoutes.get("/by-name/:productName", async (request, response) => {
  const product = await Product.findOne({ name: request.params.productName }).lean();
  if (!product) return response.status(404).json({ error: "상품을 찾을 수 없습니다." });

  const allHosts = await BotHost.find({ enabled: true }).sort({ createdAt: 1, _id: 1 }).lean();
  const hostNumbers = new Map(allHosts.map((host, index) => [String(host._id), index + 1]));
  const selectedIds = new Set((product.hostIds ?? []).map(String));
  const selectedHosts = product.allHosts
    ? allHosts
    : allHosts.filter((host) => selectedIds.has(String(host._id)));
  const selectedHostIds = selectedHosts.map((host) => host._id);
  const memberCounts = await RestoredUser.aggregate([
    { $match: { hostId: { $in: selectedHostIds } } },
    { $group: {
      _id: "$hostId",
      total: { $sum: 1 },
      active: { $sum: { $cond: [{ $eq: ["$status", "ACTIVE"] }, 1, 0] } },
    } },
  ]);
  const countsByHost = new Map(memberCounts.map((entry) => [String(entry._id), { total: entry.total, active: entry.active }]));
  const hosts = selectedHosts.map((host) => ({
    hostNumber: hostNumbers.get(String(host._id)),
    total: countsByHost.get(String(host._id))?.total ?? 0,
    active: countsByHost.get(String(host._id))?.active ?? 0,
  }));

  return response.json({
    product: {
      _id: product._id,
      name: product.name,
      priceMinor: product.priceMinor,
      currency: product.currency,
      enabled: product.enabled,
      allHosts: product.allHosts,
      validityDays: product.validityDays,
      minimumActiveMembers: product.minimumActiveMembers,
      maximumActiveMembers: product.maximumActiveMembers,
      createdAt: product.createdAt,
      hosts,
      totalMembers: hosts.reduce((sum, host) => sum + host.total, 0),
      activeMembers: hosts.reduce((sum, host) => sum + host.active, 0),
    },
  });
});
productRoutes.post("/", async (request, response) => {
  try {
    const result = await createLicenseDefinition({ ...request.body, productize: true }, request.admin?.id ?? "ADMIN");
    return response.status(201).json({ product: result.product });
  } catch (error) {
    if (error instanceof LicenseError) return response.status(400).json({ error: error.message });
    throw error;
  }
});
productRoutes.patch("/:productId", async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.productId)) return response.status(400).json({ error: "상품 ID가 올바르지 않습니다." });
  const update = {};
  const { name, priceMinor, currency, enabled } = request.body ?? {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 120) return response.status(400).json({ error: "상품 이름을 확인해 주세요." });
    update.name = name.trim();
  }
  if (priceMinor !== undefined) {
    const amount = Number(priceMinor);
    if (!Number.isSafeInteger(amount) || amount < 1) return response.status(400).json({ error: "가격은 1원 이상의 정수로 입력해 주세요." });
    update.priceMinor = amount;
  }
  if (currency !== undefined) {
    const value = String(currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(value)) return response.status(400).json({ error: "통화 코드를 확인해 주세요." });
    const existing = await Product.findById(request.params.productId).select("isLicenseProduct").lean();
    if (existing?.isLicenseProduct && value !== "KRW") return response.status(400).json({ error: "라이선스 상품은 KRW 통화만 지원합니다." });
    update.currency = value;
  }
  if (enabled !== undefined) {
    if (typeof enabled !== "boolean") return response.status(400).json({ error: "사용 상태가 올바르지 않습니다." });
    update.enabled = enabled;
  }
  if (!Object.keys(update).length) return response.status(400).json({ error: "변경할 항목이 없습니다." });
  const product = await Product.findByIdAndUpdate(request.params.productId, update, { returnDocument: "after", runValidators: true });
  if (!product) return response.status(404).json({ error: "상품을 찾을 수 없습니다." });
  return response.json({ product });
});
productRoutes.delete("/:productId", async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.productId)) return response.status(400).json({ error: "상품 ID가 올바르지 않습니다." });
  const product = await Product.findByIdAndDelete(request.params.productId);
  if (!product) return response.status(404).json({ error: "상품을 찾을 수 없습니다." });
  return response.json({ product });
});

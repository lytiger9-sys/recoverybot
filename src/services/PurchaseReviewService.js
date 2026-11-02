import mongoose from "mongoose";
import { License } from "../models/License.js";
import { PurchaseReview } from "../models/PurchaseReview.js";

export class PurchaseReviewError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export async function getPurchasesAwaitingReview(discordUserId) {
  const purchases = await License.find({
    purchaserDiscordId: String(discordUserId),
    productId: { $ne: null },
  }).sort({ createdAt: -1 }).limit(100).lean();
  if (!purchases.length) return [];
  const reviews = await PurchaseReview.find({ licenseId: { $in: purchases.map((item) => item._id) } }).select("licenseId").lean();
  const reviewed = new Set(reviews.map((item) => String(item.licenseId)));
  return purchases.filter((item) => !reviewed.has(String(item._id))).slice(0, 25);
}

export async function getReviewablePurchase(discordUserId, licenseId) {
  if (!mongoose.isValidObjectId(licenseId)) return null;
  return License.findOne({
    _id: licenseId,
    purchaserDiscordId: String(discordUserId),
    productId: { $ne: null },
  }).select("_id productId productName createdAt").lean();
}

export async function submitPurchaseReview({ discordUserId, licenseId, rating, content }) {
  const purchase = await getReviewablePurchase(discordUserId, licenseId);
  if (!purchase) throw new PurchaseReviewError("PURCHASE_NOT_FOUND", "본인의 구매 내역을 찾을 수 없습니다.");
  const score = Number(rating);
  const reviewText = String(content ?? "").trim();
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new PurchaseReviewError("INVALID_RATING", "별점은 1부터 5까지 숫자로 입력해 주세요.");
  }
  if (reviewText.length < 2 || reviewText.length > 1000) {
    throw new PurchaseReviewError("INVALID_CONTENT", "후기는 2자 이상 1000자 이하로 입력해 주세요.");
  }
  try {
    return await PurchaseReview.create({
      licenseId: purchase._id,
      productId: purchase.productId,
      purchaserDiscordId: String(discordUserId),
      productName: purchase.productName,
      purchasedAt: purchase.createdAt,
      rating: score,
      content: reviewText,
    });
  } catch (error) {
    if (error?.code === 11000) throw new PurchaseReviewError("ALREADY_REVIEWED", "이 구매 내역에는 이미 후기를 작성했습니다.");
    throw error;
  }
}


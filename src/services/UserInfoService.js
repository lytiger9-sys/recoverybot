import { BalanceLedger } from "../models/BalanceLedger.js";
import { License } from "../models/License.js";
import { PurchaseReview } from "../models/PurchaseReview.js";
import { UserBalance } from "../models/UserBalance.js";

export async function getUserInfo(discordUserId) {
  const userId = String(discordUserId);
  const [balance, purchaseLedger, licenses] = await Promise.all([
    UserBalance.findOne({ discordUserId: userId }).select("cashMinor").lean(),
    BalanceLedger.aggregate([
      { $match: { discordUserId: userId, entryType: "PURCHASE" } },
      { $group: { _id: null, amount: { $sum: "$amountMinor" } } },
    ]),
    License.find({ purchaserDiscordId: userId, productId: { $ne: null } }).select("_id status").lean(),
  ]);

  const reviews = licenses.length
    ? await PurchaseReview.find({ licenseId: { $in: licenses.map((license) => license._id) } }).select("licenseId").lean()
    : [];
  const reviewedLicenseIds = new Set(reviews.map((review) => String(review.licenseId)));
  return {
    balance: Number(balance?.cashMinor ?? 0),
    totalPurchaseAmount: Math.abs(Number(purchaseLedger[0]?.amount ?? 0)),
    purchasedLicenseCount: licenses.length,
    availableLicenseCount: licenses.filter((license) => ["ISSUED", "IN_PROGRESS", "FAILED"].includes(license.status)).length,
    pendingReviewCount: licenses.filter((license) => !reviewedLicenseIds.has(String(license._id))).length,
  };
}

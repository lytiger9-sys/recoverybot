import { Router } from "express";
import { BalanceLedger } from "../../models/BalanceLedger.js";
import { requireAdmin } from "../../middleware/adminAuth.js";

export const dashboardFinanceRoutes = Router();
dashboardFinanceRoutes.use(requireAdmin);

function kstYearStart(year) {
  return new Date(Date.UTC(year, 0, 1) - (9 * 60 * 60 * 1000));
}

function currentKstYear() {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));
}

dashboardFinanceRoutes.get("/years", async (_request, response) => {
  const records = await BalanceLedger.aggregate([
    { $match: { currency: "KRW" } },
    { $group: { _id: { $dateToString: { format: "%Y", date: "$createdAt", timezone: "Asia/Seoul" } } } },
    { $sort: { _id: -1 } },
  ]);
  const years = new Set(records.map((record) => Number(record._id)).filter(Number.isInteger));
  years.add(currentKstYear());
  return response.json({ years: [...years].sort((left, right) => right - left) });
});

dashboardFinanceRoutes.get("/", async (request, response) => {
  const year = Number(request.query.year ?? currentKstYear());
  const nowYear = currentKstYear();
  if (!Number.isInteger(year) || year < 2000 || year > nowYear + 1) {
    return response.status(400).json({ error: "조회 연도를 확인해 주세요." });
  }
  const start = kstYearStart(year);
  const end = kstYearStart(year + 1);
  const grouped = await BalanceLedger.aggregate([
    { $match: { currency: "KRW", createdAt: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: { $dateToString: { format: "%m", date: "$createdAt", timezone: "Asia/Seoul" } },
        rechargeMinor: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ["$entryType", "AUTO_RECHARGE"] },
                  { $and: [{ $eq: ["$entryType", "ADMIN_ADJUSTMENT"] }, { $gt: ["$amountMinor", 0] }] },
                ],
              },
              "$amountMinor",
              0,
            ],
          },
        },
        purchaseMinor: {
          $sum: {
            $cond: [{ $eq: ["$entryType", "PURCHASE"] }, { $abs: "$amountMinor" }, 0],
          },
        },
      },
    },
  ]);
  const months = Array.from({ length: 12 }, (_unused, index) => ({
    month: index + 1,
    rechargeMinor: 0,
    purchaseMinor: 0,
  }));
  for (const row of grouped) {
    const month = Number(row._id);
    if (month >= 1 && month <= 12) {
      months[month - 1].rechargeMinor = Number(row.rechargeMinor ?? 0);
      months[month - 1].purchaseMinor = Number(row.purchaseMinor ?? 0);
    }
  }
  return response.json({ year, months });
});


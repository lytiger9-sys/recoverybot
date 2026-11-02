import mongoose from "mongoose";
import { BalanceLedger } from "../models/BalanceLedger.js";
import { UserBalance } from "../models/UserBalance.js";

export class BalanceAdjustmentError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export async function adjustUserBalance({ discordUserId, amountMinor, adminId, adminName }) {
  if (!/^\d{17,22}$/.test(String(discordUserId))) {
    throw new BalanceAdjustmentError("INVALID_USER", "Discord 유저를 확인해 주세요.");
  }
  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0) {
    throw new BalanceAdjustmentError("INVALID_AMOUNT", "금액은 0이 아닌 정수로 입력해 주세요.");
  }

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const currentBalance = await UserBalance.findOne({ discordUserId: String(discordUserId) }).session(session);
      const previousCashMinor = Number(currentBalance?.cashMinor ?? 0);
      const nextCashMinor = previousCashMinor + amountMinor;
      if (nextCashMinor < 0) throw new BalanceAdjustmentError("INSUFFICIENT_BALANCE", "차감 금액이 현재 잔액보다 큽니다.");
      if (!Number.isSafeInteger(nextCashMinor)) throw new BalanceAdjustmentError("BALANCE_OVERFLOW", "조정 후 잔액이 허용 범위를 넘습니다.");

      let balance;
      if (currentBalance) {
        balance = await UserBalance.findOneAndUpdate(
          { _id: currentBalance._id, cashMinor: previousCashMinor },
          { $set: { cashMinor: nextCashMinor } },
          { returnDocument: "after", session },
        );
        if (!balance) throw new BalanceAdjustmentError("BALANCE_CHANGED", "잔액이 동시에 변경됐습니다. 다시 시도해 주세요.");
      } else {
        const [created] = await UserBalance.create([{
          discordUserId: String(discordUserId),
          cashMinor: nextCashMinor,
          currency: "KRW",
        }], { session });
        balance = created;
      }

      await BalanceLedger.create([{
        discordUserId: String(discordUserId),
        entryType: "ADMIN_ADJUSTMENT",
        amountMinor,
        currency: "KRW",
        referenceId: "admin-adjustment:" + new mongoose.Types.ObjectId(),
        note: "Discord 관리자 잔액 조정 · " + String(adminName || "관리자") + " (" + String(adminId || "") + ")",
      }], { session });
      result = {
        discordUserId: String(discordUserId),
        amountMinor,
        cashMinor: balance.cashMinor,
        previousCashMinor,
      };
    });
  } finally {
    await session.endSession();
  }
  return result;
}

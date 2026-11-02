import mongoose from "mongoose";

const schema = new mongoose.Schema({
  discordUserId: { type: String, required: true, trim: true },
  entryType: { type: String, enum: ["AUTO_RECHARGE", "ADMIN_ADJUSTMENT", "PURCHASE"], required: true },
  amountMinor: { type: Number, required: true },
  currency: { type: String, required: true, uppercase: true, default: "KRW" },
  referenceId: { type: String, required: true, unique: true },
  note: { type: String, default: "" },
}, { timestamps: true });
schema.index({ discordUserId: 1, createdAt: -1 });
export const BalanceLedger = mongoose.model("BalanceLedger", schema);

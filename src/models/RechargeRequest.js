import mongoose from "mongoose";

const schema = new mongoose.Schema({
  discordUserId: { type: String, required: true, trim: true },
  depositorName: { type: String, required: true, trim: true },
  depositorNameKey: { type: String, required: true, trim: true },
  amountMinor: { type: Number, required: true, min: 1 },
  accountBank: { type: String, required: true, trim: true },
  accountNumber: { type: String, required: true, trim: true },
  accountHolder: { type: String, required: true, trim: true },
  status: { type: String, enum: ["PENDING", "PAID", "EXPIRED", "REVIEW"], default: "PENDING" },
  matchingSuppressed: { type: Boolean, default: false },
  paidNotificationId: { type: String, default: "" },
  chargeLogChannelId: { type: String, default: "" },
  chargeLogMessageId: { type: String, default: "" },
  chargeLogStatus: { type: String, enum: ["PENDING", "PAID", "EXPIRED"], default: "PENDING" },
  expiresAt: { type: Date, required: true },
  paidAt: { type: Date },
}, { timestamps: true });
schema.index({ discordUserId: 1, status: 1 });
schema.index({ depositorNameKey: 1, amountMinor: 1, status: 1 });
schema.index({ status: 1, createdAt: 1 });
schema.index({ expiresAt: 1, status: 1 });
export const RechargeRequest = mongoose.model("RechargeRequest", schema);

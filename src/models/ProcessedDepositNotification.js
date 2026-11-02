import mongoose from "mongoose";

const schema = new mongoose.Schema({
  pushbulletIden: { type: String, required: true, unique: true },
  notificationAppName: { type: String, required: true },
  depositorKeyHash: { type: String, default: "" },
  amountMinor: { type: Number, default: null },
  outcome: { type: String, enum: ["MATCHED", "UNMATCHED", "AMBIGUOUS", "IGNORED"], required: true },
  rechargeRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "RechargeRequest" },
}, { timestamps: true });
schema.index({ createdAt: -1 });
export const ProcessedDepositNotification = mongoose.model("ProcessedDepositNotification", schema);

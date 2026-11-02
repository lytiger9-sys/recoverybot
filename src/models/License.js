import mongoose from "mongoose";

const schema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  status: { type: String, enum: ["ISSUED", "IN_PROGRESS", "REJECTED", "COMPLETED", "FAILED", "EXPIRED"], default: "ISSUED", index: true },
  hostIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "BotHost", required: true }],
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
  productName: { type: String, default: "직접 발급" },
  purchaserDiscordId: { type: String, default: "", trim: true },
  issuedBy: { type: String, default: "", trim: true },
  expectedMemberCount: { type: Number, min: 0, required: true },
  durationDays: { type: Number, min: 1, default: null },
  expiresAt: { type: Date, default: null },
  rejectionCount: { type: Number, min: 0, default: 0 },
  activeRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "LicenseApprovalRequest", default: null },
  recoveryRunId: { type: mongoose.Schema.Types.ObjectId, ref: "RecoveryRun", default: null },
  usedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  recoverySucceeded: { type: Number, min: 0, default: 0 },
  recoveryTotal: { type: Number, min: 0, default: 0 },
  failureReason: { type: String, default: "", trim: true, maxlength: 500 },
}, { timestamps: true });

schema.index({ createdAt: -1 });
schema.index({ hostIds: 1, status: 1 });
schema.index({ productId: 1, createdAt: -1 });

export const License = mongoose.model("License", schema);

import mongoose from "mongoose";

const schema = new mongoose.Schema({
  licenseId: { type: mongoose.Schema.Types.ObjectId, ref: "License", required: true },
  requesterDiscordId: { type: String, required: true, trim: true },
  requesterUsername: { type: String, required: true, trim: true },
  commandHostId: { type: mongoose.Schema.Types.ObjectId, ref: "BotHost", required: true },
  hostIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "BotHost", required: true }],
  targetGuildId: { type: String, required: true, trim: true },
  targetGuildName: { type: String, default: "", trim: true },
  status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "FAILED"], default: "PENDING", index: true },
  autoApproved: { type: Boolean, default: false },
  decidedBy: { type: String, default: "", trim: true },
  decidedAt: { type: Date, default: null },
  rejectionNumber: { type: Number, min: 0, default: 0 },
  recoveryRunId: { type: mongoose.Schema.Types.ObjectId, ref: "RecoveryRun", default: null },
}, { timestamps: true });

schema.index({ licenseId:  1, createdAt: -1 });

export const LicenseApprovalRequest = mongoose.model("LicenseApprovalRequest", schema);

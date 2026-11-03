import mongoose from "mongoose";

const schema = new mongoose.Schema({
  hostIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "BotHost", required: true }],
  licenseId: { type: mongoose.Schema.Types.ObjectId, ref: "License", default: null },
  retryOfRunId: { type: mongoose.Schema.Types.ObjectId, ref: "RecoveryRun", default: null },
  licenseApprovalRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "LicenseApprovalRequest", default: null },
  expectedMemberCountAtRun: { type: Number, min: 0, default: null },
  targetGuildId: { type: String, required: true },
  targetUserIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "RestoredUser" }], default: undefined },
  completedUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "RestoredUser" }],
  overallTotal: { type: Number, min: 0, default: 0 },
  status: { type: String, enum: ["QUEUED", "RUNNING", "COMPLETED", "FAILED"], default: "QUEUED" },
  total: { type: Number, default: 0 },
  processed: { type: Number, default: 0 },
  succeeded: { type: Number, default: 0 },
  alreadyMember: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  failureReasons: { type: Map, of: Number, default: () => new Map() },
  currentHostName: { type: String, default: "" },
  currentHostId: { type: mongoose.Schema.Types.ObjectId, ref: "BotHost", default: null },
  delayMs: { type: Number, default: 2000 },
  estimatedRemainingSeconds: { type: Number, default: 0 },
  message: { type: String, default: "" },
  startedAt: { type: Date },
  completedAt: { type: Date },
  logPublishedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ createdAt: -1 });
schema.index({ hostIds: 1, status: 1 });
schema.index({ hostIds: 1, startedAt: -1 });
export const RecoveryRun = mongoose.model("RecoveryRun", schema);

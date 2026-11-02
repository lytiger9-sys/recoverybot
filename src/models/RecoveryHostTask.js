import mongoose from "mongoose";

const schema = new mongoose.Schema({
  runId: { type: mongoose.Schema.Types.ObjectId, ref: "RecoveryRun", required: true },
  hostId: { type: mongoose.Schema.Types.ObjectId, ref: "BotHost", required: true },
  sequence: { type: Number, min: 0, required: true },
  status: { type: String, enum: ["WAITING", "QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"], default: "WAITING", index: true },
  processed: { type: Number, min: 0, default: 0 },
  succeeded: { type: Number, min: 0, default: 0 },
  alreadyMember: { type: Number, min: 0, default: 0 },
  failed: { type: Number, min: 0, default: 0 },
  heartbeatAt: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  failureReason: { type: String, default: "" },
}, { timestamps: true });

schema.index({ runId: 1, hostId: 1 }, { unique: true });
schema.index({ hostId: 1, status: 1, createdAt: 1, sequence: 1 });

export const RecoveryHostTask = mongoose.model("RecoveryHostTask", schema);

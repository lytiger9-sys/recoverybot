import mongoose from "mongoose";

const schema = new mongoose.Schema({
  hostId: { type: mongoose.Schema.Types.ObjectId, ref: "BotHost", required: true, unique: true },
  runId: { type: mongoose.Schema.Types.ObjectId, ref: "RecoveryRun", required: true, index: true },
  targetGuildId: { type: String, required: true },
  acquiredAt: { type: Date, default: Date.now },
}, { timestamps: true });

export const RecoveryHostLock = mongoose.model("RecoveryHostLock", schema);

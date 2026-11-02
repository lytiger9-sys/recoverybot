import mongoose from "mongoose";
const schema = new mongoose.Schema({
  sessionIdHash: { type: String, required: true, unique: true },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AdminSession = mongoose.model("AdminSession", schema);

import mongoose from "mongoose";

const schema = new mongoose.Schema({
  stateHash: { type: String, required: true, unique: true },
  hostId: { type: mongoose.Schema.Types.ObjectId, ref: "BotHost", required: true },
  authPanelId: { type: mongoose.Schema.Types.ObjectId, ref: "AuthPanel", default: null },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const OAuthState = mongoose.model("OAuthState", schema);

import mongoose from "mongoose";

const authPanelSchema = new mongoose.Schema({
  hostId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  guildId: { type: String, required: true },
  guildName: { type: String, required: true },
  roleId: { type: String, required: true },
  roleName: { type: String, required: true },
  channelId: { type: String, required: true },
}, { timestamps: true });

export const AuthPanel = mongoose.models.AuthPanel ?? mongoose.model("AuthPanel", authPanelSchema);

import mongoose from "mongoose";

const restoredUserSchema = new mongoose.Schema(
  {
    hostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BotHost",
      required: true,
    },
    discordUserId: { type: String, required: true, trim: true },
    username: { type: String, required: true, trim: true },
    accessToken: { type: mongoose.Schema.Types.Mixed, required: true },
    refreshToken: { type: mongoose.Schema.Types.Mixed, required: true },
    email: { type: mongoose.Schema.Types.Mixed, default: undefined },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "REVOKED"],
      default: "ACTIVE",
    },
    lastUpdated: { type: Date, required: true },
    tokenExpiresAt: { type: Date },
  },
  { timestamps: true },
);

restoredUserSchema.index({ hostId: 1, discordUserId: 1 }, { unique: true });
restoredUserSchema.index({ hostId: 1, username: 1 });

export const RestoredUser = mongoose.model("RestoredUser", restoredUserSchema);



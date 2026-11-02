import mongoose from "mongoose";

const userBalanceSchema = new mongoose.Schema(
  {
    discordUserId: { type: String, required: true, trim: true },
    cashMinor: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, required: true, uppercase: true, default: "KRW" },
  },
  { timestamps: true },
);

userBalanceSchema.index({ discordUserId: 1 }, { unique: true });

export const UserBalance = mongoose.model("UserBalance", userBalanceSchema);

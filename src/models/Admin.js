import mongoose from "mongoose";

const adminSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);

adminSchema.index({ username: 1 }, { unique: true });

export const Admin = mongoose.model("Admin", adminSchema);

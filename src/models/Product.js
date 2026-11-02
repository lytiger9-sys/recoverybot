import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    priceMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, default: "KRW" },
    enabled: { type: Boolean, default: true },
    hostIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "BotHost" }],
    allHosts: { type: Boolean, default: false },
    minimumActiveMembers: { type: Number, min: 0, default: 0 },
    maximumActiveMembers: { type: Number, min: 0, default: 0 },
    validityDays: { type: Number, min: 1, default: null },
    isLicenseProduct: { type: Boolean, default: false },
  },
  { timestamps: true },
);

productSchema.index({ name: 1 }, { unique: true });

export const Product = mongoose.model("Product", productSchema);

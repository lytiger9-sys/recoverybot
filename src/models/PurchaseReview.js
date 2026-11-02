import mongoose from "mongoose";

const schema = new mongoose.Schema({
  licenseId: { type: mongoose.Schema.Types.ObjectId, ref: "License", required: true, unique: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  purchaserDiscordId: { type: String, required: true, index: true },
  productName: { type: String, required: true, trim: true, maxlength: 120 },
  purchasedAt: { type: Date, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  content: { type: String, required: true, trim: true, maxlength: 1000 },
}, { timestamps: true });

schema.index({ productId: 1, createdAt: -1 });
export const PurchaseReview = mongoose.model("PurchaseReview", schema);


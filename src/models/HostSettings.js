import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "hosts" },
    defaultNameTemplate: { type: String, required: true, default: "호기 {n}" },
  },
  { timestamps: true },
);
export const HostSettings = mongoose.model("HostSettings", schema);

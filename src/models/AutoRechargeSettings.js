import mongoose from "mongoose";
import { encryptedSecretSchema } from "./fields/encryptedSecret.js";

const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    enabled: { type: Boolean, default: false },
    pushbulletToken: { type: encryptedSecretSchema, default: undefined },
    accountBank: { type: String, default: "" },
    accountNumber: { type: String, default: "" },
    accountHolder: { type: String, default: "" },
    minimumTopupMinor: { type: Number, min: 1, default: 100 },
    notificationAppName: { type: String, default: "" },
    reviewLogChannelId: { type: String, default: "" },
    purchaseLogChannelId: { type: String, default: "" },
    chargeLogChannelId: { type: String, default: "" },
    depositLogChannelId: { type: String, default: "" },
    embedTitle: { type: String, default: "자동충전" },
    embedDescription: { type: String, default: "아래 버튼을 눌러 입금 요청을 등록해 주세요." },
    embedColor: { type: String, default: "#c8a45b" },
    embedFooter: { type: String, default: "" },
    embedImageUrl: { type: String, default: "" },
  },
  { timestamps: true },
);

export const AutoRechargeSettings = mongoose.model("AutoRechargeSettings", schema);

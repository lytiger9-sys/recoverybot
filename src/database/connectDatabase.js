import mongoose from "mongoose";
import { retainRechargeRequestHistory } from "./migrations/retainRechargeRequestHistory.js";
import { convertRestoredUserSecretsToPlaintext } from "./migrations/convertRestoredUserSecretsToPlaintext.js";

export async function connectDatabase(uri) {
  await mongoose.connect(uri, { dbName: "recovery_bot", autoIndex: false });
  await retainRechargeRequestHistory(mongoose.connection);
  const convertedUsers = await convertRestoredUserSecretsToPlaintext();
  if (convertedUsers) console.log("Converted " + convertedUsers + " restored user records to plaintext token storage.");
  await Promise.all(Object.values(mongoose.models).map((model) => model.createIndexes()));
  return mongoose.connection;
}

export function getDatabaseStatus() {
  return mongoose.connection.readyState === 1 ? "connected" : "disconnected";
}

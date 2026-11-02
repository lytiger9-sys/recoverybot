import { RestoredUser } from "../../models/RestoredUser.js";
import { config } from "../../config/env.js";
import { decryptSecret } from "../../security/secretEncryption.js";

function isEncrypted(value) {
  return value && typeof value === "object" && value.ciphertext && value.iv && value.authTag;
}

export async function convertRestoredUserSecretsToPlaintext() {
  const cursor = RestoredUser.find({
    $or: [
      { accessToken: { $type: "object" } },
      { refreshToken: { $type: "object" } },
      { email: { $type: "object" } },
    ],
  }).select("_id accessToken refreshToken email").lean().cursor();
  let batch = [];
  let converted = 0;
  for await (const user of cursor) {
    const update = {};
    if (isEncrypted(user.accessToken)) update.accessToken = decryptSecret(user.accessToken, config.tokenEncryptionKey);
    if (isEncrypted(user.refreshToken)) update.refreshToken = decryptSecret(user.refreshToken, config.tokenEncryptionKey);
    if (isEncrypted(user.email)) update.email = decryptSecret(user.email, config.tokenEncryptionKey);
    if (!Object.keys(update).length) continue;
    batch.push({ updateOne: { filter: { _id: user._id }, update: { $set: update } } });
    if (batch.length >= 500) {
      await RestoredUser.bulkWrite(batch, { ordered: false });
      converted += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await RestoredUser.bulkWrite(batch, { ordered: false });
    converted += batch.length;
  }
  return converted;
}


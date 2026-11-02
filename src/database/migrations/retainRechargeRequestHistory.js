export async function retainRechargeRequestHistory(connection) {
  const collection = connection.collection("rechargerequests");
  let indexes;
  try { indexes = await collection.indexes(); }
  catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") return;
    throw error;
  }

  for (const index of indexes) {
    if (index.key?.expiresAt === 1 && index.expireAfterSeconds !== undefined) {
      await collection.dropIndex(index.name);
    }
  }
}

import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { connectDatabase } from "./database/connectDatabase.js";
import { startBotRuntime, stopBotRuntime } from "./discord/BotRuntime.js";
import { refreshPushbulletListener, stopPushbulletListener } from "./services/PushbulletListener.js";
import { startHostStatsSync, stopHostStatsSync } from "./services/HostStatsSync.js";
import { recoverInterruptedRuns, startRecoveryQueue } from "./services/RecoveryQueue.js";

await connectDatabase(config.mongodbUri);
const app = createApp();
const server = app.listen(config.port, () => console.log("Web server listening on port " + config.port));

await startBotRuntime();
await recoverInterruptedRuns();
startRecoveryQueue();
await startHostStatsSync();
await refreshPushbulletListener();

async function shutdown() {
  server.close();
  stopHostStatsSync();
  await Promise.allSettled([stopBotRuntime(), stopPushbulletListener()]);
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

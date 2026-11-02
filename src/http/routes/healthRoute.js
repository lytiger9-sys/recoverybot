import { Router } from "express";
import { getDatabaseStatus } from "../../database/connectDatabase.js";
import { getMainBotStatus } from "../../discord/BotRuntime.js";

export const healthRoute = Router();

healthRoute.get("/health", (_request, response) => {
  const database = getDatabaseStatus();
  const service = getMainBotStatus() ? "online" : "offline";
  const healthy = database === "connected" && service === "online";

  response.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "unavailable",
    database,
    service,
  });
});

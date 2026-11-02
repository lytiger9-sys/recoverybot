import { ActivityType } from "discord.js";
import { RestoredUser } from "../models/RestoredUser.js";

const PRESENCE_REFRESH_MS = 60_000;

export function startMainBotPresence(client) {
  let lastActivity = "";

  async function refreshPresence() {
    if (!client.isReady() || !client.user) return;
    const [total, active] = await Promise.all([
      RestoredUser.countDocuments({}),
      RestoredUser.countDocuments({ status: "ACTIVE" }),
    ]);
    const activity = `복구 가능 인원 수: ${active}/${total}`;
    if (activity === lastActivity) return;
    client.user.setPresence({
      activities: [{ name: activity, type: ActivityType.Watching }],
      status: "online",
    });
    lastActivity = activity;
  }

  void refreshPresence().catch((error) => console.error("Main bot presence update failed:", error?.name ?? "UnknownError"));
  const timer = setInterval(() => {
    void refreshPresence().catch((error) => console.error("Main bot presence update failed:", error?.name ?? "UnknownError"));
  }, PRESENCE_REFRESH_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

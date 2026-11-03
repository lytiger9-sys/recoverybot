export function syncGuildCommands(client, commands, label) {
  const payload = commands.map((command) => command.toJSON());

  async function syncGuild(guild) {
    try {
      await guild.commands.set(payload);
      console.log(label + " slash commands synced:", {
        guildId: guild.id,
        guildName: guild.name,
        commands: payload.map((command) => command.name),
      });
    } catch (error) {
      console.error(label + " slash command sync failed:", {
        guildId: guild.id,
        guildName: guild.name,
        message: error?.message ?? error?.name ?? "UnknownError",
      });
    }
  }

  client.once("ready", async () => {
    try {
      await client.application.commands.set([]);
    } catch (error) {
      console.error(label + " global slash command cleanup failed:", error?.message ?? error?.name ?? "UnknownError");
    }

    const guilds = [...client.guilds.cache.values()];
    if (!guilds.length) {
      console.warn(label + " has no guilds; guild slash commands cannot be published until the bot is added to a server.");
      return;
    }
    for (const guild of guilds) await syncGuild(guild);
  });

  client.on("guildCreate", (guild) => {
    if (client.isReady()) void syncGuild(guild);
  });
}

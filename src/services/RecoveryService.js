import { config } from "../config/env.js";
import { decryptSecret } from "../security/secretEncryption.js";

const API = "https://discord.com/api/v10";

async function discordRequest(url, options) {
  return fetch(url, options);
}

export async function checkHostsInGuild(hosts, guildId) {
  return Promise.all(hosts.map(async (host) => {
    try {
      const token = decryptSecret(host.botToken, config.tokenEncryptionKey);
      const headers = { Authorization: "Bot " + token };
      const guildResponse = await discordRequest(API + "/guilds/" + guildId, { headers });
      if (!guildResponse.ok) return { hostId: String(host._id), name: host.name, present: false, canAddMembers: false, status: guildResponse.status, stage: "guild" };
      const guild = await guildResponse.json();
      const meResponse = await discordRequest(API + "/users/@me", { headers });
      if (!meResponse.ok) return { hostId: String(host._id), name: host.name, present: true, canAddMembers: false, status: meResponse.status, stage: "bot-auth" };
      const me = await meResponse.json();
      const memberResponse = await discordRequest(API + "/guilds/" + guildId + "/members/" + me.id, { headers });
      if (!memberResponse.ok) return { hostId: String(host._id), name: host.name, present: false, canAddMembers: false, status: memberResponse.status, stage: "member" };
      const member = await memberResponse.json();
      const roles = new Map((guild.roles ?? []).map((role) => [role.id, BigInt(role.permissions)]));
      const permissions = [guildId, ...(member.roles ?? [])].reduce((bits, roleId) => bits | (roles.get(roleId) ?? 0n), 0n);
      const canAddMembers = (permissions & 8n) === 8n || (permissions & 1n) === 1n;
      return { hostId: String(host._id), name: host.name, present: true, canAddMembers, status: canAddMembers ? 200 : 403 };
    } catch {
      return { hostId: String(host._id), name: host.name, present: false, canAddMembers: false, status: 0 };
    }
  }));
}


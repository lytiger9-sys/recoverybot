const statuses = new Map();

export function setHostBotStatus(hostId, status) {
  statuses.set(String(hostId), {
    online: Boolean(status?.online),
    username: String(status?.username ?? ""),
    heartbeatAt: status?.heartbeatAt ? new Date(status.heartbeatAt) : null,
  });
}

export function clearHostBotStatus(hostId) {
  statuses.delete(String(hostId));
}

export function retainHostBotStatuses(hostIds) {
  const active = new Set([...hostIds].map(String));
  for (const hostId of statuses.keys()) if (!active.has(hostId)) statuses.delete(hostId);
}

export function isHostBotOnline(hostId) {
  const status = statuses.get(String(hostId));
  return Boolean(status?.online && status.heartbeatAt && Date.now() - status.heartbeatAt.getTime() < 45_000);
}

export function getHostBotStatus(hostId) {
  const status = statuses.get(String(hostId));
  return {
    online: Boolean(status?.online && status.heartbeatAt && Date.now() - status.heartbeatAt.getTime() < 45_000),
    username: status?.username ?? "",
  };
}

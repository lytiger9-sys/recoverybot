async function hostDbInfoApi(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: options.cache ?? "no-store",
  });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("로그인이 필요합니다.");
  }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "호기 유저 정보를 불러오지 못했습니다.");
  return payload;
}

function formatHostDbDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

function formatTokenTime(value) {
  if (!value) return "정보 없음";
  const remainingMs = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(remainingMs)) return "정보 없음";
  if (remainingMs <= 0) return "만료 · 다음 복구 시 갱신";
  const minutes = Math.floor(remainingMs / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return `${days}일 ${hours}시간 남음`;
  if (hours) return `${hours}시간 ${rest}분 남음`;
  return `${rest}분 남음`;
}

function appendUserRow(tbody, user, expired = false, onDelete) {
  const row = document.createElement("tr");
  const values = [
    user.userId,
    user.username,
    user.email || "-",
    expired ? (user.status === "REVOKED" ? "EXPIRED" : user.status) : "ACTIVE",
    formatHostDbDate(user.lastUpdated),
  ];
  if (!expired) values.push(formatTokenTime(user.tokenExpiresAt));
  for (const value of values) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.append(cell);
  }
  const actions = document.createElement("td");
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "button-quiet host-user-delete-button";
  remove.title = "유저 레코드 삭제";
  remove.setAttribute("aria-label", "유저 레코드 삭제");
  remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>';
  remove.addEventListener("click", () => onDelete(user, row));
  actions.append(remove);
  row.append(actions);
  if (expired) row.classList.add("host-user-expired");
  tbody.append(row);
}

document.addEventListener("DOMContentLoaded", async () => {
  const match = window.location.pathname.match(/^\/db(\d+)info$/);
  const hostNumber = match ? Number(match[1]) : 0;
  const message = document.getElementById("host-db-message");
  if (!hostNumber) {
    message.textContent = "호기 주소가 올바르지 않습니다.";
    message.classList.add("error");
    return;
  }
  let userTotals = { active: 0, expired: 0 };
  const updateCounts = () => {
    document.getElementById("active-count").textContent = userTotals.active.toLocaleString("ko-KR") + "명";
    document.getElementById("expired-count").textContent = userTotals.expired.toLocaleString("ko-KR") + "명";
    message.textContent = "전체 유저 " + (userTotals.active + userTotals.expired).toLocaleString("ko-KR") + "명 · 토큰 값은 이 페이지에 표시하지 않습니다.";
    message.classList.remove("error");
  };
  const deleteUser = async (user, row) => {
    if (!window.confirm(user.username + " 레코드를 삭제할까요?")) return;
    try {
      await hostDbInfoApi("/api/admin/users/" + encodeURIComponent(user._id), { method: "DELETE" });
      row.remove();
      if (user.status === "ACTIVE") userTotals.active -= 1;
      else userTotals.expired -= 1;
      updateCounts();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("error");
    }
  };
  try {
    const data = await hostDbInfoApi("/api/admin/hosts/db-info/" + encodeURIComponent(hostNumber));
    document.title = data.host.name + " 유저 정보 | Veloxcore Recovery";
    document.getElementById("host-title").textContent = data.host.name + " 유저 정보";
    userTotals = { active: data.activeUsers.length, expired: data.expiredUsers.length };
    updateCounts();
    const activeRows = document.getElementById("active-users");
    const expiredRows = document.getElementById("expired-users");
    data.activeUsers.forEach((user) => appendUserRow(activeRows, user, false, deleteUser));
    data.expiredUsers.forEach((user) => appendUserRow(expiredRows, user, true, deleteUser));
    if (!data.activeUsers.length) activeRows.innerHTML = '<tr><td colspan="7" class="host-user-empty">활성 유저가 없습니다.</td></tr>';
    if (!data.expiredUsers.length) expiredRows.innerHTML = '<tr><td colspan="6" class="host-user-empty">만료 또는 재인증이 필요한 유저가 없습니다.</td></tr>';
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  }
});

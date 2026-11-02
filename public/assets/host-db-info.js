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

const HOST_USER_PAGE_SIZE = 15;

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
  remove.addEventListener("click", () => onDelete(user));
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
  let activeUsers = [];
  let expiredUsers = [];
  const pages = { active: 1, expired: 1 };
  const tableBodies = {
    active: document.getElementById("active-users"),
    expired: document.getElementById("expired-users"),
  };
  const pagination = {
    active: document.getElementById("active-users-pagination"),
    expired: document.getElementById("expired-users-pagination"),
  };
  const pageJumpDialog = document.getElementById("host-page-jump-dialog");
  const pageJumpInput = document.getElementById("host-page-jump-input");
  let pageJumpTarget = "active";

  const getPageCount = (type) => Math.max(1, Math.ceil((type === "active" ? activeUsers : expiredUsers).length / HOST_USER_PAGE_SIZE));

  function renderUsers(type) {
    const users = type === "active" ? activeUsers : expiredUsers;
    const tbody = tableBodies[type];
    const totalPages = getPageCount(type);
    pages[type] = Math.min(pages[type], totalPages);
    const start = (pages[type] - 1) * HOST_USER_PAGE_SIZE;
    tbody.replaceChildren();
    const pageUsers = users.slice(start, start + HOST_USER_PAGE_SIZE);
    pageUsers.forEach((user) => appendUserRow(tbody, user, type === "expired", deleteUser));
    if (!users.length) {
      const row = document.createElement("tr");
      const empty = document.createElement("td");
      empty.colSpan = type === "active" ? 7 : 6;
      empty.className = "host-user-empty";
      empty.textContent = type === "active" ? "활성 유저가 없습니다." : "만료 또는 재인증이 필요한 유저가 없습니다.";
      row.append(empty);
      tbody.append(row);
    }
    const controls = pagination[type];
    controls.querySelector("[data-page-position]").textContent = `${pages[type]} / ${totalPages}`;
    controls.querySelector('[data-page-direction="prev"]').disabled = pages[type] <= 1;
    controls.querySelector('[data-page-direction="next"]').disabled = pages[type] >= totalPages;
    controls.hidden = users.length <= HOST_USER_PAGE_SIZE;
  }

  function setPage(type, page) {
    pages[type] = page;
    renderUsers(type);
  }

  const updateCounts = () => {
    userTotals = { active: activeUsers.length, expired: expiredUsers.length };
    document.getElementById("active-count").textContent = userTotals.active.toLocaleString("ko-KR") + "명";
    document.getElementById("expired-count").textContent = userTotals.expired.toLocaleString("ko-KR") + "명";
    message.textContent = "전체 유저 " + (userTotals.active + userTotals.expired).toLocaleString("ko-KR") + "명 · 토큰 값은 이 페이지에 표시하지 않습니다.";
    message.classList.remove("error");
  };
  const deleteUser = async (user) => {
    if (!window.confirm(user.username + " 레코드를 삭제할까요?")) return;
    try {
      await hostDbInfoApi("/api/admin/users/" + encodeURIComponent(user._id), { method: "DELETE" });
      if (user.status === "ACTIVE") activeUsers = activeUsers.filter((item) => item._id !== user._id);
      else expiredUsers = expiredUsers.filter((item) => item._id !== user._id);
      renderUsers(user.status === "ACTIVE" ? "active" : "expired");
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
    activeUsers = data.activeUsers;
    expiredUsers = data.expiredUsers;
    renderUsers("active");
    renderUsers("expired");
    updateCounts();
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  }

  for (const type of ["active", "expired"]) {
    pagination[type].querySelector('[data-page-direction="prev"]').addEventListener("click", () => {
      if (pages[type] > 1) setPage(type, pages[type] - 1);
    });
    pagination[type].querySelector('[data-page-direction="next"]').addEventListener("click", () => {
      if (pages[type] < getPageCount(type)) setPage(type, pages[type] + 1);
    });
    pagination[type].querySelector("[data-page-position]").addEventListener("click", () => {
      pageJumpTarget = type;
      pageJumpInput.min = "1";
      pageJumpInput.max = String(getPageCount(type));
      pageJumpInput.value = String(pages[type]);
      document.getElementById("host-page-jump-range").textContent = `1~${getPageCount(type)} 사이 페이지를 입력하세요.`;
      pageJumpDialog.showModal();
      pageJumpInput.focus();
      pageJumpInput.select();
    });
  }
  document.querySelector("[data-close-page-jump]").addEventListener("click", () => pageJumpDialog.close());
  document.getElementById("host-page-jump-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const targetPage = pageJumpInput.valueAsNumber;
    const maxPage = getPageCount(pageJumpTarget);
    if (!Number.isInteger(targetPage) || targetPage < 1 || targetPage > maxPage) {
      pageJumpInput.setCustomValidity(`1부터 ${maxPage} 사이 숫자를 입력하세요.`);
      pageJumpInput.reportValidity();
      return;
    }
    pageJumpInput.setCustomValidity("");
    pageJumpDialog.close();
    setPage(pageJumpTarget, targetPage);
  });
  pageJumpInput.addEventListener("input", () => pageJumpInput.setCustomValidity(""));
});

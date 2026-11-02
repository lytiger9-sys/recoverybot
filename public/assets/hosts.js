async function fetchJson(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const result = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error ?? "요청을 처리하지 못했습니다.");
  return result;
}

let hostsToastTimer;

function showMessage(text, isError = false) {
  const toast = document.getElementById("hosts-toast");
  if (!toast) return;
  toast.textContent = text;
  toast.title = text;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  clearTimeout(hostsToastTimer);
  hostsToastTimer = setTimeout(() => toast.classList.remove("visible"), 5000);
}

function createHostIconButton({ label, icon, asLink = false, className = "" }) {
  const element = document.createElement(asLink ? "a" : "button");
  element.className = `button-quiet host-icon-button ${className}`.trim();
  if (!asLink) element.type = "button";
  element.title = label;
  element.setAttribute("aria-label", label);
  element.innerHTML = icon;
  return element;
}

const hostActionIcons = {
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a7 7 0 0 0-12-2L4 8"/><path d="M4 4v4h4"/><path d="M6 16a7 7 0 0 0 12 2l2-2"/><path d="M20 20v-4h-4"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4.5h4l.5 2c.6.2 1.2.4 1.7.7l1.9-.7 2 3.4-1.5 1.5v1.2l1.5 1.5-2 3.4-1.9-.7c-.5.3-1.1.5-1.7.7l-.5 2h-4l-.5-2c-.6-.2-1.2-.4-1.7-.7l-1.9.7-2-3.4 1.5-1.5v-1.2L4 9.9l2-3.4 1.9.7c.5-.3 1.1-.5 1.7-.7l.4-2Z"/><circle cx="12" cy="12" r="3"/></svg>',
  database: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="8" ry="2"/><path d="M4 6v12c0 1.1 3.6 2 8 2s8-.9 8-2V6"/><path d="M4 12c0 1.1 3.6 2 8 2s8-.9 8-2"/></svg>',
  enabled: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>',
  disabled: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M21 3 3 21"/></svg>',
};

document.addEventListener("DOMContentLoaded", async () => {
  const settingsForm = document.getElementById("host-settings-form");
  const hostForm = document.getElementById("host-form");
  const namePreview = document.getElementById("host-name-preview");
  const countLabel = document.getElementById("host-count");
  const settingsInput = settingsForm.elements.namedItem("defaultNameTemplate");
  const hostList = document.getElementById("hosts-list");
  const searchInput = document.getElementById("host-search");
  const filterInput = document.getElementById("host-filter");
  let hostRecords = [];

  function updateNamePreview() {
    namePreview.value = (settingsInput.value || "호기 {n}").replaceAll("{n}", String(hostRecords.length + 1));
  }

  function renderHosts() {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const selectedState = filterInput.value;
    const hosts = hostRecords.filter((host) => {
      const matchesQuery = !query || `${host.name} ${host._id}`.toLocaleLowerCase().includes(query);
      const state = host.runtimeStatus ?? "off";
      return matchesQuery && (selectedState === "all" || state === selectedState);
    });
    hostList.replaceChildren();
    for (const host of hosts) {
      const item = document.createElement("details");
      item.className = "host-accordion host-list-item";

      const summary = document.createElement("summary");
      summary.className = "host-accordion-summary host-list-summary";
      const state = document.createElement("span");
      state.className = "host-state host-state-" + (host.runtimeStatus ?? "off");
      state.textContent = String(host.runtimeStatus ?? "off").toUpperCase();

      const nameCell = document.createElement("span");
      nameCell.className = "host-list-name";
      const name = document.createElement("strong");
      name.textContent = host.name;
      const hostId = document.createElement("small");
      hostId.textContent = String(host._id);
      nameCell.append(name, hostId);

      const memberInfo = document.createElement("span");
      memberInfo.className = "host-list-members";
      const memberCount = Number(host.memberCount ?? 0).toLocaleString("ko-KR");
      const activeCount = Number(host.activeMemberCount ?? 0).toLocaleString("ko-KR");
      memberInfo.innerHTML = `<strong>${memberCount}명</strong><small>예상 복구 ${activeCount}명</small>`;

      const lastRun = host.lastRecoveryAt ? new Date(host.lastRecoveryAt).toLocaleString("ko-KR") : "기록 없음";
      const lastRunCell = document.createElement("span");
      lastRunCell.className = "host-list-last-run";
      lastRunCell.textContent = lastRun;

      const actions = document.createElement("span");
      actions.className = "host-list-actions";
      const sync = createHostIconButton({ label: host.name + " 정보 새로고침", icon: hostActionIcons.refresh });
      sync.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        sync.disabled = true;
        try {
          const result = await fetchJson("/api/admin/hosts/" + encodeURIComponent(host._id) + "/sync", { method: "POST" });
          await loadHosts();
          const updatedHost = result.host;
          showMessage(`${updatedHost.name} 정보 갱신 · 봇 ${updatedHost.botOnline ? "온라인" : "오프라인"} · 전체 ${Number(updatedHost.memberCount).toLocaleString("ko-KR")}명 · 예상 복구 ${Number(updatedHost.activeMemberCount).toLocaleString("ko-KR")}명`);
        } catch (error) {
          sync.disabled = false;
          showMessage(error.message, true);
        } finally {
          sync.disabled = false;
        }
      });
      const edit = createHostIconButton({ label: host.name + " 설정", icon: hostActionIcons.settings });
      edit.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        item.open = !item.open;
      });
      const dbInfo = createHostIconButton({ label: host.name + " DB 보기", icon: hostActionIcons.database, asLink: true, className: "host-db-info-icon" });
      dbInfo.href = "/db" + host.hostNumber + "info";
      dbInfo.addEventListener("click", (event) => event.stopPropagation());
      const isEnabled = Boolean(host.enabled);
      const toggle = createHostIconButton({
        label: isEnabled ? host.name + " 사용 중지" : host.name + " 사용 시작",
        icon: isEnabled ? hostActionIcons.enabled : hostActionIcons.disabled,
      });
      toggle.classList.add("host-enable-toggle", isEnabled ? "is-enabled" : "is-disabled");
      toggle.setAttribute("aria-pressed", String(isEnabled));
      toggle.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle.disabled = true;
        try {
          await fetchJson("/api/admin/hosts/" + encodeURIComponent(host._id), {
            method: "PATCH",
            body: JSON.stringify({ enabled: !isEnabled }),
          });
          await loadHosts();
          showMessage(host.name + (isEnabled ? " 사용을 중지했습니다." : " 사용을 시작했습니다."));
        } catch (error) {
          toggle.disabled = false;
          showMessage(error.message, true);
        }
      });
      actions.append(sync, edit, dbInfo, toggle);
      summary.append(state, nameCell, memberInfo, lastRunCell, actions);
      item.append(summary);

      const idRow = document.createElement("div");
      idRow.className = "host-id-row";
      const idLabel = document.createElement("span");
      idLabel.textContent = "HOST_ID";
      const idValue = document.createElement("code");
      idValue.textContent = String(host._id);
      const copyId = document.createElement("button");
      copyId.type = "button";
      copyId.className = "button-quiet button-small";
      copyId.textContent = "ID 복사";
      copyId.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(String(host._id));
          copyId.textContent = "복사됨";
          setTimeout(() => { copyId.textContent = "ID 복사"; }, 1200);
        } catch { showMessage("클립보드에 복사하지 못했습니다.", true); }
      });
      idRow.append(idLabel, idValue, copyId);
      item.append(idRow);

      const form = document.createElement("form");
      form.className = "host-settings-form form-grid";
      form.innerHTML = `
        <label>호기 이름<input name="name" maxlength="80" required></label>
        <label>Discord OAuth Client ID<input name="clientId" inputmode="numeric" required></label>
        <label>Client Secret 변경<input name="clientSecret" type="password" autocomplete="new-password"></label>
        <label>봇 토큰 변경<input name="botToken" type="password" autocomplete="new-password"></label>
        <label class="wide">봇 초대 링크 (선택)<input name="inviteLink" type="url" placeholder="https://discord.com/oauth2/authorize?..."></label>
        <div class="wide form-actions"><button type="submit">설정 저장</button><button type="button" class="button-danger" data-delete>호기 삭제</button></div>`;
      form.elements.namedItem("name").value = host.name;
      form.elements.namedItem("clientId").value = host.clientId;
      form.elements.namedItem("inviteLink").value = host.inviteLink || "";
      form.elements.namedItem("clientSecret").placeholder = host.hasClientSecret ? "저장된 값 유지 · 변경할 때만 입력" : "Client Secret 입력";
      form.elements.namedItem("botToken").placeholder = host.hasBotToken ? "저장된 값 유지 · 변경할 때만 입력" : "봇 토큰 입력";
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        try {
          await fetchJson("/api/admin/hosts/" + encodeURIComponent(host._id), { method: "PATCH", body: JSON.stringify(values) });
          await loadHosts();
          showMessage(host.name + " 설정을 저장했습니다.");
        } catch (error) { showMessage(error.message, true); }
      });

      form.querySelector("[data-delete]").addEventListener("click", async () => {
        if (!window.confirm("이 호기를 삭제할까요? 저장된 유저 데이터가 있으면 삭제할 수 없습니다.")) return;
        try {
          await fetchJson("/api/admin/hosts/" + encodeURIComponent(host._id), { method: "DELETE" });
          await loadHosts();
          showMessage("호기를 삭제했습니다.");
        } catch (error) { showMessage(error.message, true); }
      });
      item.append(form);
      hostList.append(item);
    }
    if (hosts.length === 0) {
      const empty = document.createElement("p");
      empty.className = "host-list-empty";
      empty.textContent = hostRecords.length ? "검색 조건에 맞는 호기가 없습니다." : "등록된 호기가 없습니다.";
      hostList.append(empty);
    }
  }

  async function loadHosts() {
    const { hosts } = await fetchJson("/api/admin/hosts");
    hostRecords = hosts;
    countLabel.textContent = hosts.length + "개";
    updateNamePreview();
    renderHosts();
  }

  searchInput.addEventListener("input", renderHosts);
  filterInput.addEventListener("change", renderHosts);
  settingsInput.addEventListener("input", updateNamePreview);

  try {
    const settings = await fetchJson("/api/admin/hosts/settings");
    settingsInput.value = settings.defaultNameTemplate;
    await loadHosts();
  } catch (error) { showMessage(error.message, true); }

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await fetchJson("/api/admin/hosts/settings", { method: "PUT", body: JSON.stringify({ defaultNameTemplate: settingsInput.value }) });
      settingsInput.value = result.defaultNameTemplate;
      await loadHosts();
      showMessage("기본 이름 패턴을 저장했습니다.");
    } catch (error) { showMessage(error.message, true); }
  });

  hostForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(hostForm));
    try {
      await fetchJson("/api/admin/hosts", { method: "POST", body: JSON.stringify(values) });
      hostForm.reset();
      await loadHosts();
      showMessage("호기를 추가했습니다. 비밀값은 암호화되어 저장됐습니다.");
    } catch (error) { showMessage(error.message, true); }
  });
});

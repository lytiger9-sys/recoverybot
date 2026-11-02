async function dataApi(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("로그인이 필요합니다.");
  }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "요청을 처리하지 못했습니다.");
  return payload;
}

function showDataMessage(text, error = false) {
  const element = document.getElementById("data-message");
  element.textContent = text;
  element.classList.toggle("error", error);
}

async function loadHostsForData() {
  const { hosts } = await dataApi("/api/admin/hosts");
  const exportSelect = document.getElementById("export-host");
  const addSelect = document.getElementById("user-host");
  const plainSelect = document.getElementById("plaintext-host");
  for (const select of [exportSelect, addSelect, plainSelect]) select.replaceChildren();

  for (const host of hosts) {
    const option = document.createElement("option");
    option.value = host._id;
    option.textContent = host.name + (host.enabled ? "" : " (중지)");
    exportSelect.append(option.cloneNode(true));
    addSelect.append(option.cloneNode(true));
    plainSelect.append(option);
  }
  if (!hosts.length) showDataMessage("등록된 호기가 없습니다.", true);
}

async function exportSelectedHost() {
  const hostId = document.getElementById("export-host").value;
  if (!hostId) {
    showDataMessage("추출할 호기를 선택해 주세요.", true);
    return;
  }
  const query = new URLSearchParams({ hostIds: hostId });
  try {
    const response = await fetch("/api/admin/data/export?" + query.toString(), { credentials: "same-origin" });
    if (response.status === 401) {
      window.location.assign("/login");
      return;
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error ?? "백업을 추출하지 못했습니다.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "recovery-host-data.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showDataMessage("선택한 호기의 평문 JSON을 추출했습니다.");
  } catch (error) {
    showDataMessage(error.message, true);
  }
}

async function addUserRecord(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const hostId = values.get("hostId");
  try {
    await dataApi("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        hostId,
        discordUserId: values.get("discordUserId"),
        username: values.get("username"),
        email: values.get("email"),
        accessToken: values.get("accessToken"),
        refreshToken: values.get("refreshToken"),
      }),
    });
    document.getElementById("export-host").value = hostId;
    form.reset();
    showDataMessage("유저 레코드를 추가했습니다.");
  } catch (error) {
    showDataMessage(error.message, true);
  }
}

async function importPlaintextBackup(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const file = values.get("backupFile");
  if (!file || !file.size) {
    showDataMessage("백업 JSON 파일을 선택해 주세요.", true);
    return;
  }
  try {
    const backup = JSON.parse(await file.text());
    const result = await dataApi("/api/admin/data/import", {
      method: "POST",
      body: JSON.stringify({ backup, plainHostId: values.get("hostId") }),
    });
    document.getElementById("export-host").value = values.get("hostId");
    showDataMessage(result.imported + "개 레코드를 추가·갱신했습니다. 파일에 없는 레코드는 그대로 유지됩니다.");
    form.reset();
  } catch (error) {
    showDataMessage(error instanceof SyntaxError ? "JSON 파일 형식을 확인해 주세요." : error.message, true);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadHostsForData();
  } catch (error) {
    showDataMessage(error.message, true);
  }
  document.getElementById("export-users").addEventListener("click", exportSelectedHost);
  document.getElementById("user-form").addEventListener("submit", addUserRecord);
  document.getElementById("plaintext-import-form").addEventListener("submit", importPlaintextBackup);
});

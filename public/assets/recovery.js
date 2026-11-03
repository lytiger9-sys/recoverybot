async function recoveryApi(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (response.status === 401) { window.location.assign("/login"); throw new Error("로그인이 필요합니다."); }
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const describeHost = (host) => {
      if (host.stage === "bot-auth" || host.status === 401) return "봇 토큰 오류(401): " + host.name;
      if (host.status === 429) return "Discord 요청 제한(429): " + host.name;
      if (Number(host.status) >= 500) return "Discord 서버 오류(" + host.status + "): " + host.name;
      if (host.stage === "guild" || host.stage === "member") return "서버 ID 또는 봇 초대 확인(HTTP " + host.status + "): " + host.name;
      if (host.stage === "roles") return "서버 역할 조회 실패(HTTP " + host.status + "): " + host.name;
      if (host.stage === "request") return "Discord 연결 오류: " + host.name;
      return "봇에 초대 권한(Create Instant Invite 또는 Administrator) 필요: " + host.name;
    };
    const missing = payload?.missingHosts?.map(describeHost).join(", ");
    const permissions = payload?.permissionHosts?.map(describeHost).join(", ");
    const diagnostics = [missing, permissions].filter(Boolean).join(" · ");
    throw new Error(diagnostics || payload?.error || "요청을 처리하지 못했습니다.");
  }
  return payload;
}

document.addEventListener("DOMContentLoaded", async () => {
  const hostContainer = document.getElementById("recovery-hosts");
  const toast = document.getElementById("recovery-toast");
  const startButton = document.getElementById("recovery-start");
  const runRows = document.getElementById("recovery-runs");
  let hosts = [];
  let toastTimer;

  function notify(text, isError = false) {
    toast.textContent = text;
    toast.title = text;
    toast.classList.toggle("error", isError);
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 5500);
  }

  function selectedHosts() {
    const selected = new Set([...hostContainer.querySelectorAll("input:checked")].map((input) => input.value));
    return hosts.filter((host) => selected.has(String(host._id)));
  }

  function updateSelection() {
    const selected = selectedHosts();
    document.getElementById("recovery-selected-count").textContent =
      selected.length ? selected.reduce((sum, host) => sum + host.activeMemberCount, 0) + "명 선택됨" : "호기를 선택해 주세요.";
  }

  async function loadHosts() {
    const data = await recoveryApi("/api/admin/recovery/hosts");
    hosts = data.hosts;
    hostContainer.replaceChildren();
    if (!hosts.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "사용 가능한 호기가 없습니다. 호기 설정에서 먼저 등록해 주세요.";
      hostContainer.append(empty);
      updateSelection();
      return;
    }
    for (const host of hosts) {
      const option = document.createElement("div");
      option.className = "recovery-host-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = host._id;
      checkbox.id = "recovery-host-" + host._id;
      checkbox.addEventListener("change", updateSelection);
      const inviteLink = document.createElement("a");
      inviteLink.className = "recovery-host-name-link";
      inviteLink.href = host.inviteLink;
      inviteLink.target = "_blank";
      inviteLink.rel = "noopener noreferrer";
      inviteLink.title = "봇 초대하기";
      inviteLink.textContent = host.name;
      const count = document.createElement("label");
      count.className = "recovery-host-count";
      count.htmlFor = checkbox.id;
      count.textContent = " · ACTIVE " + Number(host.activeMemberCount).toLocaleString("ko-KR") + "명";
      option.append(checkbox, inviteLink, count);
      hostContainer.append(option);
    }
    updateSelection();
  }

  function formatDuration(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "계산 중";
    const seconds = Math.floor(totalSeconds);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    if (hours) return hours + "시간 " + minutes + "분";
    if (minutes) return minutes + "분 " + remainder + "초";
    return remainder + "초";
  }

  function formatRunDate(value) {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric", month: "numeric", day: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(value));
  }

  async function loadRuns() {
    const { runs } = await recoveryApi("/api/admin/recovery/runs");
    runRows.replaceChildren();
    const statusLabels = { QUEUED: "대기", RUNNING: "진행 중", COMPLETED: "완료", FAILED: "실패" };
    const failureLabels = {
      oauth_revoked: "OAuth 만료/취소",
      discord_401: "Discord 인증 실패",
      discord_403: "권한 부족",
      discord_404: "서버 또는 유저 없음",
      discord_429: "Discord 요청 제한",
      discord_5xx: "Discord 서버 오류",
      discord_error: "Discord API 오류",
      network_error: "네트워크 오류",
      member_check_failed: "대상 유저 가입 상태 확인 실패",
      membership_mismatch: "Discord 응답과 실제 가입 상태 불일치",
      run_incomplete: "호기 중단 또는 대상 변경으로 미처리",
      host_offline: "호기 봇 오프라인",
      host_auth_failed: "호기 봇 인증 실패",
      host_left_guild: "호기 봇이 서버에서 나감",
      bot_permission_lost: "호기 봇 권한 상실",
      process_restarted: "프로세스 재시작으로 중단",
      unexpected_error: "기타 처리 오류",
    };
    for (const run of runs) {
      const row = document.createElement("tr");
      const processed = Number(run.processed ?? 0);
      const total = Number(run.total ?? 0);
      const percent = total ? Math.min(100, Math.floor(processed * 100 / total)) : 0;
      const values = [
        formatRunDate(run.createdAt),
        run.targetGuildId,
        run.status === "FAILED"
          ? "실패 (" + (Number(run.succeeded ?? 0) + Number(run.alreadyMember ?? 0)) + "/" + total + ")"
          : run.status === "COMPLETED"
            ? "완료 (" + (Number(run.succeeded ?? 0) + Number(run.alreadyMember ?? 0)) + "/" + total + ")"
            : statusLabels[run.status] ?? run.status,
        run.recoveryType === "LICENSE" ? "라이선스" + (run.licenseName ? " · " + run.licenseName : "") : "관리자 직접",
        run.currentHostName || "-",
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }
      const progressCell = document.createElement("td");
      const progress = document.createElement("progress");
      progress.max = total || 1;
      progress.value = processed;
      progress.setAttribute("aria-label", "복구 진행률 " + percent + "%");
      const progressText = document.createElement("span");
      progressText.className = "progress-label";
      progressText.textContent = processed + "/" + total + "명 · " + percent + "%";
      progressCell.append(progress, progressText);
      row.append(progressCell);
      for (const value of [run.succeeded ?? 0, run.alreadyMember ?? 0, run.failed ?? 0]) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }
      const reasonCell = document.createElement("td");
      const reasons = run.failureReasons instanceof Map ? [...run.failureReasons.entries()] : Object.entries(run.failureReasons ?? {});
      reasonCell.textContent = reasons
        .filter(([, count]) => Number(count) > 0)
        .map(([code, count]) => (failureLabels[code] ?? "기타 오류") + " " + Number(count) + "명")
        .join(", ") || run.message || "-";
      reasonCell.title = reasonCell.textContent;
      row.append(reasonCell);
      const eta = document.createElement("td");
      eta.textContent = run.status === "COMPLETED" ? "완료" : run.status === "FAILED" ? "-" : formatDuration(run.estimatedRemainingSeconds);
      row.append(eta);
      runRows.append(row);
    }
  }

  try { await Promise.all([loadHosts(), loadRuns()]); }
  catch (error) { notify(error.message, true); }

  startButton.addEventListener("click", async () => {
    const selected = selectedHosts();
    const guildId = document.getElementById("recovery-guild-id").value.trim();
    if (!selected.length) return notify("복구할 호기를 체크해 주세요.", true);
    if (!/^\d{17,22}$/.test(guildId)) return notify("Discord 서버 ID를 확인해 주세요.", true);
    const total = selected.reduce((sum, host) => sum + host.activeMemberCount, 0);
    if (!total) return notify("선택한 호기에 ACTIVE 멤버가 없습니다.", true);
    if (!window.confirm(selected.map((host) => host.name).join(", ") + " 호기의 ACTIVE 멤버 " + total + "명을 서버 " + guildId + "에 복구할까요?")) return;

    startButton.disabled = true;
    try {
      const result = await recoveryApi("/api/admin/recovery/runs", {
        method: "POST",
        body: JSON.stringify({ hostIds: selected.map((host) => host._id), guildId }),
      });
      notify("복구 대기열에 등록했습니다. 대상 " + result.total + "명");
      await loadRuns();
    } catch (error) { notify(error.message, true); }
    finally { startButton.disabled = false; }
  });

  document.getElementById("recovery-refresh").addEventListener("click", () => loadRuns().catch((error) => notify(error.message, true)));
  setInterval(() => loadRuns().catch(() => {}), 3000);
});




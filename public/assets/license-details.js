async function licenseDetailsApi(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("로그인이 필요합니다.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "라이선스 실행 정보를 불러오지 못했습니다.");
  return payload;
}

function appendLicenseDetail(container, label, value) {
  const item = document.createElement("div");
  item.className = "license-detail-item";
  const caption = document.createElement("span");
  caption.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value || "-";
  item.append(caption, content);
  container.append(item);
}

function formatLicenseDate(value) {
  return value ? new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value)) : "-";
}

function renderLicenseRun(run, index, runCount) {
  const statusNames = { QUEUED: "대기 중", RUNNING: "진행 중", COMPLETED: "완료", FAILED: "실패" };
  const card = document.createElement("section");
  card.className = "license-run-card";
  const heading = document.createElement("h4");
  heading.textContent = (runCount - index) + "차 실행 · " + formatLicenseDate(run.startedAt);
  card.append(heading);

  const grid = document.createElement("div");
  grid.className = "license-run-grid";
  const requester = run.requesterUsername + (run.requesterDiscordId ? " · " + run.requesterDiscordId : "");
  const server = (run.targetGuildName ? run.targetGuildName + " · " : "") + run.targetGuildId;
  appendLicenseDetail(grid, "실행자", requester);
  appendLicenseDetail(grid, "대상 서버", server);
  appendLicenseDetail(grid, "사용 호기", (run.hostNames ?? []).join(", "));
  appendLicenseDetail(grid, "실행 당시 라이선스 예상 인원", Number(run.expectedMemberCount ?? 0).toLocaleString("ko-KR") + "명");
  appendLicenseDetail(grid, "실행 당시 대상 인원", Number(run.targetMemberCount ?? 0).toLocaleString("ko-KR") + "명");
  appendLicenseDetail(grid, "이번 실행 신규 복구", Number(run.succeeded ?? 0).toLocaleString("ko-KR") + "명");
  appendLicenseDetail(grid, "이미 서버에 있던 인원", Number(run.alreadyMember ?? 0).toLocaleString("ko-KR") + "명");
  appendLicenseDetail(grid, "누적 완료", Number(run.completedMemberCount ?? 0).toLocaleString("ko-KR") + "/" + Number(run.targetMemberCount ?? 0).toLocaleString("ko-KR") + "명");
  appendLicenseDetail(grid, "실패 인원", Number(run.failed ?? 0).toLocaleString("ko-KR") + "명");
  appendLicenseDetail(grid, "실행 상태", statusNames[run.status] ?? run.status);
  appendLicenseDetail(grid, "종료 시각", run.completedAt ? formatLicenseDate(run.completedAt) : "진행 중");
  card.append(grid);

  if (run.failureReason) {
    const note = document.createElement("p");
    note.className = "license-run-note";
    note.textContent = "실패 사유: " + run.failureReason;
    card.append(note);
  }
  if (run.retryOfRunId) {
    const retry = document.createElement("p");
    retry.className = "license-run-note";
    retry.textContent = "이전 실패 실행을 이어서 진행한 기록입니다.";
    card.append(retry);
  }
  return card;
}

document.addEventListener("DOMContentLoaded", () => {
  const dialog = document.getElementById("license-detail-dialog");
  const subtitle = document.getElementById("license-detail-subtitle");
  const summary = document.getElementById("license-detail-summary");
  const runs = document.getElementById("license-detail-runs");
  const message = document.getElementById("license-create-message");
  dialog.querySelector("[data-close-license-details]").addEventListener("click", () => dialog.close());

  document.addEventListener("license:show-details", async (event) => {
    const { licenseId, button } = event.detail ?? {};
    if (!licenseId) return;
    if (button) button.disabled = true;
    try {
      const payload = await licenseDetailsApi("/api/admin/licenses/" + encodeURIComponent(licenseId) + "/details");
      const license = payload.license;
      subtitle.textContent = (license.productName || "라이선스") + " · " + license.code;
      summary.replaceChildren();
      appendLicenseDetail(summary, "라이선스 코드", license.code);
      appendLicenseDetail(summary, "구매자 Discord ID", license.purchaserDiscordId || "직접 발급");
      appendLicenseDetail(summary, "발급 시 예상 복구 인원", Number(license.expectedMemberCount ?? 0).toLocaleString("ko-KR") + "명");
      appendLicenseDetail(summary, "발급일", formatLicenseDate(license.createdAt));
      appendLicenseDetail(summary, "라이선스 만료일", license.expiresAt ? formatLicenseDate(license.expiresAt) : "영구");
      appendLicenseDetail(summary, "대상 호기", (license.hostNames ?? []).join(", "));

      runs.replaceChildren();
      if (!payload.runs.length) {
        const empty = document.createElement("p");
        empty.className = "license-detail-empty";
        empty.textContent = "아직 이 라이선스로 시작한 복구 실행이 없습니다.";
        runs.append(empty);
      } else {
        payload.runs.forEach((run, index) => runs.append(renderLicenseRun(run, index, payload.runs.length)));
      }
      dialog.showModal();
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("error");
    } finally {
      if (button) button.disabled = false;
    }
  });
});

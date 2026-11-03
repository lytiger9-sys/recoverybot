async function licenseApi(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (response.status === 401) { window.location.assign("/login"); throw new Error("로그인이 필요합니다."); }
  const result = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error ?? "요청을 처리하지 못했습니다.");
  return result;
}

const licenseStatusLabels = { ISSUED: "발급완료", IN_PROGRESS: "진행중", REJECTED: "거절됨", COMPLETED: "완료됨", FAILED: "실패", EXPIRED: "만료됨" };

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("license-create-form");
  const productize = form.elements.namedItem("productize");
  const productFields = document.getElementById("product-license-fields");
  const hostContainer = document.getElementById("license-hosts");
  const hostTotal = document.getElementById("license-host-total");
  const message = document.getElementById("license-create-message");
  const result = document.getElementById("issued-license-result");
  const rows = document.getElementById("license-rows");
  const search = document.getElementById("license-search");
  const tabs = document.getElementById("license-status-tabs");
  const totalLabel = document.getElementById("license-total");
  let activeStatus = "ALL";
  let currentPage = 1;
  let totalPages = 1;
  let searchTimer;
  let activeMemberCounts = new Map();

  function updateHostTotal() {
    const checked = [...form.querySelectorAll('input[name="hostIds"]:checked')];
    const total = (productize.checked
      ? [...activeMemberCounts.values()]
      : checked.map((checkbox) => activeMemberCounts.get(checkbox.value) ?? 0))
      .reduce((sum, count) => sum + count, 0);
    hostTotal.textContent = (productize.checked ? "전체 등록 호기" : "선택 호기") + " 예상 ACTIVE 합계: " + total.toLocaleString("ko-KR") + "명";
  }

  function toggleHostPicker() {
    hostContainer.closest(".host-picker").hidden = productize.checked;
    updateHostTotal();
  }

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("error", isError);
  }

  async function loadHosts() {
    const { hosts } = await licenseApi("/api/admin/hosts");
    hostContainer.replaceChildren();
    activeMemberCounts = new Map(hosts.map((host) => [String(host._id), Number(host.activeMemberCount ?? 0)]));
    for (const [index, host] of hosts.entries()) {
      const memberCount = Number(host.memberCount ?? 0);
      const activeMemberCount = Number(host.activeMemberCount ?? 0);

      const label = document.createElement("label");
      label.className = "host-choice";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "hostIds";
      checkbox.value = host._id;
      const text = document.createElement("span");
      text.textContent = `${index + 1}호기 · 예상 ACTIVE ${Number(host.activeMemberCount ?? 0).toLocaleString("ko-KR")}명`;
      label.append(checkbox, text);
      hostContainer.append(label);
    }
    updateHostTotal();
  }

  async function loadLicenses() {
    const query = new URLSearchParams({ status: activeStatus, q: search.value.trim(), page: String(currentPage) });
    const payload = await licenseApi("/api/admin/licenses?" + query);
    rows.replaceChildren();
    for (const license of payload.licenses) {
      const row = document.createElement("tr");
      const values = [
        license.code + (license.productName ? " · " + license.productName : ""),
        new Date(license.createdAt).toLocaleString("ko-KR"),
        (license.hostNames ?? []).join(", "),
        Number(license.expectedMemberCount ?? 0).toLocaleString("ko-KR") + "명",
        license.expiresAt ? new Date(license.expiresAt).toLocaleString("ko-KR") : "영구",
        ["FAILED", "COMPLETED"].includes(license.status)
          ? (license.status === "FAILED" ? "실패 (" : "완료됨 (")
            + Number(license.recoverySucceeded ?? 0).toLocaleString("ko-KR") + "/"
            + Number(license.recoveryTotal ?? license.expectedMemberCount ?? 0).toLocaleString("ko-KR") + ")"
          : licenseStatusLabels[license.status] ?? license.status,
        String(license.rejectionCount ?? 0) + "/2",
      ];
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (license.status === "FAILED" && value.startsWith("실패 (")) cell.title = license.failureReason || "복구 중 오류가 발생했습니다.";
        row.append(cell);
      }
      const actionCell = document.createElement("td");
      if (license.status === "FAILED" && license.recoveryRunId) {
        const resume = document.createElement("button");
        resume.type = "button";
        resume.className = "button-quiet button-small";
        resume.textContent = "이어하기";
        resume.addEventListener("click", async () => {
          resume.disabled = true;
          try {
            const resumed = await licenseApi("/api/admin/licenses/" + encodeURIComponent(license._id) + "/resume", { method: "POST" });
            setMessage("복구를 이어서 시작했습니다. 이미 성공한 " + Number(resumed.skipped ?? 0).toLocaleString("ko-KR") + "명은 건너뛰고 남은 " + Number(resumed.total ?? 0).toLocaleString("ko-KR") + "명을 처리합니다.");
            await loadLicenses();
          } catch (error) {
            resume.disabled = false;
            setMessage(error.message, true);
          }
        });
        actionCell.append(resume);
      } else {
        actionCell.textContent = "—";
      }
      row.append(actionCell);
      rows.append(row);
    }
    totalPages = Math.max(1, Math.ceil(payload.total / payload.pageSize));
    totalLabel.textContent = "총 " + payload.total.toLocaleString("ko-KR") + "개";
    document.getElementById("license-page").textContent = currentPage + " / " + totalPages;
    document.getElementById("license-prev").disabled = currentPage <= 1;
    document.getElementById("license-next").disabled = currentPage >= totalPages;
  }

  const toggleProductFields = () => {
    productFields.hidden = !productize.checked;
    productFields.querySelectorAll("input").forEach((input) => {
      input.disabled = !productize.checked;
      input.required = productize.checked;
    });
  };
  productize.addEventListener("change", toggleProductFields);
  productize.addEventListener("change", toggleHostPicker);
  hostContainer.addEventListener("change", updateHostTotal);
  toggleProductFields();
  toggleHostPicker();
  form.elements.namedItem("permanent").addEventListener("change", (event) => {
    form.elements.namedItem("validityDays").disabled = event.target.checked;
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    result.hidden = true;
    const values = Object.fromEntries(new FormData(form));
    values.hostIds = productize.checked ? [] : [...form.querySelectorAll('input[name="hostIds"]:checked')].map((input) => input.value);
    values.productize = productize.checked;
    values.permanent = form.elements.namedItem("permanent").checked;
    values.validityDays = values.permanent ? null : Number(values.validityDays);
    if (values.productize) {
      values.priceMinor = Number(values.priceMinor);
      values.minimumActiveMembers = Number(values.minimumActiveMembers);
      values.maximumActiveMembers = Number(values.maximumActiveMembers);
    }
    try {
      const created = await licenseApi("/api/admin/licenses", { method: "POST", body: JSON.stringify(values) });
      if (created.kind === "LICENSE") {
        result.replaceChildren();
        const title = document.createElement("strong");
        title.textContent = "직접 지급용 코드";
        const code = document.createElement("code");
        code.textContent = created.license.code;
        const detail = document.createElement("p");
        detail.textContent = "호기: " + created.license.hostNames.join(", ") + " · 예상 복구 " + Number(created.license.expectedMemberCount).toLocaleString("ko-KR") + "명";
        const copy = document.createElement("button");
        copy.type = "button";
        copy.textContent = "코드 복사";
        copy.addEventListener("click", async () => { await navigator.clipboard.writeText(created.license.code); copy.textContent = "복사 완료"; });
        result.append(title, code, detail, copy);
        result.hidden = false;
        setMessage("수동 지급용 라이선스를 만들었습니다.");
      } else {
        setMessage("상품을 구매 목록에 등록했습니다. 실제 코드는 구매 시 발급됩니다.");
      }
      await loadLicenses();
    } catch (error) { setMessage(error.message, true); }
  });

  tabs.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-status]");
    if (!button) return;
    activeStatus = button.dataset.status;
    currentPage = 1;
    tabs.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
    try { await loadLicenses(); } catch (error) { setMessage(error.message, true); }
  });
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentPage = 1; loadLicenses().catch((error) => setMessage(error.message, true)); }, 250);
  });
  document.getElementById("license-prev").addEventListener("click", () => { if (currentPage > 1) { currentPage -= 1; loadLicenses().catch((error) => setMessage(error.message, true)); } });
  document.getElementById("license-next").addEventListener("click", () => { if (currentPage < totalPages) { currentPage += 1; loadLicenses().catch((error) => setMessage(error.message, true)); } });

  try { await Promise.all([loadHosts(), loadLicenses()]); }
  catch (error) { setMessage(error.message, true); }
});

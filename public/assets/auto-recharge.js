async function autoRechargeApi(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (response.status === 401) { window.location.assign("/login"); throw new Error("로그인이 필요합니다."); }
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "요청을 처리하지 못했습니다.");
  return payload;
}

function setAutoRechargeMessage(text, isError = false) {
  let toast = document.getElementById("auto-recharge-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "auto-recharge-toast";
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.append(toast);
  }
  toast.textContent = text;
  toast.title = text;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  clearTimeout(setAutoRechargeMessage.timeout);
  setAutoRechargeMessage.timeout = setTimeout(() => toast.classList.remove("visible"), 3500);
}

function updateEmbedPreview(form) {
  const value = (name) => String(form.elements.namedItem(name).value ?? "");
  const title = document.getElementById("preview-title");
  const description = document.getElementById("preview-description");
  const footer = document.getElementById("preview-footer");
  const footerSeparator = document.getElementById("preview-footer-separator");
  const minimum = document.getElementById("preview-minimum");
  const image = document.getElementById("preview-image");
  const embed = document.getElementById("embed-preview");
  title.textContent = value("embedTitle") || "자동충전";
  description.textContent = value("embedDescription");
  footer.textContent = value("embedFooter");
  footer.hidden = !value("embedFooter").trim();
  footerSeparator.hidden = footer.hidden;
  const minimumAmount = Number(value("minimumTopupMinor") || 100).toLocaleString("ko-KR");
  minimum.textContent = "- 최소 충전 금액은 " + minimumAmount + "원입니다.";
  minimum.hidden = false;
  embed.style.borderLeftColor = value("embedColor") || "#c8a45b";
  const imageUrl = value("embedImageUrl");
  if (imageUrl && /^https:\/\//i.test(imageUrl)) { image.src = imageUrl; image.hidden = false; }
  else { image.removeAttribute("src"); image.hidden = true; }
}

async function refreshAutoRechargeSettings(form) {
  const settings = await autoRechargeApi("/api/admin/auto-recharge");
  for (const name of ["accountBank", "accountNumber", "accountHolder", "minimumTopupMinor", "notificationAppName", "reviewLogChannelId", "purchaseLogChannelId", "chargeLogChannelId", "depositLogChannelId", "embedTitle", "embedDescription", "embedColor", "embedFooter", "embedImageUrl"]) {
    form.elements.namedItem(name).value = settings[name] ?? (name === "minimumTopupMinor" ? 100 : "");
  }
  form.elements.namedItem("enabled").checked = Boolean(settings.enabled);
  updateEmbedPreview(form);
}

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("auto-recharge-form");
  const logChannelFields = ["reviewLogChannelId", "purchaseLogChannelId", "chargeLogChannelId", "depositLogChannelId"];
  for (const name of ["embedTitle", "embedDescription", "embedColor", "embedFooter", "embedImageUrl", "minimumTopupMinor"]) form.elements.namedItem(name).addEventListener("input", () => updateEmbedPreview(form));
  try { await refreshAutoRechargeSettings(form); }
  catch (error) { setAutoRechargeMessage(error.message, true); }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    values.enabled = form.elements.namedItem("enabled").checked;
    values.minimumTopupMinor = Number(values.minimumTopupMinor);
    try {
      await autoRechargeApi("/api/admin/auto-recharge", { method: "PUT", body: JSON.stringify(values) });
      form.elements.namedItem("token").value = "";
      await refreshAutoRechargeSettings(form);
      setAutoRechargeMessage("자동충전 설정을 저장했습니다.");
    } catch (error) { setAutoRechargeMessage(error.message, true); }
  });

  document.getElementById("save-log-channels").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const values = Object.fromEntries(logChannelFields.map((name) => [name, form.elements.namedItem(name).value.trim()]));
    try {
      await autoRechargeApi("/api/admin/auto-recharge", { method: "PUT", body: JSON.stringify(values) });
      setAutoRechargeMessage("Discord 로그 채널 설정을 저장했습니다.");
    } catch (error) {
      setAutoRechargeMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
});

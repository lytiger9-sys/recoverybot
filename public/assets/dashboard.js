async function dashboardApi(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("로그인이 필요합니다.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "실적 데이터를 불러오지 못했습니다.");
  return payload;
}

const won = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const formatWon = (value) => won.format(value) + "원";
function formatAxisAmount(value) {
  if (value >= 100_000_000) return won.format(value / 100_000_000) + "억";
  if (value >= 10_000) return won.format(value / 10_000) + "만";
  return won.format(value) + "원";
}

function drawFinanceChart(canvas, months) {
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, bounds.width);
  const height = 320;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const pad = { top: 18, right: 18, bottom: 42, left: 82 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const maxValue = Math.max(1, ...months.flatMap((item) => [item.rechargeMinor, item.purchaseMinor]));
  const tickStep = maxValue / 4;
  const scaleTop = Math.ceil(maxValue / tickStep) * tickStep || 1;

  context.font = "12px Inter, 'Noto Sans KR', sans-serif";
  context.textBaseline = "middle";
  for (let tick = 0; tick <= 4; tick += 1) {
    const value = scaleTop - (scaleTop * tick / 4);
    const y = pad.top + chartHeight * tick / 4;
    context.strokeStyle = "#303030";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(pad.left, y);
    context.lineTo(width - pad.right, y);
    context.stroke();
    context.fillStyle = "#a5a5a5";
    context.textAlign = "right";
    context.fillText(formatAxisAmount(value), pad.left - 10, y);
  }

  const xAt = (index) => pad.left + chartWidth * index / 11;
  const yAt = (value) => pad.top + chartHeight * (1 - value / scaleTop);
  const series = [
    { key: "rechargeMinor", color: "#f2f2f2" },
    { key: "purchaseMinor", color: "#a5a5a5" },
  ];
  for (const line of series) {
    context.strokeStyle = line.color;
    context.lineWidth = 2.5;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    months.forEach((item, index) => {
      const x = xAt(index);
      const y = yAt(item[line.key]);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    months.forEach((item, index) => {
      context.beginPath();
      context.arc(xAt(index), yAt(item[line.key]), 3.5, 0, Math.PI * 2);
      context.fillStyle = line.color;
      context.fill();
    });
  }

  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillStyle = "#a5a5a5";
  months.forEach((item, index) => {
    context.fillText((index + 1) + "월", xAt(index), height - pad.bottom + 13);
  });
}

async function refreshSystemStatus() {
  const databaseStatus = document.getElementById("database-status");
  const serviceStatus = document.getElementById("service-status");
  const setState = (element, isOn) => {
    element.textContent = isOn ? "ON" : "OFF";
    element.dataset.state = isOn ? "on" : "off";
  };
  try {
    const response = await fetch("/api/health", { cache: "no-store", credentials: "same-origin" });
    const health = await response.json();
    setState(databaseStatus, health.database === "connected");
    setState(serviceStatus, health.service === "online");
  } catch {
    setState(databaseStatus, false);
    setState(serviceStatus, false);
  }
}

async function loadFinanceYears(select) {
  const { years } = await dashboardApi("/api/admin/dashboard/finance/years");
  select.replaceChildren(...years.map((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = year + "년";
    return option;
  }));
  const currentYear = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date());
  select.value = years.includes(Number(currentYear)) ? currentYear : String(years[0] ?? currentYear);
}

async function loadFinancePerformance() {
  const select = document.getElementById("finance-year");
  const chart = document.getElementById("finance-chart");
  const status = document.getElementById("finance-chart-status");
  status.textContent = "불러오는 중...";
  try {
    const { year, months } = await dashboardApi("/api/admin/dashboard/finance?year=" + encodeURIComponent(select.value));
    drawFinanceChart(chart, months);
    document.getElementById("recharge-year-total").textContent =
      formatWon(months.reduce((sum, item) => sum + item.rechargeMinor, 0));
    document.getElementById("purchase-year-total").textContent =
      formatWon(months.reduce((sum, item) => sum + item.purchaseMinor, 0));
    status.textContent = year + "년 월별 합계 · 충전은 자동충전 및 양수 수동 조정, 구매는 라이선스 구매 기준";
  } catch (error) {
    status.textContent = error.message;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  void refreshSystemStatus();
  window.setInterval(refreshSystemStatus, 10000);
  const select = document.getElementById("finance-year");
  try {
    await loadFinanceYears(select);
    await loadFinancePerformance();
    select.addEventListener("change", loadFinancePerformance);
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(loadFinancePerformance, 150);
    });
  } catch (error) {
    document.getElementById("finance-chart-status").textContent = error.message;
  }
});


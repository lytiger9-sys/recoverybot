async function productDetailApi(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("로그인이 필요합니다.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "상품 정보를 불러오지 못했습니다.");
  return payload;
}

function appendProductDetailCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  row.append(cell);
}

document.addEventListener("DOMContentLoaded", async () => {
  const message = document.getElementById("product-detail-message");
  const rows = document.getElementById("product-host-rows");
  const rawName = window.location.pathname.slice("/product/".length);
  try {
    const productName = decodeURIComponent(rawName);
    const { product } = await productDetailApi("/api/admin/products/by-name/" + encodeURIComponent(productName));
    document.title = product.name + " | 상품 정보";
    document.getElementById("product-name").textContent = product.name;
    document.getElementById("product-price").textContent = Number(product.priceMinor).toLocaleString("ko-KR") + " " + product.currency;
    document.getElementById("product-duration").textContent = product.validityDays ? product.validityDays + "일" : "영구";
    document.getElementById("product-member-range").textContent = Number(product.minimumActiveMembers).toLocaleString("ko-KR") + "~" + Number(product.maximumActiveMembers).toLocaleString("ko-KR") + "명";
    document.getElementById("product-host-count").textContent = product.hosts.length + "개 호기";
    document.getElementById("product-total-members").textContent = Number(product.totalMembers).toLocaleString("ko-KR") + "명";
    document.getElementById("product-active-members").textContent = Number(product.activeMembers).toLocaleString("ko-KR") + "명";

    const status = document.getElementById("product-status");
    status.textContent = product.enabled ? "판매 중" : "판매 중지";
    status.classList.add(product.enabled ? "product-status-active" : "product-status-paused");
    for (const host of product.hosts) {
      const row = document.createElement("tr");
      appendProductDetailCell(row, host.hostNumber + "호기");
      appendProductDetailCell(row, Number(host.total).toLocaleString("ko-KR") + "명");
      appendProductDetailCell(row, Number(host.active).toLocaleString("ko-KR") + "명");
      rows.append(row);
    }
    if (!product.hosts.length) {
      const row = document.createElement("tr");
      const empty = document.createElement("td");
      empty.colSpan = 3;
      empty.className = "table-empty";
      empty.textContent = "연결된 호기가 없습니다.";
      row.append(empty);
      rows.append(row);
    }
    document.getElementById("product-created-at").textContent = product.createdAt
      ? "상품 등록일 · " + new Date(product.createdAt).toLocaleString("ko-KR")
      : "";
  } catch (error) {
    document.getElementById("product-name").textContent = "상품 정보를 불러오지 못했습니다.";
    message.textContent = error.message;
    message.classList.add("error");
  }
});

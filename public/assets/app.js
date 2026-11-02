async function api(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  if (response.status === 401 && document.body.dataset.page !== "login") {
    window.location.assign("/login");
    throw new Error("로그인이 필요합니다.");
  }
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "요청을 처리하지 못했습니다.");
  return payload;
}

function setMessage(id, text, isError = false) {
  const element = document.getElementById(id);
  if (!element) return;
  element.textContent = text;
  element.classList.toggle("error", isError);
}

function cell(text) {
  const element = document.createElement("td");
  element.textContent = text;
  return element;
}

function actionButton(text, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button-quiet";
  button.textContent = text;
  button.addEventListener("click", action);
  return button;
}

async function loadAdmin() {
  try {
    const result = await api("/api/auth/me");
    const element = document.getElementById("admin-name");
    if (element) element.textContent = result.admin.username;
  } catch {
    // The API handler redirects protected pages to login.
  }
}

function bindLogout() {
  document.querySelectorAll("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api("/api/auth/session", { method: "DELETE" });
      } finally {
        window.location.assign("/login");
      }
    });
  });
}

async function loadHosts() {
  const tbody = document.getElementById("hosts-rows");
  if (!tbody) return;
  try {
    const { hosts } = await api("/api/admin/hosts");
    tbody.replaceChildren();
    for (const host of hosts) {
      const row = document.createElement("tr");
      row.append(cell(host.name));
      row.append(cell(host.enabled ? "사용 중" : "중지"));
      row.append(cell(host.createdAt ? new Date(host.createdAt).toLocaleDateString("ko-KR") : "-"));
      const actions = document.createElement("td");

      actions.append(actionButton(host.enabled ? "중지" : "사용", async () => {
        try {
          await api("/api/admin/hosts/" + host._id, {
            method: "PATCH",
            body: JSON.stringify({ enabled: !host.enabled }),
          });
          await loadHosts();
        } catch (error) {
          setMessage("hosts-message", error.message, true);
        }
      }));

      actions.append(actionButton("이름 변경", async () => {
        const name = window.prompt("새 호기 이름", host.name);
        if (!name || !name.trim()) return;
        try {
          await api("/api/admin/hosts/" + host._id, {
            method: "PATCH",
            body: JSON.stringify({ name: name.trim() }),
          });
          await loadHosts();
        } catch (error) {
          setMessage("hosts-message", error.message, true);
        }
      }));

      actions.append(actionButton("토큰 교체", async () => {
        const botToken = window.prompt("새 봇 토큰을 입력하세요.");
        if (!botToken) return;
        try {
          await api("/api/admin/hosts/" + host._id, {
            method: "PATCH",
            body: JSON.stringify({ botToken }),
          });
          setMessage("hosts-message", "토큰을 교체했습니다.");
        } catch (error) {
          setMessage("hosts-message", error.message, true);
        }
      }));

      actions.append(actionButton("삭제", async () => {
        if (!window.confirm("연결된 유저가 없는 호기만 삭제됩니다. 계속할까요?")) return;
        try {
          await api("/api/admin/hosts/" + host._id, { method: "DELETE" });
          await loadHosts();
        } catch (error) {
          setMessage("hosts-message", error.message, true);
        }
      }));

      row.append(actions);
      tbody.append(row);
    }
  } catch (error) {
    setMessage("hosts-message", error.message, true);
  }
}

let productsSearchQuery = "";
let editingProductId = null;

const productActionIcons = {
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>',
  power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10"/><path d="M6.2 5.8a8 8 0 1 0 11.6 0"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>',
};

function productIconButton(label, icon, action, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button-quiet host-icon-button product-icon-button ${extraClass}`.trim();
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon;
  button.addEventListener("click", action);
  return button;
}

async function loadProducts() {
  const tbody = document.getElementById("products-rows");
  if (!tbody) return;
  try {
    const { products } = await api("/api/admin/products");
    tbody.replaceChildren();
    const visibleProducts = products.filter((product) => product.name.toLocaleLowerCase("ko-KR").includes(productsSearchQuery));
    const count = document.getElementById("products-count");
    if (count) count.textContent = `${visibleProducts.length}개`;
    for (const product of visibleProducts) {
      const row = document.createElement("tr");
      row.append(cell(product.name));
      row.append(cell(Number(product.priceMinor).toLocaleString("ko-KR") + " " + product.currency));
      row.append(cell(product.validityDays ? `${product.validityDays}일` : "영구"));
      const statusCell = cell(product.enabled ? "판매 중" : "중지");
      statusCell.className = product.enabled ? "product-status product-status-active" : "product-status product-status-paused";
      row.append(statusCell);
      row.append(cell(product.createdAt ? new Date(product.createdAt).toLocaleDateString("ko-KR") : "-"));
      const actions = document.createElement("td");

      actions.className = "product-actions";
      actions.append(productIconButton("가격 수정", productActionIcons.edit, () => {
        editingProductId = product._id;
        document.getElementById("product-price-name").textContent = product.name;
        const priceForm = document.getElementById("product-price-form");
        priceForm.elements.namedItem("priceMinor").value = String(product.priceMinor);
        document.getElementById("product-price-dialog").showModal();
      }));

      actions.append(productIconButton(product.enabled ? "판매 중지" : "판매 재개", productActionIcons.power, async () => {
        try {
          await api("/api/admin/products/" + product._id, {
            method: "PATCH",
            body: JSON.stringify({ enabled: !product.enabled }),
          });
          await loadProducts();
        } catch (error) {
          setMessage("products-message", error.message, true);
        }
      }, product.enabled ? "" : "product-icon-button-paused"));

      actions.append(productIconButton("상품 정보", productActionIcons.info, () => {
        window.location.assign("/product/" + encodeURIComponent(product.name));
      }));

      actions.append(productIconButton("상품 목록에서 삭제", productActionIcons.trash, async () => {
        if (!window.confirm("상품 레코드를 삭제할까요? 기존 구매 라이선스와 후기에 저장된 상품 정보는 유지됩니다.")) return;
        try {
          await api("/api/admin/products/" + product._id, { method: "DELETE" });
          setMessage("products-message", "상품을 삭제했습니다.");
          await loadProducts();
        } catch (error) {
          setMessage("products-message", error.message, true);
        }
      }, "product-icon-button-danger"));

      row.append(actions);
      tbody.append(row);
    }
    if (visibleProducts.length === 0) {
      const row = document.createElement("tr");
      const empty = cell(productsSearchQuery ? "검색 결과가 없습니다." : "등록된 상품이 없습니다.");
      empty.colSpan = 6;
      empty.className = "table-empty";
      row.append(empty);
      tbody.append(row);
    }
  } catch (error) {
    setMessage("products-message", error.message, true);
  }
}

async function initLogin() {
  const form = document.getElementById("login-form");
  if (!form) return;
  try {
    await api("/api/auth/me");
    window.location.assign("/");
    return;
  } catch {
    // The visitor is not signed in.
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: data.get("username"),
          password: data.get("password"),
        }),
      });
      window.location.assign("/");
    } catch (error) {
      setMessage("login-message", error.message, true);
      button.disabled = false;
    }
  });
}

async function initForms() {
  const hostForm = document.getElementById("host-form");
  if (hostForm) {
    hostForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(hostForm);
      try {
        await api("/api/admin/hosts", {
          method: "POST",
          body: JSON.stringify({ name: data.get("name"), botToken: data.get("botToken") }),
        });
        hostForm.reset();
        setMessage("hosts-message", "호기를 추가했습니다.");
        await loadHosts();
      } catch (error) {
        setMessage("hosts-message", error.message, true);
      }
    });
  }

  const productForm = document.getElementById("product-form");
  if (productForm) {
    productForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(productForm);
      try {
        await api("/api/admin/products", {
          method: "POST",
          body: JSON.stringify({
            name: data.get("name"),
            priceMinor: Number(data.get("priceMinor")),
            currency: "KRW",
          }),
        });
        productForm.reset();
        setMessage("products-message", "제품을 추가했습니다.");
        await loadProducts();
      } catch (error) {
        setMessage("products-message", error.message, true);
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (document.body.dataset.page === "login") {
    await initLogin();
    return;
  }
  await loadAdmin();
  bindLogout();
  await initForms();
  await loadHosts();
  const priceDialog = document.getElementById("product-price-dialog");
  const priceForm = document.getElementById("product-price-form");
  if (priceDialog && priceForm) {
    document.querySelector("[data-close-price-dialog]").addEventListener("click", () => priceDialog.close());
    priceForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!editingProductId || !priceForm.reportValidity()) return;
      const saveButton = priceForm.querySelector('button[type="submit"]');
      saveButton.disabled = true;
      try {
        await api("/api/admin/products/" + editingProductId, {
          method: "PATCH",
          body: JSON.stringify({ priceMinor: Number(priceForm.elements.namedItem("priceMinor").value) }),
        });
        priceDialog.close();
        setMessage("products-message", "상품 가격을 수정했습니다.");
        await loadProducts();
      } catch (error) {
        setMessage("products-message", error.message, true);
      } finally {
        saveButton.disabled = false;
      }
    });
    priceDialog.addEventListener("close", () => { editingProductId = null; });
  }
  await loadProducts();
  const productSearch = document.getElementById("products-search");
  if (productSearch) productSearch.addEventListener("input", () => {
    productsSearchQuery = productSearch.value.trim().toLocaleLowerCase("ko-KR");
    loadProducts();
  });
});

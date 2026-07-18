/**
 * INDU RO SERVICE — Invoice Generator + Dashboard
 * LocalStorage-backed, mobile-first
 */

const STORAGE_KEY = "indu_ro_invoices";
const DRAFT_KEY = "indu_ro_draft";

const els = {
  customerName: document.getElementById("customerName"),
  customerPhone: document.getElementById("customerPhone"),
  refNo: document.getElementById("refNo"),
  issueDate: document.getElementById("issueDate"),
  notes: document.getElementById("notes"),
  itemsList: document.getElementById("itemsList"),
  previewCustomerName: document.getElementById("previewCustomerName"),
  previewCustomerPhone: document.getElementById("previewCustomerPhone"),
  previewRefNo: document.getElementById("previewRefNo"),
  previewDate: document.getElementById("previewDate"),
  previewItems: document.getElementById("previewItems"),
  previewQtyTotal: document.getElementById("previewQtyTotal"),
  previewSubtotal: document.getElementById("previewSubtotal"),
  previewNotes: document.getElementById("previewNotes"),
  invoice: document.getElementById("invoice"),
  toast: document.getElementById("toast"),
  viewDashboard: document.getElementById("viewDashboard"),
  viewCreate: document.getElementById("viewCreate"),
  toolbarSubtitle: document.getElementById("toolbarSubtitle"),
  toolbarCreateActions: document.getElementById("toolbarCreateActions"),
  dashHeroAmount: document.getElementById("dashHeroAmount"),
  dashHeroMeta: document.getElementById("dashHeroMeta"),
  dashCount: document.getElementById("dashCount"),
  dashRevenue: document.getElementById("dashRevenue"),
  dashPeriodLabel: document.getElementById("dashPeriodLabel"),
  dashList: document.getElementById("dashList"),
  dashEmpty: document.getElementById("dashEmpty"),
};

let items = [];
let currentId = null;
let toastTimer = null;
let currentPeriod = "day";
let currentView = "dashboard";

/* ---------- helpers ---------- */

function formatMoney(n) {
  const num = Number(n) || 0;
  return num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoneyShort(n) {
  const num = Number(n) || 0;
  if (num >= 100000) {
    return (num / 100000).toFixed(num % 100000 === 0 ? 0 : 1) + "L";
  }
  if (num >= 1000) {
    return num.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  }
  return formatMoney(num);
}

function formatDateDisplay(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function generateRefNo() {
  return Date.now().toString().slice(-5);
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function parseNum(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseIssueDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/* ---------- navigation ---------- */

function showView(view) {
  currentView = view;
  const isDash = view === "dashboard";

  els.viewDashboard.classList.toggle("hidden", !isDash);
  els.viewCreate.classList.toggle("hidden", isDash);
  els.toolbarSubtitle.textContent = isDash ? "Dashboard" : "Create invoice";
  els.toolbarCreateActions.hidden = isDash;

  document.querySelectorAll(".nav-item").forEach((btn) => {
    const active = btn.dataset.nav === view;
    btn.classList.toggle("active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });

  if (isDash) renderDashboard();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- state ---------- */

function getFormState() {
  return {
    id: currentId || crypto.randomUUID(),
    customerName: els.customerName.value.trim(),
    customerPhone: els.customerPhone.value.trim(),
    refNo: els.refNo.value.trim(),
    issueDate: els.issueDate.value,
    notes: els.notes.value.trim(),
    items: items.map((it) => ({
      name: it.name.trim(),
      qty: parseNum(it.qty),
      price: parseNum(it.price),
    })),
    updatedAt: new Date().toISOString(),
  };
}

function calcTotals(state) {
  let qtyTotal = 0;
  let total = 0;
  (state.items || []).forEach((it) => {
    qtyTotal += parseNum(it.qty);
    total += parseNum(it.qty) * parseNum(it.price);
  });
  return { qtyTotal, total };
}

/* ---------- items UI ---------- */

function addItem(data = { name: "", qty: 1, price: "" }) {
  items.push({
    id: crypto.randomUUID(),
    name: data.name || "",
    qty: data.qty ?? 1,
    price: data.price ?? "",
  });
  renderItems();
  updatePreview();
  persistDraft();
}

function removeItem(id) {
  items = items.filter((it) => it.id !== id);
  if (items.length === 0) addItem();
  else {
    renderItems();
    updatePreview();
    persistDraft();
  }
}

function renderItems() {
  els.itemsList.innerHTML = "";
  items.forEach((it, index) => {
    const card = document.createElement("div");
    card.className = "item-card";
    card.dataset.id = it.id;
    card.innerHTML = `
      <div class="item-card-top">
        <span>Item ${index + 1}</span>
        <button type="button" class="btn-remove" data-action="remove">Remove</button>
      </div>
      <div class="item-grid">
        <label class="field-name">
          Product name
          <input type="text" data-field="name" value="${escapeAttr(it.name)}" placeholder="e.g. RO Membrane" />
        </label>
        <label>
          Qty
          <input type="number" data-field="qty" min="0" step="0.01" inputmode="decimal" value="${escapeAttr(it.qty)}" />
        </label>
        <label>
          Price (₹)
          <input type="number" data-field="price" min="0" step="0.01" inputmode="decimal" value="${escapeAttr(it.price)}" />
        </label>
      </div>
      <div class="item-amount">Amount: ₹ <span data-amount>0.00</span></div>
    `;

    const amountEl = card.querySelector("[data-amount]");
    amountEl.textContent = formatMoney(parseNum(it.qty) * parseNum(it.price));

    card.querySelector('[data-action="remove"]').addEventListener("click", () => {
      removeItem(it.id);
    });

    card.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        const field = input.dataset.field;
        it[field] = input.value;
        amountEl.textContent = formatMoney(parseNum(it.qty) * parseNum(it.price));
        updatePreview();
        persistDraft();
      });
    });

    els.itemsList.appendChild(card);
  });
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ---------- preview ---------- */

function updatePreview() {
  const state = getFormState();
  const totals = calcTotals(state);

  els.previewCustomerName.textContent = state.customerName || "—";
  els.previewCustomerPhone.textContent = state.customerPhone || "—";
  els.previewRefNo.textContent = state.refNo || "—";
  els.previewDate.textContent = formatDateDisplay(state.issueDate);

  const filled = state.items.filter((it) => it.name || it.qty || it.price);
  if (filled.length === 0) {
    els.previewItems.innerHTML =
      '<tr class="empty-row"><td colspan="5">No products added</td></tr>';
  } else {
    els.previewItems.innerHTML = filled
      .map((it, i) => {
        const amount = it.qty * it.price;
        return `<tr>
          <td class="col-sr">${i + 1}</td>
          <td>${escapeHtml(it.name) || "—"}</td>
          <td class="num">${formatQty(it.qty)}</td>
          <td class="num">${formatMoney(it.price)}</td>
          <td class="num">${formatMoney(amount)}</td>
        </tr>`;
      })
      .join("");
  }

  els.previewQtyTotal.textContent = formatQty(totals.qtyTotal);
  els.previewSubtotal.textContent = formatMoney(totals.total);

  if (state.notes) {
    els.previewNotes.hidden = false;
    els.previewNotes.textContent = state.notes;
  } else {
    els.previewNotes.hidden = true;
    els.previewNotes.textContent = "";
  }
}

function formatQty(n) {
  const num = Number(n) || 0;
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

/* ---------- storage ---------- */

function loadInvoices() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveInvoices(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function persistDraft() {
  const state = getFormState();
  localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function applyState(state) {
  currentId = state.id || null;
  els.customerName.value = state.customerName || "";
  els.customerPhone.value = state.customerPhone || "";
  els.refNo.value = state.refNo || generateRefNo();
  els.issueDate.value = state.issueDate || todayISO();
  els.notes.value = state.notes || "";
  items = (state.items && state.items.length
    ? state.items
    : [{ name: "", qty: 1, price: "" }]
  ).map((it) => ({
    id: crypto.randomUUID(),
    name: it.name || "",
    qty: it.qty ?? 1,
    price: it.price ?? "",
  }));
  renderItems();
  updatePreview();
}

function newInvoice() {
  currentId = crypto.randomUUID();
  applyState({
    id: currentId,
    customerName: "",
    customerPhone: "",
    refNo: generateRefNo(),
    issueDate: todayISO(),
    notes: "",
    items: [{ name: "", qty: 1, price: "" }],
  });
  persistDraft();
  showToast("New invoice ready");
}

function saveInvoice() {
  const state = getFormState();
  if (!state.customerName) {
    showToast("Enter customer name");
    els.customerName.focus();
    return;
  }
  if (!state.customerPhone) {
    showToast("Enter customer contact");
    els.customerPhone.focus();
    return;
  }
  const hasItem = state.items.some((it) => it.name && it.qty > 0);
  if (!hasItem) {
    showToast("Add at least one product");
    return;
  }

  currentId = state.id;
  const list = loadInvoices();
  const idx = list.findIndex((inv) => inv.id === state.id);
  if (idx >= 0) list[idx] = state;
  else list.unshift(state);
  saveInvoices(list);
  persistDraft();
  showToast("Invoice saved");
  renderDashboard();
}

function deleteInvoice(id) {
  const list = loadInvoices().filter((inv) => inv.id !== id);
  saveInvoices(list);
  if (currentId === id) {
    const draft = loadDraft();
    if (draft && draft.id === id) localStorage.removeItem(DRAFT_KEY);
    newInvoice();
  }
  renderDashboard();
  showToast("Invoice deleted");
}

function openInvoice(inv) {
  applyState(inv);
  persistDraft();
  showView("create");
  showToast("Invoice loaded");
}

/* ---------- dashboard filters ---------- */

function getPeriodRange(period, refDate = new Date()) {
  const today = startOfDay(refDate);

  if (period === "day") {
    const start = today;
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    return { start, end, label: formatPeriodLabel(period, start) };
  }

  if (period === "week") {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(today);
    start.setDate(today.getDate() + mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end, label: formatPeriodLabel(period, start, end) };
  }

  if (period === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end, label: formatPeriodLabel(period, start) };
  }

  const start = new Date(today.getFullYear(), 0, 1);
  const end = new Date(today.getFullYear(), 11, 31, 23, 59, 59, 999);
  return { start, end, label: formatPeriodLabel(period, start) };
}

function formatPeriodLabel(period, start, end) {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  if (period === "day") {
    const isToday = start.toDateString() === startOfDay(new Date()).toDateString();
    return isToday
      ? `Today · ${start.getDate()} ${months[start.getMonth()]} ${start.getFullYear()}`
      : `${start.getDate()} ${months[start.getMonth()]} ${start.getFullYear()}`;
  }
  if (period === "week") {
    return `${start.getDate()} ${months[start.getMonth()]} – ${end.getDate()} ${months[end.getMonth()]} ${end.getFullYear()}`;
  }
  if (period === "month") {
    return `${months[start.getMonth()]} ${start.getFullYear()}`;
  }
  return `Year ${start.getFullYear()}`;
}

function filterInvoicesByPeriod(invoices, period) {
  const { start, end, label } = getPeriodRange(period);
  const filtered = invoices
    .filter((inv) => {
      const d = parseIssueDate(inv.issueDate);
      if (!d) return false;
      return d >= start && d <= end;
    })
    .sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""));
  return { filtered, label };
}

function renderDashboard() {
  const invoices = loadInvoices();
  const { filtered, label } = filterInvoicesByPeriod(invoices, currentPeriod);

  let revenue = 0;
  filtered.forEach((inv) => {
    revenue += calcTotals(inv).total;
  });

  els.dashHeroAmount.textContent = `₹ ${formatMoney(revenue)}`;
  els.dashHeroMeta.textContent = `${filtered.length} invoice${filtered.length === 1 ? "" : "s"}`;
  els.dashCount.textContent = String(filtered.length);
  els.dashRevenue.textContent = `₹ ${formatMoneyShort(revenue)}`;
  els.dashPeriodLabel.textContent = label;

  els.dashList.innerHTML = "";
  els.dashEmpty.classList.toggle("show", filtered.length === 0);

  filtered.forEach((inv) => {
    const totals = calcTotals(inv);
    const li = document.createElement("li");
    li.className = "dash-item";
    li.innerHTML = `
      <button type="button" class="dash-item-main">
        <div class="dash-item-top">
          <strong>${escapeHtml(inv.customerName) || "Untitled"}</strong>
          <span class="dash-item-amt">₹ ${formatMoney(totals.total)}</span>
        </div>
        <div class="dash-item-meta">
          #${escapeHtml(inv.refNo)} · ${formatDateDisplay(inv.issueDate)}
          ${inv.customerPhone ? ` · ${escapeHtml(inv.customerPhone)}` : ""}
        </div>
      </button>
      <div class="dash-item-actions">
        <button type="button" class="dash-act" data-act="open">Open</button>
        <button type="button" class="dash-act dash-act-danger" data-act="delete">Delete</button>
      </div>
    `;
    li.querySelector(".dash-item-main").addEventListener("click", () => openInvoice(inv));
    li.querySelector('[data-act="open"]').addEventListener("click", () => openInvoice(inv));
    li.querySelector('[data-act="delete"]').addEventListener("click", () => {
      if (confirm(`Delete invoice #${inv.refNo}?`)) deleteInvoice(inv.id);
    });
    els.dashList.appendChild(li);
  });
}

function setPeriod(period) {
  currentPeriod = period;
  document.querySelectorAll(".period-tab").forEach((tab) => {
    const active = tab.dataset.period === period;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  renderDashboard();
}

/* ---------- init ---------- */

function bindEvents() {
  ["customerName", "customerPhone", "issueDate", "notes"].forEach((key) => {
    els[key].addEventListener("input", () => {
      updatePreview();
      persistDraft();
    });
  });

  document.getElementById("btnAddItem").addEventListener("click", () => addItem());
  document.getElementById("btnSave").addEventListener("click", saveInvoice);
  document.getElementById("btnNew").addEventListener("click", () => {
    newInvoice();
    showView("create");
  });
  document.getElementById("btnPrint").addEventListener("click", printInvoice);
  document.getElementById("btnDownload").addEventListener("click", downloadPdf);
  document.getElementById("btnPrintMobile").addEventListener("click", printInvoice);
  document.getElementById("btnDownloadMobile").addEventListener("click", downloadPdf);

  els.customerPhone.addEventListener("input", () => {
    els.customerPhone.value = els.customerPhone.value.replace(/\D/g, "").slice(0, 10);
  });

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.nav === "create" && !currentId) newInvoice();
      showView(btn.dataset.nav);
    });
  });

  document.querySelectorAll(".period-tab").forEach((tab) => {
    tab.addEventListener("click", () => setPeriod(tab.dataset.period));
  });
}

function init() {
  bindEvents();
  const draft = loadDraft();
  if (draft) applyState(draft);
  else {
    currentId = crypto.randomUUID();
    applyState({
      id: currentId,
      customerName: "",
      customerPhone: "",
      refNo: generateRefNo(),
      issueDate: todayISO(),
      notes: "",
      items: [{ name: "", qty: 1, price: "" }],
    });
  }
  if (typeof applyLogoDataUrls === "function") applyLogoDataUrls();
  showView("dashboard");
}

init();

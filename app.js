/**
 * INDU RO SERVICE — Invoice Generator + Dashboard
 * LocalStorage-backed, mobile-first
 */

const STORAGE_KEY = "indu_ro_invoices";
const DRAFT_KEY = "indu_ro_draft";

const els = {
  customerName: document.getElementById("customerName"),
  customerPhone: document.getElementById("customerPhone"),
  customerAddress: document.getElementById("customerAddress"),
  refNo: document.getElementById("refNo"),
  issueDate: document.getElementById("issueDate"),
  paymentMode: document.getElementById("paymentMode"),
  notes: document.getElementById("notes"),
  itemsList: document.getElementById("itemsList"),
  previewCustomerName: document.getElementById("previewCustomerName"),
  previewCustomerPhone: document.getElementById("previewCustomerPhone"),
  previewCustomerAddress: document.getElementById("previewCustomerAddress"),
  previewRefNo: document.getElementById("previewRefNo"),
  previewDate: document.getElementById("previewDate"),
  previewPayment: document.getElementById("previewPayment"),
  previewItems: document.getElementById("previewItems"),
  previewQtyTotal: document.getElementById("previewQtyTotal"),
  previewGrandTotal: document.getElementById("previewGrandTotal"),
  previewWords: document.getElementById("previewWords"),
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

function showToast(message, duration = 2400) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), duration);
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

function parseWarranty(warrantyText) {
  if (warrantyText === undefined || warrantyText === null) {
    return { value: 1, unit: "Year" };
  }
  const clean = String(warrantyText).trim().toLowerCase();
  if (clean === "" || clean === "none" || clean === "no warranty" || clean === "na" || clean === "n/a" || clean === "0") {
    return { value: "", unit: "Year" };
  }
  const yearMatch = clean.match(/(\d+)\s*y/);
  const monthMatch = clean.match(/(\d+)\s*m/);
  if (yearMatch) {
    return { value: parseInt(yearMatch[1], 10), unit: "Year" };
  }
  if (monthMatch) {
    return { value: parseInt(monthMatch[1], 10), unit: "Month" };
  }
  const numOnly = parseInt(clean, 10);
  if (!isNaN(numOnly)) {
    return { value: numOnly, unit: "Year" };
  }
  return { value: 1, unit: "Year" };
}

function buildWarrantyText(value, unit = "Year") {
  if (value === "" || value === null || value === undefined) return "";
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) return "No Warranty";
  const normalizedUnit = String(unit).toLowerCase().startsWith("m") ? "Month" : "Year";
  const plural = num > 1 ? `${normalizedUnit}s` : normalizedUnit;
  return `${num} ${plural}`;
}

function calcWarrantyValidity(issueDateIso, warrantyText) {
  if (!issueDateIso || !warrantyText) return "";
  const clean = String(warrantyText).trim().toLowerCase();
  if (clean === "none" || clean === "no warranty" || clean === "na" || clean === "n/a" || clean === "0") return "";

  const [y, m, d] = issueDateIso.split("-").map(Number);
  if (!y || !m || !d) return "";

  const date = new Date(y, m - 1, d);

  const yearMatch = clean.match(/(\d+)\s*y/);
  const monthMatch = clean.match(/(\d+)\s*m/);

  if (yearMatch) {
    const years = parseInt(yearMatch[1], 10);
    date.setFullYear(date.getFullYear() + years);
    date.setDate(date.getDate() - 1);
  } else if (monthMatch) {
    const months = parseInt(monthMatch[1], 10);
    date.setMonth(date.getMonth() + months);
    date.setDate(date.getDate() - 1);
  } else {
    return "";
  }

  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function numberToWordsIndian(num) {
  const n = Math.round(Number(num) * 100) / 100;
  if (!Number.isFinite(n) || n === 0) return "Zero Rupees Only";

  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen"
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function convertTwoDigits(val) {
    if (val < 20) return a[val];
    const tens = Math.floor(val / 10);
    const units = val % 10;
    return b[tens] + (units ? "-" + a[units] : "");
  }

  function convertThreeDigits(val) {
    const hundred = Math.floor(val / 100);
    const rest = val % 100;
    let res = "";
    if (hundred > 0) res += a[hundred] + " Hundred";
    if (rest > 0) res += (res ? " " : "") + convertTwoDigits(rest);
    return res;
  }

  const intPart = Math.floor(n);
  const paise = Math.round((n - intPart) * 100);

  let crores = Math.floor(intPart / 10000000);
  let rem = intPart % 10000000;
  let lakhs = Math.floor(rem / 100000);
  rem = rem % 100000;
  let thousands = Math.floor(rem / 1000);
  let hundreds = rem % 1000;

  let words = "";
  if (crores > 0) words += convertThreeDigits(crores) + " Crore ";
  if (lakhs > 0) words += convertThreeDigits(lakhs) + " Lakh ";
  if (thousands > 0) words += convertThreeDigits(thousands) + " Thousand ";
  if (hundreds > 0) words += convertThreeDigits(hundreds) + " ";

  words = words.trim();
  let result = words ? words + " Rupees" : "";

  if (paise > 0) {
    const paiseWords = convertTwoDigits(paise) + " Paise";
    result = result ? `${result} and ${paiseWords}` : `${paiseWords}`;
  }

  return (result ? result : "Zero Rupees") + " Only";
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
    customerName: els.customerName ? els.customerName.value.trim() : "",
    customerPhone: els.customerPhone ? els.customerPhone.value.trim() : "",
    customerAddress: els.customerAddress ? els.customerAddress.value.trim() : "",
    refNo: els.refNo ? els.refNo.value.trim() : "",
    issueDate: els.issueDate ? els.issueDate.value : todayISO(),
    paymentMode: els.paymentMode ? els.paymentMode.value.trim() : "Paid – UPI / Cash",
    notes: els.notes ? els.notes.value.trim() : "",
    items: items.map((it) => ({
      name: it.name.trim(),
      serialNo: (it.serialNo || "").trim(),
      warrantyValue: it.warrantyValue !== undefined ? it.warrantyValue : "",
      warrantyUnit: it.warrantyUnit || "Year",
      warranty: (it.warranty || "").trim(),
      validTill: (it.validTill || "").trim(),
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

function addItem(data = { name: "", serialNo: "", warrantyValue: 1, warrantyUnit: "Year", warranty: "1 Year", validTill: "", qty: 1, price: "" }) {
  const issueDate = els.issueDate ? els.issueDate.value : todayISO();
  let warrantyValue = data.warrantyValue;
  let warrantyUnit = data.warrantyUnit;
  if (warrantyValue === undefined || warrantyUnit === undefined) {
    const parsed = parseWarranty(data.warranty !== undefined ? data.warranty : "1 Year");
    warrantyValue = parsed.value;
    warrantyUnit = parsed.unit;
  }
  const warranty = buildWarrantyText(warrantyValue, warrantyUnit);
  const validTill = data.validTill || calcWarrantyValidity(issueDate, warranty);
  items.push({
    id: crypto.randomUUID(),
    name: data.name || "",
    serialNo: data.serialNo || "",
    warrantyValue: warrantyValue,
    warrantyUnit: warrantyUnit,
    warranty: warranty,
    validTill: validTill,
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
          <span>Product name</span>
          <input type="text" data-field="name" value="${escapeAttr(it.name)}" placeholder="e.g. Aqua RO machine" />
        </label>
        <label class="field-serial">
          <span>Serial No (optional)</span>
          <input type="text" data-field="serialNo" value="${escapeAttr(it.serialNo)}" placeholder="e.g. SN-12345" />
        </label>
        <div class="field-warranty">
          <div class="warranty-two-inputs">
            <label>
              <span>No . of Yr/month</span>
              <input type="number" data-field="warrantyValue" min="0" step="1" inputmode="numeric" value="${escapeAttr(it.warrantyValue)}" placeholder="e.g. 1" />
            </label>
            <label>
              <span>Month or Year</span>
              <select data-field="warrantyUnit">
                <option value="Year" ${it.warrantyUnit === "Year" ? "selected" : ""}>Year</option>
                <option value="Month" ${it.warrantyUnit === "Month" ? "selected" : ""}>Month</option>
              </select>
            </label>
          </div>
          <span class="valid-till-hint" data-hint>${it.validTill ? `Valid till ${escapeHtml(it.validTill)}` : ""}</span>
        </div>
        <label>
          <span>Qty</span>
          <input type="number" data-field="qty" min="0" step="0.01" inputmode="decimal" value="${escapeAttr(it.qty)}" />
        </label>
        <label>
          <span>Price (₹)</span>
          <input type="number" data-field="price" min="0" step="0.01" inputmode="decimal" value="${escapeAttr(it.price)}" />
        </label>
      </div>
      <div class="item-amount">Amount: ₹ <span data-amount>0.00</span></div>
    `;

    const amountEl = card.querySelector("[data-amount]");
    const hintEl = card.querySelector("[data-hint]");
    amountEl.textContent = formatMoney(parseNum(it.qty) * parseNum(it.price));

    card.querySelector('[data-action="remove"]').addEventListener("click", () => {
      removeItem(it.id);
    });

    const onFieldChange = (el) => {
      const field = el.dataset.field;
      it[field] = el.value;
      if (field === "warrantyValue" || field === "warrantyUnit") {
        it.warranty = buildWarrantyText(it.warrantyValue, it.warrantyUnit);
        it.validTill = calcWarrantyValidity(els.issueDate.value, it.warranty);
        hintEl.textContent = it.validTill ? `Valid till ${it.validTill}` : "";
      }
      amountEl.textContent = formatMoney(parseNum(it.qty) * parseNum(it.price));
      updatePreview();
      persistDraft();
    };

    card.querySelectorAll("input, select").forEach((control) => {
      control.addEventListener("input", () => onFieldChange(control));
      control.addEventListener("change", () => onFieldChange(control));
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

  els.previewCustomerName.textContent = state.customerName || "Customer Name";
  els.previewCustomerPhone.textContent = state.customerPhone || "—";
  els.previewCustomerAddress.textContent = state.customerAddress || "Customer address";
  els.previewRefNo.textContent = state.refNo || "—";
  els.previewDate.textContent = formatDateDisplay(state.issueDate);
  els.previewPayment.textContent = state.paymentMode || "Paid – UPI / Cash";

  const filled = state.items.filter((it) => it.name || it.qty || it.price);
  if (filled.length === 0) {
    els.previewItems.innerHTML =
      '<tr class="empty-row"><td colspan="6">No products added</td></tr>';
  } else {
    els.previewItems.innerHTML = filled
      .map((it, i) => {
        const amount = it.qty * it.price;
        const serialHtml = it.serialNo
          ? `<span class="sub">Serial no: ${escapeHtml(it.serialNo)}</span>`
          : "";
        const warrantyHtml = it.warranty
          ? `<span class="warr">${escapeHtml(it.warranty)}</span>`
          : "—";
        const validityHtml = it.validTill
          ? `<span class="sub">Valid till ${escapeHtml(it.validTill)}</span>`
          : "";

        return `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(it.name) || "—"}${serialHtml}</td>
          <td>${warrantyHtml}${validityHtml}</td>
          <td class="n">${formatQty(it.qty)}</td>
          <td class="n">${formatMoney(it.price)}</td>
          <td class="n">${formatMoney(amount)}</td>
        </tr>`;
      })
      .join("");
  }

  els.previewQtyTotal.textContent = formatQty(totals.qtyTotal);
  els.previewGrandTotal.textContent = `₹ ${formatMoney(totals.total)}`;
  els.previewWords.textContent = `Amount in words: ${numberToWordsIndian(totals.total)}`;

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
  if (els.customerAddress) els.customerAddress.value = state.customerAddress || "";
  els.refNo.value = state.refNo || generateRefNo();
  els.issueDate.value = state.issueDate || todayISO();
  if (els.paymentMode) els.paymentMode.value = state.paymentMode || "Paid – UPI / Cash";
  els.notes.value = state.notes || "";
  items = (state.items && state.items.length
    ? state.items
    : [{ name: "", serialNo: "", warrantyValue: 1, warrantyUnit: "Year", warranty: "1 Year", validTill: "", qty: 1, price: "" }]
  ).map((it) => {
    let warrantyValue = it.warrantyValue;
    let warrantyUnit = it.warrantyUnit;
    if (warrantyValue === undefined || warrantyUnit === undefined) {
      const parsed = parseWarranty(it.warranty !== undefined ? it.warranty : "1 Year");
      warrantyValue = parsed.value;
      warrantyUnit = parsed.unit;
    }
    const warranty = buildWarrantyText(warrantyValue, warrantyUnit);
    const validTill = it.validTill || calcWarrantyValidity(state.issueDate || todayISO(), warranty);
    return {
      id: crypto.randomUUID(),
      name: it.name || "",
      serialNo: it.serialNo || "",
      warrantyValue: warrantyValue,
      warrantyUnit: warrantyUnit,
      warranty: warranty,
      validTill: validTill,
      qty: it.qty ?? 1,
      price: it.price ?? "",
    };
  });
  renderItems();
  updatePreview();
}

function newInvoice() {
  currentId = crypto.randomUUID();
  applyState({
    id: currentId,
    customerName: "",
    customerPhone: "",
    customerAddress: "",
    refNo: generateRefNo(),
    issueDate: todayISO(),
    paymentMode: "Paid – UPI / Cash",
    notes: "",
    items: [{ name: "", serialNo: "", warrantyValue: 1, warrantyUnit: "Year", warranty: "1 Year", validTill: "", qty: 1, price: "" }],
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
        <button type="button" class="dash-act dash-act-wa" data-act="whatsapp">WhatsApp</button>
        <button type="button" class="dash-act" data-act="open">Open</button>
        <button type="button" class="dash-act dash-act-danger" data-act="delete">Delete</button>
      </div>
    `;
    li.querySelector(".dash-item-main").addEventListener("click", () => openInvoice(inv));
    li.querySelector('[data-act="open"]').addEventListener("click", () => openInvoice(inv));
    li.querySelector('[data-act="whatsapp"]').addEventListener("click", () => shareWhatsAppInvoice(inv));
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

/* ---------- whatsapp share ---------- */

async function shareWhatsAppInvoice(targetState = null) {
  const isTargetProvided = !!targetState;
  const state = isTargetProvided ? targetState : getFormState();
  const totals = calcTotals(state);
  const customerName = state.customerName || "Customer";
  const totalStr = `₹ ${formatMoney(totals.total)}`;

  const message = `Hi ${customerName},
Details of your Sale Invoice from INDU Enterprises
Invoice Amount: ${totalStr}
Thank you for doing business with us,
INDU Enterprises
6382182592 | 7904015662`;

  let phone = (state.customerPhone || "").replace(/\D/g, "");
  if (phone.length === 10) phone = "91" + phone;

  const filename = `INDU-RO-Invoice-${state.refNo || "bill"}.pdf`;

  // Build PDF synchronously in memory (<10ms) so browser user gesture is preserved
  let pdfBlob = null;
  try {
    if (typeof buildInvoicePdfBlob === "function") {
      pdfBlob = buildInvoicePdfBlob(state, totals);
    }
  } catch (err) {
    console.error("PDF generation error:", err);
  }

  // 1. Mobile & Web Share API support:
  // When supported (Android Chrome, iOS Safari), navigator.share attaches the PDF file AND text directly into WhatsApp!
  if (pdfBlob && typeof File !== "undefined" && typeof navigator !== "undefined" && navigator.canShare) {
    try {
      const pdfFile = new File([pdfBlob], filename, {
        type: "application/pdf",
        lastModified: Date.now(),
      });

      if (navigator.canShare({ files: [pdfFile] })) {
        await navigator.share({
          title: `Invoice #${state.refNo || "bill"}`,
          text: message,
          files: [pdfFile],
        });
        showToast("Invoice PDF shared to WhatsApp!");
        return;
      }
    } catch (shareErr) {
      if (shareErr.name === "AbortError") {
        // User cancelled the share dialog
        return;
      }
      console.warn("Native share failed, proceeding with fallback:", shareErr);
    }
  }

  // 2. Desktop fallback (WhatsApp Web):
  // WhatsApp Web cannot programmatically accept files via URL schemes.
  // We automatically download the PDF document to the device and open WhatsApp with the pre-filled message.
  if (pdfBlob && typeof triggerBlobDownload === "function") {
    triggerBlobDownload(pdfBlob, filename);
  }

  const encodedMsg = encodeURIComponent(message);
  const waUrl = phone
    ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodedMsg}`
    : `https://api.whatsapp.com/send?text=${encodedMsg}`;

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    window.location.href = waUrl;
  } else {
    window.open(waUrl, "_blank");
  }

  showToast("Invoice PDF downloaded! Attach it in WhatsApp chat (📎 > Document)", 4500);
}

/* ---------- init ---------- */

function bindEvents() {
  [
    "customerName",
    "customerPhone",
    "customerAddress",
    "issueDate",
    "paymentMode",
    "notes",
  ].forEach((key) => {
    if (els[key]) {
      els[key].addEventListener("input", () => {
        if (key === "issueDate") {
          items.forEach((it) => {
            it.validTill = calcWarrantyValidity(els.issueDate.value, it.warranty);
          });
          renderItems();
        }
        updatePreview();
        persistDraft();
      });
    }
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

  const btnWA = document.getElementById("btnWhatsApp");
  if (btnWA) btnWA.addEventListener("click", () => shareWhatsAppInvoice());
  const btnWAMobile = document.getElementById("btnWhatsAppMobile");
  if (btnWAMobile) btnWAMobile.addEventListener("click", () => shareWhatsAppInvoice());

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
      customerName: "Raju",
      customerPhone: "7678904532",
      customerAddress: "Customer address",
      refNo: "38044",
      issueDate: todayISO(),
      paymentMode: "Paid – UPI / Cash",
      notes: "",
      items: [
        {
          name: "Aqua RO machine",
          serialNo: "Enter",
          warranty: "1 Year",
          validTill: calcWarrantyValidity(todayISO(), "1 Year"),
          qty: 1,
          price: 10000,
        },
        {
          name: "Inverter",
          serialNo: "Enter",
          warranty: "1 Year",
          validTill: calcWarrantyValidity(todayISO(), "1 Year"),
          qty: 1,
          price: 4000,
        },
        {
          name: "Battery",
          serialNo: "Enter",
          warranty: "2 Years",
          validTill: calcWarrantyValidity(todayISO(), "2 Years"),
          qty: 1,
          price: 19999.78,
        },
      ],
    });
  }
  if (typeof applyLogoDataUrls === "function") applyLogoDataUrls();
  showView("dashboard");
}

init();

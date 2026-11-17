/**
 * INDU RO SERVICE — Invoice Generator + Dashboard
 * High-reliability, mobile-first, offline-ready
 */

const STORAGE_KEY = "indu_ro_invoices";
const DRAFT_KEY = "indu_ro_draft";

const els = {
  customerName: typeof document !== "undefined" ? document.getElementById("customerName") : null,
  customerPhone: typeof document !== "undefined" ? document.getElementById("customerPhone") : null,
  refNo: typeof document !== "undefined" ? document.getElementById("refNo") : null,
  issueDate: typeof document !== "undefined" ? document.getElementById("issueDate") : null,
  paymentMode: typeof document !== "undefined" ? document.getElementById("paymentMode") : null,
  profit: typeof document !== "undefined" ? document.getElementById("profit") : null,
  notes: typeof document !== "undefined" ? document.getElementById("notes") : null,
  itemsList: typeof document !== "undefined" ? document.getElementById("itemsList") : null,
  previewCustomerName: typeof document !== "undefined" ? document.getElementById("previewCustomerName") : null,
  previewCustomerPhone: typeof document !== "undefined" ? document.getElementById("previewCustomerPhone") : null,
  previewRefNo: typeof document !== "undefined" ? document.getElementById("previewRefNo") : null,
  previewDate: typeof document !== "undefined" ? document.getElementById("previewDate") : null,
  previewPayment: typeof document !== "undefined" ? document.getElementById("previewPayment") : null,
  previewItems: typeof document !== "undefined" ? document.getElementById("previewItems") : null,
  previewQtyTotal: typeof document !== "undefined" ? document.getElementById("previewQtyTotal") : null,
  previewGrandTotal: typeof document !== "undefined" ? document.getElementById("previewGrandTotal") : null,
  previewWords: typeof document !== "undefined" ? document.getElementById("previewWords") : null,
  previewNotes: typeof document !== "undefined" ? document.getElementById("previewNotes") : null,
  invoice: typeof document !== "undefined" ? document.getElementById("invoice") : null,
  toast: typeof document !== "undefined" ? document.getElementById("toast") : null,
  viewDashboard: typeof document !== "undefined" ? document.getElementById("viewDashboard") : null,
  viewCreate: typeof document !== "undefined" ? document.getElementById("viewCreate") : null,
  toolbarSubtitle: typeof document !== "undefined" ? document.getElementById("toolbarSubtitle") : null,
  toolbarCreateActions: typeof document !== "undefined" ? document.getElementById("toolbarCreateActions") : null,
  dashHeroLabel: typeof document !== "undefined" ? document.getElementById("dashHeroLabel") : null,
  dashHeroAmount: typeof document !== "undefined" ? document.getElementById("dashHeroAmount") : null,
  dashHeroMeta: typeof document !== "undefined" ? document.getElementById("dashHeroMeta") : null,
  dashCount: typeof document !== "undefined" ? document.getElementById("dashCount") : null,
  dashRevenue: typeof document !== "undefined" ? document.getElementById("dashRevenue") : null,
  dashProfit: typeof document !== "undefined" ? document.getElementById("dashProfit") : null,
  dashPeriodLabel: typeof document !== "undefined" ? document.getElementById("dashPeriodLabel") : null,
  dashList: typeof document !== "undefined" ? document.getElementById("dashList") : null,
  dashEmpty: typeof document !== "undefined" ? document.getElementById("dashEmpty") : null,
  editorBillTotal: typeof document !== "undefined" ? document.getElementById("editorBillTotal") : null,
  editorProfitTotal: typeof document !== "undefined" ? document.getElementById("editorProfitTotal") : null,
  btnSave: typeof document !== "undefined" ? document.getElementById("btnSave") : null,
};

let items = [];
let currentId = null;
let toastTimer = null;
let currentPeriod = "day";
let currentDashMode = "bill";
let currentView = "dashboard";
let isSaving = false;

/* ---------- financial & calculation helpers ---------- */

function roundPaise(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parseNum(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function formatMoney(n) {
  const num = roundPaise(n);
  return num.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoneyShort(n) {
  const num = roundPaise(n);
  if (num >= 100000) {
    const inL = num / 100000;
    return (inL % 1 === 0 ? inL.toFixed(0) : inL.toFixed(1)) + "L";
  }
  if (num >= 1000) {
    return num.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  }
  return formatMoney(num);
}

function formatQty(n) {
  const num = Number(n) || 0;
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

function calcTotals(state) {
  let qtyTotal = 0;
  let totalPaise = 0;
  (state.items || []).forEach((it) => {
    const q = parseNum(it.qty);
    const p = parseNum(it.price);
    const rowPaise = Math.round(roundPaise(q * p) * 100);
    qtyTotal = roundPaise(qtyTotal + q);
    totalPaise += rowPaise;
  });
  return {
    qtyTotal,
    total: totalPaise / 100,
  };
}

/* ---------- date helpers (timezone-safe, ISO calendar normalized) ---------- */

function extractISODate(value) {
  if (!value) return "";
  if (value instanceof Date && !isNaN(value)) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const str = String(value).trim();
  const m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  }
  return "";
}

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDateDisplay(iso) {
  const clean = extractISODate(iso);
  if (!clean) return "—";
  const [y, m, d] = clean.split("-");
  return `${d}/${m}/${y}`;
}

function generateRefNo() {
  return Date.now().toString().slice(-5);
}

function showToast(message, duration = 2400) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast && els.toast.classList.remove("show"), duration);
}

/* ---------- warranty calculations (month-end rollover safe) ---------- */

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
  if (!isNaN(numOnly) && numOnly > 0) {
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
  const cleanDate = extractISODate(issueDateIso);
  if (!cleanDate || !warrantyText) return "";
  const clean = String(warrantyText).trim().toLowerCase();
  if (clean === "" || clean === "none" || clean === "no warranty" || clean === "na" || clean === "n/a" || clean === "0") {
    return "";
  }

  const [y, m, d] = cleanDate.split("-").map(Number);
  if (!y || !m || !d) return "";

  const yearMatch = clean.match(/(\d+)\s*y/);
  const monthMatch = clean.match(/(\d+)\s*m/);

  let targetYear = y;
  let targetMonth = m - 1; // 0-indexed month
  let targetDay = d;

  if (yearMatch) {
    const years = parseInt(yearMatch[1], 10);
    if (isNaN(years) || years <= 0) return "";
    targetYear += years;
  } else if (monthMatch) {
    const months = parseInt(monthMatch[1], 10);
    if (isNaN(months) || months <= 0) return "";
    const totalMonths = targetMonth + months;
    targetYear += Math.floor(totalMonths / 12);
    targetMonth = ((totalMonths % 12) + 12) % 12;
  } else {
    const numOnly = parseInt(clean, 10);
    if (!isNaN(numOnly) && numOnly > 0) {
      targetYear += numOnly;
    } else {
      return "";
    }
  }

  // Safe month-end clamping (handles Feb 28, Feb 29 in leap year, 30, 31)
  const maxDaysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  targetDay = Math.min(targetDay, maxDaysInTargetMonth);

  // Expiration is target date minus 1 day (standard warranty convention)
  const resultDate = new Date(targetYear, targetMonth, targetDay);
  resultDate.setDate(resultDate.getDate() - 1);

  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(resultDate.getDate())}/${pad(resultDate.getMonth() + 1)}/${resultDate.getFullYear()}`;
}

/* ---------- amount in words (Indian numbering system) ---------- */

function numberToWordsIndian(num) {
  const n = roundPaise(num);
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

  if (els.viewDashboard) els.viewDashboard.classList.toggle("hidden", !isDash);
  if (els.viewCreate) els.viewCreate.classList.toggle("hidden", isDash);

  if (els.toolbarSubtitle) {
    if (isDash) {
      els.toolbarSubtitle.textContent = "Dashboard";
    } else {
      els.toolbarSubtitle.textContent = currentId && els.refNo && els.refNo.value
        ? `Edit invoice #${els.refNo.value}`
        : "Create invoice";
    }
  }
  if (els.toolbarCreateActions) els.toolbarCreateActions.hidden = isDash;

  if (typeof document !== "undefined") {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      const active = btn.dataset.nav === view;
      btn.classList.toggle("active", active);
      if (active) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
  }

  if (isDash) renderDashboard();
  if (typeof window !== "undefined" && window.scrollTo) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

/* ---------- state & form ---------- */

function getFormState() {
  return {
    id: currentId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    customerName: els.customerName ? els.customerName.value.trim() : "",
    customerPhone: els.customerPhone ? els.customerPhone.value.trim() : "",
    refNo: els.refNo ? els.refNo.value.trim() : "",
    issueDate: els.issueDate ? extractISODate(els.issueDate.value) || todayISO() : todayISO(),
    paymentMode: els.paymentMode ? els.paymentMode.value.trim() : "Paid – UPI / Cash",
    profit: els.profit && els.profit.value !== "" ? roundPaise(parseNum(els.profit.value)) : 0,
    notes: els.notes ? els.notes.value.trim() : "",
    items: items.map((it) => ({
      name: (it.name || "").trim(),
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

/* ---------- items UI ---------- */

function addItem(data = { name: "", serialNo: "", warrantyValue: 1, warrantyUnit: "Year", warranty: "1 Year", validTill: "", qty: 1, price: "" }) {
  const issueDate = els.issueDate ? extractISODate(els.issueDate.value) || todayISO() : todayISO();
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
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    name: data.name || "",
    serialNo: data.serialNo || "",
    warrantyValue: warrantyValue,
    warrantyUnit: warrantyUnit,
    warranty: warranty,
    validTill: validTill,
    qty: data.qty !== undefined && data.qty !== "" ? parseNum(data.qty) : 1,
    price: data.price !== undefined && data.price !== "" ? parseNum(data.price) : "",
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
  if (!els.itemsList) return;
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
    const lineTotal = roundPaise(parseNum(it.qty) * parseNum(it.price));
    amountEl.textContent = formatMoney(lineTotal);

    card.querySelector('[data-action="remove"]').addEventListener("click", () => {
      removeItem(it.id);
    });

    const onFieldChange = (el) => {
      const field = el.dataset.field;
      it[field] = el.value;
      if (field === "qty" || field === "price") {
        it[field] = el.value !== "" ? parseNum(el.value) : "";
      }
      if (field === "warrantyValue" || field === "warrantyUnit") {
        it.warranty = buildWarrantyText(it.warrantyValue, it.warrantyUnit);
        it.validTill = calcWarrantyValidity(els.issueDate.value, it.warranty);
        hintEl.textContent = it.validTill ? `Valid till ${it.validTill}` : "";
      }
      const updatedTotal = roundPaise(parseNum(it.qty) * parseNum(it.price));
      amountEl.textContent = formatMoney(updatedTotal);
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

  if (els.editorBillTotal) {
    els.editorBillTotal.textContent = `₹ ${formatMoney(totals.total)}`;
  }
  if (els.editorProfitTotal) {
    els.editorProfitTotal.textContent = `₹ ${formatMoney(parseNum(state.profit))}`;
  }

  if (els.previewCustomerName) els.previewCustomerName.textContent = state.customerName || "Customer Name";
  if (els.previewCustomerPhone) els.previewCustomerPhone.textContent = state.customerPhone || "—";
  if (els.previewRefNo) els.previewRefNo.textContent = state.refNo || "—";
  if (els.previewDate) els.previewDate.textContent = formatDateDisplay(state.issueDate);
  if (els.previewPayment) els.previewPayment.textContent = state.paymentMode || "Paid – UPI / Cash";

  if (els.previewItems) {
    const filled = state.items.filter((it) => it.name || it.qty || it.price);
    if (filled.length === 0) {
      els.previewItems.innerHTML =
        '<tr class="empty-row"><td colspan="6">No products added</td></tr>';
    } else {
      els.previewItems.innerHTML = filled
        .map((it, i) => {
          const amount = roundPaise(parseNum(it.qty) * parseNum(it.price));
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
  }

  if (els.previewQtyTotal) els.previewQtyTotal.textContent = formatQty(totals.qtyTotal);
  if (els.previewGrandTotal) els.previewGrandTotal.textContent = `₹ ${formatMoney(totals.total)}`;
  if (els.previewWords) els.previewWords.textContent = `Amount in words: ${numberToWordsIndian(totals.total)}`;

  if (els.previewNotes) {
    if (state.notes) {
      els.previewNotes.hidden = false;
      els.previewNotes.textContent = state.notes;
    } else {
      els.previewNotes.hidden = true;
      els.previewNotes.textContent = "";
    }
  }
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn("saveInvoices failed:", e);
  }
}

function persistDraft() {
  try {
    const state = getFormState();
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("persistDraft failed:", e);
  }
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch (e) {
    console.warn("clearDraft failed:", e);
  }
}

function applyState(state) {
  currentId = state.id || null;
  if (els.customerName) els.customerName.value = state.customerName || "";
  if (els.customerPhone) els.customerPhone.value = state.customerPhone || "";
  if (els.refNo) els.refNo.value = state.refNo || generateRefNo();
  if (els.issueDate) els.issueDate.value = extractISODate(state.issueDate) || todayISO();
  if (els.paymentMode) els.paymentMode.value = state.paymentMode || "Paid – UPI / Cash";
  if (els.profit) els.profit.value = state.profit !== undefined && state.profit !== null && state.profit !== "" ? state.profit : "";
  if (els.notes) els.notes.value = state.notes || "";

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
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      name: it.name || "",
      serialNo: it.serialNo || "",
      warrantyValue: warrantyValue,
      warrantyUnit: warrantyUnit,
      warranty: warranty,
      validTill: validTill,
      qty: it.qty !== undefined && it.qty !== "" ? parseNum(it.qty) : 1,
      price: it.price !== undefined && it.price !== "" ? parseNum(it.price) : "",
    };
  });
  renderItems();
  updatePreview();
}

function newInvoice() {
  currentId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  applyState({
    id: currentId,
    customerName: "",
    customerPhone: "",
    refNo: generateRefNo(),
    issueDate: todayISO(),
    paymentMode: "Paid – UPI / Cash",
    profit: "",
    notes: "",
    items: [{ name: "", serialNo: "", warrantyValue: 1, warrantyUnit: "Year", warranty: "1 Year", validTill: "", qty: 1, price: "" }],
  });
  clearDraft();
  if (els.toolbarSubtitle && currentView === "create") {
    els.toolbarSubtitle.textContent = "Create invoice";
  }
  showToast("New invoice ready");
}

async function saveInvoice() {
  if (isSaving) return;

  const state = getFormState();
  if (!state.customerName) {
    showToast("Enter customer name");
    if (els.customerName) els.customerName.focus();
    return;
  }
  if (!state.customerPhone || state.customerPhone.length < 10) {
    showToast("Enter 10-digit customer mobile number");
    if (els.customerPhone) els.customerPhone.focus();
    return;
  }
  const hasItem = state.items.some((it) => it.name && it.qty > 0);
  if (!hasItem) {
    showToast("Add at least one product with name and quantity");
    return;
  }

  isSaving = true;
  if (els.btnSave) {
    els.btnSave.disabled = true;
    els.btnSave.textContent = "Saving…";
  }

  try {
    currentId = state.id;
    state.updatedAt = new Date().toISOString();

    // 1. Save to local storage
    const list = loadInvoices();
    const idx = list.findIndex((inv) => inv.id === state.id);
    if (idx >= 0) list[idx] = state;
    else list.unshift(state);
    saveInvoices(list);

    // 2. Clear uncommitted draft since changes are successfully saved
    clearDraft();

    // 3. Update dashboard immediately without requiring page reload
    renderDashboard();
    if (els.toolbarSubtitle && currentView === "create") {
      els.toolbarSubtitle.textContent = `Edit invoice #${state.refNo}`;
    }
    showToast("Invoice saved successfully");

    // 4. Persist to Supabase
    if (window.invoiceDb) {
      const res = await window.invoiceDb.saveInvoice(state);
      if (res && res.localOnly === false) {
        showToast("Changes saved & synced to Supabase");
      } else if (res && res.localOnly === true) {
        showToast("Invoice saved locally (waiting to sync)");
      }
    }
  } catch (err) {
    console.error("Save invoice error:", err);
    showToast("Unable to save invoice. Please try again.");
  } finally {
    isSaving = false;
    if (els.btnSave) {
      els.btnSave.disabled = false;
      els.btnSave.textContent = "Save invoice";
    }
  }
}

function deleteInvoice(id) {
  if (!id) return;
  const strId = String(id);
  const list = loadInvoices().filter((inv) => String(inv.id) !== strId);
  saveInvoices(list);

  if (window.invoiceDb) {
    window.invoiceDb.deleteInvoice(strId);
  }

  if (String(currentId) === strId) {
    clearDraft();
    newInvoice();
  }

  renderDashboard();
  showToast("Invoice deleted");
}

function openInvoice(inv) {
  applyState(inv);
  showView("create");
  if (els.toolbarSubtitle) {
    els.toolbarSubtitle.textContent = `Edit invoice #${inv.refNo || ""}`;
  }
  showToast("Invoice loaded");
}

/* ---------- dashboard filters (timezone-safe, inclusive calendar bounds) ---------- */

function getPeriodBounds(period, refDate = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = refDate.getFullYear();
  const m = refDate.getMonth();
  const d = refDate.getDate();
  const refIso = `${y}-${pad(m + 1)}-${pad(d)}`;

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  if (period === "day") {
    const isToday = refIso === todayISO();
    return {
      start: refIso,
      end: refIso,
      label: isToday ? `Today · ${d} ${months[m]} ${y}` : `${d} ${months[m]} ${y}`,
    };
  }

  if (period === "week") {
    const dayOfWeek = refDate.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(y, m, d + mondayOffset);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const start = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
    const end = `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`;
    const label = `${monday.getDate()} ${months[monday.getMonth()]} – ${sunday.getDate()} ${months[sunday.getMonth()]} ${sunday.getFullYear()}`;
    return { start, end, label };
  }

  if (period === "month") {
    const lastDay = new Date(y, m + 1, 0).getDate();
    const start = `${y}-${pad(m + 1)}-01`;
    const end = `${y}-${pad(m + 1)}-${pad(lastDay)}`;
    return {
      start,
      end,
      label: `${months[m]} ${y}`,
    };
  }

  // Year filter
  return {
    start: `${y}-01-01`,
    end: `${y}-12-31`,
    label: `Year ${y}`,
  };
}

function filterInvoicesByPeriod(invoices, period, refDate = new Date()) {
  const { start, end, label } = getPeriodBounds(period, refDate);
  const filtered = (invoices || []).filter((inv) => {
    const iso = extractISODate(inv.issueDate);
    if (!iso) return false;
    return iso >= start && iso <= end;
  });

  filtered.sort((a, b) => {
    const da = extractISODate(a.issueDate);
    const db = extractISODate(b.issueDate);
    if (da !== db) return db.localeCompare(da);
    const ta = String(a.updatedAt || a.created_at || "");
    const tb = String(b.updatedAt || b.created_at || "");
    if (ta !== tb) return tb.localeCompare(ta);
    return String(b.refNo || "").localeCompare(String(a.refNo || ""));
  });

  return { filtered, label, start, end };
}

function renderDashboard() {
  if (!els.dashList) return;

  const invoices = loadInvoices();
  const { filtered, label } = filterInvoicesByPeriod(invoices, currentPeriod);

  let totalRevenuePaise = 0;
  let totalProfitPaise = 0;

  filtered.forEach((inv) => {
    const totals = calcTotals(inv);
    totalRevenuePaise += Math.round(totals.total * 100);
    totalProfitPaise += Math.round(roundPaise(parseNum(inv.profit)) * 100);
  });

  const revenue = totalRevenuePaise / 100;
  const totalProfit = totalProfitPaise / 100;
  const isProfitMode = currentDashMode === "profit";

  if (els.dashHeroLabel) {
    els.dashHeroLabel.textContent = isProfitMode ? "Total profit" : "Total bill amount";
  }
  if (els.dashHeroAmount) {
    els.dashHeroAmount.textContent = isProfitMode
      ? `₹ ${formatMoney(totalProfit)}`
      : `₹ ${formatMoney(revenue)}`;
  }
  if (els.dashHeroMeta) {
    els.dashHeroMeta.textContent = `${filtered.length} invoice${filtered.length === 1 ? "" : "s"}`;
  }
  if (els.dashCount) {
    els.dashCount.textContent = String(filtered.length);
  }
  if (els.dashRevenue) {
    els.dashRevenue.textContent = `₹ ${formatMoneyShort(revenue)}`;
  }
  if (els.dashProfit) {
    els.dashProfit.textContent = `₹ ${formatMoneyShort(totalProfit)}`;
  }
  if (els.dashPeriodLabel) {
    els.dashPeriodLabel.textContent = label;
  }

  els.dashList.innerHTML = "";
  if (els.dashEmpty) {
    els.dashEmpty.classList.toggle("show", filtered.length === 0);
  }

  filtered.forEach((inv) => {
    const totals = calcTotals(inv);
    const profitNum = roundPaise(parseNum(inv.profit));
    const hasProfit = inv.profit !== undefined && inv.profit !== null && String(inv.profit).trim() !== "";

    const li = document.createElement("li");
    li.className = "dash-item";

    if (isProfitMode) {
      li.innerHTML = `
        <button type="button" class="dash-item-main">
          <div class="dash-item-top">
            <div class="dash-item-cust">
              <strong>${escapeHtml(inv.customerName) || "Untitled"}</strong>
              <span class="dash-profit-badge">Profit</span>
            </div>
            <span class="dash-item-amt" style="color:var(--warr)">+₹ ${formatMoney(profitNum)}</span>
          </div>
          <div class="dash-item-meta">
            Bill: ₹ ${formatMoney(totals.total)} · #${escapeHtml(inv.refNo)} · ${formatDateDisplay(inv.issueDate)}
            ${inv.customerPhone ? ` · ${escapeHtml(inv.customerPhone)}` : ""}
          </div>
        </button>
        <div class="dash-item-actions">
          <button type="button" class="dash-act dash-act-wa" data-act="whatsapp">WhatsApp</button>
          <button type="button" class="dash-act" data-act="open">Open</button>
          <button type="button" class="dash-act dash-act-danger" data-act="delete">Delete</button>
        </div>
      `;
    } else {
      const profitBadge = hasProfit || profitNum > 0
        ? `<span class="dash-profit-badge">Profit: ₹ ${formatMoney(profitNum)}</span>`
        : "";

      li.innerHTML = `
        <button type="button" class="dash-item-main">
          <div class="dash-item-top">
            <div class="dash-item-cust">
              <strong>${escapeHtml(inv.customerName) || "Untitled"}</strong>
              ${profitBadge}
            </div>
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
    }

    li.querySelector(".dash-item-main").addEventListener("click", () => openInvoice(inv));
    li.querySelector('[data-act="open"]').addEventListener("click", () => openInvoice(inv));
    li.querySelector('[data-act="whatsapp"]').addEventListener("click", () => shareWhatsAppInvoice(inv));
    li.querySelector('[data-act="delete"]').addEventListener("click", () => {
      const custText = inv.customerName ? ` for ${inv.customerName}` : "";
      if (confirm(`Delete invoice #${inv.refNo}${custText}?`)) {
        deleteInvoice(inv.id);
      }
    });
    els.dashList.appendChild(li);
  });
}

function setDashMode(mode) {
  currentDashMode = mode;
  if (typeof document !== "undefined") {
    document.querySelectorAll(".dash-mode-tab").forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
  }
  renderDashboard();
}

function setPeriod(period) {
  currentPeriod = period;
  if (typeof document !== "undefined") {
    document.querySelectorAll(".period-tab").forEach((tab) => {
      const active = tab.dataset.period === period;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
  }
  renderDashboard();
}

/* ---------- whatsapp share (strictly private profit) ---------- */

function shareWhatsAppInvoice(targetState = null) {
  const isTargetProvided = !!targetState;
  const state = isTargetProvided ? targetState : getFormState();
  const totals = calcTotals(state);
  const customerName = state.customerName || "Customer";
  const totalStr = `₹ ${formatMoney(totals.total)}`;

  let rawPhone = (state.customerPhone || "").replace(/\D/g, "");
  let phone = "";
  if (rawPhone.length === 10) {
    phone = "91" + rawPhone;
  } else if (rawPhone.length === 11 && rawPhone.startsWith("0")) {
    phone = "91" + rawPhone.slice(1);
  } else if (rawPhone.length === 12 && rawPhone.startsWith("91")) {
    phone = rawPhone;
  } else if (rawPhone.length > 0) {
    phone = rawPhone;
  }

  if (!phone) {
    showToast("Please enter customer contact number");
    if (!isTargetProvided && els.customerPhone) els.customerPhone.focus();
    return;
  }

  // Privacy: Profit NEVER appears in customer-facing message
  const message = `Hi ${customerName},
Details of your Sale Invoice from INDU Enterprises
Invoice Amount: ${totalStr}
Thank you for doing business with us,
INDU Enterprises
6382182592 | 7904015662`;

  const encodedMsg = encodeURIComponent(message);
  const filename = `INDU-RO-Invoice-${state.refNo || "bill"}.pdf`;

  // 1. Generate PDF and trigger download immediately
  let pdfBlob = null;
  try {
    if (typeof buildInvoicePdfBlob === "function") {
      pdfBlob = buildInvoicePdfBlob(state, totals);
    }
  } catch (err) {
    console.error("PDF generation error:", err);
  }

  if (pdfBlob && typeof triggerBlobDownload === "function") {
    triggerBlobDownload(pdfBlob, filename);
  }

  // 2. Open WhatsApp directly to customer's chat on Android, iPhone & Desktop
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    const appUrl = `whatsapp://send?phone=${phone}&text=${encodedMsg}`;
    const webUrl = `https://wa.me/${phone}?text=${encodedMsg}`;

    const a = document.createElement("a");
    a.href = appUrl;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
      window.location.href = webUrl;
    }, 1000);
  } else {
    const desktopUrl = `https://web.whatsapp.com/send?phone=${phone}&text=${encodedMsg}`;
    window.open(desktopUrl, "_blank");
  }

  showToast("Opening WhatsApp chat… invoice PDF downloaded!");
}

/* ---------- init & event binding ---------- */

function bindEvents() {
  [
    "customerName",
    "customerPhone",
    "issueDate",
    "paymentMode",
    "profit",
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

  const btnAddItem = document.getElementById("btnAddItem");
  if (btnAddItem) btnAddItem.addEventListener("click", () => addItem());

  const btnSave = document.getElementById("btnSave");
  if (btnSave) btnSave.addEventListener("click", saveInvoice);

  const btnNew = document.getElementById("btnNew");
  if (btnNew) {
    btnNew.addEventListener("click", () => {
      newInvoice();
      showView("create");
    });
  }

  const btnPrint = document.getElementById("btnPrint");
  if (btnPrint) btnPrint.addEventListener("click", printInvoice);

  const btnDownload = document.getElementById("btnDownload");
  if (btnDownload) btnDownload.addEventListener("click", downloadPdf);

  const btnPrintMobile = document.getElementById("btnPrintMobile");
  if (btnPrintMobile) btnPrintMobile.addEventListener("click", printInvoice);

  const btnDownloadMobile = document.getElementById("btnDownloadMobile");
  if (btnDownloadMobile) btnDownloadMobile.addEventListener("click", downloadPdf);

  const btnWA = document.getElementById("btnWhatsApp");
  if (btnWA) btnWA.addEventListener("click", () => shareWhatsAppInvoice());

  const btnWAMobile = document.getElementById("btnWhatsAppMobile");
  if (btnWAMobile) btnWAMobile.addEventListener("click", () => shareWhatsAppInvoice());

  if (els.customerPhone) {
    els.customerPhone.addEventListener("input", () => {
      els.customerPhone.value = els.customerPhone.value.replace(/\D/g, "").slice(0, 10);
    });
  }

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.nav === "create" && !currentId) newInvoice();
      showView(btn.dataset.nav);
    });
  });

  document.querySelectorAll(".period-tab").forEach((tab) => {
    tab.addEventListener("click", () => setPeriod(tab.dataset.period));
  });

  document.querySelectorAll(".dash-mode-tab").forEach((tab) => {
    tab.addEventListener("click", () => setDashMode(tab.dataset.mode));
  });
}

async function init() {
  bindEvents();

  if (window.invoiceDb) {
    const cloudBadge = document.getElementById("cloudStatus");
    window.invoiceDb.onStatusChange((status) => {
      if (!cloudBadge) return;
      cloudBadge.className = `cloud-badge ${status}`;
      if (status === "online") {
        cloudBadge.textContent = "☁️ Supabase Live";
        cloudBadge.title = "Connected to Supabase PostgreSQL database";
      } else if (status === "local") {
        cloudBadge.textContent = "☁️ Supabase Ready";
        cloudBadge.title = "Connected to Supabase (run supabase-schema.sql to enable cloud sync)";
      } else {
        cloudBadge.textContent = "☁️ Local Cache";
        cloudBadge.title = "Working with local offline storage";
      }
    });

    try {
      // Reconciles remote with local cache without overwriting newer local edits
      const merged = await window.invoiceDb.fetchInvoices();
      if (merged && merged.length > 0) {
        renderDashboard();
      }
    } catch (err) {
      console.warn("Remote invoice fetch:", err);
    }
  }

  const draft = loadDraft();
  if (draft) {
    applyState(draft);
  } else {
    currentId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    applyState({
      id: currentId,
      customerName: "Raju",
      customerPhone: "7678904532",
      refNo: "38044",
      issueDate: todayISO(),
      paymentMode: "Paid – UPI / Cash",
      profit: "1500",
      notes: "",
      items: [
        {
          name: "Aqua RO machine",
          serialNo: "SN-10294",
          warranty: "1 Year",
          validTill: calcWarrantyValidity(todayISO(), "1 Year"),
          qty: 1,
          price: 10000,
        },
        {
          name: "Inverter",
          serialNo: "INV-4412",
          warranty: "1 Year",
          validTill: calcWarrantyValidity(todayISO(), "1 Year"),
          qty: 1,
          price: 4000,
        },
        {
          name: "Battery",
          serialNo: "BAT-9901",
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

if (typeof window !== "undefined") {
  init();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    roundPaise,
    parseNum,
    calcTotals,
    extractISODate,
    todayISO,
    formatDateDisplay,
    formatMoney,
    formatMoneyShort,
    formatQty,
    parseWarranty,
    buildWarrantyText,
    calcWarrantyValidity,
    numberToWordsIndian,
    getPeriodBounds,
    filterInvoicesByPeriod,
  };
}

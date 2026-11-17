/**
 * INDU RO SERVICE — Comprehensive Automated Audit Test Suite
 * Covers Filtering, Calculations, Warranty Date Clamping,
 * Supabase Offline/Online Sync Reconciliation, and Profit Privacy.
 */

const assert = require("assert");
const app = require("../app.js");
const { InvoiceDatabase } = require("../db.js");

let totalTests = 0;
let passedTests = 0;

function test(description, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    Error: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("=================================================");
console.log("INDU RO SERVICE — Running Automated Audit Tests");
console.log("=================================================\n");

// ---------------------------------------------------------------------
// 1. Filtering & Timezone Tests
// ---------------------------------------------------------------------
console.log("1. Filtering & Date Boundaries:");

test("Extracts clean YYYY-MM-DD from various formats", () => {
  assert.strictEqual(app.extractISODate("2026-11-17"), "2026-11-17");
  assert.strictEqual(app.extractISODate("2026-11-17T15:30:00.000Z"), "2026-11-17");
  assert.strictEqual(app.extractISODate("2026-1-5"), "2026-01-05");
  assert.strictEqual(app.extractISODate(new Date(2026, 10, 17)), "2026-11-17");
  assert.strictEqual(app.extractISODate(null), "");
  assert.strictEqual(app.extractISODate("invalid"), "");
});

test("Day filter returns exact matching day records only", () => {
  const ref = new Date(2026, 10, 17); // Nov 17, 2026
  const list = [
    { id: "1", refNo: "101", issueDate: "2026-11-17", items: [{ qty: 1, price: 1000 }], profit: 100 },
    { id: "2", refNo: "102", issueDate: "2026-11-17T00:00:00Z", items: [{ qty: 1, price: 2000 }], profit: 200 },
    { id: "3", refNo: "103", issueDate: "2026-11-16", items: [{ qty: 1, price: 500 }], profit: 50 },
    { id: "4", refNo: "104", issueDate: "2026-11-18", items: [{ qty: 1, price: 700 }], profit: 70 },
  ];
  const { filtered } = app.filterInvoicesByPeriod(list, "day", ref);
  assert.strictEqual(filtered.length, 2);
  assert.deepStrictEqual(filtered.map((x) => x.refNo), ["102", "101"]);
});

test("Week filter includes Monday through Sunday inclusive", () => {
  // Nov 17, 2026 is a Tuesday. The week is Monday Nov 16 to Sunday Nov 22.
  const ref = new Date(2026, 10, 17);
  const bounds = app.getPeriodBounds("week", ref);
  assert.strictEqual(bounds.start, "2026-11-16");
  assert.strictEqual(bounds.end, "2026-11-22");

  const list = [
    { id: "1", refNo: "101", issueDate: "2026-11-15" }, // Sunday prior
    { id: "2", refNo: "102", issueDate: "2026-11-16" }, // Monday start
    { id: "3", refNo: "103", issueDate: "2026-11-17" }, // Tuesday
    { id: "4", refNo: "104", issueDate: "2026-11-22" }, // Sunday end
    { id: "5", refNo: "105", issueDate: "2026-11-23" }, // Next Monday
  ];
  const { filtered } = app.filterInvoicesByPeriod(list, "week", ref);
  assert.strictEqual(filtered.length, 3);
  assert.deepStrictEqual(filtered.map((x) => x.refNo), ["104", "103", "102"]);
});

test("Month filter correctly identifies month length and leap year", () => {
  // February in leap year 2024 (29 days)
  const leapRef = new Date(2024, 1, 15);
  const leapBounds = app.getPeriodBounds("month", leapRef);
  assert.strictEqual(leapBounds.start, "2024-02-01");
  assert.strictEqual(leapBounds.end, "2024-02-29");

  // February in non-leap year 2026 (28 days)
  const nonLeapRef = new Date(2026, 1, 15);
  const nonLeapBounds = app.getPeriodBounds("month", nonLeapRef);
  assert.strictEqual(nonLeapBounds.start, "2026-02-01");
  assert.strictEqual(nonLeapBounds.end, "2026-02-28");
});

test("Year filter spans Jan 01 to Dec 31 inclusive", () => {
  const ref = new Date(2026, 6, 20);
  const bounds = app.getPeriodBounds("year", ref);
  assert.strictEqual(bounds.start, "2026-01-01");
  assert.strictEqual(bounds.end, "2026-12-31");

  const list = [
    { id: "1", refNo: "101", issueDate: "2025-12-31" },
    { id: "2", refNo: "102", issueDate: "2026-01-01" },
    { id: "3", refNo: "103", issueDate: "2026-07-20" },
    { id: "4", refNo: "104", issueDate: "2026-12-31" },
    { id: "5", refNo: "105", issueDate: "2027-01-01" },
  ];
  const { filtered } = app.filterInvoicesByPeriod(list, "year", ref);
  assert.strictEqual(filtered.length, 3);
  assert.deepStrictEqual(filtered.map((x) => x.refNo), ["104", "103", "102"]);
});

// ---------------------------------------------------------------------
// 2. Warranty Calculation Tests (Month-End Rollover Bug Fix)
// ---------------------------------------------------------------------
console.log("\n2. Warranty Calculations & Rollover:");

test("Jan 31 + 1 Month safely clamps to February end (never March)", () => {
  // Jan 31 + 1 Month in 2026 (non-leap year, Feb has 28 days)
  // Target date is Feb 28 minus 1 day = Feb 27
  const validTill = app.calcWarrantyValidity("2026-01-31", "1 Month");
  assert.strictEqual(validTill, "27/02/2026");
});

test("Jan 31 + 1 Month in leap year clamps to Feb 29 end", () => {
  // 2024 is leap year, Feb has 29 days
  const validTill = app.calcWarrantyValidity("2024-01-31", "1 Month");
  assert.strictEqual(validTill, "28/02/2024");
});

test("Feb 29 (leap year) + 1 Year safely clamps to Feb 28 end in non-leap year", () => {
  const validTill = app.calcWarrantyValidity("2024-02-29", "1 Year");
  assert.strictEqual(validTill, "27/02/2025");
});

test("Standard warranty 1 Year on Jan 1 expires Dec 31", () => {
  const validTill = app.calcWarrantyValidity("2026-01-01", "1 Year");
  assert.strictEqual(validTill, "31/12/2026");
});

test("Handles none, zero, and empty warranty cleanly", () => {
  assert.strictEqual(app.calcWarrantyValidity("2026-01-01", "No Warranty"), "");
  assert.strictEqual(app.calcWarrantyValidity("2026-01-01", "0"), "");
  assert.strictEqual(app.calcWarrantyValidity("2026-01-01", ""), "");
  assert.strictEqual(app.calcWarrantyValidity("", "1 Year"), "");
});

// ---------------------------------------------------------------------
// 3. Financial Calculations & Precision Tests
// ---------------------------------------------------------------------
console.log("\n3. Financial Precision & Calculations:");

test("calcTotals calculates paise-exact sum and avoids floating point drift", () => {
  const state = {
    items: [
      { qty: 1, price: 10000 },
      { qty: 1, price: 4000 },
      { qty: 1, price: 19999.78 },
    ],
  };
  const totals = app.calcTotals(state);
  assert.strictEqual(totals.qtyTotal, 3);
  assert.strictEqual(totals.total, 33999.78);
});

test("Rejects negative quantities and prices", () => {
  assert.strictEqual(app.parseNum("-50"), 0);
  assert.strictEqual(app.parseNum(-100), 0);
  assert.strictEqual(app.parseNum("25.5"), 25.5);

  const state = {
    items: [{ qty: -2, price: 100 }],
  };
  const totals = app.calcTotals(state);
  assert.strictEqual(totals.total, 0);
});

test("Indian Rupee format and words converter", () => {
  assert.strictEqual(app.formatMoney(33999.78), "33,999.78");
  assert.strictEqual(app.formatMoney(100000), "1,00,000.00");

  const words = app.numberToWordsIndian(33999.78);
  assert.strictEqual(
    words,
    "Thirty-Three Thousand Nine Hundred Ninety-Nine Rupees and Seventy-Eight Paise Only"
  );

  const zeroWords = app.numberToWordsIndian(0);
  assert.strictEqual(zeroWords, "Zero Rupees Only");
});

// ---------------------------------------------------------------------
// 4. Supabase & Offline Sync Reconciliation Tests
// ---------------------------------------------------------------------
console.log("\n4. Supabase & Offline Sync Reconciliation:");

test("mergeInvoices keeps local changes when local is strictly newer", () => {
  const db = new InvoiceDatabase();
  const localList = [
    { id: "1", refNo: "101", customerName: "Alice Updated Locally", updatedAt: "2026-11-17T12:00:00Z" },
    { id: "2", refNo: "102", customerName: "Bob Local Older", updatedAt: "2026-11-17T09:00:00Z" },
  ];
  const remoteList = [
    { id: "1", refNo: "101", customerName: "Alice Stale Remote", updatedAt: "2026-11-17T10:00:00Z" },
    { id: "2", refNo: "102", customerName: "Bob Newer Remote", updatedAt: "2026-11-17T14:00:00Z" },
  ];

  const merged = db.mergeInvoices(localList, remoteList);
  const alice = merged.find((x) => x.id === "1");
  const bob = merged.find((x) => x.id === "2");

  assert.strictEqual(alice.customerName, "Alice Updated Locally");
  assert.strictEqual(bob.customerName, "Bob Newer Remote");
});

test("mergeInvoices preserves offline created records", () => {
  const db = new InvoiceDatabase();
  const localList = [
    { id: "offline-1", refNo: "999", customerName: "Created Offline", updatedAt: "2026-11-17T12:00:00Z" },
  ];
  const remoteList = [
    { id: "remote-1", refNo: "888", customerName: "Remote Server Record", updatedAt: "2026-11-17T11:00:00Z" },
  ];

  const merged = db.mergeInvoices(localList, remoteList);
  assert.strictEqual(merged.length, 2);
  assert(merged.some((x) => x.id === "offline-1"));
  assert(merged.some((x) => x.id === "remote-1"));
});

test("Tombstone protection: deleted IDs are never resurrected by remote fetch", () => {
  const db = new InvoiceDatabase();
  const deletedId = "del-123";

  // Simulate local deletion tombstone
  db.addDeletedId(deletedId);

  const localList = [];
  const remoteList = [
    { id: deletedId, refNo: "DEL-1", customerName: "Zombie Record" },
    { id: "active-1", refNo: "ACT-1", customerName: "Active Record" },
  ];

  const merged = db.mergeInvoices(localList, remoteList);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].id, "active-1");
});

// ---------------------------------------------------------------------
// 5. Profit Privacy & Security Verification
// ---------------------------------------------------------------------
console.log("\n5. Profit Privacy Verification:");

test("Invoice PDF vector code contains zero profit references", () => {
  const fs = require("fs");
  const pdfSource = fs.readFileSync(__dirname + "/../pdf.js", "utf8");

  // Verify that neither 'profit' nor 'Profit' is used in drawing operations
  const drawProfitMatch = pdfSource.match(/ops\.push.*[Pp]rofit/);
  assert.strictEqual(
    drawProfitMatch,
    null,
    "CRITICAL SECURITY: Found profit reference in PDF drawing stream!"
  );
});

test("WhatsApp sharing message template contains zero profit references", () => {
  const fs = require("fs");
  const appSource = fs.readFileSync(__dirname + "/../app.js", "utf8");

  const waFunc = appSource.substring(
    appSource.indexOf("function shareWhatsAppInvoice"),
    appSource.indexOf("function bindEvents")
  );
  assert.ok(!waFunc.includes("profit"), "CRITICAL: WhatsApp message contains profit!");
});

console.log("\n=================================================");
console.log(`Audit Test Suite Completed: ${passedTests}/${totalTests} Passed`);
console.log("=================================================");

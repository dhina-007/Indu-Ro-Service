/**
 * Download PDF = exact same Tax Invoice UI as Print.
 */

function pdfEscape(text) {
  const sanitized = String(text ?? "")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u20B9]/g, "Rs ")
    .replace(/[^\x20-\x7E]/g, " ");
  return sanitized
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = (dataUrl || "").split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readJpegSize(bytes) {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
      };
    }
    i += 2 + len;
  }
  return { width: 200, height: 200 };
}

function rgb(r, g, b) {
  return `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)}`;
}

function applyLogoDataUrls() {
  const data = window.INDU_LOGO_DATA;
  if (!data || !data.dataUrl) return;
  document.querySelectorAll(".inv-logo, .toolbar-logo").forEach((img) => {
    img.setAttribute("src", data.dataUrl);
    img.src = data.dataUrl;
  });
}

function waitForImages(root) {
  const imgs = [...root.querySelectorAll("img")];
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete && img.naturalWidth) return resolve();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          setTimeout(resolve, 1500);
        })
    )
  );
}

function printInvoice() {
  updatePreview();
  applyLogoDataUrls();
  window.print();
}

async function downloadPdf() {
  updatePreview();
  applyLogoDataUrls();

  const state = getFormState();
  const totals = typeof calcTotals === "function" ? calcTotals(state) : { qtyTotal: 0, total: 0 };
  const filename = `INDU-RO-Invoice-${state.refNo || "draft"}.pdf`;

  showToast("Preparing PDF…");

  // Primary: Pure vector A4 PDF — pixel-perfect on iPhone, Android, and Desktop
  try {
    const blob = buildInvoicePdfBlob(state, totals);
    triggerBlobDownload(blob, filename);
    showToast("PDF downloaded");
  } catch (err) {
    console.warn("Vector PDF failed, trying HTML capture:", err);
    try {
      const blob = await captureInvoiceAsPdfBlob();
      triggerBlobDownload(blob, filename);
      showToast("PDF downloaded");
    } catch (err2) {
      console.error(err2);
      showToast("PDF failed — use Print instead");
    }
  }
}

/**
 * Capture the live #invoice (same UI as print preview).
 */
async function captureInvoiceAsPdfBlob() {
  const el = document.getElementById("invoice");
  if (!el) throw new Error("Invoice missing");

  const viewCreateEl = document.getElementById("viewCreate");
  const wasHidden = viewCreateEl ? viewCreateEl.classList.contains("hidden") : false;
  const prevView = typeof currentView !== "undefined" ? currentView : "dashboard";
  if (wasHidden && typeof showView === "function") showView("create");

  const prevMax = el.style.maxWidth;
  const prevWidth = el.style.width;
  const prevMargin = el.style.margin;
  const prevBorder = el.style.border;
  const prevShadow = el.style.boxShadow;
  const prevRadius = el.style.borderRadius;

  // Match print layout width on A4
  el.style.maxWidth = "780px";
  el.style.width = "780px";
  el.style.margin = "0 auto";
  el.style.border = "none";
  el.style.boxShadow = "none";
  el.style.borderRadius = "0";

  applyLogoDataUrls();
  await waitForImages(el);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    const h2c = window.html2canvas;
    if (typeof h2c !== "function") {
      throw new Error("html2canvas not available — check internet for CDN");
    }

    const canvas = await h2c(el, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#ffffff",
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: el.scrollWidth,
      windowHeight: el.scrollHeight,
      onclone: (doc) => {
        const data = window.INDU_LOGO_DATA;
        const cloneInv = doc.getElementById("invoice");
        if (cloneInv) {
          cloneInv.style.maxWidth = "780px";
          cloneInv.style.width = "780px";
          cloneInv.style.border = "none";
          cloneInv.style.borderTop = "6px solid #0b7fc4";
          cloneInv.style.boxShadow = "none";
          cloneInv.style.borderRadius = "0";
          cloneInv.style.margin = "0";
          cloneInv.style.padding = "24px 30px";
        }
        if (data && data.dataUrl) {
          doc.querySelectorAll(".inv-logo").forEach((img) => {
            img.src = data.dataUrl;
          });
        }
      },
    });

    if (!canvas || !canvas.width) throw new Error("Empty canvas");
    return canvasToA4PdfBlob(canvas);
  } finally {
    el.style.maxWidth = prevMax;
    el.style.width = prevWidth;
    el.style.margin = prevMargin;
    el.style.border = prevBorder;
    el.style.boxShadow = prevShadow;
    el.style.borderRadius = prevRadius;
    if (wasHidden) showView(prevView || "dashboard");
  }
}

function canvasToA4PdfBlob(canvas) {
  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 24;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;

  let imgW = maxW;
  let imgH = (canvas.height * imgW) / canvas.width;
  if (imgH > maxH) {
    imgH = maxH;
    imgW = (canvas.width * imgH) / canvas.height;
  }

  const x = (pageW - imgW) / 2;
  const y = pageH - margin - imgH;
  const jpegBytes = dataUrlToUint8Array(canvas.toDataURL("image/jpeg", 0.95));

  const stream = [
    "1 1 1 rg 0 0 595.28 841.89 re f",
    `q ${imgW.toFixed(2)} 0 0 ${imgH.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im1 Do Q`,
  ].join("\n");

  return assembleImagePdf(stream, jpegBytes, canvas.width, canvas.height, pageW, pageH);
}

function assembleImagePdf(stream, jpegBytes, imgW, imgH, pageW, pageH) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [0];

  function push(data) {
    chunks.push(typeof data === "string" ? enc.encode(data) : data);
  }
  function off() {
    return chunks.reduce((n, c) => n + c.length, 0);
  }
  function obj(text) {
    offsets.push(off());
    push(text);
  }

  const streamBytes = enc.encode(stream);
  push("%PDF-1.4\n");
  obj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  obj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  obj(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>\nendobj\n`
  );
  offsets.push(off());
  push(`4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
  push(streamBytes);
  push("\nendstream\nendobj\n");
  offsets.push(off());
  push(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  push(jpegBytes);
  push("\nendstream\nendobj\n");

  const xrefPos = off();
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  push(xref);
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);
  return new Blob(chunks, { type: "application/pdf" });
}

const HELVETICA_CHAR_WIDTHS = {
  " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
  "A": 667, "B": 667, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778, "H": 722, "I": 278,
  "J": 500, "K": 667, "L": 556, "M": 833, "N": 722, "O": 722, "P": 667, "Q": 722, "R": 667,
  "S": 667, "T": 611, "U": 722, "V": 667, "W": 944, "X": 667, "Y": 667, "Z": 611,
  "[": 278, "\\": 278, "]": 278, "^": 469, "_": 556, "`": 222,
  "a": 556, "b": 556, "c": 500, "d": 556, "e": 556, "f": 278, "g": 556, "h": 556, "i": 222,
  "j": 222, "k": 500, "l": 222, "m": 833, "n": 556, "o": 556, "p": 556, "q": 556, "r": 333,
  "s": 500, "t": 278, "u": 556, "v": 500, "w": 722, "x": 500, "y": 500, "z": 500,
  "{": 334, "|": 260, "}": 334, "~": 584
};

function getPdfTextWidth(str, size) {
  let w = 0;
  for (let ch of String(str)) {
    w += (HELVETICA_CHAR_WIDTHS[ch] || 550);
  }
  return (w / 1000) * size;
}

/**
 * Exact Tax Invoice vector layout matching print preview on standard A4 (595 x 842 pt).
 * Immune to mobile screen width constraints, ensuring pixel-perfect alignment on iPhone.
 */
function buildInvoicePdfBlob(state, totals) {
  const pageW = 595.28;
  const pageH = 841.89;
  const m = 36;
  const L = m;
  const R = pageW - m;
  const W = R - L;
  const filled = (state.items || []).filter((it) => it.name || it.qty || it.price);
  const ops = [];

  let logoBytes = null;
  let logoPixelW = 0;
  let logoPixelH = 0;
  let drawLogoW = 0;
  let drawLogoH = 0;
  const logoData = window.INDU_LOGO_DATA;

  if (logoData && logoData.dataUrl && String(logoData.mime || "").includes("jpeg")) {
    try {
      logoBytes = dataUrlToUint8Array(logoData.dataUrl);
      const size = readJpegSize(logoBytes);
      logoPixelW = size.width;
      logoPixelH = size.height;
      const max = 70;
      const scale = Math.min(max / size.width, max / size.height);
      drawLogoW = Math.round(size.width * scale);
      drawLogoH = Math.round(size.height * scale);
    } catch (e) {
      logoBytes = null;
    }
  }

  // Top accent bar (#0b7fc4)
  ops.push(`${rgb(11, 127, 196)} rg`);
  ops.push(`0 ${pageH - 6} ${pageW} 6 re f`);

  // Left Header Text
  let y = pageH - 34;

  ops.push("BT");
  ops.push(`/F2 8 Tf ${rgb(11, 127, 196)} rg`);
  ops.push(`1 0 0 1 ${L} ${y} Tm (${pdfEscape("TAX INVOICE")}) Tj`);
  ops.push("ET");

  y -= 18;
  ops.push("BT");
  ops.push(`/F2 16 Tf ${rgb(29, 42, 53)} rg`);
  ops.push(`1 0 0 1 ${L} ${y} Tm (${pdfEscape("INDU RO SERVICE")}) Tj`);
  ops.push("ET");

  y -= 14;
  ops.push("BT");
  ops.push(`/F1 9 Tf ${rgb(107, 122, 136)} rg`);
  ops.push(`1 0 0 1 ${L} ${y} Tm (${pdfEscape("RO Water Purifier Sales & Service")}) Tj`);
  ops.push("ET");

  y -= 14;
  ops.push("BT");
  ops.push(`/F2 9.5 Tf ${rgb(11, 127, 196)} rg`);
  ops.push(`1 0 0 1 ${L} ${y} Tm (${pdfEscape("7904015662 | 6382182592")}) Tj`);
  ops.push("ET");

  // Logo Right Alignment:
  // Positioned in top-right corner, level with TAX INVOICE header
  if (logoBytes) {
    const lx = R - drawLogoW;
    const logoTop = pageH - 32;
    const ly = logoTop - drawLogoH;
    ops.push(`q ${drawLogoW} 0 0 ${drawLogoH} ${lx.toFixed(2)} ${ly.toFixed(2)} cm /Im1 Do Q`);
  }

  // Meta Section Box (placed cleanly 22pt below the logo with zero overlap)
  const metaBoxH = 82;
  const boxTop = 716;
  const boxBottom = boxTop - metaBoxH;

  ops.push(`${rgb(247, 250, 252)} rg`);
  ops.push(`${L} ${boxBottom} ${W} ${metaBoxH} re f`);
  ops.push(`${rgb(219, 230, 238)} RG 0.8 w`);
  ops.push(`${L} ${boxBottom} ${W} ${metaBoxH} re S`);

  const metaL = L + 14;
  const metaR = R - 135;
  let my = boxTop - 15;

  // BILL TO & INVOICE NO
  ops.push("BT");
  ops.push(`/F2 7.5 Tf ${rgb(11, 127, 196)} rg`);
  ops.push(`1 0 0 1 ${metaL} ${my} Tm (${pdfEscape("BILL TO")}) Tj`);
  ops.push(`1 0 0 1 ${metaR} ${my} Tm (${pdfEscape("INVOICE NO")}) Tj`);
  ops.push("ET");

  // Customer Name & Ref No
  my -= 13;
  ops.push("BT");
  ops.push(`/F2 11 Tf ${rgb(29, 42, 53)} rg`);
  ops.push(`1 0 0 1 ${metaL} ${my} Tm (${pdfEscape(state.customerName || "-")}) Tj`);
  ops.push(`1 0 0 1 ${metaR} ${my} Tm (${pdfEscape(String(state.refNo || "-"))}) Tj`);
  ops.push("ET");

  // Phone & DATE OF ISSUE
  my -= 13;
  ops.push("BT");
  ops.push(`/F2 9.5 Tf ${rgb(11, 127, 196)} rg`);
  ops.push(`1 0 0 1 ${metaL} ${my} Tm (${pdfEscape(state.customerPhone || "-")}) Tj`);
  ops.push(`/F2 7.5 Tf ${rgb(11, 127, 196)} rg`);
  ops.push(`1 0 0 1 ${metaR} ${my} Tm (${pdfEscape("DATE OF ISSUE")}) Tj`);
  ops.push("ET");

  // Date value
  my -= 12;
  ops.push("BT");
  ops.push(`/F2 9.5 Tf ${rgb(29, 42, 53)} rg`);
  ops.push(`1 0 0 1 ${metaR} ${my} Tm (${pdfEscape(formatDateDisplay(state.issueDate))}) Tj`);
  ops.push("ET");

  // PAYMENT label
  my -= 12;
  ops.push("BT");
  ops.push(`/F2 7.5 Tf ${rgb(11, 127, 196)} rg`);
  ops.push(`1 0 0 1 ${metaR} ${my} Tm (${pdfEscape("PAYMENT")}) Tj`);
  ops.push("ET");

  // Payment mode value
  my -= 10;
  ops.push("BT");
  ops.push(`/F1 8.5 Tf ${rgb(29, 42, 53)} rg`);
  ops.push(`1 0 0 1 ${metaR} ${my} Tm (${pdfEscape(state.paymentMode || "Paid - UPI / Cash")}) Tj`);
  ops.push("ET");

  // Table setup
  y = boxBottom - 18;
  const colSr = L + 8;
  const colName = L + 28;
  const colWarr = L + 195;
  const colQty = R - 150;
  const colPrice = R - 75;
  const colAmt = R - 8;

  const rightText = (xRight, ty, text, size, bold, colorRgb) => {
    const w = getPdfTextWidth(text, size);
    ops.push("BT");
    ops.push(`${bold ? "/F2" : "/F1"} ${size} Tf ${colorRgb || rgb(29, 42, 53)} rg`);
    ops.push(`1 0 0 1 ${(xRight - w).toFixed(1)} ${ty} Tm (${pdfEscape(text)}) Tj`);
    ops.push("ET");
  };

  // Table Header Bar
  ops.push(`${rgb(234, 245, 252)} rg`);
  ops.push(`${L} ${y - 6} ${W} 20 re f`);
  ops.push("BT /F2 8 Tf");
  ops.push(`${rgb(68, 88, 106)} rg`);
  ops.push(`1 0 0 1 ${colSr} ${y} Tm (#) Tj`);
  ops.push(`1 0 0 1 ${colName} ${y} Tm (Item) Tj`);
  ops.push(`1 0 0 1 ${colWarr} ${y} Tm (Warranty) Tj`);
  ops.push("ET");
  rightText(colQty, y, "Qty", 8, true, rgb(68, 88, 106));
  rightText(colPrice, y, "Price (Rs)", 8, true, rgb(68, 88, 106));
  rightText(colAmt, y, "Amount (Rs)", 8, true, rgb(68, 88, 106));

  y -= 22;

  if (!filled.length) {
    ops.push("BT /F1 9.5 Tf");
    ops.push(`${rgb(107, 122, 136)} rg`);
    ops.push(`1 0 0 1 ${colName} ${y} Tm (No products added) Tj`);
    ops.push("ET");
    y -= 18;
  } else {
    filled.forEach((it, i) => {
      if (y < 120) return;
      const amount = parseNum(it.qty) * parseNum(it.price);
      const name = String(it.name || "-").substring(0, 32);
      const warr = String(it.warranty || "-").substring(0, 16);

      ops.push("BT /F1 9.5 Tf");
      ops.push(`${rgb(29, 42, 53)} rg`);
      ops.push(`1 0 0 1 ${colSr} ${y} Tm (${pdfEscape(String(i + 1))}) Tj`);
      ops.push(`1 0 0 1 ${colName} ${y} Tm (${pdfEscape(name)}) Tj`);
      ops.push("ET");

      ops.push("BT /F2 8.5 Tf");
      ops.push(`${rgb(10, 122, 70)} rg`);
      ops.push(`1 0 0 1 ${colWarr} ${y} Tm (${pdfEscape(warr)}) Tj`);
      ops.push("ET");

      rightText(colQty, y, formatQty(it.qty), 9.5, false);
      rightText(colPrice, y, formatMoney(it.price), 9.5, false);
      rightText(colAmt, y, formatMoney(amount), 9.5, false);

      // Sublines (Serial no / Valid till)
      if (it.serialNo || it.validTill) {
        y -= 11;
        ops.push("BT /F1 7.5 Tf");
        ops.push(`${rgb(107, 122, 136)} rg`);
        if (it.serialNo) {
          ops.push(`1 0 0 1 ${colName} ${y} Tm (${pdfEscape("Serial no: " + it.serialNo)}) Tj`);
        }
        if (it.validTill) {
          ops.push(`1 0 0 1 ${colWarr} ${y} Tm (${pdfEscape("Valid till " + it.validTill)}) Tj`);
        }
        ops.push("ET");
      }

      ops.push(`${rgb(219, 230, 238)} RG 0.5 w`);
      ops.push(`${L} ${y - 4} m ${R} ${y - 4} l S`);

      y -= 17;
    });
  }

  // Total row
  ops.push(`${rgb(234, 245, 252)} rg`);
  ops.push(`${L} ${y - 6} ${W} 18 re f`);
  ops.push("BT /F2 9.5 Tf");
  ops.push(`${rgb(29, 42, 53)} rg`);
  ops.push(`1 0 0 1 ${colName} ${y} Tm (Total) Tj`);
  ops.push("ET");
  rightText(colQty, y, formatQty(totals.qtyTotal), 9.5, true);

  // Grand Total row
  y -= 18;
  ops.push(`${rgb(234, 245, 252)} rg`);
  ops.push(`${L} ${y - 6} ${W} 22 re f`);
  rightText(colPrice - 10, y, "Grand total", 11, true, rgb(29, 42, 53));
  rightText(colAmt, y, "Rs " + formatMoney(totals.total), 11, true, rgb(29, 42, 53));

  // Amount in words
  y -= 22;
  const wordsText = typeof numberToWordsIndian === "function" ? numberToWordsIndian(totals.total) : "";
  ops.push("BT /F1 8.5 Tf");
  ops.push(`${rgb(107, 122, 136)} rg`);
  ops.push(`1 0 0 1 ${L} ${y} Tm (${pdfEscape("Amount in words: " + wordsText)}) Tj`);
  ops.push("ET");

  if (state.notes) {
    y -= 16;
    ops.push("BT /F1 8.5 Tf");
    ops.push(`${rgb(84, 110, 122)} rg`);
    ops.push(
      `1 0 0 1 ${L} ${y} Tm (${pdfEscape("Notes: " + String(state.notes).substring(0, 90))}) Tj`
    );
    ops.push("ET");
  }

  // Footer
  ops.push(`${rgb(219, 230, 238)} RG 0.6 w`);
  ops.push("[2.5 2] 0 d");
  ops.push(`${L} 56 m ${R} 56 l S`);
  ops.push("[] 0 d");

  const thanks = "Thanks for doing business with us!";
  const tw = getPdfTextWidth(thanks, 9.5);
  const tx = ((pageW - tw) / 2).toFixed(1);
  ops.push("BT /F1 9.5 Tf");
  ops.push(`${rgb(107, 122, 136)} rg`);
  ops.push(`1 0 0 1 ${tx} 38 Tm (${pdfEscape(thanks)}) Tj`);
  ops.push("ET");

  return assembleDesignPdf(ops.join("\n"), logoBytes, logoPixelW, logoPixelH, pageW, pageH);
}

function assembleDesignPdf(stream, logoBytes, logoPixelW, logoPixelH, pageW, pageH) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [0];

  function push(data) {
    chunks.push(typeof data === "string" ? enc.encode(data) : data);
  }
  function off() {
    return chunks.reduce((n, c) => n + c.length, 0);
  }
  function obj(text) {
    offsets.push(off());
    push(text);
  }

  push("%PDF-1.4\n");
  obj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  obj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");

  const resources = logoBytes
    ? "<< /Font << /F1 5 0 R /F2 6 0 R >> /XObject << /Im1 7 0 R >> >>"
    : "<< /Font << /F1 5 0 R /F2 6 0 R >> >>";

  obj(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources ${resources} >>\nendobj\n`
  );

  const streamBytes = enc.encode(stream);
  offsets.push(off());
  push(`4 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n`);
  push(streamBytes);
  push("\nendstream\nendobj\n");

  obj("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  obj("6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n");

  if (logoBytes) {
    offsets.push(off());
    push(
      `7 0 obj\n<< /Type /XObject /Subtype /Image /Width ${logoPixelW} /Height ${logoPixelH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoBytes.length} >>\nstream\n`
    );
    push(logoBytes);
    push("\nendstream\nendobj\n");
  }

  const xrefPos = off();
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    xref += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  push(xref);
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);
  return new Blob(chunks, { type: "application/pdf" });
}

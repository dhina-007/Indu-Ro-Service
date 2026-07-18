/**
 * Download PDF = exact same Tax Invoice UI as Print.
 */

function pdfEscape(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function triggerBlobDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
  const filename = `INDU-RO-Invoice-${state.refNo || "draft"}.pdf`;

  showToast("Preparing PDF…");

  try {
    const blob = await captureInvoiceAsPdfBlob();
    triggerBlobDownload(blob, filename);
    showToast("PDF downloaded");
  } catch (err) {
    console.warn("Capture failed, using matching layout PDF:", err);
    try {
      const blob = buildInvoicePdfBlob(state, calcTotals(state));
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

  const wasHidden = els.viewCreate.classList.contains("hidden");
  const prevView = currentView;
  if (wasHidden) showView("create");

  const prevMax = el.style.maxWidth;
  const prevWidth = el.style.width;
  const prevMargin = el.style.margin;
  const prevBorder = el.style.border;
  const prevShadow = el.style.boxShadow;
  const prevRadius = el.style.borderRadius;

  // Match print layout width on A4
  el.style.maxWidth = "720px";
  el.style.width = "720px";
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
          cloneInv.style.maxWidth = "720px";
          cloneInv.style.width = "720px";
          cloneInv.style.border = "none";
          cloneInv.style.boxShadow = "none";
          cloneInv.style.borderRadius = "0";
          cloneInv.style.margin = "0";
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

/**
 * Fallback — same Tax Invoice layout as print (no Grand Total / signature).
 */
function buildInvoicePdfBlob(state, totals) {
  const pageW = 595;
  const pageH = 842;
  const m = 40;
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
      const max = 72;
      const scale = Math.min(max / size.width, max / size.height);
      drawLogoW = Math.round(size.width * scale);
      drawLogoH = Math.round(size.height * scale);
    } catch (e) {
      logoBytes = null;
    }
  }

  // Top accent (light blue bar)
  ops.push(`${rgb(79, 195, 247)} rg`);
  ops.push(`0 ${pageH - 14} ${pageW} 14 re f`);

  // Header bg
  ops.push(`${rgb(247, 251, 254)} rg`);
  ops.push(`0 ${pageH - 118} ${pageW} 104 re f`);

  let y = pageH - 36;

  ops.push("BT");
  ops.push(`/F2 8 Tf ${rgb(2, 136, 209)} rg`);
  ops.push(`1 0 0 1 ${L} ${y} Tm (${pdfEscape("TAX INVOICE")}) Tj`);
  ops.push("ET");

  y -= 18;
  ops.push("BT");
  ops.push(`/F2 16 Tf ${rgb(55, 71, 79)} rg`);
  ops.push(`1 0 0 1 ${L} ${y} Tm (${pdfEscape("INDU RO SERVICE")}) Tj`);
  ops.push("ET");

  y -= 14;
  ops.push("BT");
  ops.push(`/F1 9 Tf ${rgb(144, 164, 174)} rg`);
  ops.push(`1 0 0 1 ${L} ${y} Tm (${pdfEscape("RO Water Purifier Sales & Service")}) Tj`);
  ops.push("ET");

  y -= 14;
  ops.push("BT");
  ops.push(`/F2 9 Tf ${rgb(2, 136, 209)} rg`);
  ops.push(`1 0 0 1 ${L} ${y} Tm (${pdfEscape("7904015662 | 6382182592")}) Tj`);
  ops.push("ET");

  if (logoBytes) {
    const lx = R - drawLogoW;
    const ly = pageH - 40 - drawLogoH;
    ops.push(`q ${drawLogoW} 0 0 ${drawLogoH} ${lx} ${ly} cm /Im1 Do Q`);
  }

  // Divider under header
  ops.push(`${rgb(179, 229, 252)} RG 0.8 w`);
  ops.push(`${L} ${pageH - 118} m ${R} ${pageH - 118} l S`);

  // Bill To / Refs
  y = pageH - 140;
  ops.push("BT");
  ops.push(`/F2 8 Tf ${rgb(2, 136, 209)} rg`);
  ops.push(`1 0 0 1 ${L} ${y} Tm (${pdfEscape("BILL TO")}) Tj`);
  ops.push(`1 0 0 1 ${R - 120} ${y} Tm (${pdfEscape("REF NO")}) Tj`);
  ops.push("ET");

  y -= 15;
  ops.push("BT");
  ops.push(`/F2 12 Tf ${rgb(55, 71, 79)} rg`);
  ops.push(`1 0 0 1 ${L} ${y} Tm (${pdfEscape(state.customerName || "-")}) Tj`);
  ops.push(`1 0 0 1 ${R - 120} ${y} Tm (${pdfEscape(String(state.refNo || "-"))}) Tj`);
  ops.push("ET");

  y -= 14;
  ops.push("BT");
  ops.push(`/F2 9 Tf ${rgb(2, 136, 209)} rg`);
  ops.push(`1 0 0 1 ${L} ${y} Tm (${pdfEscape(state.customerPhone || "-")}) Tj`);
  ops.push(`/F2 8 Tf ${rgb(2, 136, 209)} rg`);
  ops.push(`1 0 0 1 ${R - 120} ${y + 14} Tm (${pdfEscape("DATE OF ISSUE")}) Tj`);
  ops.push(`/F2 12 Tf ${rgb(55, 71, 79)} rg`);
  ops.push(`1 0 0 1 ${R - 120} ${y} Tm (${pdfEscape(formatDateDisplay(state.issueDate))}) Tj`);
  ops.push("ET");

  // Table
  y -= 28;
  const colSr = L + 8;
  const colName = L + 36;
  const colQty = R - 160;
  const colPrice = R - 95;
  const colAmt = R - 8;

  const rightText = (xRight, ty, text, size, bold) => {
    const approx = String(text).length * size * 0.5;
    ops.push("BT");
    ops.push(`${bold ? "/F2" : "/F1"} ${size} Tf ${rgb(55, 71, 79)} rg`);
    ops.push(`1 0 0 1 ${(xRight - approx).toFixed(1)} ${ty} Tm (${pdfEscape(text)}) Tj`);
    ops.push("ET");
  };

  ops.push(`${rgb(227, 242, 253)} rg`);
  ops.push(`${L} ${y - 7} ${W} 22 re f`);
  ops.push("BT /F2 8 Tf");
  ops.push(`${rgb(84, 110, 122)} rg`);
  ops.push(`1 0 0 1 ${colSr} ${y} Tm (SR) Tj`);
  ops.push(`1 0 0 1 ${colName} ${y} Tm (NAME) Tj`);
  ops.push("ET");
  rightText(colQty, y, "QTY", 8, true);
  rightText(colPrice, y, "PRICE", 8, true);
  rightText(colAmt, y, "AMOUNT", 8, true);

  y -= 24;

  if (!filled.length) {
    ops.push("BT /F1 10 Tf");
    ops.push(`${rgb(158, 158, 158)} rg`);
    ops.push(`1 0 0 1 ${colName} ${y} Tm (No products added) Tj`);
    ops.push("ET");
    y -= 18;
  } else {
    filled.forEach((it, i) => {
      if (y < 120) return;
      const amount = parseNum(it.qty) * parseNum(it.price);
      const name = String(it.name || "-").substring(0, 40);
      ops.push("BT /F1 10 Tf");
      ops.push(`${rgb(66, 66, 66)} rg`);
      ops.push(`1 0 0 1 ${colSr} ${y} Tm (${pdfEscape(String(i + 1))}) Tj`);
      ops.push(`1 0 0 1 ${colName} ${y} Tm (${pdfEscape(name)}) Tj`);
      ops.push("ET");
      rightText(colQty, y, formatQty(it.qty), 10, false);
      rightText(colPrice, y, formatMoney(it.price), 10, false);
      rightText(colAmt, y, formatMoney(amount), 10, false);
      y -= 18;
    });
  }

  // Total row only
  y -= 4;
  ops.push(`${rgb(227, 242, 253)} rg`);
  ops.push(`${L} ${y - 8} ${W} 24 re f`);
  ops.push("BT /F2 11 Tf");
  ops.push(`${rgb(55, 71, 79)} rg`);
  ops.push(`1 0 0 1 ${colName} ${y} Tm (Total) Tj`);
  ops.push("ET");
  rightText(colQty, y, formatQty(totals.qtyTotal), 11, true);
  rightText(colAmt, y, formatMoney(totals.total), 11, true);

  if (state.notes) {
    y -= 30;
    ops.push("BT /F1 9 Tf");
    ops.push(`${rgb(96, 125, 139)} rg`);
    ops.push(
      `1 0 0 1 ${L} ${y} Tm (${pdfEscape("Notes: " + String(state.notes).substring(0, 90))}) Tj`
    );
    ops.push("ET");
  }

  // Footer
  ops.push(`${rgb(176, 190, 197)} RG 0.6 w`);
  ops.push("[2.5 2] 0 d");
  ops.push(`${L} 70 m ${R} 70 l S`);
  ops.push("[] 0 d");

  const thanks = "Thanks for doing business with us!";
  const tw = thanks.length * 10 * 0.42;
  ops.push("BT /F1 10 Tf");
  ops.push(`${rgb(158, 158, 158)} rg`);
  ops.push(`1 0 0 1 ${((pageW - tw) / 2).toFixed(1)} 48 Tm (${pdfEscape(thanks)}) Tj`);
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

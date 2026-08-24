/**
 * Build a styled .xlsx workbook from a serialized report, matching the
 * PDF/print design: a "Kalayaan Ward Stewardship" header, the report title and date, an
 * optional subtitle, a bold filled header row, colour-coded data cells
 * (attendance tiers, temple-recommend status, the attendance grid), and a
 * confidential footer. The file opens with its formatting intact in Google
 * Sheets (drag into Drive, or File → Import) and in Excel.
 *
 * The payload comes from the browser, serialized off the exact table the
 * user is looking at, so the sheet mirrors the current filter, sort,
 * columns and colours — the same view the PDF prints.
 */
const ExcelJS = require("exceljs");

// App palette (echoes public/style.css tokens), as ARGB for Excel.
const INK = "FF23262A";
const INK_SOFT = "FF5E6167";
const INK_FAINT = "FF8B8D8F";
const PAPER = "FFE4E2D9";
const WHITE = "FFFFFFFF";

// A 6-hex (or rgb-ish) colour from the browser → ARGB, or null if none.
function toArgb(hex) {
  if (!hex) return null;
  const h = String(hex).replace(/^#/, "").trim();
  if (/^[0-9a-fA-F]{6}$/.test(h)) return "FF" + h.toUpperCase();
  if (/^[0-9a-fA-F]{8}$/.test(h)) return h.toUpperCase();
  return null;
}

function safeSheetName(name) {
  // Excel sheet names: <=31 chars, none of : \ / ? * [ ]
  const clean = String(name || "Report").replace(/[:\\/?*[\]]/g, " ").trim() || "Report";
  return clean.slice(0, 31);
}

async function buildWorkbook(payload) {
  const p = payload || {};
  const columns = Array.isArray(p.columns) ? p.columns : [];
  const rows = Array.isArray(p.rows) ? p.rows : [];
  const nCols = Math.max(1, columns.length);
  const lastColLetter = colLetter(nCols);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Kalayaan Stewardship";
  wb.created = new Date();
  const title = p.title || "Report";
  const ws = wb.addWorksheet(safeSheetName(title), {
    views: [{ state: "frozen", ySplit: 0 }], // header freeze set after we know the row
  });

  let r = 1;
  const mergeAcross = (row) => ws.mergeCells(`A${row}:${lastColLetter}${row}`);

  // Title
  mergeAcross(r);
  const titleCell = ws.getCell(`A${r}`);
  titleCell.value = title;
  titleCell.font = { name: "Georgia", size: 16, bold: true, color: { argb: INK } };
  titleCell.alignment = { vertical: "middle" };
  ws.getRow(r).height = 22;
  r += 1;

  // Ward · date
  mergeAcross(r);
  const metaCell = ws.getCell(`A${r}`);
  const meta = [p.ward, p.date].filter(Boolean).join("  ·  ");
  metaCell.value = meta;
  metaCell.font = { name: "Arial", size: 10, color: { argb: INK_SOFT } };
  r += 1;

  // Optional subtitle (custom-report description / query summary)
  if (p.subtitle) {
    mergeAcross(r);
    const sub = ws.getCell(`A${r}`);
    sub.value = p.subtitle;
    sub.font = { name: "Arial", size: 9, italic: true, color: { argb: INK_FAINT } };
    r += 1;
  }

  r += 1; // blank spacer row

  // Header row
  const headerRow = r;
  columns.forEach((label, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = label;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: false };
  });
  ws.getRow(headerRow).height = 18;
  r += 1;

  // Data rows
  const maxLen = columns.map((c) => String(c || "").length);
  for (const row of rows) {
    const cells = Array.isArray(row.cells) ? row.cells : [];
    for (let i = 0; i < nCols; i++) {
      const c = cells[i] || {};
      const cell = ws.getCell(r, i + 1);
      cell.value = c.v == null ? "" : c.v;
      const bg = toArgb(c.bg);
      const fg = toArgb(c.fg);
      const font = { name: "Arial", size: 10 };
      if (fg) font.color = { argb: fg };
      if (c.bold) font.bold = true;
      cell.font = font;
      if (bg) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      cell.alignment = {
        vertical: "middle",
        horizontal: c.align === "right" ? "right" : c.align === "center" ? "center" : "left",
      };
      const len = String(cell.value).length;
      if (len > (maxLen[i] || 0)) maxLen[i] = len;
    }
    r += 1;
  }

  // Confidential footer
  r += 1;
  mergeAcross(r);
  const foot = ws.getCell(`A${r}`);
  foot.value = p.footer || "Confidential membership records.";
  foot.font = { name: "Arial", size: 8, italic: true, color: { argb: INK_SOFT } };

  // Column widths: fit content, but keep the grid columns of the attendance
  // roll narrow (short headers, single-char cells).
  ws.columns.forEach((col, i) => {
    const len = maxLen[i] || 4;
    col.width = Math.min(Math.max(len + 2, 4), 42);
  });

  // Freeze the header row and turn on the filter over the data.
  ws.views = [{ state: "frozen", ySplit: headerRow }];
  if (rows.length) {
    ws.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow, column: nCols },
    };
  }

  return wb.xlsx.writeBuffer();
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

module.exports = { buildWorkbook, toArgb, colLetter, safeSheetName };

import ExcelJS from "exceljs";

/**
 * Excel (.xlsx) writer and reader for the owner's exports and the member import.
 *
 * Writing lays every sheet out the same way: a bold title, a few grey lines saying what the file
 * covers, then a header row (dark, frozen, filterable), the data, and a bold totals block whose
 * cells are real formulas (with the computed value cached, so previews that don't calculate still
 * show the number). Money is a number formatted as Rupiah, dates are real dates, so sorting and
 * summing in Excel or Google Sheets just works. Text cells are written as text, never parsed as a
 * formula, so a member called "=HYPERLINK(...)" is harmless here without any escaping.
 */

export type ColumnKind = "text" | "money" | "count" | "date";

export interface SheetColumn {
  header: string;
  kind?: ColumnKind;
}

/** A date column takes "YYYY-MM-DD" (a day in the gym's timezone) or "" for none. */
export type SheetCell = string | number | null;

/** A totals cell: plain text, or a sum over the data rows of this column, optionally only where other columns match. */
export type TotalCell =
  | SheetCell
  | { sum: true; where?: { column: number; equals: string[] }[] };

export interface TotalRow {
  label: string;
  cells?: Partial<Record<number, TotalCell>>;
  /** The final, bold "grand total" line; other total rows are lighter subtotals. */
  strong?: boolean;
}

export interface SheetSpec {
  /** Tab name (Excel caps it at 31 characters). */
  name: string;
  title: string;
  /** Grey lines under the title: gym, period, when it was made. */
  info?: string[];
  columns: SheetColumn[];
  rows: SheetCell[][];
  totals?: TotalRow[];
}

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const MONEY_FORMAT = '"Rp "#,##0;[Red]-"Rp "#,##0';
const COUNT_FORMAT = "#,##0";
const DATE_FORMAT = "dd mmm yyyy";
const HEADER_FILL = "FF1F2937";
const TOTAL_FILL = "FFF3F4F6";
const STRONG_FILL = "FFE5E7EB";
const BAND_FILL = "FFF9FAFB";
const GRID = { style: "thin" as const, color: { argb: "FFE5E7EB" } };

function toDate(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

function colLetter(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellValue(value: SheetCell, kind: ColumnKind): ExcelJS.CellValue {
  if (value === null || value === "") return null;
  if (kind === "date" && typeof value === "string") return toDate(value) ?? value;
  if ((kind === "money" || kind === "count") && typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

/** Characters a cell shows, for sizing its column. */
function displayLength(value: SheetCell, kind: ColumnKind): number {
  if (value === null) return 0;
  if (kind === "date") return 11;
  if (kind === "money" && typeof value === "number") return `Rp ${Math.round(Math.abs(value)).toLocaleString("en-US")}`.length + (value < 0 ? 1 : 0);
  if (kind === "count" && typeof value === "number") return value.toLocaleString("en-US").length;
  return String(value).length;
}

function addSheet(wb: ExcelJS.Workbook, spec: SheetSpec) {
  const ws = wb.addWorksheet(spec.name.slice(0, 31), {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    views: [{ showGridLines: false }],
  });
  const kinds = spec.columns.map((c) => c.kind ?? "text");
  const width = spec.columns.length;

  const title = ws.addRow([spec.title]);
  title.font = { bold: true, size: 14 };
  title.height = 22;
  for (const line of spec.info ?? []) ws.addRow([line]).font = { size: 10, color: { argb: "FF6B7280" } };
  ws.addRow([]);

  const header = ws.addRow(spec.columns.map((c) => c.header));
  header.height = 20;
  header.eachCell((cell, n) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: kinds[n - 1] === "money" || kinds[n - 1] === "count" ? "right" : "left" };
  });
  const headerRow = header.number;

  spec.rows.forEach((r, i) => {
    const row = ws.addRow(r.map((v, c) => cellValue(v, kinds[c] ?? "text")));
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c);
      const kind = kinds[c - 1];
      if (kind === "money") cell.numFmt = MONEY_FORMAT;
      else if (kind === "count") cell.numFmt = COUNT_FORMAT;
      else if (kind === "date") cell.numFmt = DATE_FORMAT;
      cell.border = { bottom: GRID };
      if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILL } };
    }
  });
  const firstData = headerRow + 1;
  const lastData = headerRow + spec.rows.length;

  if (spec.rows.length === 0) {
    ws.addRow(["Nothing in this period."]).font = { italic: true, color: { argb: "FF6B7280" } };
  }

  if (spec.totals?.length) {
    ws.addRow([]);
    spec.totals.forEach((t, ti) => {
      const values: ExcelJS.CellValue[] = Array.from({ length: width }, () => null);
      values[0] = t.label;
      for (const [key, total] of Object.entries(t.cells ?? {})) {
        const c = Number(key);
        if (total === undefined) continue;
        if (total !== null && typeof total === "object") {
          const range = (col: number) => `${colLetter(col)}${firstData}:${colLetter(col)}${Math.max(lastData, firstData)}`;
          const conditions = total.where ?? [];
          // One SUMIFS per combination of allowed values, added up: works in Excel, Google Sheets and LibreOffice alike.
          const combos = conditions.reduce<{ column: number; value: string }[][]>(
            (acc, cond) => acc.flatMap((combo) => cond.equals.map((v) => [...combo, { column: cond.column, value: v }])),
            [[]],
          );
          const formula = conditions.length === 0
            ? `SUM(${range(c)})`
            : combos.map((combo) => `SUMIFS(${range(c)},${combo.map((x) => `${range(x.column)},"${x.value.replace(/"/g, '""')}"`).join(",")})`).join("+");
          const result = spec.rows.reduce((sum, r) => {
            const ok = conditions.every((cond) => cond.equals.includes(String(r[cond.column] ?? "")));
            const v = Number(r[c]);
            return ok && Number.isFinite(v) ? sum + v : sum;
          }, 0);
          // exceljs leaves out a cached result of 0, which previews then show as blank: write a plain 0 instead.
          values[c] = result === 0 ? 0 : { formula, result };
        } else {
          values[c] = cellValue(total, kinds[c] ?? "text");
        }
      }
      const row = ws.addRow(values);
      const strong = t.strong ?? ti === spec.totals!.length - 1;
      for (let c = 1; c <= width; c++) {
        const cell = row.getCell(c);
        const kind = kinds[c - 1];
        if (kind === "money") cell.numFmt = MONEY_FORMAT;
        else if (kind === "count") cell.numFmt = COUNT_FORMAT;
        cell.font = { bold: strong };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: strong ? STRONG_FILL : TOTAL_FILL } };
        if (strong) cell.border = { top: { style: "thin" }, bottom: { style: "double" } };
      }
    });
  }

  spec.columns.forEach((_, i) => {
    const col = ws.getColumn(i + 1);
    const kind = kinds[i];
    const longest = Math.max(
      spec.columns[i]?.header.length ?? 0,
      ...spec.rows.map((r) => displayLength(r[i] ?? null, kind)),
      // Total labels aren't counted: they spill into the empty cells beside them, so a long one doesn't widen the first column.
      kind === "money" ? 14 : 0,
    );
    col.width = Math.min(Math.max(longest + 2, 8), 48);
  });

  ws.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];
  if (spec.rows.length > 0) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: lastData, column: width } };
}

export async function buildXlsx(sheets: SheetSpec[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Liftmora";
  wb.calcProperties.fullCalcOnLoad = true;
  wb.created = new Date();
  for (const s of sheets) addSheet(wb, s);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  // A plain ArrayBuffer is what a Response body takes.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) return "result" in value ? cellText(value.result as ExcelJS.CellValue) : "";
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return String(value.text);
    if ("error" in value) return "";
  }
  return String(value);
}

/** The first sheet of an .xlsx as rows of text. Blank rows stay as empty arrays, so index + 1 is the row number Excel shows. */
export async function readXlsxRows(data: ArrayBuffer | Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value).trim());
    while (rows.length < row.number - 1) rows.push([]);
    rows.push(cells);
  });
  return rows;
}

/** An .xlsx starts with the ZIP signature "PK\x03\x04"; a CSV never does. */
export function looksLikeXlsx(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function xlsxHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": XLSX_CONTENT_TYPE,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
}

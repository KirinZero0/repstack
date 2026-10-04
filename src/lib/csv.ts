/**
 * Small CSV reader/writer for member export and import. No dependency: the files are a few
 * hundred rows at most, and the edge cases that matter are Excel's, not RFC 4180's.
 *
 * Reading copes with: a UTF-8 BOM; CRLF or LF; quoted cells with embedded quotes, commas and
 * newlines; and either `,` or `;` as the delimiter (Excel saves CSV with `;` in the Indonesian
 * locale, because `,` is the decimal separator there).
 *
 * Writing adds a BOM so Excel opens the file as UTF-8, and defuses cells that would otherwise be
 * taken as formulas. A cell can be marked `excelText` to survive Excel's number parsing, which is
 * how leading zeros on phone numbers are kept.
 */

export type CsvCell = string | { excelText: string };

/** Excel drops the leading 0 of "0812…" unless the cell is forced to text. `="0812…"` does that in every spreadsheet app. */
export function excelText(value: string): CsvCell {
  return { excelText: value };
}

function escapeCell(cell: CsvCell, delimiter: string): string {
  if (typeof cell !== "string") {
    // Digits and a few phone characters only: anything else would let a crafted value break out of the formula.
    const safe = cell.excelText.replace(/[^\d+\-\s()]/g, "");
    return `="${safe}"`;
  }
  let v = cell;
  // A spreadsheet treats a leading =, +, -, @ (or a stray tab/CR) as a formula. A member name is never one.
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (v.includes('"') || v.includes(delimiter) || /[\r\n]/.test(v)) {
    v = `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function toCsv(rows: CsvCell[][], delimiter = ","): string {
  const body = rows.map((r) => r.map((c) => escapeCell(c, delimiter)).join(delimiter)).join("\r\n");
  return `﻿${body}\r\n`;
}

/** Picks `;` when the first line has more semicolons than commas (Indonesian-locale Excel), else `,`. */
export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  return semis > commas ? ";" : ",";
}

export function parseCsv(input: string, delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop fully blank lines (trailing newline, spacer rows in a hand-edited sheet).
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Undoes `excelText` (and Excel's own `="…"` text wrapper) when a file is imported back. */
export function unwrapExcelText(value: string): string {
  const m = /^="(.*)"$/.exec(value.trim());
  return m ? m[1] : value;
}

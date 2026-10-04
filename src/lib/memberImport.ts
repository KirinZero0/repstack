import { z } from "zod";
import { parseCsv, unwrapExcelText } from "./csv";
import { normalizePhone } from "./crypto";

/** The columns a member CSV can carry. Export writes them in this order; import accepts them in any order. */
export const MEMBER_CSV_COLUMNS = ["Name", "Email", "Phone", "Plan", "Status", "Paid until", "Activated", "Joined"] as const;

/** Columns import reads. Status, Activated and Joined are export-only: they describe the account, not the person. */
type Field = "fullName" | "email" | "phone" | "plan" | "expiry";

// Header aliases, matched after lowercasing and stripping everything but letters and digits, so
// "No. HP", "no hp" and "NoHP" are the same column. English and Indonesian, since the sheet being
// imported was usually kept by hand.
const HEADER_ALIASES: Record<Field, string[]> = {
  fullName: ["name", "fullname", "nama", "namalengkap", "member", "membername", "namamember", "nama anggota"],
  email: ["email", "emailaddress", "mail", "surel"],
  phone: ["phone", "phonenumber", "whatsapp", "wa", "nowa", "nomorwa", "hp", "nohp", "nomorhp", "telepon", "notelepon", "nomortelepon", "telp", "notelp", "mobile", "phonewhatsapp"],
  plan: ["plan", "planname", "paket", "membership", "membershipplan", "jenismember", "tipemember", "keanggotaan"],
  expiry: ["paiduntil", "expiry", "expires", "expired", "expirydate", "expirationdate", "membershipexpiry", "validuntil", "berlakusampai", "masaaktif", "masaberlaku", "berlakuhingga", "aktifsampai", "jatuhtempo", "sampai"],
};

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function mapHeaders(headerRow: string[]): { columns: Partial<Record<Field, number>>; unknown: string[] } {
  const columns: Partial<Record<Field, number>> = {};
  const unknown: string[] = [];
  headerRow.forEach((raw, i) => {
    const key = normalizeHeader(raw);
    if (!key) return;
    const field = (Object.keys(HEADER_ALIASES) as Field[]).find((f) => HEADER_ALIASES[f].map(normalizeHeader).includes(key));
    if (field && columns[field] === undefined) columns[field] = i;
    else if (!field) unknown.push(raw);
  });
  return { columns, unknown };
}

/**
 * Accepts the dates people actually type: 2026-03-31, 31/03/2026, 31-03-2026, 31.3.2026, 2026/03/31,
 * and an ISO timestamp. Returns YYYY-MM-DD, or null when it can't be read. Day-first is assumed for
 * slashed dates, as everywhere in Indonesia; a US-style 03/31/2026 is caught because 31 isn't a month.
 */
export function parseSheetDate(raw: string): string | null {
  const s = unwrapExcelText(raw).trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (m > 12 && d <= 12) [d, m] = [m, d];
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const rowSchema = z.object({
  fullName: z.string().trim().min(2, "Name is too short").max(120, "Name is too long"),
  email: z.string().trim().email("Not a valid email address"),
  phone: z
    .string()
    .trim()
    .transform(unwrapExcelText)
    .refine((p) => /^\+?[\d\s\-().]+$/.test(p), "Phone number has letters in it")
    .refine((p) => {
      const n = normalizePhone(p).length;
      return n >= 8 && n <= 15;
    }, "Phone number should have 8 to 15 digits"),
  plan: z.string().trim().optional(),
  expiry: z.string().trim().optional(),
});

export interface ParsedRow {
  /** 1-based line in the file, as the person sees it in their spreadsheet (header is line 1). */
  line: number;
  fullName: string;
  email: string;
  phone: string;
  /** Plan name as written in the file; blank means "use the default chosen in the import form". */
  plan: string;
  /** YYYY-MM-DD, or null to use the plan's standard length from today. */
  expiry: string | null;
  error?: string;
}

export interface ParsedSheet {
  rows: ParsedRow[];
  /** Header cells that matched nothing; shown so a typo in "Phone" is obvious instead of silently ignored. */
  unknownColumns: string[];
  missingColumns: string[];
}

export const MAX_IMPORT_ROWS = 1000;

/** Reads a member CSV into validated rows. Problems are attached per row, never thrown: the person sees them all at once. */
export function parseMemberSheet(text: string): ParsedSheet {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], unknownColumns: [], missingColumns: ["Name", "Email", "Phone"] };

  const { columns, unknown } = mapHeaders(table[0]);
  const missing = (["fullName", "email", "phone"] as Field[]).filter((f) => columns[f] === undefined);
  if (missing.length > 0) {
    const label: Record<Field, string> = { fullName: "Name", email: "Email", phone: "Phone", plan: "Plan", expiry: "Paid until" };
    return { rows: [], unknownColumns: unknown, missingColumns: missing.map((f) => label[f]) };
  }

  const cell = (r: string[], f: Field) => (columns[f] === undefined ? "" : (r[columns[f]!] ?? ""));
  const seenEmails = new Map<string, number>();
  const rows: ParsedRow[] = table.slice(1, MAX_IMPORT_ROWS + 1).map((r, i) => {
    const line = i + 2;
    const parsed = rowSchema.safeParse({
      fullName: cell(r, "fullName"),
      email: cell(r, "email"),
      phone: cell(r, "phone"),
      plan: cell(r, "plan"),
      expiry: cell(r, "expiry"),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { line, fullName: cell(r, "fullName").trim(), email: cell(r, "email").trim(), phone: cell(r, "phone").trim(), plan: cell(r, "plan").trim(), expiry: null, error: issue.message };
    }
    const d = parsed.data;
    const row: ParsedRow = { line, fullName: d.fullName, email: d.email, phone: d.phone, plan: d.plan ?? "", expiry: null };
    if (d.expiry) {
      row.expiry = parseSheetDate(d.expiry);
      if (!row.expiry) row.error = `Can't read the date "${d.expiry}" (use 2026-12-31 or 31/12/2026)`;
    }
    const emailKey = d.email.toLowerCase();
    const firstLine = seenEmails.get(emailKey);
    if (firstLine !== undefined) row.error = row.error ?? `Same email as line ${firstLine}`;
    else seenEmails.set(emailKey, line);
    return row;
  });

  return { rows, unknownColumns: unknown, missingColumns: [] };
}

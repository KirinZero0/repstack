import type { PaymentProvider, PaymentStatus } from "@prisma/client";
import type { TenantDb } from "./prisma";
import { dayKeyInTimezone, zonedTimeToUtc } from "./date";
import { monthKey, monthLabel } from "./stats";
import type { CsvCell } from "./csv";

export interface DateRange {
  /** YYYY-MM-DD, inclusive, in the gym's timezone. */
  from: string;
  to: string;
}

/** First day of the current month to today, in the gym's timezone: what an owner most often wants to hand to their bookkeeper. */
export function defaultTransactionsRange(timezone: string, now = new Date()): DateRange {
  const today = dayKeyInTimezone(now, timezone);
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** The last twelve months including this one. */
export function defaultMonthlyRange(timezone: string, now = new Date()): DateRange {
  const today = dayKeyInTimezone(now, timezone);
  const [y, m] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 - 11, 1));
  return { from: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}-01`, to: today };
}

/** The instants that bound the range: the start of `from` and the end of `to`, both as the gym's wall clock. */
export function rangeBounds(range: DateRange, timezone: string): { start: Date; end: Date } {
  return { start: zonedTimeToUtc(`${range.from}T00:00`, timezone), end: zonedTimeToUtc(`${range.to}T23:59:59`, timezone) };
}

const METHOD: Record<PaymentProvider, string> = { CASH: "Cash / transfer at desk", XENDIT: "Online (Xendit)", MIDTRANS: "Online (Midtrans)" };

/** A voided desk payment is stored as FAILED, which reads wrong on a report; online FAILED really did fail. */
function statusLabel(status: PaymentStatus, provider: PaymentProvider): string {
  return status === "FAILED" && provider === "CASH" ? "VOIDED" : status;
}

export const TRANSACTION_COLUMNS = [
  "Date",
  "Type",
  "Member",
  "Item",
  "Amount",
  "Currency",
  "Status",
  "Method",
  "Recorded by",
  "Note",
  "Invoice ID",
  "Payment ID",
] as const;

interface Txn {
  when: Date;
  type: "Membership" | "Class";
  member: string;
  item: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  recordedBy: string;
  note: string;
  invoiceId: string;
  id: string;
}

/**
 * Every membership and class payment whose relevant date falls in the range: the paid date for
 * paid ones, the created date for the rest (an unpaid invoice "happened" when it was issued).
 * `onlyPaid` drops everything that isn't money in the bank.
 */
async function loadTransactions(db: TenantDb, gymId: string, range: DateRange, timezone: string, onlyPaid: boolean): Promise<Txn[]> {
  const { start, end } = rangeBounds(range, timezone);
  const inRange = onlyPaid
    ? { status: "PAID" as const, paidAt: { gte: start, lte: end } }
    : {
        OR: [
          { status: "PAID" as const, paidAt: { gte: start, lte: end } },
          { status: { not: "PAID" as const }, createdAt: { gte: start, lte: end } },
        ],
      };

  const [memberships, classes] = await Promise.all([
    db.payment.findMany({
      where: { gymId, ...inRange },
      include: { member: { select: { fullName: true } }, plan: { select: { name: true } }, recordedBy: { select: { name: true } } },
    }),
    db.classPayment.findMany({
      where: { gymId, ...inRange },
      include: {
        registration: { include: { member: { select: { fullName: true } }, session: { include: { class: { select: { name: true } } } } } },
        recordedBy: { select: { name: true } },
      },
    }),
  ]);

  const rows: Txn[] = [
    ...memberships.map((p) => ({
      when: p.paidAt ?? p.createdAt,
      type: "Membership" as const,
      member: p.member.fullName,
      item: p.plan.name,
      amount: Number(p.amount),
      currency: p.currency,
      status: statusLabel(p.status, p.provider),
      method: METHOD[p.provider],
      recordedBy: p.recordedBy?.name ?? "",
      note: p.note ?? "",
      invoiceId: p.externalInvoiceId ?? "",
      id: p.id,
    })),
    ...classes.map((p) => ({
      when: p.paidAt ?? p.createdAt,
      type: "Class" as const,
      member: p.registration.member.fullName,
      item: `${p.registration.session.class.name} (${dayKeyInTimezone(p.registration.session.startsAt, timezone)})`,
      amount: Number(p.amount),
      currency: p.currency,
      status: statusLabel(p.status, p.provider),
      method: METHOD[p.provider],
      recordedBy: p.recordedBy?.name ?? "",
      note: p.note ?? "",
      invoiceId: p.externalInvoiceId ?? "",
      id: p.id,
    })),
  ];
  return rows.sort((a, b) => a.when.getTime() - b.when.getTime());
}

export async function transactionsReport(db: TenantDb, gymId: string, range: DateRange, timezone: string, onlyPaid: boolean): Promise<CsvCell[][]> {
  const rows = await loadTransactions(db, gymId, range, timezone, onlyPaid);
  return [
    [...TRANSACTION_COLUMNS],
    ...rows.map((r) => [
      dayKeyInTimezone(r.when, timezone),
      r.type,
      r.member,
      r.item,
      String(r.amount),
      r.currency,
      r.status,
      r.method,
      r.recordedBy,
      r.note,
      r.invoiceId,
      r.id,
    ]),
  ];
}

export const MONTHLY_COLUMNS = ["Month", "Membership revenue", "Class revenue", "Total revenue", "Paid payments", "Cash / transfer", "Online", "Voided"] as const;

/** Month keys (YYYY-MM) from the month of `from` to the month of `to`, inclusive. */
function monthsIn(range: DateRange): string[] {
  const [fy, fm] = range.from.split("-").map(Number);
  const [ty, tm] = range.to.split("-").map(Number);
  const keys: string[] = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m++) {
    if (m > 12) {
      m = 1;
      y++;
      if (y > ty || (y === ty && m > tm)) break;
    }
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return keys;
}

/** One row per month: what came in, split by membership vs class and by how it was paid. Paid money only, plus a count of voided entries. */
export async function monthlyReport(db: TenantDb, gymId: string, range: DateRange, timezone: string): Promise<CsvCell[][]> {
  const rows = await loadTransactions(db, gymId, range, timezone, false);
  type Bucket = { membership: number; classes: number; count: number; cash: number; online: number; voided: number };
  const buckets = new Map<string, Bucket>(monthsIn(range).map((k) => [k, { membership: 0, classes: 0, count: 0, cash: 0, online: 0, voided: 0 }]));
  for (const r of rows) {
    const b = buckets.get(monthKey(r.when, timezone));
    if (!b) continue;
    if (r.status === "VOIDED") {
      b.voided++;
      continue;
    }
    if (r.status !== "PAID") continue;
    b.count++;
    if (r.type === "Membership") b.membership += r.amount;
    else b.classes += r.amount;
    if (r.method === METHOD.CASH) b.cash += r.amount;
    else b.online += r.amount;
  }
  return [
    [...MONTHLY_COLUMNS],
    ...Array.from(buckets.entries()).map(([key, b]) => [
      `${monthLabel(key)} ${key.slice(0, 4)}`,
      String(b.membership),
      String(b.classes),
      String(b.membership + b.classes),
      String(b.count),
      String(b.cash),
      String(b.online),
      String(b.voided),
    ]),
  ];
}

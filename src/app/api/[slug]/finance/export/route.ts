import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { financeExportQuerySchema } from "@/lib/validation/tenant";
import { buildXlsx, xlsxHeaders, type SheetSpec, type TotalRow } from "@/lib/xlsx";
import { MONTHLY_COLUMNS, TRANSACTION_COLUMNS, TX, defaultMonthlyRange, defaultTransactionsRange, monthlyReport, transactionsReport } from "@/lib/financeExport";
import { exportDay, exportStamp } from "@/lib/exportLabels";

export const dynamic = "force-dynamic";

/**
 * The owner's finance report as an Excel file, for their bookkeeper or their own spreadsheet. Each
 * file opens with what it covers and ends with totals.
 *
 *   ?report=transactions   one row per membership or class payment (default: this month, paid only;
 *                          `status=all` adds unpaid, expired, failed and voided entries)
 *   ?report=monthly        one row per month with revenue split by type and by payment method
 *                          (default: the last twelve months)
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD   inclusive days in the gym's timezone
 *
 * Owner only, like the Finance page it sits on.
 */
export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
  if (session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can export financials" }, { status: 403 });
  }

  const parsed = financeExportQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the dates" }, { status: 400 });
  }
  const q = parsed.data;
  const fallback = q.report === "monthly" ? defaultMonthlyRange(gym.timezone) : defaultTransactionsRange(gym.timezone);
  const range = { from: q.from ?? fallback.from, to: q.to ?? fallback.to };
  if (range.from > range.to) {
    return NextResponse.json({ error: "'from' must not be after 'to'" }, { status: 400 });
  }

  const period = `Period: ${exportDay(range.from)} to ${exportDay(range.to)}`;
  let spec: SheetSpec;
  if (q.report === "monthly") {
    const rows = await monthlyReport(db, gym.id, range, gym.timezone);
    spec = {
      name: "Monthly summary",
      title: `${gym.name}: monthly finance summary`,
      info: [period, "Paid money only; refunds are subtracted in Total revenue. Voided counts entries that were cancelled.", exportStamp(gym.timezone)],
      columns: MONTHLY_COLUMNS,
      rows,
      totals: [{ label: "Total", strong: true, cells: Object.fromEntries(MONTHLY_COLUMNS.slice(1).map((_, i) => [i + 1, { sum: true }])) }],
    };
  } else {
    const rows = await transactionsReport(db, gym.id, range, gym.timezone, q.status === "paid");
    const counted = { column: TX.status, equals: ["PAID", "REFUNDED"] };
    const types: [string, string][] = [["Membership", "Memberships"], ["Class", "Classes"], ["Day pass", "Day passes"], ["Field", "Fields"], ["Refund", "Refunds"]];
    const totals: TotalRow[] = types
      .filter(([type]) => rows.some((r) => r[TX.type] === type && counted.equals.includes(String(r[TX.status]))))
      .map(([type, label]) => ({ label, cells: { [TX.amount]: { sum: true, where: [{ column: TX.type, equals: [type] }, counted] } } }));
    totals.push({ label: "Total received (after refunds)", strong: true, cells: { [TX.amount]: { sum: true, where: [counted] } } });
    const notCounted = ["PENDING", "EXPIRED", "FAILED", "VOIDED"];
    if (rows.some((r) => notCounted.includes(String(r[TX.status])))) {
      totals.push({ label: "Not counted above: unpaid, expired, failed or voided", strong: false, cells: { [TX.amount]: { sum: true, where: [{ column: TX.status, equals: notCounted }] } } });
    }
    spec = {
      name: "Transactions",
      title: `${gym.name}: transactions`,
      info: [
        period,
        q.status === "paid" ? "Paid payments and refunds only." : "Everything, including unpaid, failed and voided entries. Only paid and refunded lines count in the total.",
        exportStamp(gym.timezone),
      ],
      columns: TRANSACTION_COLUMNS,
      rows,
      totals,
    };
  }

  const filename = `finance-${q.report}-${gym.slug}-${range.from}-to-${range.to}.xlsx`;
  return new NextResponse(await buildXlsx([spec]), { status: 200, headers: xlsxHeaders(filename) });
}

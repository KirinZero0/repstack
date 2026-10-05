import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { financeExportQuerySchema } from "@/lib/validation/tenant";
import { toCsv } from "@/lib/csv";
import { defaultMonthlyRange, defaultTransactionsRange, monthlyReport, transactionsReport } from "@/lib/financeExport";

export const dynamic = "force-dynamic";

/**
 * The owner's finance report as CSV, for their bookkeeper or their own spreadsheet.
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

  const rows =
    q.report === "monthly"
      ? await monthlyReport(db, gym.id, range, gym.timezone)
      : await transactionsReport(db, gym.id, range, gym.timezone, q.status === "paid");

  const filename = `finance-${q.report}-${gym.slug}-${range.from}-to-${range.to}.csv`;
  return new NextResponse(toCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

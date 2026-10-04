import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { decrypt } from "@/lib/crypto";
import { dayKeyInTimezone } from "@/lib/date";
import { excelText, toCsv, type CsvCell } from "@/lib/csv";
import { MEMBER_CSV_COLUMNS } from "@/lib/memberImport";

export const dynamic = "force-dynamic";

/**
 * The gym's member list as a CSV the owner can open in Excel or Google Sheets, or feed back into
 * the import. Owner only: it's every member's phone number and email in one file, which is a
 * different thing from staff seeing one row at a time on screen. The gym's data is the gym's to
 * take away, so this is also the answer to "what if I stop paying".
 */
export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
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
    return NextResponse.json({ error: "Only the owner can export the member list" }, { status: 403 });
  }

  const members = await db.member.findMany({
    where: { gymId: gym.id, anonymizedAt: null },
    include: { plan: { select: { name: true } } },
    orderBy: [{ status: "asc" }, { fullName: "asc" }],
  });

  const day = (d: Date | null) => (d ? dayKeyInTimezone(d, gym.timezone) : "");
  const rows: CsvCell[][] = [
    [...MEMBER_CSV_COLUMNS],
    ...members.map((m) => [
      m.fullName,
      m.email,
      excelText(decrypt(m.phoneWhatsapp)),
      m.plan.name,
      m.status,
      day(m.membershipExpiry),
      m.passwordHash ? "Yes" : "No",
      day(m.createdAt),
    ]),
  ];

  const filename = `members-${gym.slug}-${dayKeyInTimezone(new Date(), gym.timezone)}.csv`;
  return new NextResponse(toCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

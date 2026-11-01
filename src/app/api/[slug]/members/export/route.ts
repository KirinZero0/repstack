import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { decrypt } from "@/lib/crypto";
import { dayKeyInTimezone } from "@/lib/date";
import { buildXlsx, xlsxHeaders, type SheetCell } from "@/lib/xlsx";
import { MEMBER_COLUMNS } from "@/lib/memberImport";
import { exportStamp } from "@/lib/exportLabels";

export const dynamic = "force-dynamic";

/**
 * The gym's member list as an Excel file the owner can open in Excel or Google Sheets, or feed back
 * into the import (which skips the title lines and the total at the bottom). Owner only: it's every member's phone number and email in one file, which is a
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
  const rows: SheetCell[][] = members.map((m) => [
    m.fullName,
    m.email,
    decrypt(m.phoneWhatsapp),
    m.plan.name,
    m.status,
    day(m.membershipExpiry),
    m.passwordHash ? "Yes" : "No",
    day(m.createdAt),
  ]);

  const byStatus = new Map<string, number>();
  for (const m of members) byStatus.set(m.status, (byStatus.get(m.status) ?? 0) + 1);
  const statusLine = Array.from(byStatus.entries())
    .map(([status, n]) => `${n} ${status.toLowerCase().replace(/_/g, " ")}`)
    .join(", ");
  const activated = members.filter((m) => m.passwordHash).length;

  const today = dayKeyInTimezone(new Date(), gym.timezone);
  const file = await buildXlsx([
    {
      name: "Members",
      title: `${gym.name}: members`,
      info: [`${members.length} member${members.length === 1 ? "" : "s"}${statusLine ? ` (${statusLine})` : ""}`, exportStamp(gym.timezone)],
      columns: MEMBER_COLUMNS,
      rows,
      totals: [{ label: `Total: ${members.length} member${members.length === 1 ? "" : "s"}`, strong: true, cells: { 4: statusLine, 6: `${activated} of ${members.length}` } }],
    },
  ]);
  return new NextResponse(file, { status: 200, headers: xlsxHeaders(`members-${gym.slug}-${today}.xlsx`) });
}

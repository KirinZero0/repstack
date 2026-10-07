import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tenantDb } from "@/lib/prisma";
import { getSession } from "@/lib/session";

const schema = z.object({ hideFromGymBoard: z.boolean() });

/** A member chooses whether other members can see them in the "who's in the gym" list. Only ever their own row. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.kind !== "member") {
    return NextResponse.json({ error: "Log in as a member to change this" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const db = tenantDb(session.gymId);
  const { count } = await db.member.updateMany({
    where: { id: session.memberId, gymId: session.gymId },
    data: { hideFromGymBoard: parsed.data.hideFromGymBoard },
  });
  if (count === 0) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

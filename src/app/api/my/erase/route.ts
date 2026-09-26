import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { tenantDb } from "@/lib/prisma";
import { clearSessionCookie, getSession } from "@/lib/session";
import { eraseSelfSchema } from "@/lib/validation/tenant";
import { eraseMember } from "@/lib/erasure";

/** A member deletes their own account. They confirm with their password; their membership ends immediately. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.kind !== "member") {
    return NextResponse.json({ error: "Log in as a member first" }, { status: 401 });
  }

  const parsed = eraseSelfSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your password to confirm." }, { status: 400 });

  const member = await tenantDb(session.gymId).member.findUnique({ where: { id: session.memberId } });
  if (!member || member.gymId !== session.gymId || member.anonymizedAt) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (!member.passwordHash || !(await bcrypt.compare(parsed.data.password, member.passwordHash))) {
    return NextResponse.json({ error: "That password isn't right." }, { status: 403 });
  }

  await eraseMember(member.id);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}

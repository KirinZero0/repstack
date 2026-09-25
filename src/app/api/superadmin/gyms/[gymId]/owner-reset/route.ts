import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import { createPasswordReset, deliverResetLink, resetUrl } from "@/lib/passwordReset";

/** Superadmin creates a password link for a gym's owner, for owners who can't recover on their own. */
export async function POST(_req: Request, { params }: { params: { gymId: string } }) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const gym = await prisma.gym.findUnique({ where: { id: params.gymId } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });

  const owner = await prisma.staffUser.findFirst({
    where: { gymId: gym.id, role: "OWNER", isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) return NextResponse.json({ error: "This gym has no active owner account." }, { status: 404 });

  const token = await createPasswordReset({ kind: "staff", subjectId: owner.id, purpose: "reset" });
  waitUntil(deliverResetLink({ kind: "staff", name: owner.name, token, purpose: "reset", staffPhone: owner.phone, gymName: gym.name }));

  await writeAuditLog({
    superadminId: session.superadminId,
    gymId: gym.id,
    action: "OWNER_RESET_LINK_CREATED",
    metadata: { ownerId: owner.id, ownerEmail: owner.email },
  });

  return NextResponse.json({ url: resetUrl(token), ownerName: owner.name, ownerEmail: owner.email });
}

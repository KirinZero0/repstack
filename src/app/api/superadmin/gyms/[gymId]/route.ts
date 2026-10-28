import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import { deleteBlob } from "@/lib/blob";

const deleteGymSchema = z.object({ confirmSlug: z.string().min(1) });

/**
 * Superadmin deletes a gym created by mistake (typo in the slug, a test tenant). Only possible while
 * the gym has no real history: no members, visits or payments of any kind. Anything with money or
 * member data is suspended instead. The caller must repeat the slug to confirm, and it is audit-logged.
 */
export async function DELETE(req: NextRequest, { params }: { params: { gymId: string } }) {
  let session;
  try {
    ({ session } = await requireSuperadminSession());
  } catch (err) {
    if (err instanceof SessionError) return NextResponse.json({ error: err.message }, { status: 401 });
    throw err;
  }

  const parsed = deleteGymSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Type the gym's slug to confirm." }, { status: 400 });

  const gym = await prisma.gym.findUnique({ where: { id: params.gymId } });
  if (!gym) return NextResponse.json({ error: "Gym not found" }, { status: 404 });
  if (parsed.data.confirmSlug !== gym.slug) return NextResponse.json({ error: "That doesn't match the gym's slug." }, { status: 400 });

  const g = { gymId: gym.id };
  const [members, checkIns, payments, classPayments, paidPlatform, paidGuests] = await Promise.all([
    prisma.member.count({ where: g }),
    prisma.checkIn.count({ where: g }),
    prisma.payment.count({ where: g }),
    prisma.classPayment.count({ where: g }),
    prisma.platformPayment.count({ where: { ...g, status: "PAID" } }),
    prisma.guestPass.count({ where: { ...g, status: { in: ["APPROVED", "ATTENDED", "VOIDED"] }, amount: { gt: 0 } } }),
  ]);
  if (members + checkIns + payments + classPayments + paidPlatform + paidGuests > 0) {
    return NextResponse.json(
      { error: "This gym has members, visits or payments on record, so it can't be deleted. Suspend it instead." },
      { status: 409 },
    );
  }

  const staff = await prisma.staffUser.findMany({ where: g, select: { id: true } });
  await prisma.$transaction([
    prisma.guestPass.deleteMany({ where: g }),
    prisma.classSession.deleteMany({ where: g }),
    prisma.gymClass.deleteMany({ where: g }),
    prisma.dayPassPlan.deleteMany({ where: g }),
    prisma.emailTemplate.deleteMany({ where: g }),
    prisma.membershipPlan.deleteMany({ where: g }),
    prisma.memberSignup.deleteMany({ where: g }),
    prisma.notificationLog.deleteMany({ where: g }),
    prisma.platformPayment.deleteMany({ where: g }),
    prisma.whatsappSenderConfig.deleteMany({ where: g }),
    prisma.passwordReset.deleteMany({ where: { kind: "staff", subjectId: { in: staff.map((s) => s.id) } } }),
    prisma.staffUser.deleteMany({ where: g }),
    prisma.gym.delete({ where: { id: gym.id } }),
  ]);
  await Promise.all(gym.photoUrls.map((url) => deleteBlob(url)));

  // The gym row is gone, so the audit entry keeps its name and slug in the metadata.
  await writeAuditLog({ superadminId: session.superadminId, action: "GYM_DELETED", metadata: { gymId: gym.id, name: gym.name, slug: gym.slug } });
  return NextResponse.json({ ok: true });
}

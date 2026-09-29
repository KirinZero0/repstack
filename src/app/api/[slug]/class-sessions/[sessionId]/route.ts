import { NextRequest, NextResponse } from "next/server";
import { tenantTransaction } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { classSessionActionSchema } from "@/lib/validation/tenant";
import { expireRegistrationInvoice, sendClassCancellations } from "@/lib/classes";

/**
 * Owner cancels a scheduled session. Every registration on it is cancelled too; unpaid online
 * invoices are expired. Money already taken stays recorded (refunds are between the gym and the
 * member), and everyone booked gets a WhatsApp notice.
 */
export async function PATCH(req: NextRequest, { params }: { params: { slug: string; sessionId: string } }) {
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
    return NextResponse.json({ error: "Only the owner can cancel a class session" }, { status: 403 });
  }

  const parsed = classSessionActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  // Tenant isolation: the session must belong to the session's gym.
  const cs = await db.classSession.findUnique({
    where: { id: params.sessionId },
    include: { registrations: { include: { payment: true } } },
  });
  if (!cs || cs.gymId !== gym.id) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (cs.status !== "SCHEDULED") return NextResponse.json({ error: "This session is already cancelled or over." }, { status: 409 });

  await tenantTransaction(gym.id, async (tx) => {
    await tx.classSession.update({ where: { id: cs.id }, data: { status: "CANCELLED" } });
    await tx.classRegistration.updateMany({
      where: { sessionId: cs.id, status: { in: ["PENDING_PAYMENT", "CONFIRMED"] } },
      data: { status: "CANCELLED" },
    });
    await tx.classPayment.updateMany({
      where: { registration: { sessionId: cs.id }, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
  });

  for (const reg of cs.registrations) await expireRegistrationInvoice(reg.payment);
  await sendClassCancellations(cs.id);

  return NextResponse.json({ ok: true, cancelledRegistrations: cs.registrations.filter((r) => r.status !== "CANCELLED").length });
}

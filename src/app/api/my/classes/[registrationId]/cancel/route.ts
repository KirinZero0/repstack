import { NextResponse } from "next/server";
import { tenantDb, tenantTransaction } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { expireRegistrationInvoice } from "@/lib/classes";

/** A member gives up their seat, any time before the session starts. A paid seat is settled with the gym. */
export async function POST(_req: Request, { params }: { params: { registrationId: string } }) {
  const session = await getSession();
  if (!session || session.kind !== "member") {
    return NextResponse.json({ error: "Log in as a member first" }, { status: 401 });
  }

  const db = tenantDb(session.gymId);
  const reg = await db.classRegistration.findUnique({
    where: { id: params.registrationId },
    include: { payment: true, session: true },
  });
  // Only the member's own registration, in their own gym.
  if (!reg || reg.gymId !== session.gymId || reg.memberId !== session.memberId) {
    return NextResponse.json({ error: "Registration not found" }, { status: 404 });
  }
  if (reg.status === "CANCELLED") return NextResponse.json({ error: "Already cancelled." }, { status: 409 });
  if (reg.session.status !== "SCHEDULED" || reg.session.startsAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "This session has already started, so it can't be cancelled." }, { status: 409 });
  }

  await tenantTransaction(session.gymId, async (tx) => {
    await tx.classRegistration.update({ where: { id: reg.id }, data: { status: "CANCELLED" } });
    if (reg.payment?.status === "PENDING") {
      await tx.classPayment.update({ where: { id: reg.payment.id }, data: { status: "EXPIRED" } });
    }
  });
  await expireRegistrationInvoice(reg.payment);

  return NextResponse.json({ ok: true, wasPaid: reg.payment?.status === "PAID" });
}

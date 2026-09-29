import { NextRequest, NextResponse } from "next/server";
import { tenantDb, tenantTransaction } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { registerForClassSchema } from "@/lib/validation/tenant";
import { createInvoice, getInvoiceState, memberPaymentsAvailable, paymentProviderEnum } from "@/lib/gateway";
import { countSeatsTaken, effectiveCapacity, sendClassConfirmation } from "@/lib/classes";

class FullError extends Error {}

/**
 * A member books a seat in a class session. Free class → confirmed at once. Online payments on
 * (or mock mode) → a PENDING registration plus an invoice to pay, seat held meanwhile. Otherwise →
 * a PENDING registration the front desk confirms when the member pays there.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.kind !== "member") {
    return NextResponse.json({ error: "Log in as a member to book a class" }, { status: 401 });
  }

  const parsed = registerForClassSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const db = tenantDb(session.gymId);
  const [member, gym] = await Promise.all([
    db.member.findUnique({ where: { id: session.memberId } }),
    db.gym.findUnique({ where: { id: session.gymId } }),
  ]);
  if (!member || !gym || member.gymId !== gym.id || member.anonymizedAt) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (gym.subscriptionStatus === "SUSPENDED" || gym.subscriptionStatus === "CANCELLED") {
    return NextResponse.json({ error: "This gym can't take bookings right now" }, { status: 403 });
  }
  if (member.status === "CANCELLED") {
    return NextResponse.json({ error: "This membership was cancelled. Ask the gym to reactivate it." }, { status: 403 });
  }

  // Tenant isolation: only sessions of the member's own gym (the RLS client hides the rest anyway).
  const cs = await db.classSession.findUnique({ where: { id: parsed.data.sessionId }, include: { class: true } });
  if (!cs || cs.gymId !== gym.id) return NextResponse.json({ error: "Class session not found" }, { status: 404 });
  if (cs.status !== "SCHEDULED" || cs.startsAt.getTime() <= Date.now() || !cs.class.isActive) {
    return NextResponse.json({ error: "Bookings for this session are closed." }, { status: 409 });
  }

  const existing = await db.classRegistration.findUnique({
    where: { sessionId_memberId: { sessionId: cs.id, memberId: member.id } },
    include: { payment: true },
  });
  if (existing?.status === "CONFIRMED") {
    return NextResponse.json({ error: "You're already booked for this session." }, { status: 409 });
  }
  if (existing?.status === "PENDING_PAYMENT") {
    // Resume an unpaid online invoice rather than stacking a second one.
    const p = existing.payment;
    if (p?.status === "PENDING" && p.externalInvoiceId && p.invoiceUrl) {
      const state = await getInvoiceState(p.externalInvoiceId, p.createdAt, p.provider);
      if (state === "PENDING") return NextResponse.json({ registrationId: existing.id, status: "PENDING_PAYMENT", invoiceUrl: p.invoiceUrl });
    }
    return NextResponse.json({ error: "You've already asked for a spot. Pay at the front desk to confirm it." }, { status: 409 });
  }
  if (existing?.status === "CANCELLED" && existing.payment?.status === "PAID") {
    // Paid earlier, then cancelled: the money is still there, so re-booking just needs a free seat.
    try {
      await tenantTransaction(gym.id, async (tx) => {
        const cap = effectiveCapacity(cs, cs.class);
        if (cap !== null && (await countSeatsTaken(tx, cs.id)) >= cap) throw new FullError();
        await tx.classRegistration.update({ where: { id: existing.id }, data: { status: "CONFIRMED" } });
      });
    } catch (err) {
      if (err instanceof FullError) return NextResponse.json({ error: "This session is full." }, { status: 409 });
      throw err;
    }
    await sendClassConfirmation(existing.id);
    return NextResponse.json({ registrationId: existing.id, status: "CONFIRMED", invoiceUrl: null }, { status: 201 });
  }

  const price = Number(cs.class.price);
  const online = price > 0 && memberPaymentsAvailable(gym.settings);
  const initialStatus = price === 0 ? "CONFIRMED" : "PENDING_PAYMENT";

  let reg: { id: string };
  let paymentId: string | null = null;
  try {
    ({ reg, paymentId } = await tenantTransaction(gym.id, async (tx) => {
      const cap = effectiveCapacity(cs, cs.class);
      if (cap !== null && (await countSeatsTaken(tx, cs.id)) >= cap) throw new FullError();

      let reg: { id: string };
      if (existing) {
        // A cancelled (or expired) earlier attempt: reuse the row, drop its stale unpaid payment.
        if (existing.payment) await tx.classPayment.delete({ where: { id: existing.payment.id } });
        reg = await tx.classRegistration.update({ where: { id: existing.id }, data: { status: initialStatus, createdAt: new Date() } });
      } else {
        reg = await tx.classRegistration.create({ data: { gymId: gym.id, sessionId: cs.id, memberId: member.id, status: initialStatus } });
      }

      let paymentId: string | null = null;
      if (online) {
        const payment = await tx.classPayment.create({
          data: { gymId: gym.id, registrationId: reg.id, provider: paymentProviderEnum(), amount: cs.class.price, currency: cs.class.currency, status: "PENDING" },
        });
        paymentId = payment.id;
      }
      return { reg, paymentId };
    }));
  } catch (err) {
    if (err instanceof FullError) return NextResponse.json({ error: "This session is full." }, { status: 409 });
    throw err;
  }

  if (initialStatus === "CONFIRMED") {
    await sendClassConfirmation(reg.id);
    return NextResponse.json({ registrationId: reg.id, status: "CONFIRMED", invoiceUrl: null }, { status: 201 });
  }

  if (!paymentId) {
    return NextResponse.json({ registrationId: reg.id, status: "PENDING_PAYMENT", invoiceUrl: null }, { status: 201 });
  }

  try {
    const invoice = await createInvoice({
      externalId: paymentId,
      amount: price,
      payerEmail: member.email,
      description: `${cs.class.name} class — ${gym.name}`,
      currency: cs.class.currency,
      successRedirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/my/classes`,
    });
    await db.classPayment.update({ where: { id: paymentId }, data: { externalInvoiceId: invoice.id, invoiceUrl: invoice.url } });
    return NextResponse.json({ registrationId: reg.id, status: "PENDING_PAYMENT", invoiceUrl: invoice.url }, { status: 201 });
  } catch (err) {
    console.error("Class payment failed to start", err);
    // Don't leave a seat held by a registration nobody can pay for.
    await tenantTransaction(gym.id, async (tx) => {
      await tx.classPayment.update({ where: { id: paymentId! }, data: { status: "FAILED" } });
      await tx.classRegistration.update({ where: { id: reg.id }, data: { status: "CANCELLED" } });
    }).catch(() => undefined);
    return NextResponse.json({ error: "We couldn't start the payment. Try again in a moment, or book at the front desk." }, { status: 502 });
  }
}

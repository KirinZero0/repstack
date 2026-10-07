import { NextRequest, NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { changePlanSchema } from "@/lib/validation/tenant";
import { countMemberSeats } from "@/lib/limits";
import { openPlatformInvoice, PaymentsDisabledError, retirePendingPlatformInvoices } from "@/lib/platformBilling";

/**
 * Owner switches the gym's Liftmora plan.
 *  - A plan that costs less and gives no more than the current one (e.g. yearly to monthly of the same tier)
 *    takes effect at once, if the gym fits inside its limits. The already-paid period is kept.
 *  - Anything else must be paid for first: we return an invoice, and the plan switches when it's paid.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
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
    return NextResponse.json({ error: "Only the owner can change the plan" }, { status: 403 });
  }
  if (gym.isLifetime) {
    return NextResponse.json({ error: "Lifetime accounts can't change plan here. Contact us." }, { status: 409 });
  }

  const parsed = changePlanSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const [current, target] = await Promise.all([
    db.saasPlan.findUnique({ where: { id: gym.saasPlanId } }),
    db.saasPlan.findUnique({ where: { id: parsed.data.saasPlanId } }),
  ]);
  if (!current) return NextResponse.json({ error: "Current plan not found" }, { status: 404 });
  if (!target || !target.isActive) return NextResponse.json({ error: "That plan isn't available." }, { status: 400 });
  if (target.id === current.id) return NextResponse.json({ error: "You're already on that plan." }, { status: 409 });

  const smaller =
    Number(target.price) <= Number(current.price) &&
    target.maxMembers <= current.maxMembers &&
    target.maxStaff <= current.maxStaff &&
    target.maxWhatsappPerMonth <= current.maxWhatsappPerMonth;

  if (smaller) {
    const [seats, activeStaff] = await Promise.all([
      countMemberSeats(db, gym.id),
      db.staffUser.count({ where: { gymId: gym.id, isActive: true } }),
    ]);
    if (seats > target.maxMembers) {
      return NextResponse.json(
        { error: `${target.name} allows ${target.maxMembers.toLocaleString("id-ID")} members and you have ${seats.toLocaleString("id-ID")}. Cancel or erase some members first.` },
        { status: 409 },
      );
    }
    if (activeStaff > target.maxStaff) {
      return NextResponse.json(
        { error: `${target.name} allows ${target.maxStaff} staff accounts and you have ${activeStaff}. Deactivate some first.` },
        { status: 409 },
      );
    }
    // An open renewal for the old (dearer) plan mustn't be payable any more.
    await retirePendingPlatformInvoices(gym.id);
    await db.gym.update({ where: { id: gym.id }, data: { saasPlanId: target.id } });
    return NextResponse.json({ changed: true, plan: target.name });
  }

  try {
    const { url } = await openPlatformInvoice(gym, target, "plan change");
    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof PaymentsDisabledError) {
      return NextResponse.json({ error: "Online payments are currently turned off. Contact us to switch to a paid plan." }, { status: 403 });
    }
    console.error("Could not create a plan change invoice", err);
    return NextResponse.json({ error: "We couldn't start the payment. Please try again in a moment." }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { requireTenantSession, SessionError } from "@/lib/session";
import { openPlatformInvoice } from "@/lib/platformBilling";

/**
 * Owner pays the gym's subscription now: returns the payable Xendit invoice (an open one is reused).
 * Works for a gym suspended for non-payment too, since that owner is only let in to pay.
 */
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug, { billing: true }));
  } catch (err) {
    if (err instanceof SessionError) {
      const status = err.code === "GYM_SUSPENDED" ? 403 : err.code === "NOT_FOUND" ? 404 : 401;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
  if (session.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can pay for the subscription" }, { status: 403 });
  }
  if (gym.isLifetime) {
    return NextResponse.json({ error: "This is a lifetime account. There's nothing to pay." }, { status: 409 });
  }

  const plan = await db.saasPlan.findUnique({ where: { id: gym.saasPlanId } });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  try {
    const { url } = await openPlatformInvoice(gym, plan, "renewal");
    return NextResponse.json({ url });
  } catch (err) {
    console.error("Could not create a subscription invoice", err);
    return NextResponse.json({ error: "We couldn't start the payment. Please try again in a moment." }, { status: 502 });
  }
}

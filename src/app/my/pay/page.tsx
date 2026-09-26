import { tenantDb } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { StatusPill, rp } from "@/components/charts";
import PayButton from "./PayButton";

export const dynamic = "force-dynamic";

export default async function PayPage() {
  const session = await getSession();

  if (!session || session.kind !== "member") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <div className="text-center">
          <p className="mb-4 text-neutral-300">Log in as a member to pay for your membership.</p>
          <a href="/" className="text-sm text-neutral-500 hover:text-neutral-300">← Back home</a>
        </div>
      </main>
    );
  }

  const db = tenantDb(session.gymId);
  const member = await db.member.findUnique({
    where: { id: session.memberId },
    include: { gym: true, plan: true },
  });
  if (!member || member.gymId !== session.gymId || member.anonymizedAt) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-red-400">Account not found.</p>
      </main>
    );
  }

  const plans = await db.membershipPlan.findMany({
    where: { gymId: member.gymId, isActive: true },
    orderBy: { price: "asc" },
  });

  const daysLeft = member.membershipExpiry
    ? Math.ceil((member.membershipExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const blocked =
    member.gym.subscriptionStatus === "SUSPENDED" ||
    member.gym.subscriptionStatus === "CANCELLED" ||
    member.status === "CANCELLED";
  const active = member.status === "ACTIVE" && daysLeft !== null && daysLeft >= 0;

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{active ? "Renew your membership" : "Pay for your membership"}</h1>
            <p className="text-sm text-neutral-400">{member.gym.name}</p>
          </div>
          <a href="/my" className="text-sm text-neutral-300 hover:text-white">← Dashboard</a>
        </div>

        <div className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-5 text-sm">
          <StatusPill status={member.status} />
          <span className="text-neutral-300">
            {member.membershipExpiry
              ? daysLeft !== null && daysLeft >= 0
                ? `Active until ${member.membershipExpiry.toLocaleDateString("id-ID")} (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)`
                : `Expired on ${member.membershipExpiry.toLocaleDateString("id-ID")}`
              : "No active membership yet"}
          </span>
          {active && <span className="text-neutral-500">Renewing adds time on top of what you have left.</span>}
        </div>

        {blocked ? (
          <p className="text-neutral-300">Payments are paused for this membership. Please speak to the gym.</p>
        ) : plans.length === 0 ? (
          <p className="text-neutral-300">This gym hasn&apos;t published any plans yet. Please ask the front desk.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {plans.map((p) => {
              const current = p.id === member.planId;
              return (
                <article key={p.id} className="flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-display text-xl font-semibold">{p.name}</h2>
                    {current && <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400">Your plan</span>}
                  </div>
                  <p className="mt-4 font-display text-3xl font-semibold tabular-nums">{rp(Number(p.price))}</p>
                  <p className="mt-1 flex-1 text-sm text-neutral-400">
                    {p.durationDays} days of access
                  </p>
                  <div className="mt-6">
                    <PayButton planId={p.id} label={`Pay ${rp(Number(p.price))}`} primary={current} />
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <p className="mt-8 text-xs text-neutral-500">
          You&apos;ll be taken to a secure Xendit page to pay by bank transfer, e-wallet or card. Your
          membership switches on as soon as the payment clears.
        </p>
      </div>
    </main>
  );
}

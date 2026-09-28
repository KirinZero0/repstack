import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { countMemberSeats } from "@/lib/limits";
import { isMockMode } from "@/lib/xendit";
import { onlinePaymentsEnabled } from "@/lib/gateway";
import GymNav from "@/components/GymNav";
import MockCheckout from "@/app/my/MockCheckout";
import { PayNowButton, PlanSwitcher } from "./BillingActions";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  PAID: "text-emerald-400",
  PENDING: "text-amber-400",
  EXPIRED: "text-neutral-500",
  FAILED: "text-red-400",
};

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { "mock-invoice"?: string };
}) {
  let session, gym, db;
  try {
    // A gym suspended for an unpaid subscription still gets its owner in here, to pay.
    ({ session, gym, db } = await requireTenantSession(params.slug, { billing: true }));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  if (session.role !== "OWNER") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-red-400">403 — Only the gym owner can view billing.</p>
      </main>
    );
  }

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [saasPlan, payments, plans, seats, activeStaff, waUsed] = await Promise.all([
    db.saasPlan.findUnique({ where: { id: gym.saasPlanId } }),
    db.platformPayment.findMany({
      where: { gymId: gym.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { saasPlan: { select: { name: true } } },
    }),
    db.saasPlan.findMany({ where: { isActive: true }, orderBy: { price: "asc" } }),
    countMemberSeats(db, gym.id),
    db.staffUser.count({ where: { gymId: gym.id, isActive: true } }),
    db.notificationLog.count({ where: { gymId: gym.id, channel: "whatsapp", status: "SENT", sentAt: { gte: monthStart } } }),
  ]);

  const paymentsOn = onlinePaymentsEnabled() || isMockMode();
  const suspended = gym.subscriptionStatus === "SUSPENDED";
  const overdue = gym.subscriptionStatus === "PAST_DUE" || suspended;
  const open = payments.find((p) => p.status === "PENDING" && p.invoiceUrl);
  const mockPayment =
    isMockMode() && searchParams["mock-invoice"]
      ? payments.find((p) => p.id === searchParams["mock-invoice"] && p.status === "PENDING")
      : undefined;

  const options = saasPlan
    ? plans
        .filter((p) => p.id !== saasPlan.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          price: Number(p.price),
          interval: p.billingInterval,
          maxMembers: p.maxMembers,
          maxStaff: p.maxStaff,
          maxWhatsappPerMonth: p.maxWhatsappPerMonth,
          immediate:
            Number(p.price) <= Number(saasPlan.price) &&
            p.maxMembers <= saasPlan.maxMembers &&
            p.maxStaff <= saasPlan.maxStaff &&
            p.maxWhatsappPerMonth <= saasPlan.maxWhatsappPerMonth,
        }))
    : [];

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-semibold">Billing</h1>
            <p className="text-sm text-neutral-400">{gym.name}</p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="billing" billingOnly={suspended} />
        </div>

        {mockPayment && (
          <MockCheckout
            paymentId={mockPayment.id}
            amount={`Rp ${Number(mockPayment.amount).toLocaleString("id-ID")}`}
            planName={mockPayment.saasPlan.name}
            returnTo={`/${params.slug}/billing`}
          />
        )}

        {suspended && (
          <div className="mb-6 rounded-xl border border-red-900 bg-red-950 px-5 py-4 text-sm text-red-400">
            <p className="font-semibold">This gym is suspended because the subscription wasn&apos;t paid.</p>
            <p className="mt-1">Members and staff can&apos;t log in or check in until you pay. Everything switches back on as soon as the payment clears.</p>
          </div>
        )}
        {!suspended && overdue && (
          <div className="mb-6 rounded-xl border border-amber-800 bg-amber-950 px-5 py-4 text-sm text-amber-400">
            <p className="font-semibold">Your subscription payment is overdue.</p>
            <p className="mt-1">
              Pay now to keep your gym running. Without payment it&apos;s suspended{" "}
              {gym.nextBillingDate
                ? `after ${new Date(gym.nextBillingDate.getTime() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString("id-ID")}`
                : "shortly"}
              .
            </p>
          </div>
        )}

        <div className="mb-8 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <p className="text-sm text-neutral-400">Plan</p>
          <p className="mb-3 text-lg font-medium">{saasPlan?.name ?? "—"}</p>

          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-neutral-400">Status</p>
              <p>{gym.subscriptionStatus}</p>
            </div>
            <div>
              <p className="text-neutral-400">Lifetime account</p>
              <p>{gym.isLifetime ? "Yes — never auto-billed" : "No"}</p>
            </div>
            {!gym.isLifetime && (
              <div>
                <p className="text-neutral-400">Next billing date</p>
                <p>{gym.nextBillingDate?.toLocaleDateString("id-ID") ?? "—"}</p>
              </div>
            )}
          </div>

          {saasPlan && (
            <div className="mt-5 grid grid-cols-1 gap-3 border-t border-neutral-800 pt-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-neutral-400">Members</p>
                <p className="tabular-nums">{seats.toLocaleString("id-ID")} of {saasPlan.maxMembers.toLocaleString("id-ID")}</p>
              </div>
              <div>
                <p className="text-neutral-400">Staff accounts</p>
                <p className="tabular-nums">{activeStaff} of {saasPlan.maxStaff}</p>
              </div>
              <div>
                <p className="text-neutral-400">WhatsApp this month</p>
                <p className="tabular-nums">{waUsed.toLocaleString("id-ID")} of {saasPlan.maxWhatsappPerMonth.toLocaleString("id-ID")}</p>
              </div>
            </div>
          )}

          {!gym.isLifetime && saasPlan && (
            <div className="mt-6 border-t border-neutral-800 pt-5">
              {paymentsOn ? (
                <>
                  <PayNowButton
                    slug={params.slug}
                    label={overdue ? `Pay Rp ${Number(saasPlan.price).toLocaleString("id-ID")} now` : `Renew early · Rp ${Number(saasPlan.price).toLocaleString("id-ID")}`}
                  />
                  {!overdue && (
                    <p className="mt-2 text-xs text-neutral-500">Renewing early adds a full period after your current billing date.</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-neutral-400">Online payments are currently turned off. Contact us to pay your subscription.</p>
              )}
            </div>
          )}
        </div>

        {!gym.isLifetime && !suspended && options.length > 0 && (
          <div className="mb-8 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
            <h2 className="mb-1 text-lg font-medium">Change plan</h2>
            <p className="mb-4 text-sm text-neutral-400">
              {paymentsOn
                ? "A bigger or dearer plan is paid for first and switches on when the payment clears. A smaller one switches at once if your gym fits its limits, and you keep the time you've paid for."
                : "A smaller plan switches at once if your gym fits its limits. Bigger or dearer plans need payment, which is currently turned off — contact us to upgrade."}
            </p>
            <PlanSwitcher slug={params.slug} options={paymentsOn ? options : options.filter((o) => o.immediate)} />
          </div>
        )}

        <h2 className="mb-3 text-lg font-medium">Invoice history</h2>
        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-neutral-800">
                  <td className="px-4 py-3">{p.createdAt.toLocaleDateString("id-ID")}</td>
                  <td className="px-4 py-3 text-neutral-300">{p.saasPlan.name}</td>
                  <td className="px-4 py-3">Rp {Number(p.amount).toLocaleString("id-ID")}</td>
                  <td className={`px-4 py-3 ${STATUS_TONE[p.status] ?? ""}`}>{p.status}</td>
                  <td className="px-4 py-3 text-right">
                    {open?.id === p.id && (
                      <a href={p.invoiceUrl ?? "#"} className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-neutral-950 hover:bg-neutral-200">
                        Pay now
                      </a>
                    )}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                    No invoices yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

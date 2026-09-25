import { notFound, redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { decrypt } from "@/lib/crypto";
import { dayKeyInTimezone } from "@/lib/date";
import { Card, StatusPill, rp } from "@/components/charts";
import { RecordPaymentForm, VoidPaymentButton } from "./RecordPayment";
import PasswordLinkButton from "./PasswordLink";

export const dynamic = "force-dynamic";

export default async function MemberDetailPage({ params }: { params: { slug: string; memberId: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/g/${params.slug}/login`);
    throw err;
  }

  const member = await db.member.findUnique({ where: { id: params.memberId }, include: { plan: true } });
  if (!member || member.gymId !== gym.id) notFound();

  const [plans, payments, visits, lastVisit] = await Promise.all([
    db.membershipPlan.findMany({ where: { gymId: gym.id, isActive: true }, orderBy: { price: "asc" } }),
    db.payment.findMany({
      where: { memberId: member.id, gymId: gym.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { plan: { select: { name: true } }, recordedBy: { select: { name: true } } },
    }),
    db.checkIn.count({ where: { memberId: member.id, gymId: gym.id, result: "SUCCESS" } }),
    db.checkIn.findFirst({ where: { memberId: member.id, gymId: gym.id, result: "SUCCESS" }, orderBy: { checkedInAt: "desc" } }),
  ]);

  // Full contact details are only decrypted here, on the member's own detail view.
  const phone = decrypt(member.phoneWhatsapp);
  const daysLeft = member.membershipExpiry
    ? Math.ceil((member.membershipExpiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const today = dayKeyInTimezone(new Date(), gym.timezone);
  const isOwner = session.role === "OWNER";

  const methodLabel = (p: { provider: string }) => (p.provider === "CASH" ? "Recorded manually" : "Online (Xendit)");

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <a href={`/g/${params.slug}/members`} className="text-sm text-neutral-400 hover:text-white">← Members</a>
            <h1 className="mt-2 text-2xl font-semibold">{member.fullName}</h1>
            <div className="mt-2 flex items-center gap-3 text-sm">
              <StatusPill status={member.status} />
              <span className="text-neutral-400">
                {member.membershipExpiry
                  ? daysLeft !== null && daysLeft >= 0
                    ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left · until ${member.membershipExpiry.toLocaleDateString("id-ID")}`
                    : `expired ${member.membershipExpiry.toLocaleDateString("id-ID")}`
                  : "no active period"}
              </span>
            </div>
          </div>
        </div>

        <div className="mb-6 grid gap-6 sm:grid-cols-2">
          <Card title="Contact">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-neutral-400">Email</dt><dd>{member.email}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-neutral-400">WhatsApp</dt><dd>{phone}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-neutral-400">Account</dt><dd>{member.passwordHash ? "Activated" : "Not activated yet"}</dd></div>
            </dl>
            <div className="mt-4 border-t border-neutral-800 pt-4">
              <PasswordLinkButton slug={params.slug} memberId={member.id} />
            </div>
          </Card>
          <Card title="Membership">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-neutral-400">Plan</dt><dd>{member.plan.name}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-neutral-400">Visits</dt><dd>{visits}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-neutral-400">Last visit</dt><dd>{lastVisit ? lastVisit.checkedInAt.toLocaleDateString("id-ID") : "—"}</dd></div>
            </dl>
          </Card>
        </div>

        <div className="mb-6">
          <Card title="Record a payment">
            <p className="mb-4 text-sm text-neutral-400">
              For money the member paid you directly, such as cash or a bank transfer to the gym.
            </p>
            <RecordPaymentForm
              slug={params.slug}
              memberId={member.id}
              plans={plans.map((p) => ({ id: p.id, name: p.name, price: Number(p.price), days: p.durationDays }))}
              defaultPlanId={member.planId}
              today={today}
            />
          </Card>
        </div>

        <Card title="Payment history">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-neutral-500">
                <tr>
                  <th className="pb-2 font-normal">Date</th>
                  <th className="pb-2 font-normal">Plan</th>
                  <th className="pb-2 font-normal">Amount</th>
                  <th className="pb-2 font-normal">How</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const voided = p.provider === "CASH" && p.status === "FAILED";
                  return (
                    <tr key={p.id} className="border-t border-neutral-800 align-top">
                      <td className="py-3 text-neutral-400">{(p.paidAt ?? p.createdAt).toLocaleDateString("id-ID")}</td>
                      <td className="py-3">{p.plan.name}</td>
                      <td className={`py-3 ${voided ? "text-neutral-500 line-through" : ""}`}>{rp(Number(p.amount))}</td>
                      <td className="py-3 text-neutral-400">
                        {methodLabel(p)}
                        {p.recordedBy && <span className="block text-xs text-neutral-500">by {p.recordedBy.name}</span>}
                        {p.note && <span className="block text-xs text-neutral-500">&ldquo;{p.note}&rdquo;</span>}
                      </td>
                      <td className="py-3">{voided ? <span className="text-neutral-500">Voided</span> : <StatusPill status={p.status} />}</td>
                      <td className="py-3 text-right">
                        {isOwner && p.provider === "CASH" && p.status === "PAID" && (
                          <VoidPaymentButton slug={params.slug} memberId={member.id} paymentId={p.id} />
                        )}
                      </td>
                    </tr>
                  );
                })}
                {payments.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-neutral-500">No payments yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </main>
  );
}

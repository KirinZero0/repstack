import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import CreateGymForm from "./CreateGymForm";
import { transferReference } from "@/lib/platformBank";
import GymActions from "./GymActions";
import LogoutButton from "./LogoutButton";

export const dynamic = "force-dynamic";

function monthlyEquivalent(price: number, interval: string) {
  return interval === "annual" ? price / 12 : price;
}

export default async function SuperadminGymsPage() {
  try {
    await requireSuperadminSession();
  } catch (err) {
    if (err instanceof SessionError) redirect("/superadmin/login");
    throw err;
  }

  const [gyms, saasPlans, transfers] = await Promise.all([
    prisma.gym.findMany({
      include: {
        saasPlan: true,
        _count: { select: { members: true } },
        whatsappConfig: { select: { senderNumber: true, isActive: true } },
        // A gym has at most one setup fee; the status is what matters here.
        platformPayments: { where: { kind: "SETUP" }, orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.saasPlan.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    // Subscription invoices the owner is paying by bank transfer, waiting for us to confirm the money arrived.
    prisma.platformPayment.findMany({ where: { provider: "manual", kind: "SUBSCRIPTION", status: "PENDING" }, orderBy: { createdAt: "desc" } }),
  ]);
  const transferByGym = new Map<string, { amount: number; hasProof: boolean; senderName: string | null; transferDate: string | null; reference: string; submittedAt: string | null }>();
  for (const t of transfers) {
    if (transferByGym.has(t.gymId)) continue;
    transferByGym.set(t.gymId, {
      amount: Number(t.amount),
      hasProof: Boolean(t.proofImageUrl),
      senderName: t.senderName,
      transferDate: t.transferDate,
      reference: transferReference(t.id),
      submittedAt: t.proofSubmittedAt?.toISOString() ?? null,
    });
  }

  const recurringGyms = gyms.filter((g) => !g.isLifetime && g.subscriptionStatus === "ACTIVE");
  const mrr = recurringGyms.reduce(
    (sum, g) => sum + monthlyEquivalent(Number(g.saasPlan.price), g.saasPlan.billingInterval),
    0,
  );
  const lifetimeRevenue = gyms
    .filter((g) => g.isLifetime)
    .reduce((sum, g) => sum + Number(g.saasPlan.price), 0);
  const setupFees = gyms.map((g) => g.platformPayments[0]).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const setupFeesCollected = setupFees.filter((p) => p.status === "PAID").reduce((sum, p) => sum + Number(p.amount), 0);
  const setupFeesDue = setupFees.filter((p) => p.status === "PENDING").reduce((sum, p) => sum + Number(p.amount), 0);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Gym tenants</h1>
            <p className="text-sm text-neutral-400">
              MRR: <span className="text-white">Rp {Math.round(mrr).toLocaleString("id-ID")}</span>
              {" · "}
              Lifetime one-time revenue:{" "}
              <span className="text-white">Rp {lifetimeRevenue.toLocaleString("id-ID")}</span>
              {" · "}
              Setup fees: <span className="text-white">Rp {setupFeesCollected.toLocaleString("id-ID")}</span>
              {setupFeesDue > 0 && <span className="text-amber-400"> (Rp {setupFeesDue.toLocaleString("id-ID")} unpaid)</span>}
            </p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/superadmin/dashboard" className="text-neutral-300 hover:text-white">Dashboard</a>
            <a href="/superadmin/settings" className="text-neutral-300 hover:text-white">Settings</a>
            <LogoutButton />
          </nav>
        </div>

        <div className="mb-6">
          <CreateGymForm
            saasPlans={saasPlans.map((p) => ({
              id: p.id,
              name: p.name,
              price: p.price.toString(),
              billingInterval: p.billingInterval,
            }))}
          />
        </div>

        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-4 py-3">Gym</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Members</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Lifetime</th>
                <th className="px-4 py-3">Setup fee</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {gyms.map((gym) => {
                const setupFee = gym.platformPayments[0];
                return (
                  <tr key={gym.id} className="border-t border-neutral-800">
                    <td className="px-4 py-3 font-medium">{gym.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-400">{gym.slug}</td>
                    <td className="px-4 py-3">{gym.saasPlan.name}</td>
                    <td className="px-4 py-3">{gym._count.members}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={gym.subscriptionStatus} />
                    </td>
                    <td className="px-4 py-3">{gym.isLifetime ? "Yes" : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {!setupFee ? (
                        "—"
                      ) : (
                        <span className={setupFee.status === "PAID" ? "text-neutral-300" : "text-amber-400"}>
                          Rp {Number(setupFee.amount).toLocaleString("id-ID")}
                          <span className="ml-1 text-xs">{setupFee.status === "PAID" ? "paid" : "unpaid"}</span>
                        </span>
                      )}
                    </td>
                    <td className="w-[300px] px-4 py-3 align-top">
                      <GymActions gymId={gym.id} status={gym.subscriptionStatus} setupFeeDue={setupFee?.status === "PENDING"} transfer={transferByGym.get(gym.id) ?? null} waNumber={gym.whatsappConfig?.isActive ? gym.whatsappConfig.senderNumber : null} />
                    </td>
                  </tr>
                );
              })}
              {gyms.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-neutral-500">
                    No gyms yet.
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

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-emerald-950 text-emerald-400 border-emerald-800",
    TRIALING: "bg-blue-950 text-blue-400 border-blue-800",
    PAST_DUE: "bg-amber-950 text-amber-400 border-amber-800",
    SUSPENDED: "bg-red-950 text-red-400 border-red-800",
    CANCELLED: "bg-neutral-900 text-neutral-500 border-neutral-700",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${colors[status] ?? ""}`}>
      {status}
    </span>
  );
}

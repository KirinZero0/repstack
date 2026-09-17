import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BillingPage({ params }: { params: { slug: string } }) {
  let session, gym;
  try {
    ({ session, gym } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/g/${params.slug}/login`);
    throw err;
  }

  if (session.role !== "OWNER") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-red-400">403 — Only the gym owner can view billing.</p>
      </main>
    );
  }

  const [saasPlan, payments] = await Promise.all([
    prisma.saasPlan.findUnique({ where: { id: gym.saasPlanId } }),
    prisma.platformPayment.findMany({
      where: { gymId: gym.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-1 text-2xl font-semibold">Billing</h1>
        <p className="mb-8 text-sm text-neutral-400">{gym.name}</p>

        <div className="mb-8 rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <p className="text-sm text-neutral-400">Plan</p>
          <p className="mb-3 text-lg font-medium">{saasPlan?.name ?? "—"}</p>

          <div className="grid grid-cols-2 gap-4 text-sm">
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
        </div>

        <h2 className="mb-3 text-lg font-medium">Invoice history</h2>
        <div className="overflow-hidden rounded-xl border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-neutral-800">
                  <td className="px-4 py-3">{p.createdAt.toLocaleDateString("id-ID")}</td>
                  <td className="px-4 py-3">Rp {Number(p.amount).toLocaleString("id-ID")}</td>
                  <td className="px-4 py-3">{p.status}</td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-neutral-500">
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

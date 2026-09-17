import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession, SessionError } from "@/lib/session";
import { decrypt, maskPhone, maskEmail } from "@/lib/crypto";
import AddMemberForm from "./AddMemberForm";
import ResendFallbackButton from "./ResendFallbackButton";

export const dynamic = "force-dynamic";

export default async function MembersPage({ params }: { params: { slug: string } }) {
  let session, gym;
  try {
    ({ session, gym } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/g/${params.slug}/login`);
    throw err;
  }

  const [members, plans] = await Promise.all([
    prisma.member.findMany({
      where: { gymId: gym.id },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.membershipPlan.findMany({ where: { gymId: gym.id, isActive: true } }),
  ]);

  const rows = members.map((m) => ({
    id: m.id,
    fullName: m.fullName,
    email: maskEmail(m.email),
    phone: maskPhone(decrypt(m.phoneWhatsapp)),
    plan: m.plan.name,
    status: m.status,
    membershipExpiry: m.membershipExpiry?.toISOString() ?? null,
    activated: Boolean(m.passwordHash),
  }));

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Members</h1>
            <p className="text-sm text-neutral-400">{gym.name}</p>
          </div>
        </div>

        <div className="mb-6">
          <AddMemberForm
            slug={params.slug}
            plans={plans.map((p) => ({ id: p.id, name: p.name, price: p.price.toString() }))}
          />
        </div>

        <div className="overflow-hidden rounded-xl border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3">Activated</th>
                {session.role === "OWNER" && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-t border-neutral-800">
                  <td className="px-4 py-3">{m.fullName}</td>
                  <td className="px-4 py-3 text-neutral-400">{m.email}</td>
                  <td className="px-4 py-3 text-neutral-400">{m.phone}</td>
                  <td className="px-4 py-3">{m.plan}</td>
                  <td className="px-4 py-3">{m.status}</td>
                  <td className="px-4 py-3 text-neutral-400">
                    {m.membershipExpiry ? new Date(m.membershipExpiry).toLocaleDateString("id-ID") : "—"}
                  </td>
                  <td className="px-4 py-3">{m.activated ? "Yes" : "Pending"}</td>
                  {session.role === "OWNER" && (
                    <td className="px-4 py-3">
                      <ResendFallbackButton slug={params.slug} memberId={m.id} />
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-neutral-500">
                    No members yet.
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

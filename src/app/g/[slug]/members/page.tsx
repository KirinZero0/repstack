import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { decrypt, maskPhone, maskEmail } from "@/lib/crypto";
import AddMemberForm from "./AddMemberForm";
import ResendFallbackButton from "./ResendFallbackButton";

export const dynamic = "force-dynamic";

export default async function MembersPage({ params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/g/${params.slug}/login`);
    throw err;
  }

  const [members, plans] = await Promise.all([
    db.member.findMany({
      where: { gymId: gym.id },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    }),
    db.membershipPlan.findMany({ where: { gymId: gym.id, isActive: true } }),
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

        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3">Activated</th>
                <th className="px-4 py-3"></th>
                {session.role === "OWNER" && <th className="px-4 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className="border-t border-neutral-800">
                  <td className="px-4 py-3">
                    <a href={`/g/${params.slug}/members/${m.id}`} className="font-medium underline-offset-2 hover:underline">
                      {m.fullName}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-neutral-400">{m.email}</td>
                  <td className="px-4 py-3 text-neutral-400">{m.phone}</td>
                  <td className="px-4 py-3">{m.plan}</td>
                  <td className="px-4 py-3">{m.status}</td>
                  <td className="px-4 py-3 text-neutral-400">
                    {m.membershipExpiry ? new Date(m.membershipExpiry).toLocaleDateString("id-ID") : "—"}
                  </td>
                  <td className="px-4 py-3">{m.activated ? "Yes" : "Pending"}</td>
                  <td className="px-4 py-3">
                    <a
                      href={`/g/${params.slug}/members/${m.id}`}
                      className="whitespace-nowrap rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                    >
                      Record payment
                    </a>
                  </td>
                  {session.role === "OWNER" && (
                    <td className="px-4 py-3">
                      <ResendFallbackButton slug={params.slug} memberId={m.id} />
                    </td>
                  )}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-neutral-500">
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

import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { decrypt } from "@/lib/crypto";
import { countMemberSeats } from "@/lib/limits";
import GymNav from "@/components/GymNav";
import AddMemberForm from "./AddMemberForm";
import ImportMembersForm from "./ImportMembersForm";
import MembersTable from "./MembersTable";

export const dynamic = "force-dynamic";

export default async function MembersPage({ params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  const [members, plans, saasPlan, seats, pendingCount] = await Promise.all([
    db.member.findMany({
      where: { gymId: gym.id, anonymizedAt: null },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    }),
    db.membershipPlan.findMany({ where: { gymId: gym.id, isActive: true } }),
    db.saasPlan.findUnique({ where: { id: gym.saasPlanId } }),
    countMemberSeats(db, gym.id),
    db.memberSignup.count({ where: { gymId: gym.id, status: "PENDING_REVIEW" } }),
  ]);

  const rows = members.map((m) => ({
    id: m.id,
    fullName: m.fullName,
    email: m.email,
    phone: decrypt(m.phoneWhatsapp),
    plan: m.plan.name,
    status: m.status,
    membershipExpiry: m.membershipExpiry?.toISOString() ?? null,
    activated: Boolean(m.passwordHash),
  }));

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Members</h1>
            <p className="text-sm text-neutral-400">
              {gym.name}
              {saasPlan && (
                <span className={seats >= saasPlan.maxMembers ? "ml-3 text-amber-400" : "ml-3 text-neutral-500"}>
                  {seats.toLocaleString("id-ID")} of {saasPlan.maxMembers.toLocaleString("id-ID")} members on your plan
                </span>
              )}
            </p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="members" />
        </div>

        {pendingCount > 0 && (
          <a
            href={`/${params.slug}/members/requests`}
            className="mb-6 flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm hover:bg-amber-500/20"
          >
            <span>
              <strong>{pendingCount}</strong> pending join request{pendingCount === 1 ? "" : "s"} waiting for review
            </span>
            <span className="text-amber-400">Review →</span>
          </a>
        )}

        <div className="mb-6 flex flex-wrap items-start gap-3">
          <AddMemberForm
            slug={params.slug}
            plans={plans.map((p) => ({ id: p.id, name: p.name, price: p.price.toString() }))}
          />
          {session.role === "OWNER" && (
            <>
              <a
                href={`/api/${params.slug}/members/export`}
                download
                className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Export CSV
              </a>
              <div className="basis-full">
                <ImportMembersForm slug={params.slug} plans={plans.map((p) => ({ id: p.id, name: p.name }))} />
              </div>
            </>
          )}
        </div>

        <MembersTable slug={params.slug} isOwner={session.role === "OWNER"} rows={rows} />
      </div>
    </main>
  );
}

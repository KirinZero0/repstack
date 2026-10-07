import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import GymNav from "@/components/GymNav";
import PlansManager from "./PlansManager";

export const dynamic = "force-dynamic";

export default async function PlansPage({ params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  if (session.role !== "OWNER") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-red-400">403 — Only the gym owner can manage plans.</p>
      </main>
    );
  }

  const plans = await db.membershipPlan.findMany({
    where: { gymId: gym.id },
    orderBy: [{ isActive: "desc" }, { price: "asc" }],
    include: { _count: { select: { members: true } } },
  });

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="gym-head mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Membership plans</h1>
            <p className="text-sm text-neutral-400">{gym.name}</p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="plans" />
        </div>
        <PlansManager
          slug={params.slug}
          plans={plans.map((p) => ({
            id: p.id,
            name: p.name,
            durationDays: p.durationDays,
            price: Number(p.price),
            isActive: p.isActive,
            memberCount: p._count.members,
          }))}
        />
      </div>
    </main>
  );
}

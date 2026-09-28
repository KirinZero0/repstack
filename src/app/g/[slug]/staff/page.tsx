import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import GymNav from "@/components/GymNav";
import StaffManager from "./StaffManager";

export const dynamic = "force-dynamic";

export default async function StaffPage({ params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/g/${params.slug}/login`);
    throw err;
  }

  if (session.role !== "OWNER") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <p className="text-red-400">403 — Only the gym owner can manage staff.</p>
      </main>
    );
  }

  const [staff, plan] = await Promise.all([
    db.staffUser.findMany({ where: { gymId: gym.id }, orderBy: [{ role: "asc" }, { createdAt: "asc" }] }),
    db.saasPlan.findUnique({ where: { id: gym.saasPlanId } }),
  ]);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Staff</h1>
            <p className="text-sm text-neutral-400">{gym.name}</p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="staff" />
        </div>
        <StaffManager
          slug={params.slug}
          limit={plan?.maxStaff ?? 1}
          staff={staff.map((s) => ({
            id: s.id,
            name: s.name,
            email: s.email,
            phone: s.phone,
            role: s.role,
            isActive: s.isActive,
            createdAt: s.createdAt.toISOString(),
          }))}
        />
      </div>
    </main>
  );
}

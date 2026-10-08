import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { SEAT_HOLDING_STATUSES, effectiveCapacity, whenLabel } from "@/lib/classes";
import { ATTENDANCE_OPENS_BEFORE_MS } from "@/lib/validation/tenant";
import GymNav from "@/components/GymNav";
import ClassesManager, { type ClassRow } from "./ClassesManager";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Owner sets up classes and schedules sessions; owner and staff see rosters and confirm front-desk payments. */
export default async function ClassesPage({ params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  const now = new Date();
  const classes = await db.gymClass.findMany({
    where: { gymId: gym.id },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      sessions: {
        // Upcoming sessions plus yesterday's, so a roster is still there the morning after.
        where: { startsAt: { gte: new Date(now.getTime() - DAY_MS) } },
        orderBy: { startsAt: "asc" },
        take: 40,
        include: {
          registrations: {
            orderBy: { createdAt: "asc" },
            include: { member: { select: { fullName: true } }, payment: { select: { status: true, amount: true, provider: true } } },
          },
        },
      },
    },
  });

  const members = await db.member.findMany({
    where: { gymId: gym.id, anonymizedAt: null, status: { not: "CANCELLED" } },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true },
    take: 1000,
  });

  const rows: ClassRow[] = classes.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description ?? "",
    instructor: c.instructor ?? "",
    price: Number(c.price),
    capacity: c.capacity,
    durationMinutes: c.durationMinutes,
    isActive: c.isActive,
    sessions: c.sessions.map((s) => ({
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      label: whenLabel(s.startsAt, gym.timezone),
      status: s.status,
      capacity: effectiveCapacity(s, c),
      taken: s.registrations.filter((r) => (SEAT_HOLDING_STATUSES as readonly string[]).includes(r.status)).length,
      past: s.startsAt.getTime() <= now.getTime(),
      attendanceOpen: s.status !== "CANCELLED" && s.startsAt.getTime() - now.getTime() <= ATTENDANCE_OPENS_BEFORE_MS,
      registrations: s.registrations.map((r) => ({
        id: r.id,
        memberId: r.memberId,
        memberName: r.member.fullName,
        status: r.status,
        paid: r.payment?.status === "PAID",
        amount: r.payment?.status === "PAID" ? Number(r.payment.amount) : null,
        attendance: (r.attendance as "ATTENDED" | "NO_SHOW" | null) ?? null,
      })),
    })),
  }));

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <div className="gym-head mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Classes</h1>
            <p className="text-sm text-neutral-400">{gym.name}</p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="classes" />
        </div>
        <ClassesManager slug={params.slug} classes={rows} isOwner={session.role === "OWNER"} timezone={gym.timezone} members={members} />
      </div>
    </main>
  );
}

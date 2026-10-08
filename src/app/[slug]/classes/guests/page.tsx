import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { decrypt, maskPhone } from "@/lib/crypto";
import { dayKeyInTimezone } from "@/lib/date";
import { passTitle, passWhen, ticketTokenFor, ticketUrl } from "@/lib/guestPass";
import GymNav from "@/components/GymNav";
import DayPassPlans from "./DayPassPlans";
import GuestPassList, { type GuestPassRow } from "./GuestPassList";

export const dynamic = "force-dynamic";

/** Owner and staff review non-member requests for class spots; approving sends the one-time ticket. */
export default async function GuestPassesPage({ params }: { params: { slug: string } }) {
  let session, gym, db;
  try {
    ({ session, gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  const passes = await db.guestPass.findMany({
    where: {
      gymId: gym.id,
      OR: [
        { session: { startsAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
        { dayPassPlanId: { not: null }, visitDate: { gte: dayKeyInTimezone(new Date(Date.now() - 24 * 60 * 60 * 1000), gym.timezone) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { session: { include: { class: true } }, dayPassPlan: true },
  });

  const dayPassPlans = await db.dayPassPlan.findMany({ where: { gymId: gym.id }, orderBy: [{ isActive: "desc" }, { price: "asc" }] });

  const rows: GuestPassRow[] = passes.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    phone: maskPhone(decrypt(p.phoneWhatsapp)),
    className: passTitle(p),
    when: passWhen(p, gym.timezone),
    price: p.dayPassPlan ? Number(p.dayPassPlan.price) : null,
    status: p.status,
    ticketLink: p.status === "APPROVED" ? ticketUrl(ticketTokenFor(p)) : null,
  }));

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="gym-head mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <a href={`/${params.slug}/classes`} className="text-sm text-neutral-400 hover:text-white">← Classes</a>
            <h1 className="mt-2 text-2xl font-semibold">Guest tickets</h1>
            <p className="text-sm text-neutral-400">
              Non-members asking for a class spot or a day pass. Approve to send their one-time QR ticket; scan it on the check-in scanner.
            </p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="classes" />
        </div>
        <p className="mb-6 text-sm text-neutral-500">
          Guests request at <span className="text-neutral-300">/{params.slug}/guest-pass</span>.
        </p>
        {session.role === "OWNER" && (
          <DayPassPlans slug={params.slug} plans={dayPassPlans.map((p) => ({ id: p.id, name: p.name, price: Number(p.price), isActive: p.isActive }))} />
        )}
        <GuestPassList slug={params.slug} rows={rows} />
      </div>
    </main>
  );
}

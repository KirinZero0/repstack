import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { decrypt, maskPhone } from "@/lib/crypto";
import { dayKeyInTimezone } from "@/lib/date";
import { passTitle, passWhen, ticketTokenFor, ticketUrl } from "@/lib/guestPass";
import GymNav from "@/components/GymNav";
import GuestPassList, { type GuestPassRow } from "./GuestPassList";

export const dynamic = "force-dynamic";

/** Owner and staff review non-member requests (day passes and class spots); approving sends the one-time ticket. */
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

  const rows: GuestPassRow[] = passes.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    phone: maskPhone(decrypt(p.phoneWhatsapp)),
    className: passTitle(p),
    when: passWhen(p, gym.timezone),
    amount: p.amount === null ? 0 : Number(p.amount),
    hasProof: Boolean(p.proofImageUrl),
    status: p.status,
    ticketLink: p.status === "APPROVED" ? ticketUrl(ticketTokenFor(p)) : null,
  }));

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="gym-head mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <a href={`/${params.slug}/members`} className="text-sm text-neutral-400 hover:text-white">← Members</a>
            <h1 className="mt-2 text-2xl font-semibold">Guest tickets</h1>
            <p className="text-sm text-neutral-400">
              Non-members asking for a class spot or a day pass. Approve to send their one-time QR ticket; scan it on the check-in scanner.
            </p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="members" />
        </div>
        <p className="mb-6 text-sm text-neutral-500">
          Guests request day passes at <span className="text-neutral-300">/{params.slug}/join/day-pass</span> and class spots at <span className="text-neutral-300">/{params.slug}/guest-pass</span>.
        </p>
        <GuestPassList slug={params.slug} rows={rows} />
      </div>
    </main>
  );
}

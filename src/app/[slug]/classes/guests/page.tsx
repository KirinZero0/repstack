import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { decrypt, maskPhone } from "@/lib/crypto";
import { whenLabel } from "@/lib/classes";
import { ticketTokenFor, ticketUrl } from "@/lib/guestPass";
import GymNav from "@/components/GymNav";
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
    where: { gymId: gym.id, session: { startsAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: { session: { include: { class: true } } },
  });

  const rows: GuestPassRow[] = passes.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    phone: maskPhone(decrypt(p.phoneWhatsapp)),
    className: p.session.class.name,
    when: whenLabel(p.session.startsAt, gym.timezone),
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
              Non-members asking for a spot. Approve to send their one-time QR ticket; scan it on the check-in scanner.
            </p>
          </div>
          <GymNav slug={params.slug} role={session.role} current="classes" />
        </div>
        <p className="mb-6 text-sm text-neutral-500">
          Guests request at <span className="text-neutral-300">/{params.slug}/guest-pass</span>.
        </p>
        <GuestPassList slug={params.slug} rows={rows} />
      </div>
    </main>
  );
}

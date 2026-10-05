import { redirect } from "next/navigation";
import { requireTenantSession, SessionError } from "@/lib/session";
import { decrypt, maskPhone, maskEmail } from "@/lib/crypto";
import PendingRequests from "./PendingRequests";

export const dynamic = "force-dynamic";

export default async function PendingRequestsPage({ params }: { params: { slug: string } }) {
  let gym, db;
  try {
    ({ gym, db } = await requireTenantSession(params.slug));
  } catch (err) {
    if (err instanceof SessionError) redirect(`/${params.slug}/login`);
    throw err;
  }

  const pending = await db.memberSignup.findMany({
    where: { gymId: gym.id, status: "PENDING_REVIEW" },
    include: { plan: true },
    orderBy: { createdAt: "asc" },
  });

  const requests = pending.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    email: maskEmail(p.email),
    phone: maskPhone(decrypt(p.phoneWhatsapp)),
    plan: p.plan.name,
    amount: p.amount.toString(),
    createdAt: p.createdAt.toISOString(),
    hasProof: Boolean(p.proofImageUrl),
    kind: p.kind === "RENEWAL" ? ("RENEWAL" as const) : ("JOIN" as const),
  }));

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <a href={`/${params.slug}/members`} className="text-sm text-neutral-400 hover:text-white">← Members</a>
        <h1 className="mt-2 text-2xl font-semibold">Pending requests</h1>
        <p className="mb-8 text-sm text-neutral-400">
          Bank-transfer requests: people joining, and members renewing. Confirm the money arrived before approving.
        </p>

        {requests.length === 0 ? (
          <p className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-8 text-center text-neutral-500">
            No pending requests.
          </p>
        ) : (
          <PendingRequests slug={params.slug} requests={requests} />
        )}
      </div>
    </main>
  );
}

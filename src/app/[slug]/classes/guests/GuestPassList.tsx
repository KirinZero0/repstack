"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface GuestPassRow {
  id: string;
  fullName: string;
  phone: string;
  className: string;
  when: string;
  /** Day passes only: what the guest pays at the desk. */
  price: number | null;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "ATTENDED";
  ticketLink: string | null;
}

const LABEL: Record<GuestPassRow["status"], string> = {
  PENDING_REVIEW: "Waiting",
  APPROVED: "Ticket sent",
  REJECTED: "Declined",
  ATTENDED: "Attended",
};

const btn = "rounded-lg border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-900 disabled:opacity-50";

export default function GuestPassList({ slug, rows }: { slug: string; rows: GuestPassRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject" | "resend") {
    setBusy(id);
    setError(null);
    setNote(null);
    const res = await fetch(`/api/${slug}/guest-passes/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(body.error ?? "Something went wrong.");
    if (action === "resend") setNote("Ticket link sent again.");
    router.refresh();
  }

  if (rows.length === 0) {
    return <p className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-8 text-center text-neutral-500">No guest requests.</p>;
  }

  // Waiting first, then everything else in the order it arrived.
  const sorted = [...rows].sort((a, b) => Number(b.status === "PENDING_REVIEW") - Number(a.status === "PENDING_REVIEW"));

  return (
    <div>
      {error && <p className="mb-3 text-sm text-red-400" role="alert">{error}</p>}
      {note && <p className="mb-3 text-sm text-emerald-400">{note}</p>}
      <ul className="divide-y divide-neutral-800 border-y border-neutral-800">
        {sorted.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-4" data-testid="guest-row" data-status={r.status}>
            <div>
              <p className="font-medium">{r.fullName} <span className="text-sm text-neutral-500">{r.phone}</span></p>
              <p className="text-sm text-neutral-400">{r.className} · {r.when}{r.price !== null ? ` · Rp ${r.price.toLocaleString("id-ID")} at the desk` : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-400">{LABEL[r.status]}</span>
              {r.status === "PENDING_REVIEW" && (
                <>
                  <button className={btn} disabled={busy === r.id} onClick={() => act(r.id, "approve")}>Approve</button>
                  <button className={btn} disabled={busy === r.id} onClick={() => act(r.id, "reject")}>Decline</button>
                </>
              )}
              {r.status === "APPROVED" && (
                <>
                  <button className={btn} disabled={busy === r.id} onClick={() => act(r.id, "resend")}>Resend</button>
                  {r.ticketLink && (
                    <button className={btn} onClick={() => navigator.clipboard?.writeText(r.ticketLink!).then(() => setNote("Ticket link copied."))}>Copy link</button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

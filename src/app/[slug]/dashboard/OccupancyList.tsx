"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface PresentRow {
  checkInId: string;
  fullName: string;
  /** Wall-clock arrival time, already formatted in the gym's timezone. */
  sinceLabel: string;
}

/** The live "in the gym now" list on the staff dashboard, with a check-out per row for people who left without tapping out. */
export default function OccupancyList({ slug, rows, windowHours }: { slug: string; rows: PresentRow[]; windowHours: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkOut(id: string) {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/${slug}/checkins/${id}/checkout`, { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Could not check them out");
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-neutral-800">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-4 py-3">
        <h2 className="font-medium">In the gym now</h2>
        <span className="text-xs text-neutral-500">{`Checked in within the last ${windowHours} hour${windowHours === 1 ? "" : "s"} and not checked out`}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-neutral-500">Nobody right now.</p>
      ) : (
        <ul className="divide-y divide-neutral-800 text-sm">
          {rows.map((r) => (
            <li key={r.checkInId} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>
                {r.fullName}
                <span className="ml-2 text-neutral-500">since {r.sinceLabel}</span>
              </span>
              <button
                onClick={() => checkOut(r.checkInId)}
                disabled={busy === r.checkInId}
                className="rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50"
              >
                {busy === r.checkInId ? "…" : "Check out"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="px-4 pb-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}

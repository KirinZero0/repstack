"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Removes a check-in that was a mistake (wrong person, scanned twice). Asks first; nothing else is touched. */
export default function RemoveCheckInButton({ slug, checkInId, name }: { slug: string; checkInId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Remove ${name}'s check-in? It disappears from today's list and their visit count.`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/${slug}/checkins/${checkInId}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setError(typeof b.error === "string" ? b.error : "Could not remove it.");
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={remove}
        disabled={busy}
        title="Remove this check-in (it was a mistake)"
        className="rounded-md border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:border-red-800 hover:text-red-400 disabled:opacity-50"
      >
        {busy ? "…" : "Remove"}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}

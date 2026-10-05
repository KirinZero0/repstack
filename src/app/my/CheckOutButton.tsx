"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Shown while the member counts as "in the gym"; tapping it ends the visit for the live count. */
export default function CheckOutButton({ sinceLabel }: { sinceLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkOut() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/my/checkout", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Could not check out");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-900 bg-emerald-950/60 px-5 py-4 text-sm">
      <span className="text-emerald-300">
        You&apos;re checked in <span className="text-emerald-500">since {sinceLabel}</span>
      </span>
      <button
        onClick={checkOut}
        disabled={busy}
        className="rounded-md border border-emerald-700 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-900 disabled:opacity-50"
      >
        {busy ? "…" : "Check out"}
      </button>
      {error && <p className="basis-full text-red-400">{error}</p>}
    </div>
  );
}

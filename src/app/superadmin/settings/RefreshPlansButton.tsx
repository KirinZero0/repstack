"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Clears the landing page's cached plan prices, so a plan changed in the database shows there. */
export default function RefreshPlansButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh() {
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/superadmin/plans/refresh", { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setNote({ ok: false, text: typeof b.error === "string" ? b.error : "Couldn't refresh." });
    }
    setNote({ ok: true, text: "Refreshed. The landing page shows the current plans." });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={refresh}
        disabled={busy}
        className="rounded-md border border-neutral-600 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {busy ? "Refreshing…" : "Refresh plan prices"}
      </button>
      {note && <span className={`text-xs ${note.ok ? "text-emerald-400" : "text-red-400"}`}>{note.text}</span>}
    </div>
  );
}

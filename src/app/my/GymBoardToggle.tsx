"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Lets a member leave themselves off the "who's in the gym" list other members see. They still count in the head count. */
export default function GymBoardToggle({ hidden }: { hidden: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(hidden);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    setBusy(true);
    setError(null);
    setValue(next);
    const res = await fetch("/api/my/privacy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hideFromGymBoard: next }) });
    setBusy(false);
    if (!res.ok) {
      setValue(!next);
      setError("Couldn't save that. Try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-4 border-t border-neutral-800 pt-3">
      <label className="flex items-start gap-3 text-xs text-neutral-400">
        <input type="checkbox" checked={value} disabled={busy} onChange={(e) => change(e.target.checked)} className="mt-0.5 h-4 w-4" />
        <span>Hide me from other members. They won&apos;t see my name here when I&apos;m in the gym. Gym staff still can.</span>
      </label>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}

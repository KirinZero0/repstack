"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface FeatureRow {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

/** The superadmin's switches for the optional features this gym has been granted. */
export default function GymFeaturesForm({ gymId, features }: { gymId: string; features: FeatureRow[] }) {
  const router = useRouter();
  const [state, setState] = useState(Object.fromEntries(features.map((f) => [f.key, f.enabled])));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: string, enabled: boolean) {
    // Shown at once; put back if the server says no.
    setState((prev) => ({ ...prev, [key]: enabled }));
    setBusy(key);
    setError(null);
    const res = await fetch(`/api/superadmin/gyms/${gymId}/features`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature: key, enabled }),
    });
    setBusy(null);
    if (!res.ok) {
      setState((prev) => ({ ...prev, [key]: !enabled }));
      const b = await res.json().catch(() => ({}));
      return setError(typeof b.error === "string" ? b.error : "Couldn't change it.");
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {features.map((f) => (
        <label key={f.key} className="flex items-start gap-3 text-sm text-neutral-300">
          <input
            type="checkbox"
            checked={state[f.key]}
            disabled={busy === f.key}
            onChange={(e) => toggle(f.key, e.target.checked)}
            className="mt-0.5 h-4 w-4"
            aria-label={f.label}
          />
          <span>
            {f.label} <span className={state[f.key] ? "text-emerald-400" : "text-neutral-500"}>({state[f.key] ? "granted" : "not granted"})</span>
            <span className="mt-1 block text-neutral-500">{f.description}</span>
          </span>
        </label>
      ))}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

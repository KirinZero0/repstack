"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** A member erases their own account. Confirmed with their password; nothing is undone afterwards. */
export default function DeleteAccount() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function erase(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/my/erase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Couldn't delete your account.");
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-300">
        Delete my account and data
      </button>
    );
  }

  return (
    <form onSubmit={erase} className="max-w-md space-y-3 rounded-xl border border-red-900 p-5 text-sm">
      <p className="font-medium text-red-400">Delete your account</p>
      <p className="text-neutral-400">
        This erases your name, email, phone number and photo, and ends your membership right away with no refund. The gym keeps an
        anonymous record of payments for its accounts. This can&apos;t be undone.
      </p>
      <label htmlFor="deletePassword" className="block text-neutral-300">Enter your password to confirm</label>
      <input
        id="deletePassword"
        type="password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-neutral-500"
      />
      {error && <p className="text-red-400">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-red-600 px-4 py-2 font-medium text-[#ffffff] hover:bg-red-500 disabled:opacity-50">
          {busy ? "Deleting…" : "Delete everything"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-neutral-700 px-4 py-2 text-neutral-300 hover:bg-neutral-800">
          Cancel
        </button>
      </div>
    </form>
  );
}

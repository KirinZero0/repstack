"use client";

import { useState } from "react";
import AuthShell from "@/components/AuthShell";

export default function GlobalForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(typeof body.error === "string" ? body.error : "Something went wrong. Please try again.");
    setSent(true);
  }

  return (
    <AuthShell tagline="Your members, your check-ins, your revenue.">
      <div className="w-full">
        <h1 className="mb-1 text-2xl font-semibold text-white">Forgot your password?</h1>
        <p className="mb-6 text-sm text-neutral-400">Works for any gym on Liftmora.</p>

        {sent ? (
          <div>
            <p className="text-sm text-neutral-300">
              If that email has an account, we&apos;ve sent a WhatsApp message to the number on file with a link to set a new password. It works for one hour.
            </p>
            <p className="mt-4 text-sm text-neutral-500">
              Nothing arrived? Your WhatsApp number may not be saved on your account. Ask your gym (or your gym owner) for a reset link.
            </p>
            <a href="/login" className="mt-6 inline-block text-sm text-neutral-300 underline underline-offset-2 hover:text-white">
              Back to log in
            </a>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="email" className="mb-1 block text-sm text-neutral-300">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="mb-4 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-white outline-none focus:border-plate-blue"
            />
            {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-white py-2.5 font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">
              {busy ? "Sending…" : "Send me a link"}
            </button>
            <a href="/login" className="mt-4 block text-center text-sm text-neutral-500 hover:text-neutral-300">
              Back to log in
            </a>
          </form>
        )}
      </div>
    </AuthShell>
  );
}

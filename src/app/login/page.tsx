"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/AuthShell";

/** The one login for the whole platform — no gym address to type, email alone finds the account. */
export default function GlobalLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Login failed");
        return;
      }
      router.push(body.billingOnly ? `/${body.slug}/billing` : body.kind === "staff" ? `/${body.slug}/dashboard` : "/my");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell tagline="Your members, your check-ins, your revenue.">
      <form onSubmit={handleSubmit} className="w-full">
        <h1 className="mb-1 text-2xl font-semibold text-white">Log in</h1>
        <p className="mb-6 text-sm text-neutral-400">Staff and members both sign in here — no gym address to type.</p>

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

        <label htmlFor="password" className="mb-1 block text-sm text-neutral-300">Password</label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="mb-4 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-white outline-none focus:border-plate-blue"
        />

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-white py-2.5 font-semibold text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
          <span>New to Repstack? <a href="/signup" className="text-neutral-300 underline underline-offset-2 hover:text-white">Set up a gym</a></span>
          <a href="/forgot" className="text-neutral-300 underline underline-offset-2 hover:text-white">
            Forgot password?
          </a>
        </div>
      </form>
    </AuthShell>
  );
}

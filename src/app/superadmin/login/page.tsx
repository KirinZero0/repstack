"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/AuthShell";

export default function SuperadminLoginPage() {
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
      const res = await fetch("/api/superadmin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Login failed");
        return;
      }
      router.push("/superadmin/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell tagline="Every gym on the platform, on one page.">
      <form
        onSubmit={handleSubmit}
        className="w-full"
      >
        <h1 className="mb-1 text-2xl font-semibold text-white">Iron Ledger</h1>
        <p className="mb-6 text-sm text-neutral-400">Superadmin login</p>

        <label htmlFor="email" className="mb-1 block text-sm text-neutral-300">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-white outline-none focus:border-plate-blue"
        />

        <label htmlFor="password" className="mb-1 block text-sm text-neutral-300">Password</label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
      </form>
    </AuthShell>
  );
}

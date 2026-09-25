"use client";

import { useEffect, useState } from "react";
import AuthShell from "@/components/AuthShell";

interface Info {
  purpose: "reset" | "invite";
  name: string;
  gymName: string;
}

const inputCls =
  "mb-4 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-white outline-none focus:border-plate-blue";

export default function ResetPasswordPage({ params }: { params: { token: string } }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [dead, setDead] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/reset/${params.token}`)
      .then(async (res) => (res.ok ? setInfo(await res.json()) : setDead(true)))
      .catch(() => setDead(true));
  }, [params.token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Your password must be at least 8 characters.");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    const res = await fetch(`/api/reset/${params.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(typeof body.error === "string" ? body.error : "Something went wrong. Please try again.");
      if (res.status === 404) setDead(true);
      return;
    }
    setLoginUrl(body.loginUrl);
  }

  return (
    <AuthShell tagline="Your members, your check-ins, your revenue.">
      <div className="w-full">
        {loginUrl ? (
          <>
            <h1 className="mb-2 text-2xl font-semibold text-white">Password saved</h1>
            <p className="mb-6 text-sm text-neutral-400">You can log in with your new password now.</p>
            <a href={loginUrl} className="block w-full rounded-lg bg-white py-2.5 text-center font-semibold text-neutral-950 hover:bg-neutral-200">
              Go to log in
            </a>
          </>
        ) : dead ? (
          <>
            <h1 className="mb-2 text-2xl font-semibold text-white">This link no longer works</h1>
            <p className="text-sm text-neutral-400">
              It may have expired or already been used. Ask for a new one from the log in page, or ask your gym.
            </p>
          </>
        ) : !info ? (
          <p className="text-neutral-400">Loading…</p>
        ) : (
          <form onSubmit={submit}>
            <h1 className="mb-1 text-2xl font-semibold text-white">
              {info.purpose === "invite" ? `Welcome, ${info.name}` : `New password, ${info.name}`}
            </h1>
            <p className="mb-6 text-sm text-neutral-400">
              {info.purpose === "invite" ? `Choose a password to start using ${info.gymName}.` : `Choose a new password for ${info.gymName}.`}
            </p>

            <label htmlFor="password" className="mb-1 block text-sm text-neutral-300">New password</label>
            <input id="password" type="password" required minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={inputCls} />

            <label htmlFor="confirm" className="mb-1 block text-sm text-neutral-300">Repeat it</label>
            <input id="confirm" type="password" required minLength={8} maxLength={72} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" className={inputCls} />

            {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

            <button type="submit" disabled={busy} className="w-full rounded-lg bg-white py-2.5 font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">
              {busy ? "Saving…" : "Save password"}
            </button>
          </form>
        )}
      </div>
    </AuthShell>
  );
}

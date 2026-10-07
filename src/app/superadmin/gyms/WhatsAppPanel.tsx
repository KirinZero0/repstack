"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const inputCls = "w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-white";
const btnCls = "rounded-md border border-neutral-700 px-3 py-1 text-sm text-neutral-300 hover:bg-neutral-800 disabled:opacity-50";

/** Connects a gym's own Fonnte token. Gym owners can't do this themselves: the superadmin sets it up for them. */
export default function WhatsAppPanel({ gymId, connectedNumber }: { gymId: string; connectedNumber: string | null }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [number, setNumber] = useState(connectedNumber ?? "");
  const [testPhone, setTestPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const base = `/api/superadmin/gyms/${gymId}/whatsapp`;

  async function call(url: string, init: RequestInit, done: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(url, init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Something went wrong");
        return false;
      }
      setNote(done);
      return true;
    } finally {
      setBusy(false);
    }
  }

  const json = (method: string, data: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });

  return (
    <div className="w-72 space-y-3 rounded-md border border-neutral-700 bg-neutral-950 p-3 text-left text-xs">
      <p className="text-neutral-400">
        {connectedNumber ? <>Connected: <span className="text-neutral-200">{connectedNumber}</span></> : "Not connected: this gym sends from the platform number."}
      </p>
      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await call(base, json("POST", { token, senderNumber: number }), "Saved.")) {
            setToken("");
            router.refresh();
          }
        }}
      >
        <input inputMode="tel" placeholder="WhatsApp number" value={number} onChange={(e) => setNumber(e.target.value)} className={inputCls} />
        <input type="password" autoComplete="off" placeholder="Fonnte token" value={token} onChange={(e) => setToken(e.target.value)} className={inputCls} />
        <button type="submit" disabled={busy || !token || !number} className={btnCls}>{connectedNumber ? "Replace" : "Connect"}</button>
      </form>
      {connectedNumber && (
        <>
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              await call(`${base}/test`, json("POST", { phone: testPhone }), "Test message sent.");
            }}
          >
            <input inputMode="tel" placeholder="Send test to" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} className={inputCls} />
            <button type="submit" disabled={busy || !testPhone} className={btnCls}>Test</button>
          </form>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm("Disconnect this gym's number? It goes back to the platform number.")) return;
              if (await call(base, { method: "DELETE" }, "Disconnected.")) {
                setNumber("");
                router.refresh();
              }
            }}
            className="text-red-400 underline underline-offset-2 disabled:opacity-50"
          >
            Disconnect
          </button>
        </>
      )}
      {error && <p className="text-red-400">{error}</p>}
      {note && !error && <p className="text-emerald-400">{note}</p>}
    </div>
  );
}

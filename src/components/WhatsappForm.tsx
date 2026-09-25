"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const inputCls =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-plate-blue";

export default function WhatsappForm({
  slug,
  configured,
  initial,
  ownerPhone,
}: {
  slug: string;
  configured: boolean;
  initial: { provider: "fonnte" | "wablas"; senderNumber: string; isActive: boolean };
  ownerPhone: string;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState(initial.provider);
  const [senderNumber, setSenderNumber] = useState(initial.senderNumber);
  const [apiKey, setApiKey] = useState("");
  const [isActive, setIsActive] = useState(initial.isActive);
  const [phone, setPhone] = useState(ownerPhone);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ state: "idle" | "sending" | "ok" | "fail"; message?: string }>({ state: "idle" });
  const [keySaved, setKeySaved] = useState(configured);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved("saving");
    setError(null);
    const res = await fetch(`/api/g/${slug}/whatsapp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, senderNumber, apiKey: apiKey || undefined, isActive }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSaved("idle");
      setError(typeof body.error === "string" ? body.error : "Could not save.");
      return;
    }
    setSaved("saved");
    setKeySaved(true);
    setApiKey("");
    router.refresh();
  }

  async function sendTest() {
    setTest({ state: "sending" });
    const res = await fetch(`/api/g/${slug}/whatsapp/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phone || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.ok) setTest({ state: "ok", message: "Sent. Check your WhatsApp." });
    else setTest({ state: "fail", message: typeof body.error === "string" ? body.error : "The test failed." });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-neutral-300">
            <span className="mb-1 block">Gateway</span>
            <select value={provider} onChange={(e) => setProvider(e.target.value as typeof provider)} className={inputCls}>
              <option value="fonnte">Fonnte</option>
              <option value="wablas">Wablas</option>
            </select>
          </label>
          <label className="text-sm text-neutral-300">
            <span className="mb-1 block">Gym WhatsApp number</span>
            <input required value={senderNumber} onChange={(e) => setSenderNumber(e.target.value)} className={inputCls} inputMode="tel" placeholder="0812…" />
          </label>
        </div>
        <label className="block text-sm text-neutral-300">
          <span className="mb-1 block">API key / token</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required={!keySaved}
            autoComplete="off"
            className={inputCls}
            placeholder={keySaved ? "A key is saved. Type a new one to replace it." : "Paste the token from your gateway dashboard"}
          />
          <span className="mt-1 block text-xs text-neutral-500">Stored encrypted. It is never shown again after saving.</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4" />
          Send messages to members
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saved === "saving"} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">
            {saved === "saving" ? "Saving…" : "Save WhatsApp settings"}
          </button>
          {saved === "saved" && <span className="text-sm text-emerald-400">Saved</span>}
        </div>
      </form>

      {keySaved && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
          <p className="text-sm font-medium text-white">Check that it works</p>
          <p className="mt-1 text-xs text-neutral-500">Sends one message to your own WhatsApp number using the saved settings.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm text-neutral-300">
              <span className="mb-1 block">Your WhatsApp number</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} inputMode="tel" placeholder="0812…" />
            </label>
            <button
              type="button"
              onClick={sendTest}
              disabled={test.state === "sending"}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {test.state === "sending" ? "Sending…" : "Send test message"}
            </button>
          </div>
          {test.state === "ok" && <p className="mt-3 text-sm text-emerald-400">{test.message}</p>}
          {test.state === "fail" && <p className="mt-3 text-sm text-red-400">{test.message}</p>}
        </div>
      )}
    </div>
  );
}

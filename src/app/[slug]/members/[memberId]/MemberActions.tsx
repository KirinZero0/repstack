"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  slug: string;
  memberId: string;
  fullName: string;
  email: string;
  phone: string;
  planId: string;
  status: string;
  isOwner: boolean;
  plans: { id: string; name: string }[];
}

const field =
  "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-neutral-500";
const ghost = "rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50";

/** Freeze, cancel, edit and erase controls for one member. Owner-only actions are hidden from staff (and refused by the API). */
export default function MemberActions({ slug, memberId, fullName, email, phone, planId, status, isOwner, plans }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [form, setForm] = useState({ fullName, email, phone, planId });

  const base = `/api/${slug}/members/${memberId}`;

  async function call(url: string, method: string, body: unknown, done: string, after?: () => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Something went wrong.");
      return;
    }
    setNotice(done);
    after?.();
    router.refresh();
  }

  const act = (action: string, done: string) => call(base, "PATCH", { action }, done);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {status === "ACTIVE" && (
          <button type="button" disabled={busy} onClick={() => act("freeze", "Membership frozen. The clock is paused until you unfreeze.")} className={ghost}>
            Freeze
          </button>
        )}
        {status === "FROZEN" && (
          <button type="button" disabled={busy} onClick={() => act("unfreeze", "Membership unfrozen. The frozen days were added back.")} className={ghost}>
            Unfreeze
          </button>
        )}
        {isOwner && status !== "CANCELLED" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Cancel ${fullName}'s membership? Their QR code stops working immediately.`)) act("cancel", "Membership cancelled.");
            }}
            className={ghost}
          >
            Cancel membership
          </button>
        )}
        {isOwner && status === "CANCELLED" && (
          <button type="button" disabled={busy} onClick={() => act("reactivate", "Membership reactivated.")} className={ghost}>
            Reactivate
          </button>
        )}
        <button type="button" onClick={() => setEditing((v) => !v)} className={ghost}>
          {editing ? "Close editor" : "Edit details"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            call(base, "PATCH", { action: "edit", ...form }, "Details saved.", () => setEditing(false));
          }}
          className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-950 p-4"
        >
          <div>
            <label htmlFor="editName" className="mb-1 block text-sm text-neutral-300">Full name</label>
            <input id="editName" required minLength={2} maxLength={120} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={field} />
          </div>
          <div>
            <label htmlFor="editEmail" className="mb-1 block text-sm text-neutral-300">Email (their login)</label>
            <input id="editEmail" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
          </div>
          <div>
            <label htmlFor="editPhone" className="mb-1 block text-sm text-neutral-300">WhatsApp number</label>
            <input id="editPhone" required minLength={6} maxLength={30} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={field} />
          </div>
          <div>
            <label htmlFor="editPlan" className="mb-1 block text-sm text-neutral-300">Plan</label>
            <select id="editPlan" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })} className={field}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
              {!plans.some((p) => p.id === planId) && <option value={planId}>Current plan (no longer on sale)</option>}
            </select>
          </div>
          <button type="submit" disabled={busy} className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </form>
      )}

      {isOwner && (
        <div className="border-t border-neutral-800 pt-4">
          {!erasing ? (
            <button type="button" onClick={() => setErasing(true)} className="text-sm text-neutral-500 underline underline-offset-2 hover:text-red-400">
              Erase this member&apos;s personal data…
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                call(`${base}/erase`, "POST", { confirmName }, "Erased.", () => router.push(`/${slug}/members`));
              }}
              className="space-y-3 rounded-lg border border-red-900 p-4 text-sm"
            >
              <p className="font-medium text-red-400">Erase personal data</p>
              <p className="text-neutral-400">
                Removes the name, email, phone number, photo and login, and cancels the membership. Payments stay in your books,
                anonymised. Use this for a member&apos;s privacy request. It can&apos;t be undone.
              </p>
              <label htmlFor="confirmName" className="block text-neutral-300">
                Type <span className="font-semibold">{fullName}</span> to confirm
              </label>
              <input id="confirmName" required value={confirmName} onChange={(e) => setConfirmName(e.target.value)} className={field} autoComplete="off" />
              <div className="flex gap-3">
                <button type="submit" disabled={busy} className="rounded-md bg-red-600 px-4 py-2 font-medium text-[#ffffff] hover:bg-red-500 disabled:opacity-50">
                  {busy ? "Erasing…" : "Erase permanently"}
                </button>
                <button type="button" onClick={() => setErasing(false)} className={ghost}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

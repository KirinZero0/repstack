"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "OWNER" | "STAFF";
  isActive: boolean;
  createdAt: string;
}

const inputCls =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-plate-blue";
const ghost = "whitespace-nowrap rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50";

function LinkBox({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-plate-yellow/60 bg-neutral-950 p-4">
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-1 text-xs text-neutral-500">
        This link works once and is shown only now. If they have a WhatsApp number on file it was sent there too; otherwise give it to them yourself.
      </p>
      <p className="mt-3 break-all rounded bg-neutral-900 px-3 py-2 text-sm text-white">{url}</p>
      <div className="mt-3 flex gap-3">
        <button
          onClick={() => {
            navigator.clipboard?.writeText(url);
            setCopied(true);
          }}
          className={ghost}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <button onClick={onClose} className={ghost}>
          Done
        </button>
      </div>
    </div>
  );
}

export default function StaffManager({ slug, staff, limit }: { slug: string; staff: StaffRow[]; limit: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ title: string; url: string } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const activeCount = staff.filter((s) => s.isActive).length;
  const full = activeCount >= limit;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/g/${slug}/staff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, email: form.email, phone: form.phone || undefined }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError({ field: body.field, message: body.error ?? "Could not add staff." });
    setLink({ title: `Invite link for ${form.name}`, url: body.inviteUrl });
    setForm({ name: "", email: "", phone: "" });
    setOpen(false);
    router.refresh();
  }

  async function setActive(id: string, isActive: boolean) {
    setRowError(null);
    const res = await fetch(`/api/g/${slug}/staff/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      return setRowError(b.error ?? "Could not update.");
    }
    router.refresh();
  }

  async function newLink(id: string, name: string) {
    setRowError(null);
    const res = await fetch(`/api/g/${slug}/staff/${id}/reset-link`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setRowError(body.error ?? "Could not create a link.");
    setLink({ title: `Password link for ${name}`, url: body.url });
  }

  return (
    <div className="space-y-6">
      {link && <LinkBox title={link.title} url={link.url} onClose={() => setLink(null)} />}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        {open ? (
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-neutral-300">
              <span className="mb-1 block">Name</span>
              <input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
            </label>
            <label className="text-sm text-neutral-300">
              <span className="mb-1 block">Email (they log in with this)</span>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
              {error?.field === "email" && <span className="mt-1 block text-xs text-red-400">{error.message}</span>}
            </label>
            <label className="text-sm text-neutral-300">
              <span className="mb-1 block">WhatsApp (optional)</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} inputMode="tel" placeholder="0812…" />
            </label>
            {error && error.field !== "email" && <p className="col-span-full text-sm text-red-400">{error.message}</p>}
            <div className="col-span-full flex items-center gap-3">
              <button type="submit" disabled={busy} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">
                {busy ? "Adding…" : "Add staff member"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className={ghost}>
                Cancel
              </button>
              <span className="text-xs text-neutral-500">They set their own password from a link, so you never handle it.</span>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <button onClick={() => setOpen(true)} disabled={full} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">
              + Add staff
            </button>
            <span className="text-sm text-neutral-400">
              {activeCount} of {limit} staff accounts used
              {full && " · your plan is full"}
            </span>
          </div>
        )}
      </div>

      {rowError && <p className="text-sm text-red-400">{rowError}</p>}

      <div className="overflow-x-auto rounded-xl border border-neutral-800">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="px-4 py-3 font-normal">Name</th>
              <th className="px-4 py-3 font-normal">Email</th>
              <th className="px-4 py-3 font-normal">Role</th>
              <th className="px-4 py-3 font-normal">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="border-t border-neutral-800">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3 text-neutral-400">{s.email}</td>
                <td className="px-4 py-3">{s.role === "OWNER" ? "Owner" : "Staff"}</td>
                <td className="px-4 py-3">
                  <span className={s.isActive ? "text-emerald-400" : "text-neutral-500"}>{s.isActive ? "Active" : "Deactivated"}</span>
                </td>
                <td className="flex justify-end gap-2 px-4 py-3">
                  {s.role === "STAFF" && s.isActive && (
                    <button onClick={() => newLink(s.id, s.name)} className={ghost}>
                      New password link
                    </button>
                  )}
                  {s.role === "STAFF" && (
                    <button onClick={() => setActive(s.id, !s.isActive)} className={ghost}>
                      {s.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-500">
        Staff can add members, record payments and run the check-in scanner. Only owners see finance, plans, billing and settings. Deactivating someone cuts their access right away.
      </p>
    </div>
  );
}

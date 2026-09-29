"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface RegistrationRow {
  id: string;
  memberName: string;
  status: "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED";
  paid: boolean;
  amount: number | null;
}

export interface SessionRow {
  id: string;
  startsAt: string;
  label: string;
  status: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  capacity: number | null;
  taken: number;
  past: boolean;
  registrations: RegistrationRow[];
}

export interface ClassRow {
  id: string;
  name: string;
  description: string;
  instructor: string;
  price: number;
  capacity: number | null;
  durationMinutes: number;
  isActive: boolean;
  sessions: SessionRow[];
}

const inputCls =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-plate-blue";
const btnCls = "rounded-lg bg-white px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50";
const ghostCls = "whitespace-nowrap rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50";
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

type ClassInput = { name: string; description: string; instructor: string; price: number; capacity: number | null; durationMinutes: number };

async function call(url: string, method: "POST" | "PATCH", body: unknown): Promise<{ error: string | null; data: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) return { error: typeof data.error === "string" ? data.error : "Something went wrong. Try again.", data };
  return { error: null, data };
}

function ClassForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ClassInput;
  submitLabel: string;
  onSubmit: (v: ClassInput) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [v, setV] = useState({
    name: initial.name,
    description: initial.description,
    instructor: initial.instructor,
    price: String(initial.price),
    capacity: initial.capacity === null ? "" : String(initial.capacity),
    durationMinutes: String(initial.durationMinutes),
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        const err = await onSubmit({
          name: v.name,
          description: v.description,
          instructor: v.instructor,
          price: Number(v.price),
          capacity: v.capacity === "" ? null : Number(v.capacity),
          durationMinutes: Number(v.durationMinutes),
        });
        setSaving(false);
        if (err) setError(err);
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Class name</span>
        <input required minLength={2} maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={inputCls} placeholder="Yoga" />
      </label>
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Instructor (optional)</span>
        <input maxLength={80} value={v.instructor} onChange={(e) => setV({ ...v, instructor: e.target.value })} className={inputCls} />
      </label>
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Price (Rp) — 0 for free</span>
        <input required type="number" min={0} step={1000} value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} className={inputCls} />
      </label>
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Length (minutes)</span>
        <input required type="number" min={5} max={600} value={v.durationMinutes} onChange={(e) => setV({ ...v, durationMinutes: e.target.value })} className={inputCls} />
      </label>
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Seats per session (blank = unlimited)</span>
        <input type="number" min={1} max={1000} value={v.capacity} onChange={(e) => setV({ ...v, capacity: e.target.value })} className={inputCls} />
      </label>
      <label className="text-sm text-neutral-300 sm:col-span-2">
        <span className="mb-1 block">Description (optional, shown to members and on your public page)</span>
        <textarea maxLength={1000} rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} className={inputCls} />
      </label>
      {error && <p className="col-span-full text-sm text-red-400">{error}</p>}
      <div className="col-span-full flex items-center gap-2">
        <button type="submit" disabled={saving} className={btnCls}>
          {saving ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={ghostCls}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function ScheduleForm({ slug, classId, defaultCapacity, onDone }: { slug: string; classId: string; defaultCapacity: number | null; onDone: () => void }) {
  const [startsAt, setStartsAt] = useState("");
  const [weeks, setWeeks] = useState("1");
  const [capacity, setCapacity] = useState(defaultCapacity === null ? "" : String(defaultCapacity));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);
        const { error } = await call(`/api/${slug}/classes/${classId}/sessions`, "POST", {
          startsAt,
          repeatWeeks: Number(weeks),
          capacity: capacity === "" ? null : Number(capacity),
        });
        setSaving(false);
        if (error) return setError(error);
        onDone();
      }}
      className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto]"
    >
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">First session</span>
        <input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputCls} aria-label="First session" />
      </label>
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Repeat weekly, times</span>
        <input required type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(e.target.value)} className={inputCls} aria-label="Repeat weekly" />
      </label>
      <label className="text-sm text-neutral-300">
        <span className="mb-1 block">Seats (blank = class default)</span>
        <input type="number" min={1} max={1000} value={capacity} onChange={(e) => setCapacity(e.target.value)} className={inputCls} aria-label="Seats" />
      </label>
      <div className="flex items-end">
        <button type="submit" disabled={saving} className={btnCls}>
          {saving ? "Scheduling…" : "Schedule"}
        </button>
      </div>
      {error && <p className="col-span-full text-sm text-red-400">{error}</p>}
    </form>
  );
}

function Roster({ slug, session, isOwner, price, onChanged }: { slug: string; session: SessionRow; isOwner: boolean; price: number; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function confirm(r: RegistrationRow) {
    const raw = window.prompt(`Amount received from ${r.memberName} (Rp)`, String(price));
    if (raw === null) return;
    const amount = Number(raw.replace(/[^\d]/g, ""));
    if (!Number.isFinite(amount)) return setError("Enter a whole number of rupiah.");
    setBusy(r.id);
    setError(null);
    const { error } = await call(`/api/${slug}/class-registrations/${r.id}/confirm`, "POST", { amount });
    setBusy(null);
    if (error) return setError(error);
    onChanged();
  }

  async function cancelSession() {
    if (!window.confirm(`Cancel this session? Everyone booked (${session.taken}) will be told by WhatsApp.`)) return;
    setBusy("session");
    setError(null);
    const { error } = await call(`/api/${slug}/class-sessions/${session.id}`, "PATCH", { action: "cancel" });
    setBusy(null);
    if (error) return setError(error);
    onChanged();
  }

  return (
    <div className="border-t border-neutral-800 bg-neutral-950 px-4 py-3">
      {session.registrations.length === 0 ? (
        <p className="text-sm text-neutral-500">Nobody booked yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-800 text-sm">
          {session.registrations.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{r.memberName}</span>
              <span className="flex items-center gap-3">
                {r.status === "CONFIRMED" ? (
                  <span className="text-emerald-400">Confirmed{r.amount !== null ? ` · ${rp(r.amount)}` : " · free"}</span>
                ) : (
                  <>
                    <span className="text-amber-400">Waiting for payment</span>
                    {session.status === "SCHEDULED" && (
                      <button onClick={() => confirm(r)} disabled={busy === r.id} className={ghostCls}>
                        {busy === r.id ? "Saving…" : "Record payment"}
                      </button>
                    )}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {isOwner && session.status === "SCHEDULED" && !session.past && (
        <div className="mt-3">
          <button onClick={cancelSession} disabled={busy === "session"} className="text-xs text-red-400 hover:underline disabled:opacity-50">
            Cancel this session
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export default function ClassesManager({ slug, classes, isOwner, timezone }: { slug: string; classes: ClassRow[]; isOwner: boolean; timezone: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const refresh = () => router.refresh();

  return (
    <div className="space-y-6">
      {isOwner && (
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          {creating ? (
            <>
              <h2 className="mb-4 text-sm font-medium text-neutral-300">New class</h2>
              <ClassForm
                initial={{ name: "", description: "", instructor: "", price: 50000, capacity: null, durationMinutes: 60 }}
                submitLabel="Create class"
                onSubmit={async (v) => {
                  const { error } = await call(`/api/${slug}/classes`, "POST", v);
                  if (!error) {
                    setCreating(false);
                    refresh();
                  }
                  return error;
                }}
                onCancel={() => setCreating(false)}
              />
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <button onClick={() => setCreating(true)} className={btnCls}>
                + New class
              </button>
              <span className="text-sm text-neutral-400">Set up a class type, then schedule when it runs. Members book from their dashboard.</span>
            </div>
          )}
        </div>
      )}

      {rowError && <p className="text-sm text-red-400">{rowError}</p>}

      {classes.length === 0 && (
        <p className="rounded-xl border border-neutral-800 px-4 py-8 text-center text-sm text-neutral-500">
          {isOwner ? "No classes yet. Create your first one above." : "The owner hasn't set up any classes yet."}
        </p>
      )}

      {classes.map((c) => (
        <section key={c.id} className={`rounded-xl border border-neutral-800 ${c.isActive ? "" : "opacity-70"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3 bg-neutral-900 px-4 py-4">
            {editing === c.id ? (
              <div className="w-full">
                <ClassForm
                  initial={c}
                  submitLabel="Save changes"
                  onSubmit={async (v) => {
                    const { error } = await call(`/api/${slug}/classes/${c.id}`, "PATCH", v);
                    if (!error) {
                      setEditing(null);
                      refresh();
                    }
                    return error;
                  }}
                  onCancel={() => setEditing(null)}
                />
                <p className="mt-2 text-xs text-neutral-500">Price changes apply to new bookings only.</p>
              </div>
            ) : (
              <>
                <div>
                  <h2 className="text-lg font-semibold">
                    {c.name}
                    {!c.isActive && <span className="ml-2 text-xs font-normal text-neutral-500">Hidden</span>}
                  </h2>
                  <p className="text-sm text-neutral-400">
                    {c.price === 0 ? "Free" : rp(c.price)} · {c.durationMinutes} min · {c.capacity === null ? "unlimited seats" : `${c.capacity} seats`}
                    {c.instructor && ` · ${c.instructor}`}
                  </p>
                  {c.description && <p className="mt-1 max-w-xl text-sm text-neutral-500">{c.description}</p>}
                </div>
                {isOwner && (
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setScheduling(scheduling === c.id ? null : c.id)} className={ghostCls}>
                      {scheduling === c.id ? "Close" : "Schedule sessions"}
                    </button>
                    <button onClick={() => setEditing(c.id)} className={ghostCls}>
                      Edit
                    </button>
                    <button
                      onClick={async () => {
                        setRowError(null);
                        const { error } = await call(`/api/${slug}/classes/${c.id}`, "PATCH", { isActive: !c.isActive });
                        if (error) return setRowError(error);
                        refresh();
                      }}
                      className={ghostCls}
                    >
                      {c.isActive ? "Hide" : "Show"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {scheduling === c.id && isOwner && (
            <div className="border-t border-neutral-800 px-4 py-4">
              <p className="mb-3 text-xs text-neutral-500">Times are in the gym&apos;s timezone ({timezone}). Repeating creates one session per week — each can be cancelled on its own.</p>
              <ScheduleForm
                slug={slug}
                classId={c.id}
                defaultCapacity={c.capacity}
                onDone={() => {
                  setScheduling(null);
                  refresh();
                }}
              />
            </div>
          )}

          <div className="border-t border-neutral-800">
            {c.sessions.length === 0 ? (
              <p className="px-4 py-4 text-sm text-neutral-500">No upcoming sessions.</p>
            ) : (
              <ul>
                {c.sessions.map((s) => (
                  <li key={s.id} className="border-b border-neutral-800 last:border-0">
                    <button
                      type="button"
                      onClick={() => setOpenSession(openSession === s.id ? null : s.id)}
                      className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-neutral-900"
                      aria-expanded={openSession === s.id}
                    >
                      <span className={s.status === "CANCELLED" ? "text-neutral-500 line-through" : ""}>{s.label}</span>
                      <span className="flex items-center gap-3 text-neutral-400">
                        {s.status === "CANCELLED" ? (
                          <span className="text-red-400">Cancelled</span>
                        ) : (
                          <span className={s.capacity !== null && s.taken >= s.capacity ? "text-amber-400" : ""}>
                            {s.taken}
                            {s.capacity !== null ? ` / ${s.capacity}` : ""} booked
                          </span>
                        )}
                        <span aria-hidden="true">{openSession === s.id ? "▾" : "▸"}</span>
                      </span>
                    </button>
                    {openSession === s.id && <Roster slug={slug} session={s} isOwner={isOwner} price={c.price} onChanged={refresh} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

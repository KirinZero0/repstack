"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export interface RegistrationRow {
  id: string;
  memberId: string;
  memberName: string;
  status: "PENDING_PAYMENT" | "CONFIRMED" | "CANCELLED";
  paid: boolean;
  amount: number | null;
  attendance: "ATTENDED" | "NO_SHOW" | null;
}

export interface SessionRow {
  id: string;
  startsAt: string;
  label: string;
  status: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  capacity: number | null;
  taken: number;
  past: boolean;
  /** True from 30 minutes before start: staff can mark who turned up. */
  attendanceOpen: boolean;
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

async function call(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<{ error: string | null; data: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
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

export interface MemberOption {
  id: string;
  fullName: string;
}

function AddMember({ slug, session, members, onChanged }: { slug: string; session: SessionRow; members: MemberOption[]; onChanged: () => void }) {
  const [memberId, setMemberId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const booked = new Set(session.registrations.filter((r) => r.status !== "CANCELLED").map((r) => r.memberId));
  const options = members.filter((m) => !booked.has(m.id));

  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!memberId) return;
        setBusy(true);
        setError(null);
        const { error } = await call(`/api/${slug}/class-sessions/${session.id}/registrations`, "POST", { memberId });
        setBusy(false);
        if (error) return setError(error);
        setMemberId("");
        onChanged();
      }}
    >
      <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={`${inputCls} max-w-xs`} aria-label="Member to add">
        <option value="">Add a member…</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.fullName}
          </option>
        ))}
      </select>
      <button type="submit" disabled={busy || !memberId} className={ghostCls}>
        {busy ? "Adding…" : "Add to class"}
      </button>
      {error && <p className="w-full text-sm text-red-400">{error}</p>}
    </form>
  );
}

function Roster({ slug, session, isOwner, price, members, onChanged }: { slug: string; session: SessionRow; isOwner: boolean; price: number; members: MemberOption[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [notice, setNotice] = useState<string | null>(null);

  async function remind(r?: RegistrationRow) {
    if (!r && !window.confirm(`Send a reminder to everyone booked (${session.taken})?`)) return;
    setBusy(r ? `remind-${r.id}` : "remind-all");
    setError(null);
    setNotice(null);
    const { error, data } = await call(`/api/${slug}/class-sessions/${session.id}/remind`, "POST", r ? { registrationId: r.id } : {});
    setBusy(null);
    if (error) return setError(error);
    setNotice(`Reminder sent to ${data.reminded as number} ${data.reminded === 1 ? "member" : "members"}.`);
  }

  async function removeBooking(r: RegistrationRow) {
    const deleting = r.status === "CANCELLED";
    if (!window.confirm(deleting ? `Delete ${r.memberName}'s cancelled booking for good?` : `Cancel ${r.memberName}'s unpaid booking?`)) return;
    setBusy(r.id);
    setError(null);
    const { error } = await call(`/api/${slug}/class-registrations/${r.id}`, "DELETE");
    setBusy(null);
    if (error) return setError(error);
    onChanged();
  }

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

  async function deleteSession() {
    if (!window.confirm("Delete this session? It has no active or paid bookings; any cancelled ones are removed with it.")) return;
    setBusy("session");
    setError(null);
    const { error } = await call(`/api/${slug}/class-sessions/${session.id}`, "DELETE");
    setBusy(null);
    if (error) return setError(error);
    onChanged();
  }

  async function mark(r: RegistrationRow, attendance: "ATTENDED" | "NO_SHOW") {
    setBusy(r.id);
    setError(null);
    // Clicking the mark already set clears it, so a slip can be undone.
    const next = r.attendance === attendance ? null : attendance;
    const { error } = await call(`/api/${slug}/class-registrations/${r.id}/attendance`, "POST", { attendance: next });
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
                {session.attendanceOpen && r.status !== "CANCELLED" && (
                  <span className="flex items-center gap-1" role="group" aria-label={`Attendance for ${r.memberName}`}>
                    <button
                      onClick={() => mark(r, "ATTENDED")}
                      disabled={busy === r.id}
                      aria-pressed={r.attendance === "ATTENDED"}
                      className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${r.attendance === "ATTENDED" ? "border-emerald-600 bg-emerald-950 text-emerald-300" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}
                    >
                      Attended
                    </button>
                    <button
                      onClick={() => mark(r, "NO_SHOW")}
                      disabled={busy === r.id}
                      aria-pressed={r.attendance === "NO_SHOW"}
                      className={`rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${r.attendance === "NO_SHOW" ? "border-red-800 bg-red-950 text-red-300" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}
                    >
                      No-show
                    </button>
                  </span>
                )}
                {r.status !== "CANCELLED" && session.status === "SCHEDULED" && !session.past && (
                  <button onClick={() => remind(r)} disabled={busy === `remind-${r.id}`} className={ghostCls}>
                    {busy === `remind-${r.id}` ? "Sending…" : "Remind"}
                  </button>
                )}
                {r.status === "CANCELLED" ? (
                  <>
                    <span className="text-neutral-500">Cancelled</span>
                    {!r.paid && (
                      <button onClick={() => removeBooking(r)} disabled={busy === r.id} className={`${ghostCls} hover:border-red-800 hover:text-red-400`}>
                        {busy === r.id ? "Deleting…" : "Delete"}
                      </button>
                    )}
                  </>
                ) : r.status === "CONFIRMED" ? (
                  <span className="text-emerald-400">Confirmed{r.amount !== null ? ` · ${rp(r.amount)}` : " · free"}</span>
                ) : (
                  <>
                    <span className="text-amber-400">Waiting for payment</span>
                    {session.status === "SCHEDULED" && (
                      <button onClick={() => confirm(r)} disabled={busy === r.id} className={ghostCls}>
                        {busy === r.id ? "Saving…" : "Record payment"}
                      </button>
                    )}
                    <button onClick={() => removeBooking(r)} disabled={busy === r.id} className={`${ghostCls} hover:border-red-800 hover:text-red-400`}>
                      Cancel booking
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {session.status === "SCHEDULED" && !session.past && session.taken > 0 && (
        <button onClick={() => remind()} disabled={busy === "remind-all"} className={`${ghostCls} mt-3`}>
          {busy === "remind-all" ? "Sending…" : "Remind everyone"}
        </button>
      )}
      {session.status === "SCHEDULED" && !session.past && <AddMember slug={slug} session={session} members={members} onChanged={onChanged} />}
      {isOwner && session.status === "SCHEDULED" && (
        <div className="mt-3 flex gap-4">
          {!session.past && (
            <button onClick={cancelSession} disabled={busy === "session"} className="text-xs text-red-400 hover:underline disabled:opacity-50">
              Cancel this session
            </button>
          )}
          {session.registrations.every((r) => r.status === "CANCELLED" && !r.paid) && (
            <button onClick={deleteSession} disabled={busy === "session"} className="text-xs text-neutral-400 hover:text-red-400 hover:underline disabled:opacity-50">
              Delete this session
            </button>
          )}
        </div>
      )}
      {notice && <p className="mt-2 text-sm text-emerald-400">{notice}</p>}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}

const VIEW_KEY = "liftmora.classesView";

/** Compact tile for the grid view: what the class is, what's next, and whether anything needs attention. */
function ClassCard({ c, onOpen }: { c: ClassRow; onOpen: () => void }) {
  const upcoming = c.sessions.filter((s) => s.status !== "CANCELLED" && !s.past);
  const next = upcoming[0];
  const waiting = c.sessions.reduce((n, s) => n + (s.status === "SCHEDULED" ? s.registrations.filter((r) => r.status === "PENDING_PAYMENT").length : 0), 0);
  const full = next && next.capacity !== null && next.taken >= next.capacity;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex h-full flex-col rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-left transition hover:border-neutral-600 hover:bg-neutral-800/60 ${c.isActive ? "" : "opacity-70"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold leading-snug">{c.name}</h2>
        {!c.isActive && <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] text-neutral-500">Hidden</span>}
      </div>
      <p className="mt-1 text-sm text-neutral-400">
        {c.price === 0 ? "Free" : rp(c.price)} · {c.durationMinutes} min
      </p>
      <p className="text-xs text-neutral-500">
        {c.capacity === null ? "Unlimited seats" : `${c.capacity} seats`}
        {c.instructor && ` · ${c.instructor}`}
      </p>

      <div className="mt-4 flex-1 rounded-lg bg-neutral-950 px-3 py-2 text-sm">
        {next ? (
          <>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Next session</p>
            <p className="mt-0.5 text-neutral-200">{next.label}</p>
            <p className={`text-xs ${full ? "text-amber-400" : "text-neutral-400"}`}>
              {next.taken}
              {next.capacity !== null ? ` / ${next.capacity}` : ""} booked{full ? " · full" : ""}
            </p>
          </>
        ) : (
          <p className="text-neutral-500">No upcoming sessions</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-neutral-500">{upcoming.length} upcoming</span>
        {waiting > 0 && <span className="rounded-full bg-amber-950 px-2 py-0.5 text-amber-400">{waiting} awaiting payment</span>}
        <span className="ml-auto text-neutral-400">Open ›</span>
      </div>
    </button>
  );
}

function ViewToggle({ view, onChange }: { view: "grid" | "list"; onChange: (v: "grid" | "list") => void }) {
  const opt = (v: "grid" | "list", label: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      aria-pressed={view === v}
      className={`px-3 py-1.5 text-xs ${view === v ? "bg-white font-semibold text-neutral-950" : "text-neutral-300 hover:bg-neutral-800"}`}
    >
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Classes layout" className="inline-flex overflow-hidden rounded-lg border border-neutral-700">
      {opt("grid", "Grid")}
      {opt("list", "List")}
    </div>
  );
}

export default function ClassesManager({ slug, classes, isOwner, timezone, members }: { slug: string; classes: ClassRow[]; isOwner: boolean; timezone: string; members: MemberOption[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [openClass, setOpenClass] = useState<string | null>(null);
  const refresh = () => router.refresh();

  // Remember the layout per browser. Read after mount so the server and first client render agree.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved === "grid" || saved === "list") setView(saved);
    } catch {}
  }, []);
  function chooseView(v: "grid" | "list") {
    setView(v);
    setOpenClass(null);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {}
  }

  const renderSection = (c: ClassRow) => (
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
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Delete "${c.name}" and its sessions? This only works for a class nobody has booked.`)) return;
                        setRowError(null);
                        const { error } = await call(`/api/${slug}/classes/${c.id}`, "DELETE");
                        if (error) return setRowError(error);
                        refresh();
                      }}
                      className={`${ghostCls} hover:border-red-800 hover:text-red-400`}
                    >
                      Delete
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
                    {openSession === s.id && <Roster slug={slug} session={s} isOwner={isOwner} price={c.price} members={members} onChanged={refresh} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
  );

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

      {classes.length > 0 && (
        <div className="flex justify-end">
          <ViewToggle view={view} onChange={chooseView} />
        </div>
      )}

      {rowError && <p className="text-sm text-red-400">{rowError}</p>}

      {classes.length === 0 && (
        <p className="rounded-xl border border-neutral-800 px-4 py-8 text-center text-sm text-neutral-500">
          {isOwner ? "No classes yet. Create your first one above." : "The owner hasn't set up any classes yet."}
        </p>
      )}

      {view === "list" ? (
        classes.map((c) => renderSection(c))
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classes.map((c) =>
            openClass === c.id ? (
              <div key={c.id} className="col-span-full space-y-3">
                <button type="button" onClick={() => setOpenClass(null)} className={ghostCls}>
                  ‹ Back to all classes
                </button>
                {renderSection(c)}
              </div>
            ) : (
              <ClassCard key={c.id} c={c} onOpen={() => setOpenClass(c.id)} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

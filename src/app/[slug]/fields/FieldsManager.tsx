"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import ChannelPicker, { type Channel } from "@/components/ChannelPicker";
import { clock } from "@/lib/fieldBooking";

export interface FieldRow {
  id: string;
  name: string;
  sport: string;
  pricePerHour: number;
  pricingType: "PER_FIELD" | "PER_PAX";
  maxPax: number | null;
  opensAt: number;
  closesAt: number;
  stepMinutes: number;
  isActive: boolean;
  opensLabel: string;
  closesLabel: string;
}

export interface BookingRow {
  id: string;
  fieldId: string;
  fieldName: string;
  fullName: string;
  phone: string;
  email: string | null;
  date: string;
  /** Minutes after local midnight on the day being shown (0 for the requests list). */
  start: number;
  end: number;
  startLabel: string;
  endLabel: string;
  amount: number;
  /** How many people, on a per-person field. */
  pax: number | null;
  /** What has been paid so far (refunds taken off). */
  paid: number;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "CANCELLED" | "ATTENDED" | "NO_SHOW";
  isBlock: boolean;
  note: string | null;
  hasProof: boolean;
  window: "EARLY" | "OPEN" | "OVER";
  hasContact: boolean;
}

const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const btn = "whitespace-nowrap rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-50";
const primary = "whitespace-nowrap rounded-md bg-white px-3 py-1 text-xs font-medium text-neutral-950 hover:bg-neutral-200 disabled:opacity-50";
const input = "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-neutral-500";
const STATUS_LABEL: Record<BookingRow["status"], string> = {
  PENDING_REVIEW: "Waiting",
  APPROVED: "Booked",
  REJECTED: "Declined",
  CANCELLED: "Cancelled",
  ATTENDED: "Came",
  NO_SHOW: "No-show",
};
const SEGMENT: Record<BookingRow["status"], string> = {
  PENDING_REVIEW: "bg-neutral-700",
  APPROVED: "bg-plate-yellow text-neutral-950",
  REJECTED: "bg-neutral-700",
  CANCELLED: "bg-neutral-700",
  ATTENDED: "bg-emerald-500 text-neutral-950",
  NO_SHOW: "bg-red-500 text-neutral-950",
};

async function call(url: string, method: string, body?: unknown): Promise<{ error: string | null; data: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { error: res.ok ? null : typeof data.error === "string" ? data.error : "Something went wrong.", data };
}

/** What a booking has paid against what it costs now: settled, owes, or owed back. */
function Balance({ b }: { b: BookingRow }) {
  if (b.status === "PENDING_REVIEW" || b.amount === 0) return null;
  const owing = b.amount - b.paid;
  if (owing > 0) return <span className="ml-2 text-amber-400" data-testid="owes">owes {rp(owing)}</span>;
  if (owing < 0) return <span className="ml-2 text-sky-400" data-testid="refund-due">refund due {rp(-owing)}</span>;
  return <span className="ml-2 text-emerald-400">paid</span>;
}

function Lane({ field, bookings }: { field: FieldRow; bookings: BookingRow[] }) {
  const span = field.closesAt - field.opensAt;
  return (
    <div className="relative h-9 rounded-md border border-neutral-800 bg-neutral-900" aria-label={`${field.name} timeline`}>
      {bookings.map((b) => {
        const left = Math.max(0, ((b.start - field.opensAt) / span) * 100);
        const width = Math.min(100 - left, ((Math.min(b.end, field.closesAt) - Math.max(b.start, field.opensAt)) / span) * 100);
        if (width <= 0) return null;
        return (
          <div
            key={b.id}
            title={`${b.startLabel}–${b.endLabel} ${b.isBlock ? "Blocked" : b.fullName}`}
            className={`absolute top-1 bottom-1 overflow-hidden rounded px-1.5 text-[11px] leading-7 ${b.isBlock ? "bg-neutral-600 text-white" : SEGMENT[b.status]}`}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            {b.isBlock ? "Blocked" : b.fullName}
          </div>
        );
      })}
    </div>
  );
}

export default function FieldsManager({
  slug,
  isOwner,
  date,
  today,
  fields,
  dayBookings,
  pending,
}: {
  slug: string;
  isOwner: boolean;
  date: string;
  today: string;
  fields: FieldRow[];
  dayBookings: BookingRow[];
  pending: BookingRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function act(b: BookingRow, action: string, channel?: Channel) {
    if (action === "cancel" && !window.confirm(`Cancel ${b.fullName}'s booking? The time is freed and their ticket stops working.`)) return;
    setBusy(b.id);
    setError(null);
    setNote(null);
    const { error: err } = await call(`/api/${slug}/field-bookings/${b.id}`, "POST", channel ? { action, channel } : { action });
    setBusy(null);
    if (err) return setError(err);
    if (action === "resend") setNote(`Ticket sent again by ${channel === "email" ? "email" : "WhatsApp"}.`);
    router.refresh();
  }

  /** Change how many people a booking is for; the price follows, and the screen shows what's now owed. */
  async function editPax(b: BookingRow) {
    const v = window.prompt(`How many people for ${b.fullName}? (now ${b.pax})`, String(b.pax ?? ""));
    if (v === null) return;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) return setError("Enter a whole number of people.");
    setBusy(b.id);
    setError(null);
    setNote(null);
    const { error: err, data } = await call(`/api/${slug}/field-bookings/${b.id}`, "POST", { action: "edit_pax", pax: n });
    setBusy(null);
    if (err) return setError(err);
    const bal = Number(data.balance ?? 0);
    setNote(`Now ${n} ${n === 1 ? "person" : "people"}, ${rp(Number(data.amount))}.${bal > 0 ? ` ${rp(bal)} is owed.` : bal < 0 ? ` ${rp(-bal)} is owed back.` : ""}`);
    router.refresh();
  }

  /** Record the extra money collected for the difference, or money handed back. */
  async function settle(b: BookingRow, action: "collect" | "refund") {
    const sum = Math.abs(b.amount - b.paid);
    if (!window.confirm(action === "collect" ? `Collect ${rp(sum)} from ${b.fullName}?` : `Refund ${rp(sum)} to ${b.fullName}?`)) return;
    setBusy(b.id);
    setError(null);
    setNote(null);
    const { error: err } = await call(`/api/${slug}/field-bookings/${b.id}`, "POST", { action });
    setBusy(null);
    if (err) return setError(err);
    setNote(action === "collect" ? `Recorded ${rp(sum)} collected.` : `Recorded ${rp(sum)} refunded.`);
    router.refresh();
  }

  async function remove(b: BookingRow) {
    if (!window.confirm(b.isBlock ? "Remove this block?" : `Delete ${b.fullName}'s booking?`)) return;
    setBusy(b.id);
    setError(null);
    const { error: err } = await call(`/api/${slug}/field-bookings/${b.id}`, "DELETE");
    setBusy(null);
    if (err) return setError(err);
    router.refresh();
  }

  return (
    <div className="space-y-10">
      {error && <p className="rounded-lg border border-red-900 bg-red-950 px-4 py-2 text-sm text-red-300" role="alert">{error}</p>}
      {note && <p className="text-sm text-emerald-400">{note}</p>}

      <section aria-labelledby="requests">
        <h2 id="requests" className="mb-3 text-lg font-semibold">Booking requests</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-neutral-500">No requests waiting.</p>
        ) : (
          <ul className="divide-y divide-neutral-800 border-y border-neutral-800">
            {pending.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-4" data-testid="booking-request" data-status={b.status}>
                <div>
                  <p className="font-medium">
                    {b.fullName} <span className="text-sm text-neutral-500">{b.phone}{b.email ? ` · ${b.email}` : ""}</span>
                  </p>
                  <p className="text-sm text-neutral-400">
                    {b.fieldName} · {b.date} {b.startLabel}–{b.endLabel}{b.pax ? ` · ${b.pax} ${b.pax === 1 ? "person" : "people"}` : ""} · {b.amount > 0 ? rp(b.amount) : "free"}
                  </p>
                  {b.amount > 0 && (
                    <p className="text-sm text-neutral-500">
                      {b.hasProof ? (
                        <a href={`/api/${slug}/field-bookings/${b.id}/proof`} target="_blank" rel="noreferrer" className="text-neutral-300 underline underline-offset-2 hover:text-white">
                          View transfer proof
                        </a>
                      ) : (
                        "No proof attached. Check your bank before approving."
                      )}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {b.pax !== null && <button className={btn} disabled={busy === b.id} onClick={() => editPax(b)}>Edit people</button>}
                  <button className={primary} disabled={busy === b.id} onClick={() => act(b, "approve")}>
                    {b.amount > 0 ? "Payment received, approve" : "Approve"}
                  </button>
                  <button className={btn} disabled={busy === b.id} onClick={() => act(b, "reject")}>Decline</button>
                  <button className={`${btn} hover:border-red-800 hover:text-red-400`} disabled={busy === b.id} onClick={() => remove(b)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="day">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="day" className="text-lg font-semibold">{date === today ? "Today" : date}</h2>
          <label className="flex items-center gap-2 text-sm text-neutral-400">
            Day
            <input type="date" value={date} onChange={(e) => e.target.value && router.push(`/${slug}/fields?date=${e.target.value}`)} className={`${input} w-auto`} aria-label="Day" />
          </label>
        </div>
        {fields.length === 0 ? (
          <p className="text-sm text-neutral-500">{isOwner ? "Add a field below to start taking bookings." : "No fields yet. Ask the owner to add one."}</p>
        ) : (
          <div className="space-y-6">
            {fields.map((f) => {
              const list = dayBookings.filter((b) => b.fieldId === f.id);
              return (
                <div key={f.id} data-testid="field-day">
                  <p className="mb-1 text-sm font-medium">
                    {f.name} <span className="text-neutral-500">{f.opensLabel}–{f.closesLabel}{f.isActive ? "" : " · off"}</span>
                  </p>
                  <Lane field={f} bookings={list} />
                  {list.length > 0 && (
                    <ul className="mt-2 divide-y divide-neutral-800">
                      {list.map((b) => (
                        <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid="booking-row" data-status={b.status}>
                          <span>
                            {b.startLabel}–{b.endLabel} · {b.isBlock ? `Blocked${b.note ? `: ${b.note}` : ""}` : b.fullName}
                            {!b.isBlock && <span className="text-neutral-500"> {b.phone}</span>}
                            {!b.isBlock && b.pax !== null && <span className="text-neutral-500"> · {b.pax} {b.pax === 1 ? "person" : "people"}</span>}
                            {!b.isBlock && b.amount > 0 && <span className="text-neutral-500"> · {rp(b.amount)}</span>}
                            {!b.isBlock && <Balance b={b} />}
                            <span className="ml-2 text-neutral-400">{STATUS_LABEL[b.status]}</span>
                          </span>
                          <span className="flex flex-wrap items-center gap-2">
                            {b.pax !== null && (b.status === "APPROVED" || b.status === "ATTENDED") && (
                              <button className={btn} disabled={busy === b.id} onClick={() => editPax(b)}>Edit people</button>
                            )}
                            {!b.isBlock && b.amount - b.paid > 0 && b.status !== "PENDING_REVIEW" && (
                              <button className={primary} disabled={busy === b.id} onClick={() => settle(b, "collect")}>Collect {rp(b.amount - b.paid)}</button>
                            )}
                            {!b.isBlock && b.amount - b.paid < 0 && isOwner && (
                              <button className={btn} disabled={busy === b.id} onClick={() => settle(b, "refund")}>Refund {rp(b.paid - b.amount)}</button>
                            )}
                            {b.status === "APPROVED" && !b.isBlock && b.window !== "EARLY" && (
                              <button className={btn} disabled={busy === b.id} onClick={() => act(b, "attend")}>Came</button>
                            )}
                            {b.status === "APPROVED" && !b.isBlock && b.window === "OVER" && (
                              <button className={btn} disabled={busy === b.id} onClick={() => act(b, "noshow")}>No-show</button>
                            )}
                            {b.status === "APPROVED" && !b.isBlock && b.window !== "OVER" && b.hasContact && (
                              <ChannelPicker label="Resend ticket" className={btn} busy={busy === b.id} onPick={(c) => act(b, "resend", c)} />
                            )}
                            {b.status === "APPROVED" && !b.isBlock && (
                              <button className={`${btn} hover:border-red-800 hover:text-red-400`} disabled={busy === b.id} onClick={() => act(b, "cancel")}>Cancel</button>
                            )}
                            {b.isBlock && (
                              <button className={`${btn} hover:border-red-800 hover:text-red-400`} disabled={busy === b.id} onClick={() => remove(b)}>Remove</button>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {fields.length > 0 && <ManualBooking slug={slug} date={date} fields={fields.filter((f) => f.isActive)} />}
      {isOwner && <FieldSetup slug={slug} fields={fields} />}
    </div>
  );
}

function timeOptions(f: FieldRow, from: number, to: number) {
  const out: number[] = [];
  for (let m = from; m <= to; m += f.stepMinutes) out.push(m);
  return out;
}

function ManualBooking({ slug, date, fields }: { slug: string; date: string; fields: FieldRow[] }) {
  const router = useRouter();
  const [fieldId, setFieldId] = useState(fields[0]?.id ?? "");
  const [day, setDay] = useState(date);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [isBlock, setIsBlock] = useState(false);
  const [pax, setPax] = useState("2");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [noteText, setNoteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const field = fields.find((f) => f.id === fieldId);
  if (!field) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    const { error: err } = await call(`/api/${slug}/field-bookings/manual`, "POST", {
      fieldId,
      date: day,
      start,
      end,
      isBlock,
      pax: field?.pricingType === "PER_PAX" && !isBlock ? Number(pax) : undefined,
      fullName: fullName || undefined,
      phone: phone || undefined,
      note: noteText || undefined,
    });
    setBusy(false);
    if (err) return setError(err);
    setDone(true);
    setFullName("");
    setPhone("");
    setNoteText("");
    router.refresh();
  }

  return (
    <section aria-labelledby="manual">
      <h2 id="manual" className="mb-3 text-lg font-semibold">Add a booking or block time</h2>
      <p className="mb-3 text-sm text-neutral-500">For someone who phoned or walked in and paid at the counter, or to close a field for maintenance. It takes the time straight away.</p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-neutral-300">
          <span className="mb-1 block">Field</span>
          <select value={fieldId} onChange={(e) => { setFieldId(e.target.value); setStart(""); setEnd(""); }} className={input} aria-label="Booking field">
            {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="text-sm text-neutral-300">
          <span className="mb-1 block">Day</span>
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className={input} aria-label="Booking day" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm text-neutral-300">
            <span className="mb-1 block">From</span>
            <select value={start} onChange={(e) => setStart(e.target.value)} className={input} aria-label="Booking from">
              <option value="" />
              {timeOptions(field, field.opensAt, field.closesAt - field.stepMinutes).map((m) => <option key={m} value={clock(m)}>{clock(m)}</option>)}
            </select>
          </label>
          <label className="text-sm text-neutral-300">
            <span className="mb-1 block">Until</span>
            <select value={end} onChange={(e) => setEnd(e.target.value)} className={input} aria-label="Booking until">
              <option value="" />
              {timeOptions(field, field.opensAt + field.stepMinutes, field.closesAt).map((m) => <option key={m} value={clock(m)}>{clock(m)}</option>)}
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-300 sm:col-span-3">
          <input type="checkbox" checked={isBlock} onChange={(e) => setIsBlock(e.target.checked)} className="h-4 w-4" />
          Block this time instead (maintenance, an event). No guest, no payment.
        </label>
        {!isBlock && field.pricingType === "PER_PAX" && (
          <label className="text-sm text-neutral-300">
            <span className="mb-1 block">How many people</span>
            <input type="number" min={1} value={pax} onChange={(e) => setPax(e.target.value)} className={input} aria-label="Booking people" />
          </label>
        )}
        {!isBlock && (
          <>
            <label className="text-sm text-neutral-300">
              <span className="mb-1 block">Name</span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={input} maxLength={80} aria-label="Booking name" />
            </label>
            <label className="text-sm text-neutral-300">
              <span className="mb-1 block">WhatsApp (optional)</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={input} maxLength={30} aria-label="Booking phone" />
            </label>
          </>
        )}
        <label className="text-sm text-neutral-300">
          <span className="mb-1 block">Note (optional)</span>
          <input value={noteText} onChange={(e) => setNoteText(e.target.value)} className={input} maxLength={200} aria-label="Booking note" />
        </label>
        <div className="sm:col-span-3">
          <button className={primary} disabled={busy || !start || !end}>{busy ? "Saving…" : isBlock ? "Block the time" : "Add booking"}</button>
          {error && <span className="ml-3 text-sm text-red-400" role="alert">{error}</span>}
          {done && <span className="ml-3 text-sm text-emerald-400">Saved</span>}
        </div>
      </form>
    </section>
  );
}

function FieldSetup({ slug, fields }: { slug: string; fields: FieldRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", sport: "Badminton", pricePerHour: "50000", pricingType: "PER_FIELD", maxPax: "", opensAt: "08:00", closesAt: "22:00", stepMinutes: "30" });
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await call(`/api/${slug}/fields`, "POST", {
      name: form.name,
      sport: form.sport,
      pricePerHour: Number(form.pricePerHour),
      pricingType: form.pricingType,
      maxPax: form.pricingType === "PER_PAX" && form.maxPax ? Number(form.maxPax) : null,
      opensAt: form.opensAt,
      closesAt: form.closesAt,
      stepMinutes: Number(form.stepMinutes),
    });
    setBusy(false);
    if (err) return setError(err);
    setForm({ ...form, name: "" });
    router.refresh();
  }

  async function patch(f: FieldRow, body: Record<string, unknown>) {
    setError(null);
    const { error: err } = await call(`/api/${slug}/fields/${f.id}`, "PATCH", body);
    if (err) return setError(err);
    router.refresh();
  }

  async function remove(f: FieldRow) {
    if (!window.confirm(`Delete ${f.name}?`)) return;
    const { error: err } = await call(`/api/${slug}/fields/${f.id}`, "DELETE");
    if (err) return setError(err);
    router.refresh();
  }

  return (
    <section aria-labelledby="setup">
      <h2 id="setup" className="mb-3 text-lg font-semibold">Fields</h2>
      {fields.length > 0 && (
        <ul className="mb-6 divide-y divide-neutral-800 border-y border-neutral-800">
          {fields.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm" data-testid="field-row">
              <span>
                <span className="font-medium">{f.name}</span> <span className="text-neutral-500">{f.sport} · {rp(f.pricePerHour)} {f.pricingType === "PER_PAX" ? `per person an hour${f.maxPax ? ` (up to ${f.maxPax})` : ""}` : "an hour"} · {f.opensLabel}–{f.closesLabel} · every {f.stepMinutes} min{f.isActive ? "" : " · off"}</span>
              </span>
              <span className="flex gap-2">
                <button className={btn} onClick={() => {
                  const v = window.prompt("Price per hour (Rp)", String(f.pricePerHour));
                  if (v && Number(v) >= 0) patch(f, { pricePerHour: Number(v) });
                }}>Change price</button>
                <button className={btn} onClick={() => patch(f, { isActive: !f.isActive })}>{f.isActive ? "Switch off" : "Switch on"}</button>
                <button className={`${btn} hover:border-red-800 hover:text-red-400`} onClick={() => remove(f)}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-neutral-300"><span className="mb-1 block">Name</span><input required minLength={2} maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} aria-label="Field name" placeholder="Court 1" /></label>
        <label className="text-sm text-neutral-300"><span className="mb-1 block">Sport</span><input required value={form.sport} onChange={(e) => setForm({ ...form, sport: e.target.value })} className={input} aria-label="Sport" /></label>
        <label className="text-sm text-neutral-300"><span className="mb-1 block">Priced</span>
          <select value={form.pricingType} onChange={(e) => setForm({ ...form, pricingType: e.target.value })} className={input} aria-label="Pricing">
            <option value="PER_FIELD">Per field (one price for the whole field)</option>
            <option value="PER_PAX">Per person (price depends on how many play)</option>
          </select>
        </label>
        <label className="text-sm text-neutral-300"><span className="mb-1 block">{form.pricingType === "PER_PAX" ? "Price per person an hour (Rp)" : "Price per hour (Rp)"}</span><input required type="number" min={0} step={1000} value={form.pricePerHour} onChange={(e) => setForm({ ...form, pricePerHour: e.target.value })} className={input} aria-label="Price per hour" /></label>
        {form.pricingType === "PER_PAX" && (
          <label className="text-sm text-neutral-300"><span className="mb-1 block">Most people per booking (optional)</span><input type="number" min={1} max={200} value={form.maxPax} onChange={(e) => setForm({ ...form, maxPax: e.target.value })} className={input} aria-label="Most people" placeholder="No limit" /></label>
        )}
        <label className="text-sm text-neutral-300"><span className="mb-1 block">Opens</span><input required type="time" value={form.opensAt} onChange={(e) => setForm({ ...form, opensAt: e.target.value })} className={input} aria-label="Opens" /></label>
        <label className="text-sm text-neutral-300"><span className="mb-1 block">Closes (24:00 = midnight)</span><input required value={form.closesAt} onChange={(e) => setForm({ ...form, closesAt: e.target.value })} className={input} aria-label="Closes" placeholder="22:00" /></label>
        <label className="text-sm text-neutral-300"><span className="mb-1 block">Book in steps of</span>
          <select value={form.stepMinutes} onChange={(e) => setForm({ ...form, stepMinutes: e.target.value })} className={input} aria-label="Step">
            <option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option>
          </select>
        </label>
        <div className="sm:col-span-3">
          <button className={primary} disabled={busy}>{busy ? "Adding…" : "Add field"}</button>
          {error && <span className="ml-3 text-sm text-red-400" role="alert">{error}</span>}
        </div>
      </form>
    </section>
  );
}

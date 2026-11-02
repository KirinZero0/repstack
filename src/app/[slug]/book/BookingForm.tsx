"use client";

import { useEffect, useMemo, useState } from "react";
import TransferPayment, { type BankInfo, rupiah } from "@/components/TransferPayment";
import { bookingAmount, clock, endTimes, parseClock, roomAt, type FieldPricingType, type MinuteRange } from "@/lib/fieldBooking";

export interface FieldOption {
  id: string;
  name: string;
  sport: string;
  pricePerHour: number;
  pricingType: FieldPricingType;
  maxPax: number | null;
  minPax: number | null;
  opensAt: number;
  closesAt: number;
  stepMinutes: number;
}

interface Availability {
  free: MinuteRange[];
  busy: MinuteRange[];
}

const input =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-white outline-none placeholder:text-neutral-500 focus:border-plate-blue";

/** "1h 30m" for a length in minutes. */
function length(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
}

export default function BookingForm({ slug, fields, bank, today, last }: { slug: string; fields: FieldOption[]; bank: BankInfo | null; today: string; last: string }) {
  const [fieldId, setFieldId] = useState(fields[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [startText, setStartText] = useState("");
  const [end, setEnd] = useState<number | null>(null);
  const [pax, setPax] = useState("2");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const field = fields.find((f) => f.id === fieldId)!;

  // What is free changes with the field and the day.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStartText("");
    setEnd(null);
    fetch(`/api/${slug}/fields/${fieldId}/availability?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((a: Availability | null) => !cancelled && setAvail(a))
      .catch(() => !cancelled && setAvail(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug, fieldId, date]);

  // The start is any minute, typed; it counts once it sits in a free stretch with room for one whole block.
  const free = useMemo(() => (avail?.free ?? []).filter((r) => r.end - r.start >= field.stepMinutes), [avail, field.stepMinutes]);
  const typed = parseClock(startText);
  const range = typed === null ? null : roomAt(free, typed, field.stepMinutes);
  const start = range ? typed : null;

  // An end is a whole number of blocks later, inside the same free stretch, up to the longest booking.
  const ends = useMemo(() => (start !== null && range ? endTimes(field.stepMinutes, start, range.end) : []), [start, range, field.stepMinutes]);

  const perPax = field.pricingType === "PER_PAX";
  const people = Number(pax);
  const price = start !== null && end !== null ? bookingAmount(field.pricingType, field.pricePerHour, perPax ? (Number.isInteger(people) && people > 0 ? people : 0) : null, end - start) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (start === null || end === null) return setError("Pick your start and end time.");
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("fieldId", fieldId);
      fd.set("date", date);
      fd.set("start", clock(start));
      fd.set("end", clock(end));
      if (perPax) fd.set("pax", pax);
      fd.set("fullName", fullName);
      fd.set("phone", phone);
      fd.set("email", email.trim());
      if (proof && price > 0) fd.set("proof", proof);
      const res = await fetch(`/api/${slug}/field-bookings`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "Something went wrong. Please try again.");
      else setSent(true);
    } catch {
      setError("Network problem. Check your connection and try again.");
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6" data-testid="booking-request-sent">
        <p className="text-lg font-medium">Request sent</p>
        <p className="mt-2 text-neutral-400">
          The gym will review it{price > 0 ? " and check your payment" : ""}. The time is held for you once it&apos;s approved, and your QR ticket then arrives by email and on WhatsApp.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm text-neutral-300">
          <span className="mb-1 block">Field</span>
          <select value={fieldId} onChange={(e) => setFieldId(e.target.value)} className={input} aria-label="Field">
            {fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} · {f.sport}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-neutral-300">
          <span className="mb-1 block">Day</span>
          <input type="date" value={date} min={today} max={last} onChange={(e) => e.target.value && setDate(e.target.value)} className={input} aria-label="Day" />
        </label>
      </div>
      <p className="-mt-3 text-sm text-neutral-500">
        Open {clock(field.opensAt)} to {clock(field.closesAt)} · {rupiah(field.pricePerHour)} {perPax ? "per person an hour" : "an hour"}
      </p>

      {perPax && (
        <label className="block text-sm text-neutral-300">
          <span className="mb-1 block">How many people{field.minPax && field.maxPax ? ` (${field.minPax} to ${field.maxPax})` : field.maxPax ? ` (up to ${field.maxPax})` : field.minPax ? ` (at least ${field.minPax})` : ""}</span>
          <input type="number" min={field.minPax ?? 1} max={field.maxPax ?? 200} required value={pax} onChange={(e) => setPax(e.target.value)} className={input} aria-label="How many people" />
          <span className="mt-1 block text-neutral-500">The price depends on this. If more people come, you pay the difference at the front desk.</span>
        </label>
      )}

      {avail && (avail.busy.length > 0) && (
        <p className="text-sm text-neutral-500" data-testid="booked-times">
          Already booked: {avail.busy.map((b) => `${clock(b.start)}–${clock(b.end)}`).join(", ")}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Checking the times…</p>
      ) : free.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-300" data-testid="nothing-free">
          Nothing is free on this day. Try another day.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-neutral-300">
            <span className="mb-1 block">From (any minute)</span>
            <input
              type="time"
              step={60}
              value={startText}
              onChange={(e) => {
                setStartText(e.target.value);
                setEnd(null);
              }}
              className={input}
              aria-label="From"
            />
            {typed !== null && start === null && (
              <span className="mt-1 block text-amber-400" role="alert">
                That time isn&apos;t free for a full {length(field.stepMinutes)}. Pick a time in a free stretch below.
              </span>
            )}
          </label>
          <label className="block text-sm text-neutral-300">
            <span className="mb-1 block">Until</span>
            <select value={end ?? ""} onChange={(e) => setEnd(e.target.value === "" ? null : Number(e.target.value))} className={input} disabled={start === null} aria-label="Until">
              <option value="">{start === null ? "Pick a start first" : "Pick a time"}</option>
              {ends.map((m) => (
                <option key={m} value={m}>
                  {clock(m)} ({length(m - start!)})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {!loading && free.length > 0 && (
        <p className="-mt-3 text-sm text-neutral-500" data-testid="free-times">
          Free: {free.map((r) => `${clock(r.start)}–${clock(r.end)}`).join(", ")} · booked in {length(field.stepMinutes)} blocks
        </p>
      )}
      {start !== null && end !== null && (
        <p className="text-sm text-neutral-300" data-testid="booking-price">
          {clock(start)} to {clock(end)} · {length(end - start)}{perPax ? ` · ${people || 0} ${people === 1 ? "person" : "people"}` : ""} · {price > 0 ? rupiah(price) : "Free"}
        </p>
      )}

      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">Your name</span>
        <input required minLength={2} maxLength={80} value={fullName} onChange={(e) => setFullName(e.target.value)} className={input} />
      </label>
      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">WhatsApp number</span>
        <input required type="tel" minLength={6} maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} className={input} placeholder="0812…" />
      </label>
      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">Email</span>
        <input required type="email" maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} className={input} placeholder="you@example.com" />
      </label>
      <TransferPayment amount={price} bank={bank} onProof={setProof} />
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      <button disabled={busy || start === null || end === null} className="rounded-lg bg-white px-6 py-3 text-sm font-semibold text-neutral-950 hover:bg-neutral-200 disabled:opacity-50">
        {busy ? "Sending…" : "Request this time"}
      </button>
    </form>
  );
}

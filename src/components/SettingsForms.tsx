"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const selectCls =
  "w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-neutral-500";
const btnCls =
  "rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200 disabled:opacity-50";

function useSave(url: string) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(body: unknown) {
    setState("saving");
    setError(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(typeof b.error === "string" ? b.error : "Failed to save");
      setState("error");
      return;
    }
    setState("saved");
    router.refresh();
  }
  return { state, error, save };
}

export function PlatformSettingsForm({
  initialMode,
  initialOverride,
}: {
  initialMode: "light" | "dark" | "system";
  initialOverride: boolean;
}) {
  const [mode, setMode] = useState(initialMode);
  const [override, setOverride] = useState(initialOverride);
  const { state, error, save } = useSave("/api/superadmin/settings");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save({ themeDefault: mode, allowUserOverride: override });
      }}
      className="space-y-4"
    >
      <label htmlFor="themeDefault" className="block text-sm text-neutral-300">
        Default theme
      </label>
      <select id="themeDefault" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className={selectCls}>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
        <option value="system">Follow device</option>
      </select>
      <label className="flex items-center gap-2 text-sm text-neutral-300">
        <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="h-4 w-4" />
        Let users switch theme themselves (shows the toggle button)
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "saving"} className={btnCls}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        {state === "saved" && <span className="text-sm text-emerald-400">Saved</span>}
      </div>
    </form>
  );
}

export function PlatformBankForm({ initial }: { initial: { bankName: string; accountNumber: string; accountHolder: string } | null }) {
  const [bankName, setBankName] = useState(initial?.bankName ?? "");
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber ?? "");
  const [accountHolder, setAccountHolder] = useState(initial?.accountHolder ?? "");
  const { state, error, save } = useSave("/api/superadmin/bank");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save({ bankName, accountNumber, accountHolder });
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor="pbBank" className="mb-1 block text-sm text-neutral-300">Bank</label>
        <input id="pbBank" value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={60} placeholder="BCA" className={selectCls} />
      </div>
      <div>
        <label htmlFor="pbNumber" className="mb-1 block text-sm text-neutral-300">Account number</label>
        <input id="pbNumber" inputMode="numeric" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} maxLength={40} className={selectCls} />
      </div>
      <div>
        <label htmlFor="pbHolder" className="mb-1 block text-sm text-neutral-300">Account holder name</label>
        <input id="pbHolder" value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} maxLength={80} className={selectCls} />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "saving" || !bankName || !accountNumber || !accountHolder} className={btnCls}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        {state === "saved" && <span className="text-sm text-emerald-400">Saved</span>}
      </div>
    </form>
  );
}

export function GymThemeForm({
  slug,
  initial,
}: {
  slug: string;
  initial: "inherit" | "light" | "dark" | "system";
}) {
  const [theme, setTheme] = useState(initial);
  const { state, error, save } = useSave(`/api/${slug}/settings`);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save({ theme });
      }}
      className="space-y-4"
    >
      <label htmlFor="gymTheme" className="block text-sm text-neutral-300">
        Theme for your staff and members
      </label>
      <select id="gymTheme" value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)} className={selectCls}>
        <option value="inherit">Use platform default</option>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
        <option value="system">Follow device</option>
      </select>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "saving"} className={btnCls}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        {state === "saved" && <span className="text-sm text-emerald-400">Saved</span>}
      </div>
    </form>
  );
}

export function BankDetailsForm({
  slug,
  initial,
}: {
  slug: string;
  initial: { bankName: string; bankAccountNumber: string; bankAccountHolder: string };
}) {
  const [bankName, setBankName] = useState(initial.bankName);
  const [bankAccountNumber, setBankAccountNumber] = useState(initial.bankAccountNumber);
  const [bankAccountHolder, setBankAccountHolder] = useState(initial.bankAccountHolder);
  const { state, error, save } = useSave(`/api/${slug}/settings`);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save({ bankName, bankAccountNumber, bankAccountHolder });
      }}
      className="space-y-4"
    >
      <p className="text-sm text-neutral-400">
        Shown on your join page so people know where to send their membership fee. Leave blank to hide it.
      </p>
      <div>
        <label htmlFor="bankName" className="mb-1 block text-sm text-neutral-300">Bank name</label>
        <input id="bankName" maxLength={60} value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="BCA" className={selectCls} />
      </div>
      <div>
        <label htmlFor="bankAccountNumber" className="mb-1 block text-sm text-neutral-300">Account number</label>
        <input id="bankAccountNumber" maxLength={40} value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} className={selectCls} />
      </div>
      <div>
        <label htmlFor="bankAccountHolder" className="mb-1 block text-sm text-neutral-300">Account holder name</label>
        <input id="bankAccountHolder" maxLength={80} value={bankAccountHolder} onChange={(e) => setBankAccountHolder(e.target.value)} className={selectCls} />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "saving"} className={btnCls}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        {state === "saved" && <span className="text-sm text-emerald-400">Saved</span>}
      </div>
    </form>
  );
}

export function JoinSettingsForm({ slug, initial, joinUrl }: { slug: string; initial: boolean; joinUrl: string }) {
  const [on, setOn] = useState(initial);
  const { state, error, save } = useSave(`/api/${slug}/settings`);

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            save({ acceptSignups: e.target.checked });
          }}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          Let people join online
          <span className="mt-1 block text-neutral-500">
            Anyone with your join link can pick a plan and submit a bank-transfer join request. You confirm the payment and activate them.
          </span>
        </span>
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {state === "saved" && <p className="text-sm text-emerald-400">Saved</p>}
      {on && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4 text-sm">
          <p className="text-neutral-400">Your join link</p>
          <p className="mt-1 break-all font-medium text-white">{joinUrl}</p>
          <div className="mt-3 flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(joinUrl)}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
            >
              Copy link
            </button>
            <a href={`/${slug}/join-poster`} className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">
              Print QR poster
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export function OnlinePaymentsForm({ slug, initial, providerReady }: { slug: string; initial: boolean; providerReady: boolean }) {
  const [on, setOn] = useState(initial);
  const { state, error, save } = useSave(`/api/${slug}/settings`);

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            save({ paymentsEnabled: e.target.checked });
          }}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          Let members pay online
          <span className="mt-1 block text-neutral-500">
            Members can renew or pay for a plan themselves from their dashboard, by card, e-wallet or bank
            transfer through our payment provider. Off by default — members pay at the front desk or by
            direct bank transfer until you turn this on.
          </span>
        </span>
      </label>
      {!providerReady && (
        <p className="rounded-lg border border-amber-800 bg-amber-950 px-3 py-2 text-xs text-amber-400">
          Online payments aren&apos;t set up on Liftmora yet, so this won&apos;t take effect until they are.
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {state === "saved" && <p className="text-sm text-emerald-400">Saved</p>}
    </div>
  );
}

export function GymProfileForm({
  slug,
  initial,
  publicUrl,
}: {
  slug: string;
  initial: { description: string; address: string };
  publicUrl: string;
}) {
  const [description, setDescription] = useState(initial.description);
  const [address, setAddress] = useState(initial.address);
  const { state, error, save } = useSave(`/api/${slug}/settings`);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save({ description, address });
      }}
      className="space-y-4"
    >
      <p className="text-sm text-neutral-400">
        Shown on your public page at{" "}
        <a href={`/${slug}`} className="break-all text-white underline underline-offset-2">{publicUrl}</a>. Anyone can see it, so keep it to what you&apos;d put on a poster.
      </p>
      <div>
        <label htmlFor="gymDescription" className="mb-1 block text-sm text-neutral-300">About the gym</label>
        <textarea
          id="gymDescription"
          maxLength={1000}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Opening hours, what you offer, who it's for…"
          className={selectCls}
        />
      </div>
      <div>
        <label htmlFor="gymAddress" className="mb-1 block text-sm text-neutral-300">Address</label>
        <input id="gymAddress" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} className={selectCls} />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "saving"} className={btnCls}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        {state === "saved" && <span className="text-sm text-emerald-400">Saved</span>}
      </div>
    </form>
  );
}

const TIMEZONES: { id: string; label: string }[] = [
  { id: "Asia/Jakarta", label: "WIB, Jakarta (UTC+7)" },
  { id: "Asia/Makassar", label: "WITA, Makassar (UTC+8)" },
  { id: "Asia/Jayapura", label: "WIT, Jayapura (UTC+9)" },
  { id: "Asia/Singapore", label: "Singapore (UTC+8)" },
  { id: "Asia/Kuala_Lumpur", label: "Kuala Lumpur (UTC+8)" },
  { id: "Asia/Bangkok", label: "Bangkok (UTC+7)" },
  { id: "Asia/Manila", label: "Manila (UTC+8)" },
  { id: "Australia/Perth", label: "Perth (UTC+8)" },
];

export function GymDetailsForm({ slug, initialName, initialTimezone }: { slug: string; initialName: string; initialTimezone: string }) {
  const [name, setName] = useState(initialName);
  const [timezone, setTimezone] = useState(initialTimezone);
  const { state, error, save } = useSave(`/api/${slug}/settings`);
  const options = TIMEZONES.some((t) => t.id === initialTimezone) ? TIMEZONES : [{ id: initialTimezone, label: initialTimezone }, ...TIMEZONES];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save({ name, timezone });
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor="gymName" className="mb-1 block text-sm text-neutral-300">Gym name</label>
        <input id="gymName" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={selectCls} />
        <p className="mt-1 text-xs text-neutral-500">Shown to your members and at the start of every WhatsApp message. Your web address doesn&apos;t change.</p>
      </div>
      <div>
        <label htmlFor="gymTimezone" className="mb-1 block text-sm text-neutral-300">Timezone</label>
        <select id="gymTimezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={selectCls}>
          {options.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-500">Decides what counts as &ldquo;today&rdquo; for check-ins (one per day) and your reports.</p>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={state === "saving"} className={btnCls}>
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        {state === "saved" && <span className="text-sm text-emerald-400">Saved</span>}
      </div>
    </form>
  );
}

/** Which channels the gym uses to reach members. Each switch saves as soon as it's flipped. */
export function NotificationsForm({
  slug,
  initialWhatsapp,
  initialEmail,
  emailReady,
}: {
  slug: string;
  initialWhatsapp: boolean;
  initialEmail: boolean;
  emailReady: boolean;
}) {
  const [whatsapp, setWhatsapp] = useState(initialWhatsapp);
  const [email, setEmail] = useState(initialEmail);
  const { state, error, save } = useSave(`/api/${slug}/settings`);

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={whatsapp}
          onChange={(e) => {
            setWhatsapp(e.target.checked);
            save({ notifyWhatsapp: e.target.checked });
          }}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          Send members WhatsApp messages
          <span className="mt-1 block text-neutral-500">Activation links, payment receipts, expiry reminders and class updates.</span>
        </span>
      </label>
      <label className="flex items-start gap-3 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={email}
          onChange={(e) => {
            setEmail(e.target.checked);
            save({ notifyEmail: e.target.checked });
          }}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          Send members emails
          <span className="mt-1 block text-neutral-500">The same messages, sent to each member&apos;s email address. Turn on both to reach them either way.</span>
        </span>
      </label>
      {email && !emailReady && (
        <p className="rounded-lg border border-amber-800 bg-amber-950 px-3 py-2 text-xs text-amber-400">
          Email isn&apos;t set up on Liftmora yet, so this won&apos;t take effect until it is.
        </p>
      )}
      {!whatsapp && !email && (
        <p className="rounded-lg border border-amber-800 bg-amber-950 px-3 py-2 text-xs text-amber-400">
          Both are off, so members won&apos;t get activation or password-reset links. You&apos;d have to share those yourself.
        </p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {state === "saved" && <p className="text-sm text-emerald-400">Saved</p>}
    </div>
  );
}

export function CheckinRulesForm({ slug, initialPerDay, initialGap }: { slug: string; initialPerDay: number; initialGap: number }) {
  const [perDay, setPerDay] = useState(initialPerDay);
  const [gap, setGap] = useState(initialGap);
  const { state, error, save } = useSave(`/api/${slug}/settings`);

  return (
    <div className="space-y-4">
      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">Check-ins allowed per member per day</span>
        <select
          value={perDay}
          onChange={(e) => {
            const v = Number(e.target.value);
            setPerDay(v);
            save({ checkinsPerDay: v });
          }}
          className={selectCls}
          aria-label="Check-ins per day"
        >
          {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
            <option key={n} value={n}>
              {n === 1 ? "1 (once a day)" : `${n} a day`}
            </option>
          ))}
        </select>
      </label>
      {perDay > 1 && (
        <label className="block text-sm text-neutral-300">
          <span className="mb-1 block">Minimum time between check-ins</span>
          <select
            value={gap}
            onChange={(e) => {
              const v = Number(e.target.value);
              setGap(v);
              save({ checkinGapMinutes: v });
            }}
            className={selectCls}
            aria-label="Minimum gap between check-ins"
          >
            {[0, 15, 30, 60, 120, 180].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "No minimum" : m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? "" : "s"}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-xs text-neutral-500">
        For gyms with split sessions (morning and evening). Each check-in counts as a visit for that day, but the leaderboard and streaks still count days, not scans. A scan inside the minimum time is refused as already checked in.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {state === "saved" && <p className="text-sm text-emerald-400">Saved</p>}
    </div>
  );
}

export function OccupancyForm({ slug, initialHours }: { slug: string; initialHours: number }) {
  const [hours, setHours] = useState(initialHours);
  const { state, error, save } = useSave(`/api/${slug}/settings`);

  return (
    <div className="space-y-3">
      <label className="block text-sm text-neutral-300">
        <span className="mb-1 block">Count a member as in the gym for</span>
        <select
          value={hours}
          onChange={(e) => {
            const v = Number(e.target.value);
            setHours(v);
            save({ occupancyWindowHours: v });
          }}
          className={selectCls}
          aria-label="Occupancy window"
        >
          {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((h) => (
            <option key={h} value={h}>
              {h} hour{h === 1 ? "" : "s"} after check-in
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-neutral-500">
        Members and staff can also check out explicitly. Anyone who doesn&apos;t drops off the &ldquo;in the gym now&rdquo; list after this long.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {state === "saved" && <p className="text-sm text-emerald-400">Saved</p>}
    </div>
  );
}

export function WhoIsInForm({ slug, initial }: { slug: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const { state, error, save } = useSave(`/api/${slug}/settings`);

  return (
    <div className="space-y-3 border-t border-neutral-800 pt-4">
      <label className="flex items-start gap-3 text-sm text-neutral-300">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            save({ whoIsInEnabled: e.target.checked });
          }}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          Let members see who&apos;s in the gym
          <span className="mt-1 block text-neutral-500">
            Members see a head count and the other members who are in right now, as first name and last initial. Each member can hide themselves from other members; staff always see everyone. Off by default.
          </span>
        </span>
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {state === "saved" && <p className="text-sm text-emerald-400">Saved</p>}
    </div>
  );
}


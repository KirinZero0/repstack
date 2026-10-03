"use client";

type Tone = "success" | "warning" | "error";

// Fixed colours (not theme tokens) so a green/amber/red result reads the same in light and dark.
const TONE: Record<Tone, { color: string; kicker: string; icon: React.ReactNode }> = {
  success: {
    color: "#10b981",
    kicker: "Welcome in",
    icon: <path className="scan-draw" d="M6 12.5l4 4 8-9" />,
  },
  warning: {
    color: "#f59e0b",
    kicker: "Heads up",
    icon: (
      <>
        <path className="scan-draw" d="M12 6.5v7" />
        <circle cx="12" cy="17.25" r="0.6" fill="currentColor" stroke="none" />
      </>
    ),
  },
  error: {
    color: "#ef4444",
    kicker: "Check-in failed",
    icon: <path className="scan-draw" d="M7.5 7.5l9 9M16.5 7.5l-9 9" />,
  },
};

export default function ScanResultModal({
  tone,
  label,
  name,
  durationMs = 2500,
  onClose,
}: {
  tone: Tone;
  label: string;
  name?: string;
  durationMs?: number;
  onClose: () => void;
}) {
  const t = TONE[tone];
  return (
    <div
      className="scan-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div className="scan-pop relative w-full max-w-xs overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900 px-6 pb-7 pt-9 text-center shadow-2xl">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-48 w-48 -translate-x-1/2 -translate-y-1/3 rounded-full opacity-30 blur-3xl"
          style={{ backgroundColor: t.color }}
        />

        <div
          className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full text-[#ffffff]"
          style={{ backgroundColor: t.color, boxShadow: `0 0 0 8px ${t.color}26, 0 10px 30px ${t.color}55` }}
        >
          <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            {t.icon}
          </svg>
        </div>

        <p className="relative mt-6 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: t.color }}>
          {t.kicker}
        </p>
        {name && <p className="relative mt-1 text-2xl font-semibold leading-tight text-white">{name}</p>}
        <p className={`relative text-neutral-400 ${name ? "mt-2 text-sm" : "mt-2 text-lg font-medium text-white"}`}>{label}</p>

        <p className="relative mt-6 text-[11px] text-neutral-500">Tap anywhere to dismiss</p>

        <div className="absolute inset-x-0 bottom-0 h-1 bg-neutral-800">
          <div className="scan-shrink h-full" style={{ backgroundColor: t.color, animationDuration: `${durationMs}ms` }} />
        </div>
      </div>
    </div>
  );
}

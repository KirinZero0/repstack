/** One week of attendance for a member: verticals for each visit, the fifth strikes them through. */
function Tally({ count, delay }: { count: number; delay: number }) {
  const bars = Math.min(count, 4);
  return (
    <svg width="58" height="24" viewBox="0 0 58 24" fill="none" stroke="var(--paper-ink)" strokeWidth="2" strokeLinecap="round" aria-label={`${count} visits`}>
      {Array.from({ length: bars }).map((_, i) => (
        <line key={i} x1={6 + i * 9} y1="3" x2={6 + i * 9} y2="21" pathLength={1} className="tally-stroke" style={{ animationDelay: `${delay + i * 0.12}s` }} />
      ))}
      {count >= 5 && (
        <line x1="1" y1="19" x2="43" y2="5" pathLength={1} className="tally-stroke" style={{ animationDelay: `${delay + 0.55}s`, stroke: "var(--plate-red)" }} />
      )}
      {count === 0 && <line x1="6" y1="12" x2="22" y2="12" strokeOpacity="0.25" />}
    </svg>
  );
}

const rows = [
  { name: "Sari Dewi", visits: 5, plan: "Annual", paid: true },
  { name: "Budi Santoso", visits: 3, plan: "Monthly", paid: true },
  { name: "Andi Wijaya", visits: 0, plan: "Monthly", paid: false },
  { name: "Rina Putri", visits: 4, plan: "Monthly", paid: true },
  { name: "Dimas Pratama", visits: 2, plan: "Monthly", paid: false },
];

export default function HeroLedger() {
  return (
    <figure className="relative mx-auto w-full max-w-md">
      <div
        className="relative overflow-hidden rounded-lg border border-black/10 bg-paper text-paper-ink shadow-2xl shadow-black/30"
        style={{ transform: "rotate(1.2deg)" }}
      >
        {/* red margin rule, like a real ledger page */}
        <div className="absolute inset-y-0 left-10 w-px bg-plate-red/60" aria-hidden="true" />
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b-2 border-paper-ink/80 py-3 pl-14 pr-5 text-xs font-medium text-paper-ink/60">
          <span>Member</span>
          <span>This week</span>
          <span className="w-16 text-right">Membership</span>
        </div>
        <ul>
          {rows.map((r, i) => (
            <li
              key={r.name}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-paper-rule py-3 pl-14 pr-5"
            >
              <span className="truncate font-display text-[15px] font-medium">{r.name}</span>
              <Tally count={r.visits} delay={0.3 + i * 0.25} />
              <span
                className={`w-16 rounded-sm py-0.5 text-center text-xs font-semibold ${
                  r.paid ? "bg-plate-green/15 text-[#1e7a44]" : "bg-plate-red/15 text-[#b0261f]"
                }`}
              >
                {r.paid ? "Paid" : "Due"}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between py-4 pl-14 pr-5">
          <span className="text-xs font-medium text-paper-ink/60">Collected this month</span>
          <span className="font-display text-xl font-semibold tabular-nums">Rp 6.250.000</span>
        </div>
      </div>
      <figcaption className="mt-4 text-center text-xs text-neutral-500">Sample data</figcaption>
    </figure>
  );
}

export function rp(n: number) {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <p className="text-sm text-neutral-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && (
        <p className={`mt-1 text-xs ${tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-red-400" : "text-neutral-500"}`}>
          {sub}
        </p>
      )}
    </div>
  );
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-4 text-sm font-medium text-neutral-300">{title}</h2>
      {children}
    </div>
  );
}

/** Vertical bar chart. Bars scale to the max value; last bar is highlighted. */
export function BarChart({
  data,
  format = (n) => String(n),
}: {
  data: { label: string; value: number }[];
  format?: (n: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-44 items-end gap-2" role="img" aria-label="Bar chart">
      {data.map((d, i) => {
        const h = Math.max((d.value / max) * 100, d.value > 0 ? 3 : 0);
        const last = i === data.length - 1;
        return (
          <div key={d.label + i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div className="text-[10px] text-neutral-500">{d.value > 0 ? format(d.value) : ""}</div>
            <div
              title={`${d.label}: ${format(d.value)}`}
              className={`w-full rounded-t ${last ? "bg-emerald-500" : "bg-neutral-600"}`}
              style={{ height: `${h}%` }}
            />
            <div className="text-[10px] text-neutral-400">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Horizontal ranked bars for category breakdowns. */
export function HBars({
  data,
  format = (n) => String(n),
}: {
  data: { label: string; value: number }[];
  format?: (n: number) => string;
}) {
  if (data.length === 0) return <p className="text-sm text-neutral-500">No data yet.</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-3">
      {data.map((d) => (
        <div key={d.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-neutral-300">{d.label}</span>
            <span className="text-neutral-400">{format(d.value)}</span>
          </div>
          <div className="h-2 rounded bg-neutral-800">
            <div className="h-2 rounded bg-emerald-500" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** GitHub-style attendance heatmap: 12 weeks × 7 days, oldest first. */
export function Heatmap({ data }: { data: { date: string; count: number }[] }) {
  const weeks: { date: string; count: number }[][] = [];
  for (let i = 0; i < data.length; i += 7) weeks.push(data.slice(i, i + 7));
  return (
    <div className="flex gap-1" role="img" aria-label="Attendance heatmap, last 12 weeks">
      {weeks.map((w, wi) => (
        <div key={wi} className="flex flex-col gap-1">
          {w.map((d) => (
            <div
              key={d.date}
              title={`${d.date}${d.count ? " — visited" : ""}`}
              className={`h-4 w-4 rounded-sm ${d.count ? "bg-emerald-500" : "bg-neutral-800"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-emerald-950 text-emerald-400 border-emerald-800",
    PAID: "bg-emerald-950 text-emerald-400 border-emerald-800",
    TRIALING: "bg-blue-950 text-blue-400 border-blue-800",
    PENDING: "bg-amber-950 text-amber-400 border-amber-800",
    PENDING_PAYMENT: "bg-amber-950 text-amber-400 border-amber-800",
    PAST_DUE: "bg-amber-950 text-amber-400 border-amber-800",
    SUSPENDED: "bg-red-950 text-red-400 border-red-800",
    EXPIRED: "bg-red-950 text-red-400 border-red-800",
    FAILED: "bg-red-950 text-red-400 border-red-800",
    FROZEN: "bg-blue-950 text-blue-400 border-blue-800",
    CANCELLED: "bg-neutral-900 text-neutral-500 border-neutral-700",
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${colors[status] ?? "border-neutral-700 text-neutral-400"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

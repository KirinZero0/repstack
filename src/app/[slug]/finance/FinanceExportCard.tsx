"use client";

import { useState } from "react";

interface Props {
  slug: string;
  /** Defaults in the gym's timezone, computed on the server so the first render is right. */
  monthStart: string;
  today: string;
  yearStart: string;
}

const inputCls = "rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white";

/**
 * Two downloads for the bookkeeper: every payment in a date range, or one line per month. Plain
 * links to the export route, so the browser saves the file and nothing here has to hold the data.
 */
export default function FinanceExportCard({ slug, monthStart, today, yearStart }: Props) {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<"paid" | "all">("paid");
  const valid = from !== "" && to !== "" && from <= to;

  const base = `/api/${slug}/finance/export`;
  const transactionsHref = `${base}?report=transactions&from=${from}&to=${to}&status=${status}`;
  const monthlyHref = `${base}?report=monthly&from=${yearStart}&to=${today}`;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-1 text-sm font-medium text-neutral-300">Export for your bookkeeper</h2>
      <p className="mb-4 text-xs text-neutral-500">CSV files that open in Excel or Google Sheets. Dates follow your gym&apos;s timezone.</p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs text-neutral-400">
          <span className="mb-1 block">From</span>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </label>
        <label className="block text-xs text-neutral-400">
          <span className="mb-1 block">To</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </label>
        <label className="block text-xs text-neutral-400">
          <span className="mb-1 block">Include</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as "paid" | "all")} className={inputCls}>
            <option value="paid">Paid only</option>
            <option value="all">Everything, incl. unpaid and voided</option>
          </select>
        </label>
        <a
          href={valid ? transactionsHref : undefined}
          download
          aria-disabled={!valid}
          className={`rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 ${valid ? "hover:bg-neutral-200" : "pointer-events-none opacity-50"}`}
        >
          Download transactions
        </a>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-neutral-800 pt-4">
        <a href={monthlyHref} download className="rounded-md border border-neutral-600 px-4 py-2 text-sm text-white hover:bg-neutral-800">
          Download monthly summary
        </a>
        <span className="text-xs text-neutral-500">Last 12 months, one row per month: membership and class revenue, cash vs online, voided entries.</span>
      </div>
    </div>
  );
}

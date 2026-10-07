"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface PlanOption {
  id: string;
  name: string;
}

interface RowResult {
  line: number;
  fullName: string;
  email: string;
  phone: string;
  plan: string;
  expiry: string | null;
  outcome: "ok" | "skipped" | "error";
  reason?: string;
}

interface ImportResponse {
  dryRun: boolean;
  created?: number;
  rows: RowResult[];
  summary: { total: number; ok: number; skipped: number; errors: number; truncated: boolean };
  unknownColumns: string[];
}

const TEMPLATE_CSV = [
  "Name,Email,Phone,Plan,Paid until",
  "Sari Dewi,sari@example.com,081234567890,Monthly,2026-12-31",
  "Budi Santoso,budi@example.com,081298765432,,",
].join("\r\n");

const PREVIEW_LIMIT = 200;

/**
 * Owner imports members from a CSV: pick the file, preview what would happen line by line, then
 * commit. The preview and the import are the same request with `dryRun` flipped, so what you see
 * is exactly what runs.
 */
export default function ImportMembersForm({ slug, plans }: { slug: string; plans: PlanOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState<null | "preview" | "import">(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const templateHref = useMemo(() => `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${TEMPLATE_CSV}`)}`, []);

  async function send(dryRun: boolean) {
    if (!file) return;
    setError(null);
    setBusy(dryRun ? "preview" : "import");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("planId", planId);
      body.set("notify", notify ? "1" : "0");
      body.set("dryRun", dryRun ? "1" : "0");
      const res = await fetch(`/api/${slug}/members/import`, { method: "POST", body });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "The file couldn't be read");
        setResult(null);
        return;
      }
      setResult(json as ImportResponse);
      if (!dryRun) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    setError(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
      >
        Import CSV
      </button>
    );
  }

  const committed = result && !result.dryRun;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Import members from a spreadsheet</h2>
          <p className="mt-1 text-sm text-neutral-400">
            A CSV with columns <span className="text-neutral-200">Name, Email, Phone</span> and optionally{" "}
            <span className="text-neutral-200">Plan</span> and <span className="text-neutral-200">Paid until</span>. In Excel or Google Sheets, use
            &ldquo;Save as&rdquo; or &ldquo;Download&rdquo; and pick CSV.{" "}
            <a href={templateHref} download="liftmora-members-template.csv" className="underline underline-offset-2 hover:text-white">
              Download a template
            </a>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-sm text-neutral-400 hover:text-white"
        >
          Close
        </button>
      </div>

      {!committed && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-sm text-neutral-300">
            <span className="mb-1 block">CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResult(null);
                setError(null);
              }}
              className="w-full text-sm text-neutral-300 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-800 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-neutral-700"
            />
          </label>
          <label className="block text-sm text-neutral-300">
            <span className="mb-1 block">Plan for rows without one</span>
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-white"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2 pt-6 text-sm text-neutral-300">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span>
              Send each member their activation link
              <span className="block text-xs text-neutral-500">Uses your WhatsApp allowance. Off, you can send links from each member&apos;s page later.</span>
            </span>
          </label>
        </div>
      )}

      <p className="mt-3 text-xs text-neutral-500">
        Imported members are not given a payment record: they paid before Liftmora. A &ldquo;Paid until&rdquo; in the past makes them Expired rather than Active.
        Rows whose email is already a member here are skipped, so importing an export changes nothing.
      </p>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {result && (
        <div className="mt-4">
          <p className="text-sm text-neutral-200">
            {committed ? (
              <>
                <strong>{result.created}</strong> member{result.created === 1 ? "" : "s"} imported.
              </>
            ) : (
              <>
                <strong>{result.summary.ok}</strong> to import
              </>
            )}
            {result.summary.skipped > 0 && <>, {result.summary.skipped} already here</>}
            {result.summary.errors > 0 && <span className="text-red-400">, {result.summary.errors} with problems</span>}
            {result.summary.truncated && <span className="text-amber-400"> · only the first 1,000 rows were read</span>}
            {result.unknownColumns.length > 0 && (
              <span className="block text-xs text-neutral-500">Ignored columns: {result.unknownColumns.join(", ")}</span>
            )}
          </p>

          <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-neutral-800">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="sticky top-0 bg-neutral-950 text-neutral-400">
                <tr>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Paid until</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.slice(0, PREVIEW_LIMIT).map((r) => (
                  <tr key={r.line} className="border-t border-neutral-800">
                    <td className="px-3 py-2 text-neutral-500">{r.line}</td>
                    <td className="px-3 py-2">{r.fullName}</td>
                    <td className="px-3 py-2 text-neutral-400">{r.email}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-neutral-300">{r.phone}</td>
                    <td className="px-3 py-2">{r.plan || <span className="text-neutral-500">default</span>}</td>
                    <td className="px-3 py-2 text-neutral-400">{r.expiry ?? <span className="text-neutral-500">plan length</span>}</td>
                    <td className={`px-3 py-2 ${r.outcome === "ok" ? "text-emerald-400" : r.outcome === "skipped" ? "text-neutral-400" : "text-red-400"}`}>
                      {r.outcome === "ok" ? (committed ? "Imported" : "Will import") : r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.rows.length > PREVIEW_LIMIT && (
              <p className="px-3 py-2 text-xs text-neutral-500">Showing the first {PREVIEW_LIMIT} of {result.rows.length} rows.</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        {!committed ? (
          <>
            <button
              type="button"
              disabled={!file || busy !== null}
              onClick={() => send(true)}
              className="rounded-md border border-neutral-600 px-4 py-2 text-sm text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy === "preview" ? "Checking…" : "Preview"}
            </button>
            <button
              type="button"
              disabled={!file || busy !== null || !result || result.summary.ok === 0}
              onClick={() => send(false)}
              className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-200 disabled:opacity-50"
            >
              {busy === "import" ? "Importing…" : result?.dryRun ? `Import ${result.summary.ok} member${result.summary.ok === 1 ? "" : "s"}` : "Import"}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-neutral-600 px-4 py-2 text-sm text-white hover:bg-neutral-800"
          >
            Import another file
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import ResendFallbackButton from "./ResendFallbackButton";

export interface MemberRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  plan: string;
  status: string;
  membershipExpiry: string | null;
  activated: boolean;
}

const digitsOf = (s: string) => s.replace(/\D/g, "");
// 62812… and 0812… are the same number; compare them in one form.
const toLocal = (d: string) => (d.startsWith("62") ? `0${d.slice(2)}` : d);

export default function MembersTable({ slug, isOwner, rows }: { slug: string; isOwner: boolean; rows: MemberRow[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const qDigits = digitsOf(q);
    return rows.filter((m) => {
      if (m.fullName.toLowerCase().includes(q)) return true;
      if (qDigits.length === 0) return false;
      const p = digitsOf(m.phone);
      return p.includes(qDigits) || toLocal(p).includes(toLocal(qDigits));
    });
  }, [rows, query]);

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or phone number"
          aria-label="Search members"
          className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none"
        />
        {query.trim() && (
          <span className="whitespace-nowrap text-sm text-neutral-400">
            {filtered.length} of {rows.length}
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-800">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Expiry</th>
              <th className="px-4 py-3">Activated</th>
              <th className="px-4 py-3"></th>
              {isOwner && <th className="px-4 py-3"></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id} className="border-t border-neutral-800">
                <td className="px-4 py-3">
                  <a href={`/${slug}/members/${m.id}`} className="font-medium underline-offset-2 hover:underline">
                    {m.fullName}
                  </a>
                </td>
                <td className="px-4 py-3 text-neutral-400">{m.email}</td>
                <td className="whitespace-nowrap px-4 py-3 text-neutral-300">{m.phone}</td>
                <td className="px-4 py-3">{m.plan}</td>
                <td className="px-4 py-3">{m.status}</td>
                <td className="px-4 py-3 text-neutral-400">
                  {m.membershipExpiry ? new Date(m.membershipExpiry).toLocaleDateString("id-ID") : "—"}
                </td>
                <td className="px-4 py-3">{m.activated ? "Yes" : "Pending"}</td>
                <td className="px-4 py-3">
                  <a
                    href={`/${slug}/members/${m.id}`}
                    className="whitespace-nowrap rounded-md border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    Record payment
                  </a>
                </td>
                {isOwner && (
                  <td className="px-4 py-3">
                    <ResendFallbackButton slug={slug} memberId={m.id} />
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-neutral-500">
                  {rows.length === 0 ? "No members yet." : `No members match "${query.trim()}".`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";

export const dynamic = "force-dynamic";

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const day = (d: Date) => d.toLocaleDateString("id-ID", { timeZone: "UTC" });
const pill: Record<string, string> = {
  UNPAID: "bg-amber-950 text-amber-400",
  PAID: "bg-emerald-950 text-emerald-400",
  VOID: "bg-neutral-800 text-neutral-500",
};

export default async function InvoicesPage() {
  try {
    await requireSuperadminSession();
  } catch (err) {
    if (err instanceof SessionError) redirect("/superadmin/login");
    throw err;
  }
  const invoices = await prisma.invoice.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  const outstanding = invoices.filter((i) => i.status === "UNPAID").reduce((s, i) => s + Number(i.total), 0);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Invoices</h1>
            <p className="text-sm text-neutral-400">
              Outstanding: <span className="text-white">{rp(outstanding)}</span>
            </p>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <a href="/superadmin/dashboard" className="text-neutral-300 hover:text-white">Dashboard</a>
            <a href="/superadmin/gyms" className="text-neutral-300 hover:text-white">Gyms</a>
            <a href="/superadmin/invoices/new" className="rounded-lg bg-white px-4 py-2 font-semibold text-neutral-950 hover:bg-neutral-200">+ New invoice</a>
          </nav>
        </div>

        <div className="overflow-x-auto rounded-xl border border-neutral-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-neutral-900 text-neutral-400">
              <tr>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Billed to</th>
                <th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-t border-neutral-800">
                  <td className="whitespace-nowrap px-4 py-3">
                    <a href={`/superadmin/invoices/${i.id}`} className="font-medium underline-offset-2 hover:underline">{i.number}</a>
                  </td>
                  <td className="px-4 py-3">
                    {i.gymName ? (
                      <>
                        <span className="block">{i.gymName}</span>
                        <span className="block text-xs text-neutral-500">{i.billToName}</span>
                      </>
                    ) : (
                      i.billToName
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-400">{day(i.issueDate)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-400">{i.dueDate ? day(i.dueDate) : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">{rp(Number(i.total))}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${pill[i.status] ?? ""}`}>{i.status.toLowerCase()}</span>
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">No invoices yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

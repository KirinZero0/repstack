import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSuperadminSession, SessionError } from "@/lib/session";
import InvoiceForm from "./InvoiceForm";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  try {
    await requireSuperadminSession();
  } catch (err) {
    if (err instanceof SessionError) redirect("/superadmin/login");
    throw err;
  }
  const [gyms, plans] = await Promise.all([
    prisma.gym.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    prisma.saasPlan.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">New invoice</h1>
          <a href="/superadmin/invoices" className="text-sm text-neutral-300 hover:text-white">‹ All invoices</a>
        </div>
        <InvoiceForm gyms={gyms.map((g) => g.name)} plans={plans.map((p) => ({ name: p.name, price: Number(p.price) }))} />
      </div>
    </main>
  );
}

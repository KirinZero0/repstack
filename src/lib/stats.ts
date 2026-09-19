import { prisma } from "./prisma";
import { dayKeyInTimezone } from "./date";

export function monthKey(date: Date, timezone: string): string {
  return dayKeyInTimezone(date, timezone).slice(0, 7);
}

/** Last `n` month keys (YYYY-MM), oldest first, ending with the current month. */
export function lastMonthKeys(n: number, timezone: string): string[] {
  const now = new Date();
  const [y, m] = monthKey(now, timezone).split("-").map(Number);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

function monthlyEquivalent(price: number, interval: string) {
  return interval === "annual" ? price / 12 : price;
}

export async function getGymFinance(gymId: string, timezone: string) {
  const months = lastMonthKeys(12, timezone);
  const since = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

  const [paid, pendingAgg, statusGroups, recent] = await Promise.all([
    prisma.payment.findMany({
      where: { gymId, status: "PAID", paidAt: { gte: since } },
      include: { plan: { select: { name: true } } },
    }),
    prisma.payment.aggregate({ where: { gymId, status: "PENDING" }, _sum: { amount: true }, _count: true }),
    prisma.payment.groupBy({ by: ["status"], where: { gymId }, _count: true }),
    prisma.payment.findMany({
      where: { gymId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { plan: { select: { name: true } }, member: { select: { fullName: true } } },
    }),
  ]);

  const byMonth = new Map<string, number>(months.map((k) => [k, 0]));
  const byPlan = new Map<string, number>();
  for (const p of paid) {
    const key = monthKey(p.paidAt ?? p.createdAt, timezone);
    if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) ?? 0) + Number(p.amount));
    if (key === months[months.length - 1]) {
      byPlan.set(p.plan.name, (byPlan.get(p.plan.name) ?? 0) + Number(p.amount));
    }
  }

  const monthly = months.map((k) => ({ key: k, label: monthLabel(k), value: byMonth.get(k) ?? 0 }));
  const thisMonth = monthly[monthly.length - 1].value;
  const lastMonth = monthly[monthly.length - 2]?.value ?? 0;

  return {
    monthly,
    thisMonth,
    lastMonth,
    changePct: lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : null,
    yearTotal: monthly.reduce((s, m) => s + m.value, 0),
    pendingAmount: Number(pendingAgg._sum.amount ?? 0),
    pendingCount: pendingAgg._count,
    byPlan: Array.from(byPlan.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    statusCounts: statusGroups.map((g) => ({ status: g.status, count: g._count })),
    recent: recent.map((p) => ({
      id: p.id,
      member: p.member.fullName,
      plan: p.plan.name,
      amount: Number(p.amount),
      status: p.status,
      date: p.createdAt,
    })),
  };
}

export async function getPlatformFinance(timezone = "Asia/Jakarta") {
  const months = lastMonthKeys(12, timezone);
  const since = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

  const [gyms, memberCount, paid, pendingAgg] = await Promise.all([
    prisma.gym.findMany({ include: { saasPlan: true, _count: { select: { members: true } } } }),
    prisma.member.count({ where: { status: "ACTIVE" } }),
    prisma.platformPayment.findMany({ where: { status: "PAID", paidAt: { gte: since } } }),
    prisma.platformPayment.aggregate({
      where: { status: "PENDING" },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const recurring = gyms.filter((g) => !g.isLifetime && g.subscriptionStatus === "ACTIVE");
  const mrr = recurring.reduce(
    (s, g) => s + monthlyEquivalent(Number(g.saasPlan.price), g.saasPlan.billingInterval),
    0,
  );
  const lifetimeRevenue = gyms.filter((g) => g.isLifetime).reduce((s, g) => s + Number(g.saasPlan.price), 0);

  const byMonth = new Map<string, number>(months.map((k) => [k, 0]));
  for (const p of paid) {
    const key = monthKey(p.paidAt ?? p.createdAt, timezone);
    if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) ?? 0) + Number(p.amount));
  }
  const monthly = months.map((k) => ({ key: k, label: monthLabel(k), value: byMonth.get(k) ?? 0 }));

  const statusCounts = new Map<string, number>();
  for (const g of gyms) statusCounts.set(g.subscriptionStatus, (statusCounts.get(g.subscriptionStatus) ?? 0) + 1);

  const gymsByMembers = gyms
    .map((g) => ({ label: g.name, value: g._count.members }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return {
    mrr,
    arr: mrr * 12,
    lifetimeRevenue,
    totalGyms: gyms.length,
    activeMembers: memberCount,
    monthly,
    collectedThisMonth: monthly[monthly.length - 1].value,
    collectedYear: monthly.reduce((s, m) => s + m.value, 0),
    pendingAmount: Number(pendingAgg._sum.amount ?? 0),
    pendingCount: pendingAgg._count,
    statusCounts: Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count })),
    gymsByMembers,
  };
}

export async function getMemberAttendance(memberId: string, timezone: string) {
  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
  const checkins = await prisma.checkIn.findMany({
    where: { memberId, result: "SUCCESS", checkedInAt: { gte: since } },
    orderBy: { checkedInAt: "desc" },
  });
  const total = await prisma.checkIn.count({ where: { memberId, result: "SUCCESS" } });

  const days = new Set(checkins.map((c) => dayKeyInTimezone(c.checkedInAt, timezone)));

  const todayKey = dayKeyInTimezone(new Date(), timezone);
  const thisMonthKey = todayKey.slice(0, 7);
  const thisMonth = Array.from(days).filter((d) => d.startsWith(thisMonthKey)).length;

  // Current streak: consecutive days ending today (or yesterday if not yet checked in today).
  let streak = 0;
  const cursor = new Date();
  if (!days.has(dayKeyInTimezone(cursor, timezone))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (days.has(dayKeyInTimezone(cursor, timezone))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  // Heatmap: last 12 weeks (84 days), oldest first.
  const heat: { date: string; count: number }[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = dayKeyInTimezone(d, timezone);
    heat.push({ date: key, count: days.has(key) ? 1 : 0 });
  }

  // Weekly visits, last 8 weeks.
  const weekly: { label: string; value: number }[] = [];
  for (let w = 7; w >= 0; w--) {
    let count = 0;
    for (let d = 0; d < 7; d++) {
      const key = dayKeyInTimezone(new Date(Date.now() - (w * 7 + d) * 24 * 60 * 60 * 1000), timezone);
      if (days.has(key)) count++;
    }
    weekly.push({ label: w === 0 ? "This wk" : `-${w}w`, value: count });
  }

  return {
    total,
    thisMonth,
    streak,
    last: checkins[0]?.checkedInAt ?? null,
    heat,
    weekly,
    recent: checkins.slice(0, 8).map((c) => c.checkedInAt),
  };
}

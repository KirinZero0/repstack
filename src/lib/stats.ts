import { prisma, type TenantDb } from "./prisma";
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

/**
 * The owner's money picture: membership payments and class payments together, since both are
 * revenue. Breakdowns are per item ("Monthly" plan, "Yoga class") and per method.
 */
export async function getGymFinance(db: TenantDb, gymId: string, timezone: string) {
  const months = lastMonthKeys(12, timezone);
  const since = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

  const [paid, paidClasses, paidDayPasses, pendingAgg, pendingClassAgg, statusGroups, classStatusGroups, recent, recentClasses] = await Promise.all([
    db.payment.findMany({
      where: { gymId, status: "PAID", paidAt: { gte: since } },
      include: { plan: { select: { name: true } } },
    }),
    db.classPayment.findMany({
      where: { gymId, status: "PAID", paidAt: { gte: since } },
      include: { registration: { select: { session: { select: { class: { select: { name: true } } } } } } },
    }),
    // Guest tickets (day passes and paid class spots) count as revenue once staff approve them, since
    // approving is the moment they confirm the money (transfer or cash) arrived.
    db.guestPass.findMany({
      where: { gymId, status: { in: ["APPROVED", "ATTENDED"] }, amount: { gt: 0 }, reviewedAt: { gte: since } },
      include: { dayPassPlan: { select: { name: true } }, session: { select: { class: { select: { name: true } } } } },
    }),
    db.payment.aggregate({ where: { gymId, status: "PENDING" }, _sum: { amount: true }, _count: true }),
    db.classPayment.aggregate({ where: { gymId, status: "PENDING" }, _sum: { amount: true }, _count: true }),
    db.payment.groupBy({ by: ["status"], where: { gymId }, _count: true }),
    db.classPayment.groupBy({ by: ["status"], where: { gymId }, _count: true }),
    db.payment.findMany({
      where: { gymId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { plan: { select: { name: true } }, member: { select: { fullName: true } } },
    }),
    db.classPayment.findMany({
      where: { gymId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { registration: { select: { member: { select: { fullName: true } }, session: { select: { class: { select: { name: true } } } } } } },
    }),
  ]);

  type PaidRow = { when: Date; amount: number; item: string; kind: "membership" | "class" | "daypass"; provider: string };
  const rows: PaidRow[] = [
    ...paid.map((p) => ({ when: p.paidAt ?? p.createdAt, amount: Number(p.amount), item: p.plan.name, kind: "membership" as const, provider: p.provider })),
    ...paidClasses.map((p) => ({
      when: p.paidAt ?? p.createdAt,
      amount: Number(p.amount),
      item: `${p.registration.session.class.name} class`,
      kind: "class" as const,
      provider: p.provider,
    })),
    ...paidDayPasses.map((p) => ({
      when: p.reviewedAt ?? p.createdAt,
      amount: Number(p.amount ?? 0),
      item: p.session ? `${p.session.class.name} class (guest)` : `${p.dayPassPlan?.name ?? "Day pass"} (day pass)`,
      kind: p.session ? ("class" as const) : ("daypass" as const),
      provider: "CASH",
    })),
  ];

  const byMonth = new Map<string, number>(months.map((k) => [k, 0]));
  const byMonthClasses = new Map<string, number>(months.map((k) => [k, 0]));
  const byMonthDayPasses = new Map<string, number>(months.map((k) => [k, 0]));
  const byPlan = new Map<string, number>();
  const byMethod = new Map<string, number>();
  for (const p of rows) {
    const key = monthKey(p.when, timezone);
    if (byMonth.has(key)) {
      byMonth.set(key, (byMonth.get(key) ?? 0) + p.amount);
      if (p.kind === "class") byMonthClasses.set(key, (byMonthClasses.get(key) ?? 0) + p.amount);
      if (p.kind === "daypass") byMonthDayPasses.set(key, (byMonthDayPasses.get(key) ?? 0) + p.amount);
    }
    if (key === months[months.length - 1]) {
      byPlan.set(p.item, (byPlan.get(p.item) ?? 0) + p.amount);
      const method = p.provider === "CASH" ? "Recorded manually" : "Online payment";
      byMethod.set(method, (byMethod.get(method) ?? 0) + p.amount);
    }
  }

  const monthly = months.map((k) => ({ key: k, label: monthLabel(k), value: byMonth.get(k) ?? 0 }));
  const thisMonth = monthly[monthly.length - 1].value;
  const thisMonthClasses = byMonthClasses.get(months[months.length - 1]) ?? 0;
  const thisMonthDayPasses = byMonthDayPasses.get(months[months.length - 1]) ?? 0;
  const lastMonth = monthly[monthly.length - 2]?.value ?? 0;

  const statusCounts = new Map<string, number>();
  for (const g of [...statusGroups, ...classStatusGroups]) statusCounts.set(g.status, (statusCounts.get(g.status) ?? 0) + g._count);

  const recentDayPasses = paidDayPasses
    .filter((p) => p.reviewedAt)
    .sort((a, b) => b.reviewedAt!.getTime() - a.reviewedAt!.getTime())
    .slice(0, 10);

  const recentAll = [
    ...recent.map((p) => ({ id: p.id, member: p.member.fullName, plan: p.plan.name, amount: Number(p.amount), status: p.status, date: p.createdAt })),
    ...recentClasses.map((p) => ({
      id: p.id,
      member: p.registration.member.fullName,
      plan: `${p.registration.session.class.name} class`,
      amount: Number(p.amount),
      status: p.status,
      date: p.createdAt,
    })),
    ...recentDayPasses.map((p) => ({
      id: p.id,
      member: `${p.fullName} (guest)`,
      plan: p.session ? `${p.session.class.name} class (guest)` : `${p.dayPassPlan?.name ?? "Day pass"} (day pass)`,
      amount: Number(p.amount ?? 0),
      status: "PAID" as string,
      date: p.reviewedAt!,
    })),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 10);

  return {
    monthly,
    thisMonth,
    thisMonthClasses,
    thisMonthDayPasses,
    lastMonth,
    changePct: lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : null,
    yearTotal: monthly.reduce((s, m) => s + m.value, 0),
    pendingAmount: Number(pendingAgg._sum.amount ?? 0) + Number(pendingClassAgg._sum.amount ?? 0),
    pendingCount: pendingAgg._count + pendingClassAgg._count,
    byPlan: Array.from(byPlan.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    byMethod: Array.from(byMethod.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    statusCounts: Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count })),
    recent: recentAll,
  };
}

export async function getPlatformFinance(timezone = "Asia/Jakarta") {
  const months = lastMonthKeys(12, timezone);
  const since = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);

  const [gyms, memberCount, paid, pendingAgg, setupAgg] = await Promise.all([
    prisma.gym.findMany({ include: { saasPlan: true, _count: { select: { members: true } } } }),
    prisma.member.count({ where: { status: "ACTIVE" } }),
    // Subscription money only: setup fees are one-time and reported on their own below.
    prisma.platformPayment.findMany({ where: { kind: "SUBSCRIPTION", status: "PAID", paidAt: { gte: since } } }),
    prisma.platformPayment.aggregate({
      where: { status: "PENDING" },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.platformPayment.aggregate({
      where: { kind: "SETUP", status: "PAID" },
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
    setupFeesCollected: Number(setupAgg._sum.amount ?? 0),
    setupFeesCount: setupAgg._count,
    statusCounts: Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count })),
    gymsByMembers,
  };
}

export async function getMemberAttendance(db: TenantDb, memberId: string, timezone: string) {
  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
  const checkins = await db.checkIn.findMany({
    where: { memberId, result: "SUCCESS", checkedInAt: { gte: since } },
    orderBy: { checkedInAt: "desc" },
  });
  const total = await db.checkIn.count({ where: { memberId, result: "SUCCESS" } });

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

import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma, staffLoginUI } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";
import { parseCsv } from "../src/lib/csv";
import { dayKeyInTimezone } from "../src/lib/date";
import { defaultMonthlyRange, defaultTransactionsRange, rangeBounds } from "../src/lib/financeExport";

const DAY = 24 * 60 * 60 * 1000;
const TZ = "Asia/Jakarta";
let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

async function makeGym() {
  const tag = uniq("fin");
  const saasPlan = await prisma.saasPlan.create({
    data: { name: `Plan ${tag}`, price: 1, billingInterval: "monthly", maxMembers: 100, maxStaff: 5, maxWhatsappPerMonth: 1000 },
  });
  const gym = await prisma.gym.create({
    data: { name: `Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, timezone: TZ, subscriptionStatus: "ACTIVE", nextBillingDate: new Date(Date.now() + 30 * DAY) },
  });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  const ownerRow = await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner Ani", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  const plan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  const phone = `0812${Date.now().toString().slice(-8)}`;
  const member = await prisma.member.create({
    data: {
      gymId: gym.id,
      planId: plan.id,
      fullName: "Sari, Dewi",
      email: `${tag}@test.local`,
      phoneWhatsapp: encrypt(phone),
      phoneWhatsappLookup: hmacLookup(phone),
      status: "ACTIVE",
      membershipExpiry: new Date(Date.now() + 10 * DAY),
    },
  });
  return { gym, owner, ownerRow, staff, plan, member, slug: tag };
}

async function login(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  const res = await request.post(`${baseURL}/api/${slug}/login`, { data: who });
  expect(res.ok(), `login ${who.email}`).toBeTruthy();
}

/** Fetches a report and returns its parsed rows (header first). */
async function fetchCsv(request: APIRequestContext, baseURL: string, slug: string, query: string) {
  const res = await request.get(`${baseURL}/api/${slug}/finance/export${query}`);
  expect(res.status(), await res.text()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const text = await res.text();
  expect(text.startsWith("﻿")).toBeTruthy();
  return { rows: parseCsv(text), disposition: res.headers()["content-disposition"] ?? "" };
}

test("default ranges and bounds follow the gym's timezone", async () => {
  // 2026-03-01 00:30 Jakarta is still 2026-02-28 in UTC: the month must be March, not February.
  const now = new Date("2026-02-28T17:30:00Z");
  expect(defaultTransactionsRange(TZ, now)).toEqual({ from: "2026-03-01", to: "2026-03-01" });
  expect(defaultMonthlyRange(TZ, now)).toEqual({ from: "2025-04-01", to: "2026-03-01" });
  const { start, end } = rangeBounds({ from: "2026-03-01", to: "2026-03-01" }, TZ);
  expect(start.toISOString()).toBe("2026-02-28T17:00:00.000Z");
  expect(end.toISOString()).toBe("2026-03-01T16:59:59.000Z");
});

test("owner downloads transactions: paid only by default, everything on request, dated and labelled for a bookkeeper", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const now = new Date();
  const inRange = new Date(now.getTime() - 2 * DAY);
  const longAgo = new Date(now.getTime() - 400 * DAY);

  const cash = await prisma.payment.create({
    data: { gymId: f.gym.id, memberId: f.member.id, planId: f.plan.id, provider: "CASH", amount: 200000, status: "PAID", paidAt: inRange, note: "Front desk, discounted", recordedById: f.ownerRow.id },
  });
  const online = await prisma.payment.create({
    data: { gymId: f.gym.id, memberId: f.member.id, planId: f.plan.id, provider: "XENDIT", amount: 250000, status: "PAID", paidAt: now, externalInvoiceId: `inv_${uniq("x")}` },
  });
  const unpaid = await prisma.payment.create({
    data: { gymId: f.gym.id, memberId: f.member.id, planId: f.plan.id, provider: "XENDIT", amount: 250000, status: "PENDING", createdAt: inRange },
  });
  const voided = await prisma.payment.create({
    data: { gymId: f.gym.id, memberId: f.member.id, planId: f.plan.id, provider: "CASH", amount: 99000, status: "FAILED", createdAt: inRange, recordedById: f.ownerRow.id },
  });
  await prisma.payment.create({
    data: { gymId: f.gym.id, memberId: f.member.id, planId: f.plan.id, provider: "CASH", amount: 1, status: "PAID", paidAt: longAgo, createdAt: longAgo },
  });
  // A class booking paid at the desk sits beside memberships, labelled with the class and its date.
  const gymClass = await prisma.gymClass.create({ data: { gymId: f.gym.id, name: "Yoga", price: 50000, durationMinutes: 60 } });
  const sessionStart = new Date(now.getTime() + 3 * DAY);
  const session = await prisma.classSession.create({ data: { gymId: f.gym.id, classId: gymClass.id, startsAt: sessionStart } });
  const reg = await prisma.classRegistration.create({ data: { gymId: f.gym.id, sessionId: session.id, memberId: f.member.id, status: "CONFIRMED" } });
  const classPay = await prisma.classPayment.create({
    data: { gymId: f.gym.id, registrationId: reg.id, provider: "CASH", amount: 50000, status: "PAID", paidAt: inRange, recordedById: f.ownerRow.id },
  });

  await login(request, baseURL!, f.slug, f.owner);
  const from = dayKeyInTimezone(new Date(now.getTime() - 7 * DAY), TZ);
  const to = dayKeyInTimezone(now, TZ);

  const paid = await fetchCsv(request, baseURL!, f.slug, `?from=${from}&to=${to}`);
  expect(paid.disposition).toContain(`finance-transactions-${f.slug}-${from}-to-${to}.csv`);
  expect(paid.rows[0]).toEqual(["Date", "Type", "Member", "Item", "Amount", "Currency", "Status", "Method", "Recorded by", "Note", "Invoice ID", "Payment ID"]);
  const paidIds = paid.rows.slice(1).map((r) => r[11]);
  expect(new Set(paidIds)).toEqual(new Set([cash.id, classPay.id, online.id]));
  // Oldest first: the two-day-old entries before today's.
  expect(paidIds[2]).toBe(online.id);
  expect(paidIds).not.toContain(unpaid.id);
  expect(paidIds).not.toContain(voided.id);

  const cashRow = paid.rows.find((r) => r[11] === cash.id)!;
  expect(cashRow).toEqual([dayKeyInTimezone(inRange, TZ), "Membership", "Sari, Dewi", "Monthly", "200000", "IDR", "PAID", "Cash / transfer at desk", "Owner Ani", "Front desk, discounted", "", cash.id]);
  const onlineRow = paid.rows.find((r) => r[11] === online.id)!;
  expect(onlineRow[7]).toBe("Online (Xendit)");
  expect(onlineRow[10]).toBe(online.externalInvoiceId);
  const classRow = paid.rows.find((r) => r[11] === classPay.id)!;
  expect(classRow[1]).toBe("Class");
  expect(classRow[3]).toBe(`Yoga (${dayKeyInTimezone(sessionStart, TZ)})`);
  expect(classRow[4]).toBe("50000");

  // Everything: the unpaid invoice and the voided desk entry appear, labelled honestly.
  const all = await fetchCsv(request, baseURL!, f.slug, `?from=${from}&to=${to}&status=all`);
  const byId = Object.fromEntries(all.rows.slice(1).map((r) => [r[11], r]));
  expect(Object.keys(byId)).toHaveLength(5);
  expect(byId[unpaid.id][6]).toBe("PENDING");
  expect(byId[voided.id][6]).toBe("VOIDED");
  expect(byId[voided.id][4]).toBe("99000");

  // The default range is this month, so the 400-day-old payment never shows; a range that covers it does.
  const defaults = await fetchCsv(request, baseURL!, f.slug, "");
  expect(defaults.rows.slice(1).map((r) => r[4])).not.toContain("1");
  const wide = await fetchCsv(request, baseURL!, f.slug, `?from=${dayKeyInTimezone(longAgo, TZ)}&to=${to}`);
  expect(wide.rows.slice(1).map((r) => r[4])).toContain("1");

  // Bad input and the wrong people.
  expect((await request.get(`${baseURL}/api/${f.slug}/finance/export?from=2026-13-01`)).status()).toBe(400);
  expect((await request.get(`${baseURL}/api/${f.slug}/finance/export?from=2026-02-01&to=2026-01-01`)).status()).toBe(400);
  expect((await request.get(`${baseURL}/api/${f.slug}/finance/export?report=yearly`)).status()).toBe(400);

  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  expect((await staffCtx.get(`${baseURL}/api/${f.slug}/finance/export`)).status()).toBe(403);
  await staffCtx.dispose();

  const other = await makeGym();
  const otherCtx = await playwright.request.newContext();
  await login(otherCtx, baseURL!, other.slug, other.owner);
  const cross = await otherCtx.get(`${baseURL}/api/${f.slug}/finance/export?from=${from}&to=${to}`);
  expect(cross.ok()).toBeFalsy();
  expect(await cross.text()).not.toContain(cash.id);
  await otherCtx.dispose();
});

test("the monthly summary has one row per month with revenue split by type and method", async ({ request, baseURL }) => {
  const f = await makeGym();
  const now = new Date();
  const thisKey = dayKeyInTimezone(now, TZ).slice(0, 7);
  // Pick a day safely inside the previous month, in Jakarta time.
  const [y, m] = thisKey.split("-").map(Number);
  const prevMonth = new Date(Date.UTC(y, m - 2, 15, 5));
  const prevKey = dayKeyInTimezone(prevMonth, TZ).slice(0, 7);

  await prisma.payment.createMany({
    data: [
      { gymId: f.gym.id, memberId: f.member.id, planId: f.plan.id, provider: "CASH", amount: 200000, status: "PAID", paidAt: now },
      { gymId: f.gym.id, memberId: f.member.id, planId: f.plan.id, provider: "XENDIT", amount: 250000, status: "PAID", paidAt: now },
      { gymId: f.gym.id, memberId: f.member.id, planId: f.plan.id, provider: "CASH", amount: 300000, status: "PAID", paidAt: prevMonth, createdAt: prevMonth },
      { gymId: f.gym.id, memberId: f.member.id, planId: f.plan.id, provider: "CASH", amount: 50000, status: "FAILED", createdAt: prevMonth },
      { gymId: f.gym.id, memberId: f.member.id, planId: f.plan.id, provider: "XENDIT", amount: 250000, status: "PENDING", createdAt: now },
    ],
  });
  const gymClass = await prisma.gymClass.create({ data: { gymId: f.gym.id, name: "Spin", price: 40000, durationMinutes: 45 } });
  const session = await prisma.classSession.create({ data: { gymId: f.gym.id, classId: gymClass.id, startsAt: now } });
  const reg = await prisma.classRegistration.create({ data: { gymId: f.gym.id, sessionId: session.id, memberId: f.member.id, status: "CONFIRMED" } });
  await prisma.classPayment.create({ data: { gymId: f.gym.id, registrationId: reg.id, provider: "MIDTRANS", amount: 40000, status: "PAID", paidAt: now } });

  // A scanned day pass (paid at the desk) counts too; one that was never scanned doesn't.
  const dayPlan = await prisma.dayPassPlan.create({ data: { gymId: f.gym.id, name: "Single visit", price: 30000 } });
  const dp = (status: "ATTENDED" | "APPROVED", n: number) => ({
    gymId: f.gym.id, dayPassPlanId: dayPlan.id, visitDate: dayKeyInTimezone(now, TZ), fullName: `Guest ${n}`, phoneWhatsapp: "v1:x", phoneWhatsappLookup: `dp-${n}-${f.slug}`,
    status, amount: 30000, attendedAt: status === "ATTENDED" ? now : null,
  });
  await prisma.guestPass.createMany({ data: [dp("ATTENDED", 1), dp("APPROVED", 2)] });

  await login(request, baseURL!, f.slug, f.owner);
  const { rows, disposition } = await fetchCsv(request, baseURL!, f.slug, `?report=monthly&from=${prevKey}-01&to=${dayKeyInTimezone(now, TZ)}`);
  expect(disposition).toContain(`finance-monthly-${f.slug}-`);
  expect(rows[0]).toEqual(["Month", "Membership revenue", "Class revenue", "Day pass revenue", "Total revenue", "Paid payments", "Cash / transfer", "Online", "Voided"]);
  expect(rows).toHaveLength(3);
  // Previous month: one cash payment, one voided entry.
  expect(rows[1].slice(1)).toEqual(["300000", "0", "0", "300000", "1", "300000", "0", "1"]);
  // This month: cash + online membership and an online class; the pending invoice isn't revenue.
  expect(rows[2].slice(1)).toEqual(["450000", "40000", "30000", "520000", "4", "230000", "290000", "0"]);
  expect(rows[2][0]).toMatch(/^[A-Z][a-z]{2} \d{4}$/);

  // The default monthly range is twelve months, all present even when empty.
  const year = await fetchCsv(request, baseURL!, f.slug, "?report=monthly");
  expect(year.rows).toHaveLength(13);
  expect(year.rows.slice(1, 11).every((r) => r[3] === "0")).toBeTruthy();
});

test("the Finance page offers the exports to the owner with this month pre-filled", async ({ page, baseURL }) => {
  const f = await makeGym();
  await staffLoginUI(page, baseURL!, f.slug, f.owner.email, f.owner.password);
  await page.waitForURL(`${baseURL}/${f.slug}/dashboard`);
  await page.goto(`${baseURL}/${f.slug}/finance`);

  const { from, to } = defaultTransactionsRange(TZ);
  await expect(page.getByLabel("From", { exact: true })).toHaveValue(from);
  await expect(page.getByLabel("To", { exact: true })).toHaveValue(to);
  await expect(page.getByRole("button", { name: "Download transactions" })).toBeEnabled();
  await page.getByLabel("Include").selectOption("all");

  // The buttons save a properly named .csv, not a file called "export".
  const [tx] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download transactions" }).click()]);
  expect(tx.suggestedFilename()).toBe(`finance-transactions-${f.slug}-${from}-to-${to}.csv`);
  
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download monthly summary" }).click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^finance-monthly-${f.slug}-.*\\.csv$`));
});

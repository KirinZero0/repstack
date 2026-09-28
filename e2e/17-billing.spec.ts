import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

interface PlanSpec {
  price: number;
  interval?: "monthly" | "annual";
  maxMembers?: number;
  maxStaff?: number;
  wa?: number;
  active?: boolean;
}

async function makePlan(name: string, s: PlanSpec) {
  return prisma.saasPlan.create({
    data: {
      name,
      price: s.price,
      billingInterval: s.interval ?? "monthly",
      maxMembers: s.maxMembers ?? 100,
      maxStaff: s.maxStaff ?? 5,
      maxWhatsappPerMonth: s.wa ?? 500,
      isActive: s.active ?? true,
    },
  });
}

async function makeGym(plan: { id: string }, over: { status?: "ACTIVE" | "PAST_DUE" | "SUSPENDED"; nextBillingDate?: Date | null; isLifetime?: boolean; settings?: object } = {}) {
  const tag = uniq("bill");
  const gym = await prisma.gym.create({
    data: {
      name: `Billing ${tag}`,
      slug: tag,
      saasPlanId: plan.id,
      subscriptionStatus: over.status ?? "ACTIVE",
      nextBillingDate: over.nextBillingDate === undefined ? new Date(Date.now() + 10 * DAY) : over.nextBillingDate,
      isLifetime: over.isLifetime ?? false,
      settings: over.settings ?? {},
    },
  });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, phone: "081200009999", passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  const memberPlan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  return { gym, owner, staff, slug: tag, memberPlan };
}

async function addMembers(f: Awaited<ReturnType<typeof makeGym>>, n: number) {
  for (let i = 0; i < n; i++) {
    const phone = `0812${Date.now().toString().slice(-7)}${i}${seq++}`;
    await prisma.member.create({
      data: {
        gymId: f.gym.id,
        planId: f.memberPlan.id,
        fullName: `Seat ${i}`,
        email: `${uniq("seat")}@test.local`,
        phoneWhatsapp: encrypt(phone),
        phoneWhatsappLookup: hmacLookup(phone),
        status: "ACTIVE",
        membershipExpiry: new Date(Date.now() + 10 * DAY),
      },
    });
  }
}

const login = (request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) =>
  request.post(`${baseURL}/api/${slug}/login`, { data: who });

async function loginOk(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  const res = await login(request, baseURL, slug, who);
  expect(res.ok(), `login ${who.email}`).toBeTruthy();
  return res;
}

const runCron = (request: APIRequestContext, baseURL: string) =>
  request.get(`${baseURL}/api/cron/subscriptions`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });

const pay = (request: APIRequestContext, baseURL: string, paymentId: string) =>
  request.post(`${baseURL}/api/webhooks/xendit`, {
    data: { id: `evt_${paymentId}`, external_id: paymentId, status: "PAID", paid_at: new Date().toISOString() },
    headers: { "x-callback-token": process.env.XENDIT_CALLBACK_TOKEN! },
  });

test("cron opens one renewal invoice for a due gym, marks it past due, and doesn't stack more", async ({ request, baseURL }) => {
  const plan = await makePlan(uniq("Cron"), { price: 300000 });
  const f = await makeGym(plan, { nextBillingDate: new Date(Date.now() - 1 * DAY) });

  expect((await runCron(request, baseURL!)).ok()).toBeTruthy();
  let payments = await prisma.platformPayment.findMany({ where: { gymId: f.gym.id } });
  expect(payments).toHaveLength(1);
  expect(payments[0].status).toBe("PENDING");
  expect(payments[0].invoiceUrl).toBeTruthy();
  expect(payments[0].externalInvoiceId).toBeTruthy();
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).subscriptionStatus).toBe("PAST_DUE");

  // A second run reuses the open invoice instead of creating another.
  await runCron(request, baseURL!);
  payments = await prisma.platformPayment.findMany({ where: { gymId: f.gym.id } });
  expect(payments).toHaveLength(1);

  // Lifetime gyms are never billed.
  const life = await makeGym(plan, { nextBillingDate: new Date(Date.now() - 1 * DAY), isLifetime: true });
  await runCron(request, baseURL!);
  expect(await prisma.platformPayment.count({ where: { gymId: life.gym.id } })).toBe(0);
});

test("a gym suspended for non-payment lets only its owner in, to pay; paying switches it back on once", async ({ request, baseURL, playwright }) => {
  const plan = await makePlan(uniq("Grace"), { price: 300000 });
  const f = await makeGym(plan, { status: "PAST_DUE", nextBillingDate: new Date(Date.now() - 4 * DAY) });
  const before = f.gym.nextBillingDate!;

  await runCron(request, baseURL!);
  const suspended = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(suspended.subscriptionStatus).toBe("SUSPENDED");
  expect((suspended.settings as { suspendedFor?: string }).suspendedFor).toBe("non_payment");

  // Staff are still shut out.
  const staffCtx = await playwright.request.newContext();
  expect((await login(staffCtx, baseURL!, f.slug, f.staff)).status()).toBe(403);
  await staffCtx.dispose();

  // The owner gets in, but only to billing.
  const res = await loginOk(request, baseURL!, f.slug, f.owner);
  expect((await res.json()).billingOnly).toBe(true);
  const page = await request.get(`${baseURL}/${f.slug}/billing`);
  expect(page.status()).toBe(200);
  expect(await page.text()).toContain("suspended because the subscription wasn");
  const blocked = await request.post(`${baseURL}/api/${f.slug}/members`, {
    data: { fullName: "Nope Nope", email: `${uniq("nope")}@test.local`, phoneWhatsapp: "081233334444", planId: f.memberPlan.id },
  });
  expect(blocked.status()).toBe(403);
  expect((await request.post(`${baseURL}/api/${f.slug}/subscription`, { data: { saasPlanId: plan.id } })).status()).toBe(403);

  const payNow = await request.post(`${baseURL}/api/${f.slug}/billing/pay`);
  expect(payNow.ok()).toBeTruthy();
  const { url } = await payNow.json();
  expect(url).toBeTruthy();
  const open = await prisma.platformPayment.findFirstOrThrow({ where: { gymId: f.gym.id, status: "PENDING" } });

  // Same invoice again, not a second one.
  const again = await request.post(`${baseURL}/api/${f.slug}/billing/pay`);
  expect((await again.json()).url).toBe(url);
  expect(await prisma.platformPayment.count({ where: { gymId: f.gym.id, status: "PENDING" } })).toBe(1);

  expect((await pay(request, baseURL!, open.id)).ok()).toBeTruthy();
  const active = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(active.subscriptionStatus).toBe("ACTIVE");
  expect((active.settings as { suspendedFor?: string }).suspendedFor).toBeUndefined();
  expect(active.nextBillingDate!.getTime()).toBeGreaterThan(Date.now() + 25 * DAY);
  expect(active.nextBillingDate!.getTime()).toBeGreaterThan(before.getTime());

  // A repeated webhook doesn't extend it a second time.
  await pay(request, baseURL!, open.id);
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).nextBillingDate!.getTime()).toBe(active.nextBillingDate!.getTime());

  // And the owner is fully back in.
  const members = await request.post(`${baseURL}/api/${f.slug}/members`, {
    data: { fullName: "Back In", email: `${uniq("back")}@test.local`, phoneWhatsapp: "081233335555", planId: f.memberPlan.id },
  });
  expect(members.status()).toBe(201);
});

test("a gym a superadmin suspended can't get back in by paying an old invoice", async ({ request, baseURL }) => {
  const plan = await makePlan(uniq("Admin"), { price: 300000 });
  const f = await makeGym(plan, { status: "SUSPENDED" }); // no suspendedFor reason: admin action
  expect((await login(request, baseURL!, f.slug, f.owner)).status()).toBe(403);

  const invoice = await prisma.platformPayment.create({
    data: { gymId: f.gym.id, saasPlanId: plan.id, provider: "xendit", amount: 300000, status: "PENDING", externalInvoiceId: uniq("inv"), invoiceUrl: "/x" },
  });
  expect((await pay(request, baseURL!, invoice.id)).ok()).toBeTruthy();
  const after = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(after.subscriptionStatus).toBe("SUSPENDED");
  expect((await prisma.platformPayment.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("PAID");
  expect((await login(request, baseURL!, f.slug, f.owner)).status()).toBe(403);
});

test("changing plan: bigger plans are paid for first, smaller ones apply at once if the gym fits", async ({ request, baseURL, playwright }) => {
  const small = await makePlan(uniq("Small"), { price: 100000, maxMembers: 10, maxStaff: 2, wa: 100 });
  const big = await makePlan(uniq("Big"), { price: 300000, maxMembers: 50, maxStaff: 5, wa: 500 });
  const tiny = await makePlan(uniq("Tiny"), { price: 50000, maxMembers: 3, maxStaff: 1, wa: 50 });
  const yearly = await makePlan(uniq("SmallYearly"), { price: 1000000, interval: "annual", maxMembers: 10, maxStaff: 2, wa: 100 });
  const hidden = await makePlan(uniq("Hidden"), { price: 1, active: false });

  const f = await makeGym(small);
  const billingDate = f.gym.nextBillingDate!;
  await loginOk(request, baseURL!, f.slug, f.owner);
  const change = (planId: string) => request.post(`${baseURL}/api/${f.slug}/subscription`, { data: { saasPlanId: planId } });

  // Bad targets.
  expect((await change(small.id)).status()).toBe(409);
  expect((await change(hidden.id)).status()).toBe(400);
  const staffCtx = await playwright.request.newContext();
  await loginOk(staffCtx, baseURL!, f.slug, f.staff);
  expect((await staffCtx.post(`${baseURL}/api/${f.slug}/subscription`, { data: { saasPlanId: big.id } })).status()).toBe(403);
  await staffCtx.dispose();

  // Upgrade: an invoice comes back, and nothing changes until it's paid.
  const up = await change(big.id);
  expect(up.ok()).toBeTruthy();
  const { url } = await up.json();
  expect(url).toBeTruthy();
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).saasPlanId).toBe(small.id);
  const invoice = await prisma.platformPayment.findFirstOrThrow({ where: { gymId: f.gym.id, status: "PENDING" } });
  expect(invoice.saasPlanId).toBe(big.id);
  expect(Number(invoice.amount)).toBe(300000);

  // Asking for a different plan retires that invoice, so only one is ever payable and a stale one can't undo the change.
  const other = await change(yearly.id);
  expect(other.ok()).toBeTruthy();
  expect(await prisma.platformPayment.count({ where: { gymId: f.gym.id, status: "PENDING" } })).toBe(1);
  expect((await prisma.platformPayment.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("EXPIRED");
  await pay(request, baseURL!, invoice.id);
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).saasPlanId).toBe(small.id);

  // Pay for the bigger plan: it switches on and the billing date moves out a period.
  await change(big.id);
  const bigInvoice = await prisma.platformPayment.findFirstOrThrow({ where: { gymId: f.gym.id, status: "PENDING" } });
  expect((await pay(request, baseURL!, bigInvoice.id)).ok()).toBeTruthy();
  let gym = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(gym.saasPlanId).toBe(big.id);
  expect(gym.nextBillingDate!.getTime()).toBe(billingDate.getTime() + 30 * DAY);

  // Downgrade to a plan the gym doesn't fit is refused, naming the limit.
  await addMembers(f, 5);
  const tooMany = await change(tiny.id);
  expect(tooMany.status()).toBe(409);
  expect((await tooMany.json()).error).toContain("allows 3 members");

  // A fitting downgrade is immediate and free, and the billing date is left alone.
  const down = await change(small.id);
  expect((await down.json()).changed).toBe(true);
  gym = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(gym.saasPlanId).toBe(small.id);
  expect(gym.nextBillingDate!.getTime()).toBe(billingDate.getTime() + 30 * DAY);
  expect(await prisma.platformPayment.count({ where: { gymId: f.gym.id, status: "PENDING" } })).toBe(0);

  // Yearly costs more than monthly of the same tier, so it's paid for first; paying adds a year.
  const toYearly = await change(yearly.id);
  expect((await toYearly.json()).url).toBeTruthy();
  const yearlyInvoice = await prisma.platformPayment.findFirstOrThrow({ where: { gymId: f.gym.id, status: "PENDING" } });
  await pay(request, baseURL!, yearlyInvoice.id);
  gym = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(gym.saasPlanId).toBe(yearly.id);
  expect(gym.nextBillingDate!.getTime()).toBe(billingDate.getTime() + 30 * DAY + 365 * DAY);

  // Yearly back to monthly is the free, immediate kind.
  expect((await (await change(small.id)).json()).changed).toBe(true);
});

test("lifetime accounts can't change plan or pay", async ({ request, baseURL }) => {
  const plan = await makePlan(uniq("Life"), { price: 300000 });
  const other = await makePlan(uniq("LifeOther"), { price: 400000 });
  const f = await makeGym(plan, { isLifetime: true, nextBillingDate: null });
  await loginOk(request, baseURL!, f.slug, f.owner);
  expect((await request.post(`${baseURL}/api/${f.slug}/subscription`, { data: { saasPlanId: other.id } })).status()).toBe(409);
  expect((await request.post(`${baseURL}/api/${f.slug}/billing/pay`)).status()).toBe(409);
});

test("billing page shows usage and a pay button to owners, and is closed to staff and other gyms", async ({ request, baseURL, playwright }) => {
  const plan = await makePlan(uniq("Page"), { price: 300000, maxMembers: 20, maxStaff: 3, wa: 250 });
  const f = await makeGym(plan);
  await addMembers(f, 2);
  await loginOk(request, baseURL!, f.slug, f.owner);

  const html = (await (await request.get(`${baseURL}/${f.slug}/billing`)).text()).replace(/<!-- -->/g, "");
  expect(html).toContain("2 of 20");
  expect(html).toContain("Renew early");
  expect(html).toContain("Change plan");

  const staffCtx = await playwright.request.newContext();
  await loginOk(staffCtx, baseURL!, f.slug, f.staff);
  expect(await (await staffCtx.get(`${baseURL}/${f.slug}/billing`)).text()).toContain("Only the gym owner");
  expect((await staffCtx.post(`${baseURL}/api/${f.slug}/billing/pay`)).status()).toBe(403);
  await staffCtx.dispose();

  // Another gym's owner can't pay for or read this gym's billing.
  const other = await makeGym(plan);
  const otherCtx = await playwright.request.newContext();
  await loginOk(otherCtx, baseURL!, other.slug, other.owner);
  expect((await otherCtx.post(`${baseURL}/api/${f.slug}/billing/pay`)).status()).toBe(401);
  await otherCtx.dispose();
});

test("owner can rename the gym and change its timezone; nobody else can", async ({ request, baseURL, playwright }) => {
  const plan = await makePlan(uniq("Settings"), { price: 300000 });
  const f = await makeGym(plan);
  await loginOk(request, baseURL!, f.slug, f.owner);

  const ok = await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { name: "Renamed Gym", timezone: "Asia/Makassar" } });
  expect(ok.ok()).toBeTruthy();
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(gym.name).toBe("Renamed Gym");
  expect(gym.timezone).toBe("Asia/Makassar");
  expect(gym.slug).toBe(f.slug);

  expect((await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { timezone: "Mars/Olympus" } })).status()).toBe(400);
  expect((await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { name: "x" } })).status()).toBe(400);

  const staffCtx = await playwright.request.newContext();
  await loginOk(staffCtx, baseURL!, f.slug, f.staff);
  expect((await staffCtx.post(`${baseURL}/api/${f.slug}/settings`, { data: { name: "Hijacked Gym" } })).status()).toBe(403);
  await staffCtx.dispose();
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).name).toBe("Renamed Gym");
});

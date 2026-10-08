import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { ticketTokenFor } from "../src/lib/guestPass";
import { dayKeyInTimezone } from "../src/lib/date";

const HOUR = 60 * 60 * 1000;
let seq = 0;

async function makeGym(over: { capacity?: number | null; startsInMs?: number } = {}) {
  const tag = `guest-${Date.now()}-${seq++}`;
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const gym = await prisma.gym.create({ data: { name: `Guest Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE" } });
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  const cls = await prisma.gymClass.create({ data: { gymId: gym.id, name: "Yoga", price: 0, durationMinutes: 60, capacity: over.capacity ?? null } });
  const session = await prisma.classSession.create({ data: { gymId: gym.id, classId: cls.id, startsAt: new Date(Date.now() + (over.startsInMs ?? 30 * 60 * 1000)) } });
  return { gym, staff, cls, session, slug: tag };
}

async function login(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  expect((await request.post(`${baseURL}/api/${slug}/login`, { data: who })).ok()).toBeTruthy();
}

async function requestSpot(request: APIRequestContext, baseURL: string, f: { slug: string; session: { id: string } }, phone: string, name = "Guest Gina") {
  return request.post(`${baseURL}/api/${f.slug}/guest-passes`, { data: { sessionId: f.session.id, fullName: name, phone } });
}

const phoneN = () => `0813${Date.now().toString().slice(-6)}${seq++}`;

test("guest requests, staff approves, ticket scans once", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const phone = phoneN();

  // Public request: no login, and nothing is sent or issued yet.
  const anon = await playwright.request.newContext();
  expect((await requestSpot(anon, baseURL!, f, phone)).status()).toBe(201);
  const pass = await prisma.guestPass.findFirstOrThrow({ where: { gymId: f.gym.id } });
  expect(pass.status).toBe("PENDING_REVIEW");
  expect(pass.phoneWhatsapp.startsWith("v1:")).toBeTruthy();
  expect(await prisma.notificationLog.count({ where: { gymId: f.gym.id, type: "guest_ticket" } })).toBe(0);

  // The same phone can't ask twice for one session.
  expect((await requestSpot(anon, baseURL!, f, phone)).status()).toBe(409);

  // A pending request has no usable ticket.
  const token = ticketTokenFor(pass);
  await login(request, baseURL!, f.slug, f.staff);
  let scan = await request.post(`${baseURL}/api/checkin`, { data: { token } });
  expect((await scan.json()).result).toBe("INVALID");

  // Approve → WhatsApp logged, ticket page shows the QR.
  expect((await request.post(`${baseURL}/api/${f.slug}/guest-passes/${pass.id}`, { data: { action: "approve" } })).ok()).toBeTruthy();
  expect(await prisma.notificationLog.count({ where: { gymId: f.gym.id, type: "guest_ticket", memberId: null } })).toBe(1);
  expect((await request.post(`${baseURL}/api/${f.slug}/guest-passes/${pass.id}`, { data: { action: "approve" } })).status()).toBe(409);
  const page = await anon.get(`${baseURL}/ticket/${token}`);
  expect(await page.text()).toContain("ticket-qr");

  // First scan admits, second is a duplicate, and the ticket page now says used.
  scan = await request.post(`${baseURL}/api/checkin`, { data: { token } });
  expect((await scan.json()).result).toBe("SUCCESS");
  expect((await prisma.guestPass.findUniqueOrThrow({ where: { id: pass.id } })).status).toBe("ATTENDED");
  scan = await request.post(`${baseURL}/api/checkin`, { data: { token } });
  expect((await scan.json()).result).toBe("DUPLICATE");
  expect(await (await anon.get(`${baseURL}/ticket/${token}`)).text()).toContain("ticket-used");
});

test("ticket from another gym is rejected, as is a forged one", async ({ request, baseURL }) => {
  const a = await makeGym();
  const b = await makeGym();
  const pass = await prisma.guestPass.create({
    data: { gymId: b.gym.id, sessionId: b.session.id, fullName: "Other", phoneWhatsapp: "v1:x", phoneWhatsappLookup: `l-${seq++}`, status: "APPROVED" },
  });
  await login(request, baseURL!, a.slug, a.staff);
  const res = await request.post(`${baseURL}/api/checkin`, { data: { token: ticketTokenFor(pass) } });
  expect((await res.json()).result).toBe("INVALID");
  expect((await prisma.guestPass.findUniqueOrThrow({ where: { id: pass.id } })).status).toBe("APPROVED");

  const forged = ticketTokenFor(pass).replace(/.$/, (c) => (c === "0" ? "1" : "0"));
  await login(request, baseURL!, b.slug, b.staff);
  expect((await (await request.post(`${baseURL}/api/checkin`, { data: { token: forged } })).json()).result).toBe("INVALID");
});

test("staff can't review another gym's request, and scans are staff-only", async ({ request, baseURL, playwright }) => {
  const a = await makeGym();
  const b = await makeGym();
  const pass = await prisma.guestPass.create({
    data: { gymId: b.gym.id, sessionId: b.session.id, fullName: "Other", phoneWhatsapp: "v1:x", phoneWhatsappLookup: `l-${seq++}` },
  });
  await login(request, baseURL!, a.slug, a.staff);
  expect((await request.post(`${baseURL}/api/${a.slug}/guest-passes/${pass.id}`, { data: { action: "approve" } })).status()).toBe(404);
  expect((await request.post(`${baseURL}/api/${b.slug}/guest-passes/${pass.id}`, { data: { action: "approve" } })).status()).toBe(401);
  expect((await prisma.guestPass.findUniqueOrThrow({ where: { id: pass.id } })).status).toBe("PENDING_REVIEW");

  const anon = await playwright.request.newContext();
  expect((await anon.post(`${baseURL}/api/checkin`, { data: { token: ticketTokenFor({ ...pass, ticketSecret: pass.ticketSecret }) } })).status()).toBe(401);
});

test("public request can't target another gym's session", async ({ baseURL, playwright }) => {
  const a = await makeGym();
  const b = await makeGym();
  const anon = await playwright.request.newContext();
  const res = await requestSpot(anon, baseURL!, { slug: a.slug, session: b.session }, phoneN());
  expect(res.status()).toBe(400);
  expect(await prisma.guestPass.count({ where: { sessionId: b.session.id } })).toBe(0);
});

test("approval respects capacity, and declining sends no ticket", async ({ request, baseURL, playwright }) => {
  const f = await makeGym({ capacity: 1 });
  const anon = await playwright.request.newContext();
  await requestSpot(anon, baseURL!, f, phoneN(), "First");
  await requestSpot(anon, baseURL!, f, phoneN(), "Second");
  const [first, second] = await prisma.guestPass.findMany({ where: { gymId: f.gym.id }, orderBy: { createdAt: "asc" } });
  await login(request, baseURL!, f.slug, f.staff);
  expect((await request.post(`${baseURL}/api/${f.slug}/guest-passes/${first.id}`, { data: { action: "approve" } })).ok()).toBeTruthy();
  const full = await request.post(`${baseURL}/api/${f.slug}/guest-passes/${second.id}`, { data: { action: "approve" } });
  expect(full.status()).toBe(409);
  expect((await request.post(`${baseURL}/api/${f.slug}/guest-passes/${second.id}`, { data: { action: "reject" } })).ok()).toBeTruthy();
  expect((await prisma.guestPass.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("REJECTED");
  expect(await prisma.notificationLog.count({ where: { gymId: f.gym.id, type: "guest_ticket" } })).toBe(1);
  // A declined guest's ticket never scans.
  const res = await request.post(`${baseURL}/api/checkin`, { data: { token: ticketTokenFor(second) } });
  expect((await res.json()).result).toBe("INVALID");
});

test("ticket is not valid long before the class", async ({ request, baseURL }) => {
  const f = await makeGym({ startsInMs: 5 * HOUR });
  const pass = await prisma.guestPass.create({
    data: { gymId: f.gym.id, sessionId: f.session.id, fullName: "Early", phoneWhatsapp: "v1:x", phoneWhatsappLookup: `l-${seq++}`, status: "APPROVED" },
  });
  await login(request, baseURL!, f.slug, f.staff);
  const body = await (await request.post(`${baseURL}/api/checkin`, { data: { token: ticketTokenFor(pass) } })).json();
  expect(body.result).toBe("INVALID");
  expect(body.message).toContain("Too early");
  expect((await prisma.guestPass.findUniqueOrThrow({ where: { id: pass.id } })).status).toBe("APPROVED");
});

// ─── Day passes ──────────────────────────────────────────────

async function makeDayPass(slugGymId: string, price = 50000) {
  return prisma.dayPassPlan.create({ data: { gymId: slugGymId, name: "Single visit", price } });
}
const todayIn = (tz: string, plusDays = 0) => dayKeyInTimezone(new Date(Date.now() + plusDays * 24 * 60 * 60 * 1000), tz);

test("day pass: owner sets it up, guest requests, staff approves, ticket scans once and no member is created", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const owner = { email: `owner-${f.slug}@test.local`, password: "owner-pass-123" };
  await prisma.staffUser.create({ data: { gymId: f.gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });

  // Staff can't manage plans; the owner can.
  await login(request, baseURL!, f.slug, f.staff);
  expect((await request.post(`${baseURL}/api/${f.slug}/day-pass-plans`, { data: { name: "Single visit", price: 50000 } })).status()).toBe(403);
  await login(request, baseURL!, f.slug, owner);
  const created = await request.post(`${baseURL}/api/${f.slug}/day-pass-plans`, { data: { name: "Single visit", price: 50000 } });
  expect(created.status()).toBe(201);
  const { planId } = await created.json();

  const anon = await playwright.request.newContext();
  // The plan shows up where visitors join, not under classes; the owner manages it with the membership plans.
  expect(await (await anon.get(`${baseURL}/${f.slug}/join/day-pass`)).text()).toContain("Single visit");
  expect(await (await anon.get(`${baseURL}/${f.slug}/join`)).text()).toContain("day-pass-link");
  expect(await (await request.get(`${baseURL}/${f.slug}/plans`)).text()).toContain("day-pass-plans");
  expect(await (await request.get(`${baseURL}/${f.slug}/classes`)).text()).not.toContain("day-pass-plans");
  expect(await (await request.get(`${baseURL}/${f.slug}/members/guests`)).text()).toContain("Guest tickets");
  const visitDate = todayIn(f.gym.timezone);
  const phone = phoneN();
  const req1 = await anon.post(`${baseURL}/api/${f.slug}/guest-passes`, { data: { dayPassPlanId: planId, visitDate, fullName: "Day Dave", phone } });
  expect(req1.status()).toBe(201);
  // Same phone, plan and day can't be filed twice; another day can.
  expect((await anon.post(`${baseURL}/api/${f.slug}/guest-passes`, { data: { dayPassPlanId: planId, visitDate, fullName: "Day Dave", phone } })).status()).toBe(409);
  expect((await anon.post(`${baseURL}/api/${f.slug}/guest-passes`, { data: { dayPassPlanId: planId, visitDate: todayIn(f.gym.timezone, 1), fullName: "Day Dave", phone } })).status()).toBe(201);

  const pass = await prisma.guestPass.findFirstOrThrow({ where: { gymId: f.gym.id, visitDate }, });
  expect(pass.sessionId).toBeNull();
  const token = ticketTokenFor(pass);
  expect((await request.post(`${baseURL}/api/${f.slug}/guest-passes/${pass.id}`, { data: { action: "approve" } })).ok()).toBeTruthy();
  expect(await prisma.notificationLog.count({ where: { gymId: f.gym.id, type: "guest_ticket", memberId: null } })).toBe(1);
  expect(await (await anon.get(`${baseURL}/ticket/${token}`)).text()).toContain("ticket-qr");

  expect((await (await request.post(`${baseURL}/api/checkin`, { data: { token } })).json()).result).toBe("SUCCESS");
  expect((await (await request.post(`${baseURL}/api/checkin`, { data: { token } })).json()).result).toBe("DUPLICATE");
  expect((await prisma.guestPass.findUniqueOrThrow({ where: { id: pass.id } })).status).toBe("ATTENDED");

  // Never a member, never a check-in row.
  expect(await prisma.member.count({ where: { gymId: f.gym.id } })).toBe(0);
  expect(await prisma.checkIn.count({ where: { gymId: f.gym.id } })).toBe(0);
});

test("day pass is only valid on its day", async ({ request, baseURL }) => {
  const f = await makeGym();
  const plan = await makeDayPass(f.gym.id);
  await login(request, baseURL!, f.slug, f.staff);
  const mk = (visitDate: string) =>
    prisma.guestPass.create({
      data: { gymId: f.gym.id, dayPassPlanId: plan.id, visitDate, fullName: "D", phoneWhatsapp: "v1:x", phoneWhatsappLookup: `l-${seq++}`, status: "APPROVED" },
    });
  const future = await mk(todayIn(f.gym.timezone, 3));
  const past = await mk(todayIn(f.gym.timezone, -2));
  const early = await (await request.post(`${baseURL}/api/checkin`, { data: { token: ticketTokenFor(future) } })).json();
  expect(early.result).toBe("INVALID");
  expect(early.message).toContain("Too early");
  const late = await (await request.post(`${baseURL}/api/checkin`, { data: { token: ticketTokenFor(past) } })).json();
  expect(late.result).toBe("EXPIRED");
  expect((await prisma.guestPass.findUniqueOrThrow({ where: { id: future.id } })).status).toBe("APPROVED");
});

test("day pass requests are tenant-scoped and validated", async ({ baseURL, playwright }) => {
  const a = await makeGym();
  const b = await makeGym();
  const planB = await makeDayPass(b.gym.id);
  const hidden = await prisma.dayPassPlan.create({ data: { gymId: a.gym.id, name: "Hidden", price: 1000, isActive: false } });
  const anon = await playwright.request.newContext();
  const post = (slug: string, data: object) => anon.post(`${baseURL}/api/${slug}/guest-passes`, { data: { fullName: "Eve", phone: phoneN(), ...data } });
  const day = todayIn(a.gym.timezone);

  expect((await post(a.slug, { dayPassPlanId: planB.id, visitDate: day })).status()).toBe(400); // another gym's plan
  expect((await post(a.slug, { dayPassPlanId: hidden.id, visitDate: day })).status()).toBe(400); // hidden plan
  const own = await makeDayPass(a.gym.id);
  expect((await post(a.slug, { dayPassPlanId: own.id })).status()).toBe(400); // no date
  expect((await post(a.slug, { dayPassPlanId: own.id, visitDate: todayIn(a.gym.timezone, -1) })).status()).toBe(400); // past
  expect((await post(a.slug, { dayPassPlanId: own.id, visitDate: todayIn(a.gym.timezone, 60) })).status()).toBe(400); // too far
  expect((await post(a.slug, { dayPassPlanId: own.id, sessionId: a.session.id, visitDate: day })).status()).toBe(400); // both targets
  expect(await prisma.guestPass.count({ where: { gymId: { in: [a.gym.id, b.gym.id] } } })).toBe(0);
});

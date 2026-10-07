import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma, staffLoginUI } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";
import { zonedTimeToUtc } from "../src/lib/date";

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

/** A throwaway gym with an owner, a staff account, a plan and N active members. */
async function makeGym(memberCount = 2, settings: object = {}) {
  const tag = uniq("cls");
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const gym = await prisma.gym.create({
    data: { name: `Class Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE", timezone: "Asia/Jakarta", settings },
  });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  const plan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  const members = [];
  for (let i = 0; i < memberCount; i++) {
    const m = uniq("m");
    const phone = `0812${Date.now().toString().slice(-7)}${i}${seq}`;
    members.push({
      email: `${m}@test.local`,
      password: "member-pass-123",
      row: await prisma.member.create({
        data: {
          gymId: gym.id,
          planId: plan.id,
          fullName: `Member ${i + 1} ${m}`,
          email: `${m}@test.local`,
          phoneWhatsapp: encrypt(phone),
          phoneWhatsappLookup: hmacLookup(phone),
          passwordHash: await bcrypt.hash("member-pass-123", 10),
          status: "ACTIVE",
          membershipExpiry: new Date(Date.now() + 30 * DAY),
        },
      }),
    });
  }
  return { gym, owner, staff, members, slug: tag };
}

async function login(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  const res = await request.post(`${baseURL}/api/${slug}/login`, { data: who });
  expect(res.ok(), `login ${who.email}`).toBeTruthy();
}

/** "YYYY-MM-DDTHH:mm" for a wall-clock time `daysAhead` days from now, at 18:00 Jakarta time. */
function localSlot(daysAhead: number, hour = 18) {
  const d = new Date(Date.now() + daysAhead * DAY);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return `${ymd}T${String(hour).padStart(2, "0")}:00`;
}

async function createClass(request: APIRequestContext, baseURL: string, slug: string, over: object = {}) {
  const res = await request.post(`${baseURL}/api/${slug}/classes`, {
    data: { name: "Yoga", instructor: "Ayu", price: 75000, capacity: 2, durationMinutes: 60, ...over },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).classId as string;
}

async function scheduleOne(request: APIRequestContext, baseURL: string, slug: string, classId: string, over: object = {}) {
  const res = await request.post(`${baseURL}/api/${slug}/classes/${classId}/sessions`, { data: { startsAt: localSlot(2), repeatWeeks: 1, ...over } });
  expect(res.status(), await res.text()).toBe(201);
  return prisma.classSession.findFirstOrThrow({ where: { classId }, orderBy: { createdAt: "desc" } });
}

const book = (ctx: APIRequestContext, baseURL: string, sessionId: string) => ctx.post(`${baseURL}/api/my/classes/register`, { data: { sessionId } });

test("zonedTimeToUtc turns a Jakarta wall-clock time into the right instant", () => {
  // 18:00 WIB (UTC+7) is 11:00 UTC. Makassar (UTC+8) is an hour earlier in UTC.
  expect(zonedTimeToUtc("2026-10-05T18:00", "Asia/Jakarta").toISOString()).toBe("2026-10-05T11:00:00.000Z");
  expect(zonedTimeToUtc("2026-10-05T18:00", "Asia/Makassar").toISOString()).toBe("2026-10-05T10:00:00.000Z");
  expect(zonedTimeToUtc("2026-10-05T18:00", "UTC").toISOString()).toBe("2026-10-05T18:00:00.000Z");
  // A DST zone: New York is UTC-4 in July, UTC-5 in January.
  expect(zonedTimeToUtc("2026-07-01T09:00", "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
  expect(zonedTimeToUtc("2026-01-15T09:00", "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
});

test("owner creates a class and a weekly series; a member books (manual pay) and staff confirms it at the desk", async ({ request, baseURL, playwright, browser }) => {
  test.setTimeout(90_000);
  const f = await makeGym();
  await login(request, baseURL!, f.slug, f.owner);

  // Validation rejects nonsense.
  expect((await request.post(`${baseURL}/api/${f.slug}/classes`, { data: { name: "x", price: -1, durationMinutes: 0 } })).status()).toBe(400);

  const classId = await createClass(request, baseURL!, f.slug);
  const cls = await prisma.gymClass.findUniqueOrThrow({ where: { id: classId } });
  expect(cls.gymId).toBe(f.gym.id);
  expect(cls.instructor).toBe("Ayu");
  expect(Number(cls.price)).toBe(75000);

  // "Yoga every week for 4 weeks" is four rows, 7 days apart, at 18:00 Jakarta time.
  const slot = localSlot(3);
  const series = await request.post(`${baseURL}/api/${f.slug}/classes/${classId}/sessions`, { data: { startsAt: slot, repeatWeeks: 4 } });
  expect(series.status()).toBe(201);
  const sessions = await prisma.classSession.findMany({ where: { classId }, orderBy: { startsAt: "asc" } });
  expect(sessions).toHaveLength(4);
  expect(sessions[0].startsAt.toISOString()).toBe(zonedTimeToUtc(slot, "Asia/Jakarta").toISOString());
  for (let i = 1; i < 4; i++) expect(sessions[i].startsAt.getTime() - sessions[i - 1].startsAt.getTime()).toBe(7 * DAY);
  expect(sessions.every((s) => s.gymId === f.gym.id && s.status === "SCHEDULED")).toBe(true);

  // Scheduling in the past or with a bad time is refused.
  expect((await request.post(`${baseURL}/api/${f.slug}/classes/${classId}/sessions`, { data: { startsAt: localSlot(-2), repeatWeeks: 1 } })).status()).toBe(400);
  expect((await request.post(`${baseURL}/api/${f.slug}/classes/${classId}/sessions`, { data: { startsAt: "tomorrow-ish", repeatWeeks: 1 } })).status()).toBe(400);

  // The owner's page lists the class and its sessions; the member's page lists them for booking.
  const ownerHtml = await (await request.get(`${baseURL}/${f.slug}/classes`)).text();
  expect(ownerHtml).toContain("Yoga");
  expect(ownerHtml).toContain("upcoming"); // the grid card (the default layout)

  // Online payments are off for this gym, so booking is a manual "pay at the desk" registration.
  const memberCtx = await playwright.request.newContext();
  await login(memberCtx, baseURL!, f.slug, f.members[0]);
  const memberHtml = await (await memberCtx.get(`${baseURL}/my/classes`)).text();
  expect(memberHtml).toContain("Yoga");
  expect(memberHtml).toContain("Book, pay at gym");

  const booked = await book(memberCtx, baseURL!, sessions[0].id);
  expect(booked.status(), await booked.text()).toBe(201);
  const { registrationId, status, invoiceUrl } = await booked.json();
  expect(status).toBe("PENDING_PAYMENT");
  expect(invoiceUrl).toBeNull();
  let reg = await prisma.classRegistration.findUniqueOrThrow({ where: { id: registrationId }, include: { payment: true } });
  expect(reg.status).toBe("PENDING_PAYMENT");
  expect(reg.payment).toBeNull();
  expect(reg.gymId).toBe(f.gym.id);
  expect(reg.memberId).toBe(f.members[0].row.id);
  expect(await (await memberCtx.get(`${baseURL}/my/classes`)).text()).toContain("pay at the gym");

  // Booking the same session again is refused (one registration per member per session).
  expect((await book(memberCtx, baseURL!, sessions[0].id)).status()).toBe(409);
  expect(await prisma.classRegistration.count({ where: { sessionId: sessions[0].id, memberId: f.members[0].row.id } })).toBe(1);

  // Staff (not just the owner) confirms the front-desk payment; the member gets a WhatsApp confirmation.
  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  expect((await staffCtx.post(`${baseURL}/api/${f.slug}/class-registrations/${registrationId}/confirm`, { data: { amount: -5 } })).status()).toBe(400);
  const confirmed = await staffCtx.post(`${baseURL}/api/${f.slug}/class-registrations/${registrationId}/confirm`, { data: { amount: 70000, note: "Cash, student discount" } });
  expect(confirmed.ok(), await confirmed.text()).toBeTruthy();
  const done = await prisma.classRegistration.findUniqueOrThrow({ where: { id: registrationId }, include: { payment: { include: { recordedBy: true } } } });
  expect(done.status).toBe("CONFIRMED");
  expect(done.payment?.provider).toBe("CASH");
  expect(done.payment?.status).toBe("PAID");
  expect(Number(done.payment?.amount)).toBe(70000);
  expect(done.payment?.note).toBe("Cash, student discount");
  expect(done.payment?.recordedBy?.email).toBe(f.staff.email);
  await expect.poll(() => prisma.notificationLog.count({ where: { memberId: f.members[0].row.id, type: "class_confirmation" } })).toBe(1);

  // Confirming twice does nothing more.
  expect((await staffCtx.post(`${baseURL}/api/${f.slug}/class-registrations/${registrationId}/confirm`, { data: { amount: 70000 } })).status()).toBe(409);
  expect(await prisma.classPayment.count({ where: { registrationId } })).toBe(1);

  // On the staff page the class is a card in the grid; opening it shows the roster with the member confirmed.
  const ui = await browser.newContext();
  const page = await ui.newPage();
  await staffLoginUI(page, baseURL!, f.slug, f.staff.email, f.staff.password);
  await page.waitForURL(`${baseURL}/${f.slug}/dashboard`);
  await page.goto(`${baseURL}/${f.slug}/classes`);
  await expect(page.getByRole("button", { name: /Yoga/ })).toBeVisible();
  await page.getByRole("button", { name: /Yoga/ }).click();
  await page.getByRole("button", { name: /booked/ }).first().click();
  await expect(page.getByText(f.members[0].row.fullName)).toBeVisible();

  // The layout switch: list shows every class's sessions at once, and the choice is remembered.
  await page.getByRole("button", { name: "Back to all classes" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to all classes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /booked/ }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
  await ui.close();

  await memberCtx.dispose();
  await staffCtx.dispose();
});

test("a free class confirms straight away, with no payment row", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(1);
  await login(request, baseURL!, f.slug, f.owner);
  const classId = await createClass(request, baseURL!, f.slug, { name: "Intro session", price: 0, capacity: null });
  const session = await scheduleOne(request, baseURL!, f.slug, classId);

  const memberCtx = await playwright.request.newContext();
  await login(memberCtx, baseURL!, f.slug, f.members[0]);
  const booked = await book(memberCtx, baseURL!, session.id);
  expect(booked.status()).toBe(201);
  expect((await booked.json()).status).toBe("CONFIRMED");
  const reg = await prisma.classRegistration.findFirstOrThrow({ where: { sessionId: session.id }, include: { payment: true } });
  expect(reg.status).toBe("CONFIRMED");
  expect(reg.payment).toBeNull();
  await memberCtx.dispose();
});

test("online registration: the invoice is paid through the webhook, idempotently", async ({ request, baseURL, playwright }) => {
  // This gym has opted in to online member payments (and the suite runs in PAYMENTS_MOCK mode).
  const f = await makeGym(1, { paymentsEnabled: true });
  await login(request, baseURL!, f.slug, f.owner);
  const classId = await createClass(request, baseURL!, f.slug);
  const session = await scheduleOne(request, baseURL!, f.slug, classId);

  const memberCtx = await playwright.request.newContext();
  await login(memberCtx, baseURL!, f.slug, f.members[0]);
  const booked = await book(memberCtx, baseURL!, session.id);
  expect(booked.status(), await booked.text()).toBe(201);
  const { registrationId, invoiceUrl } = await booked.json();
  expect(invoiceUrl).toBeTruthy();
  const paymentId = new URL(invoiceUrl, "http://x").searchParams.get("mock-invoice")!;
  let payment = await prisma.classPayment.findUniqueOrThrow({ where: { id: paymentId } });
  expect(payment.registrationId).toBe(registrationId);
  expect(payment.status).toBe("PENDING");
  expect(Number(payment.amount)).toBe(75000);
  expect(payment.externalInvoiceId).toBe(`mock_${paymentId}`);

  // Asking again resumes the same unpaid invoice instead of creating a second one; the seat is held meanwhile.
  const again = await book(memberCtx, baseURL!, session.id);
  expect(again.ok()).toBeTruthy();
  expect((await again.json()).invoiceUrl).toBe(invoiceUrl);
  expect(await prisma.classPayment.count({ where: { registrationId } })).toBe(1);

  // The same PAID event delivered twice confirms once and sends one WhatsApp.
  const event = { id: "evt_class_1", external_id: paymentId, status: "PAID", paid_at: new Date().toISOString() };
  const headers = { "x-callback-token": process.env.XENDIT_CALLBACK_TOKEN! };
  const first = await request.post(`${baseURL}/api/webhooks/xendit`, { data: event, headers });
  expect(first.ok()).toBeTruthy();
  expect((await request.post(`${baseURL}/api/webhooks/xendit`, { data: event, headers })).ok()).toBeTruthy();

  payment = await prisma.classPayment.findUniqueOrThrow({ where: { id: paymentId } });
  expect(payment.status).toBe("PAID");
  expect(payment.paidAt).not.toBeNull();
  const reg = await prisma.classRegistration.findUniqueOrThrow({ where: { id: registrationId } });
  expect(reg.status).toBe("CONFIRMED");
  await expect.poll(() => prisma.notificationLog.count({ where: { memberId: f.members[0].row.id, type: "class_confirmation" } })).toBe(1);

  // Once paid, booking again is simply "already booked".
  expect((await book(memberCtx, baseURL!, session.id)).status()).toBe(409);
  await memberCtx.dispose();
});

test("an expired online invoice frees the seat, and the member can book again", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(1, { paymentsEnabled: true });
  await login(request, baseURL!, f.slug, f.owner);
  const classId = await createClass(request, baseURL!, f.slug, { capacity: 1 });
  const session = await scheduleOne(request, baseURL!, f.slug, classId);

  const memberCtx = await playwright.request.newContext();
  await login(memberCtx, baseURL!, f.slug, f.members[0]);
  const { registrationId, invoiceUrl } = await (await book(memberCtx, baseURL!, session.id)).json();
  const paymentId = new URL(invoiceUrl, "http://x").searchParams.get("mock-invoice")!;

  const headers = { "x-callback-token": process.env.XENDIT_CALLBACK_TOKEN! };
  await request.post(`${baseURL}/api/webhooks/xendit`, { data: { id: "evt_class_exp", external_id: paymentId, status: "EXPIRED" }, headers });
  expect((await prisma.classPayment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("EXPIRED");
  expect((await prisma.classRegistration.findUniqueOrThrow({ where: { id: registrationId } })).status).toBe("CANCELLED");

  // Booking again reuses the registration row with a fresh invoice.
  const again = await book(memberCtx, baseURL!, session.id);
  expect(again.status(), await again.text()).toBe(201);
  const body = await again.json();
  expect(body.registrationId).toBe(registrationId);
  expect(body.invoiceUrl).not.toBe(invoiceUrl);
  expect((await prisma.classRegistration.findUniqueOrThrow({ where: { id: registrationId } })).status).toBe("PENDING_PAYMENT");
  expect(await prisma.classPayment.count({ where: { registrationId } })).toBe(1);
  await memberCtx.dispose();
});

test("a full session refuses new bookings; a cancelled seat opens it again", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(3);
  await login(request, baseURL!, f.slug, f.owner);
  const classId = await createClass(request, baseURL!, f.slug, { capacity: 5 });
  // The session's own capacity (2) overrides the class default (5).
  const session = await scheduleOne(request, baseURL!, f.slug, classId, { capacity: 2 });

  const ctxs = [];
  for (const m of f.members) {
    const c = await playwright.request.newContext();
    await login(c, baseURL!, f.slug, m);
    ctxs.push(c);
  }
  expect((await book(ctxs[0], baseURL!, session.id)).status()).toBe(201);
  expect((await book(ctxs[1], baseURL!, session.id)).status()).toBe(201);
  // A pending (unpaid) registration still holds its seat, so the third member is refused.
  const full = await book(ctxs[2], baseURL!, session.id);
  expect(full.status()).toBe(409);
  expect((await full.json()).error).toContain("full");
  expect(await (await ctxs[2].get(`${baseURL}/my/classes`)).text()).toContain("Full");

  // The first member cancels their own booking; the third can now get in.
  const reg0 = await prisma.classRegistration.findFirstOrThrow({ where: { sessionId: session.id, memberId: f.members[0].row.id } });
  const cancel = await ctxs[0].post(`${baseURL}/api/my/classes/${reg0.id}/cancel`);
  expect(cancel.ok()).toBeTruthy();
  expect((await prisma.classRegistration.findUniqueOrThrow({ where: { id: reg0.id } })).status).toBe("CANCELLED");
  expect((await ctxs[0].post(`${baseURL}/api/my/classes/${reg0.id}/cancel`)).status()).toBe(409);
  expect((await book(ctxs[2], baseURL!, session.id)).status()).toBe(201);

  // A member can't cancel someone else's booking.
  const reg1 = await prisma.classRegistration.findFirstOrThrow({ where: { sessionId: session.id, memberId: f.members[1].row.id } });
  expect((await ctxs[0].post(`${baseURL}/api/my/classes/${reg1.id}/cancel`)).status()).toBe(404);
  expect((await prisma.classRegistration.findUniqueOrThrow({ where: { id: reg1.id } })).status).toBe("PENDING_PAYMENT");

  // Nobody can cancel once the session has started.
  await prisma.classSession.update({ where: { id: session.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
  expect((await ctxs[1].post(`${baseURL}/api/my/classes/${reg1.id}/cancel`)).status()).toBe(409);
  for (const c of ctxs) await c.dispose();
});

test("owner cancels a session: bookings are cancelled, pending invoices expired, members told", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(2, { paymentsEnabled: true });
  await login(request, baseURL!, f.slug, f.owner);
  const classId = await createClass(request, baseURL!, f.slug, { capacity: null });
  const session = await scheduleOne(request, baseURL!, f.slug, classId);

  const c0 = await playwright.request.newContext();
  await login(c0, baseURL!, f.slug, f.members[0]);
  const { invoiceUrl } = await (await book(c0, baseURL!, session.id)).json();
  const paymentId = new URL(invoiceUrl, "http://x").searchParams.get("mock-invoice")!;
  const c1 = await playwright.request.newContext();
  await login(c1, baseURL!, f.slug, f.members[1]);
  const { registrationId: reg1 } = await (await book(c1, baseURL!, session.id)).json();
  // Second member paid already.
  await request.post(`${baseURL}/api/webhooks/xendit`, {
    data: { id: "evt_c", external_id: (await prisma.classPayment.findFirstOrThrow({ where: { registrationId: reg1 } })).id, status: "PAID" },
    headers: { "x-callback-token": process.env.XENDIT_CALLBACK_TOKEN! },
  });

  // Staff can't cancel a session; the owner can.
  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  expect((await staffCtx.patch(`${baseURL}/api/${f.slug}/class-sessions/${session.id}`, { data: { action: "cancel" } })).status()).toBe(403);
  const cancelled = await request.patch(`${baseURL}/api/${f.slug}/class-sessions/${session.id}`, { data: { action: "cancel" } });
  expect(cancelled.ok(), await cancelled.text()).toBeTruthy();
  expect((await cancelled.json()).cancelledRegistrations).toBe(2);

  expect((await prisma.classSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("CANCELLED");
  const regs = await prisma.classRegistration.findMany({ where: { sessionId: session.id }, include: { payment: true } });
  expect(regs.every((r) => r.status === "CANCELLED")).toBe(true);
  expect((await prisma.classPayment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("EXPIRED");
  // Money already taken is kept on record (refunds are the gym's call).
  expect(regs.find((r) => r.id === reg1)?.payment?.status).toBe("PAID");
  await expect.poll(() => prisma.notificationLog.count({ where: { gymId: f.gym.id, type: "class_cancelled" } })).toBe(2);

  // Nothing more can happen on it.
  expect((await request.patch(`${baseURL}/api/${f.slug}/class-sessions/${session.id}`, { data: { action: "cancel" } })).status()).toBe(409);
  expect((await book(c0, baseURL!, session.id)).status()).toBe(409);
  expect(await (await c0.get(`${baseURL}/my/classes`)).text()).toContain("Class cancelled");
  await c0.dispose();
  await c1.dispose();
  await staffCtx.dispose();
});

test("tenant isolation: another gym's staff and members can't see or touch these classes", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(1);
  const other = await makeGym(1);
  await login(request, baseURL!, f.slug, f.owner);
  const classId = await createClass(request, baseURL!, f.slug, { name: "Private Pilates" });
  const session = await scheduleOne(request, baseURL!, f.slug, classId);
  const memberCtx = await playwright.request.newContext();
  await login(memberCtx, baseURL!, f.slug, f.members[0]);
  const { registrationId } = await (await book(memberCtx, baseURL!, session.id)).json();

  // The other gym's owner, through their own gym's URLs: every id from gym A is "not found".
  const otherOwner = await playwright.request.newContext();
  await login(otherOwner, baseURL!, other.slug, other.owner);
  expect((await otherOwner.patch(`${baseURL}/api/${other.slug}/classes/${classId}`, { data: { name: "Hijacked" } })).status()).toBe(404);
  expect((await otherOwner.post(`${baseURL}/api/${other.slug}/classes/${classId}/sessions`, { data: { startsAt: localSlot(5), repeatWeeks: 1 } })).status()).toBe(404);
  expect((await otherOwner.patch(`${baseURL}/api/${other.slug}/class-sessions/${session.id}`, { data: { action: "cancel" } })).status()).toBe(404);
  expect((await otherOwner.post(`${baseURL}/api/${other.slug}/class-registrations/${registrationId}/confirm`, { data: { amount: 1 } })).status()).toBe(404);
  // And through gym A's URLs, the session simply doesn't belong.
  expect((await otherOwner.patch(`${baseURL}/api/${f.slug}/classes/${classId}`, { data: { name: "Hijacked" } })).status()).toBe(401);
  expect((await otherOwner.get(`${baseURL}/${other.slug}/classes`)).ok()).toBeTruthy();
  expect(await (await otherOwner.get(`${baseURL}/${other.slug}/classes`)).text()).not.toContain("Private Pilates");

  // The other gym's member can't book gym A's session or cancel gym A's registration, and doesn't see the class.
  const otherMember = await playwright.request.newContext();
  await login(otherMember, baseURL!, other.slug, other.members[0]);
  expect((await book(otherMember, baseURL!, session.id)).status()).toBe(404);
  expect((await otherMember.post(`${baseURL}/api/my/classes/${registrationId}/cancel`)).status()).toBe(404);
  expect(await (await otherMember.get(`${baseURL}/my/classes`)).text()).not.toContain("Private Pilates");

  // Staff of gym A can't create or edit classes (owner-only), but can see them.
  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  expect((await staffCtx.post(`${baseURL}/api/${f.slug}/classes`, { data: { name: "Nope", price: 1000, durationMinutes: 30 } })).status()).toBe(403);
  expect((await staffCtx.patch(`${baseURL}/api/${f.slug}/classes/${classId}`, { data: { isActive: false } })).status()).toBe(403);
  expect(await (await staffCtx.get(`${baseURL}/${f.slug}/classes`)).text()).toContain("Private Pilates");

  // Nothing changed.
  const cls = await prisma.gymClass.findUniqueOrThrow({ where: { id: classId } });
  expect(cls.name).toBe("Private Pilates");
  expect(cls.isActive).toBe(true);
  expect(await prisma.classSession.count({ where: { classId } })).toBe(1);
  expect((await prisma.classRegistration.findUniqueOrThrow({ where: { id: registrationId } })).status).toBe("PENDING_PAYMENT");
  expect(await prisma.classRegistration.count({ where: { sessionId: session.id } })).toBe(1);

  // RLS: gym B's restricted client sees none of gym A's class rows even with no where clause.
  const { tenantDb } = await import("../src/lib/prisma");
  const dbB = tenantDb(other.gym.id);
  expect(await dbB.gymClass.findUnique({ where: { id: classId } })).toBeNull();
  expect(await dbB.classSession.count()).toBe(0);
  expect(await dbB.classRegistration.count()).toBe(0);
  await expect(dbB.classSession.create({ data: { gymId: f.gym.id, classId, startsAt: new Date(Date.now() + DAY) } })).rejects.toThrow();

  await memberCtx.dispose();
  await otherOwner.dispose();
  await otherMember.dispose();
  await staffCtx.dispose();
});

test("hidden classes and past sessions can't be booked; a cancelled member can't book at all", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(2);
  await login(request, baseURL!, f.slug, f.owner);
  const classId = await createClass(request, baseURL!, f.slug);
  const session = await scheduleOne(request, baseURL!, f.slug, classId);

  const memberCtx = await playwright.request.newContext();
  await login(memberCtx, baseURL!, f.slug, f.members[0]);

  expect((await request.patch(`${baseURL}/api/${f.slug}/classes/${classId}`, { data: { isActive: false } })).ok()).toBeTruthy();
  expect((await book(memberCtx, baseURL!, session.id)).status()).toBe(409);
  expect(await (await memberCtx.get(`${baseURL}/my/classes`)).text()).not.toContain("Yoga");
  await request.patch(`${baseURL}/api/${f.slug}/classes/${classId}`, { data: { isActive: true } });

  await prisma.classSession.update({ where: { id: session.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
  expect((await book(memberCtx, baseURL!, session.id)).status()).toBe(409);
  await prisma.classSession.update({ where: { id: session.id }, data: { startsAt: new Date(Date.now() + DAY) } });

  await prisma.member.update({ where: { id: f.members[0].row.id }, data: { status: "CANCELLED" } });
  expect((await book(memberCtx, baseURL!, session.id)).status()).toBe(403);
  expect(await prisma.classRegistration.count({ where: { sessionId: session.id } })).toBe(0);
  await memberCtx.dispose();
});

test("owner sets up a class in the browser and a member books it", async ({ page, baseURL, browser }) => {
  const f = await makeGym(1);
  // This flow works on the full per-class sections, which is the List layout.
  await page.addInitScript(() => window.localStorage.setItem("repstack.classesView", "list"));
  await page.goto(`${baseURL}/${f.slug}/login`);
  await page.getByLabel("Email").fill(f.owner.email);
  await page.getByLabel("Password").fill(f.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${baseURL}/${f.slug}/dashboard`);

  await page.getByRole("link", { name: "Classes" }).first().click();
  await page.waitForURL(`${baseURL}/${f.slug}/classes`);
  await page.getByRole("button", { name: "+ New class" }).click();
  await page.getByLabel("Class name").fill("Spin");
  await page.getByLabel("Instructor (optional)").fill("Budi");
  await page.getByLabel("Price (Rp) — 0 for free").fill("60000");
  await page.getByLabel("Length (minutes)").fill("45");
  await page.getByLabel("Seats per session (blank = unlimited)").fill("10");
  await page.getByRole("button", { name: "Create class" }).click();
  await expect(page.getByRole("heading", { name: "Spin" })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Schedule sessions" }).click();
  await page.getByLabel("First session").fill(localSlot(4, 7));
  await page.getByLabel("Repeat weekly").fill("2");
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByText("0 / 10 booked").first()).toBeVisible({ timeout: 20_000 });
  expect(await prisma.classSession.count({ where: { gym: { id: f.gym.id } } })).toBe(2);

  // The member books from their own dashboard.
  const memberPage = await (await browser.newContext()).newPage();
  await memberPage.goto(`${baseURL}/${f.slug}/login`);
  await memberPage.getByLabel("Email").fill(f.members[0].email);
  await memberPage.getByLabel("Password").fill(f.members[0].password);
  await memberPage.getByRole("button", { name: "Sign in" }).click();
  await memberPage.waitForURL(`${baseURL}/my`);
  await memberPage.getByRole("link", { name: "Classes" }).click();
  await memberPage.waitForURL(`${baseURL}/my/classes`);
  await expect(memberPage.getByText("Spin").first()).toBeVisible({ timeout: 20_000 });
  await memberPage.getByRole("button", { name: "Book, pay at gym" }).first().click();
  await expect(memberPage.getByText("Your bookings")).toBeVisible({ timeout: 20_000 });
  await expect(memberPage.getByText("Pending — pay at the gym")).toBeVisible();

  // Back on the owner's page, the roster shows them and the count went up.
  await page.reload();
  await expect(page.getByText("1 / 10 booked")).toBeVisible({ timeout: 20_000 });
  await page.getByText("1 / 10 booked").click();
  await expect(page.getByText(f.members[0].row.fullName)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record payment" })).toBeVisible();
  await memberPage.context().close();
});

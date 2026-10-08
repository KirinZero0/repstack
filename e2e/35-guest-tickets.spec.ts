import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { ticketTokenFor } from "../src/lib/guestPass";
import { dayKeyInTimezone } from "../src/lib/date";
import { encrypt, hmacLookup } from "../src/lib/crypto";

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
  // Own forwarded IP per login: the whole suite shares one address, and the login throttle (200/hour per IP) would otherwise run dry this late in a full run.
  const headers = { "x-forwarded-for": `10.9.${seq++ % 250}.${Math.floor(Math.random() * 250)}` };
  expect((await request.post(`${baseURL}/api/${slug}/login`, { data: who, headers })).ok()).toBeTruthy();
}

async function requestSpot(request: APIRequestContext, baseURL: string, f: { slug: string; session: { id: string } }, phone: string, name = "Guest Gina") {
  return request.post(`${baseURL}/api/${f.slug}/guest-passes`, { data: { sessionId: f.session.id, fullName: name, phone } });
}

/** An anonymous visitor with their own IP, so the public form's per-IP rate limit doesn't couple the tests. */
async function newVisitor(playwright: { request: { newContext(o?: object): Promise<APIRequestContext> } }, ip = `10.1.${seq++}.${Math.floor(Math.random() * 250)}`) {
  return playwright.request.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip } });
}

const phoneN = () => `0813${Date.now().toString().slice(-6)}${seq++}`;

test("guest requests, staff approves, ticket scans once", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const phone = phoneN();

  // Public request: no login, and nothing is sent or issued yet.
  const anon = await newVisitor(playwright);
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

  const anon = await newVisitor(playwright);
  expect((await anon.post(`${baseURL}/api/checkin`, { data: { token: ticketTokenFor({ ...pass, ticketSecret: pass.ticketSecret }) } })).status()).toBe(401);
});

test("public request can't target another gym's session", async ({ baseURL, playwright }) => {
  const a = await makeGym();
  const b = await makeGym();
  const anon = await newVisitor(playwright);
  const res = await requestSpot(anon, baseURL!, { slug: a.slug, session: b.session }, phoneN());
  expect(res.status()).toBe(400);
  expect(await prisma.guestPass.count({ where: { sessionId: b.session.id } })).toBe(0);
});

test("approval respects capacity, and declining sends no ticket", async ({ request, baseURL, playwright }) => {
  const f = await makeGym({ capacity: 1 });
  const anon = await newVisitor(playwright);
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
  const created = await request.post(`${baseURL}/api/${f.slug}/day-pass-plans`, { data: { name: "Single visit", price: 50000, validityDays: 7 } });
  expect(created.status()).toBe(201);
  const { planId } = await created.json();

  const anon = await newVisitor(playwright);
  // The plan shows up where visitors join, not under classes; the owner manages it with the membership plans.
  expect(await (await anon.get(`${baseURL}/${f.slug}/join/day-pass`)).text()).toContain("Single visit");
  expect(await (await anon.get(`${baseURL}/${f.slug}/join`)).text()).toContain("day-pass-link");
  expect(await (await request.get(`${baseURL}/${f.slug}/plans`)).text()).toContain("day-pass-plans");
  expect(await (await request.get(`${baseURL}/${f.slug}/classes`)).text()).not.toContain("day-pass-plans");
  expect(await (await request.get(`${baseURL}/${f.slug}/members/guests`)).text()).toContain("Guest tickets");
  const phone = phoneN();
  // No date to pick: the visitor just asks. The same phone can't have two open requests for one plan.
  const ask = () => anon.post(`${baseURL}/api/${f.slug}/guest-passes`, { data: { dayPassPlanId: planId, fullName: "Day Dave", phone } });
  expect((await ask()).status()).toBe(201);
  expect((await ask()).status()).toBe(409);

  const pass = await prisma.guestPass.findFirstOrThrow({ where: { gymId: f.gym.id, dayPassPlanId: planId } });
  expect(pass.sessionId).toBeNull();
  expect(pass.visitDate).toBeNull();
  expect(pass.expiresAt).toBeNull(); // the clock starts at approval
  const token = ticketTokenFor(pass);
  expect((await request.post(`${baseURL}/api/${f.slug}/guest-passes/${pass.id}`, { data: { action: "approve" } })).ok()).toBeTruthy();
  const approved = await prisma.guestPass.findUniqueOrThrow({ where: { id: pass.id } });
  const validDays = (approved.expiresAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  expect(validDays).toBeGreaterThan(6.9);
  expect(validDays).toBeLessThanOrEqual(7);
  expect(await prisma.notificationLog.count({ where: { gymId: f.gym.id, type: "guest_ticket", memberId: null } })).toBe(1);
  const ticketPage = await (await anon.get(`${baseURL}/ticket/${token}`)).text();
  expect(ticketPage).toContain("ticket-qr");
  expect(ticketPage).toContain("valid until");

  expect((await (await request.post(`${baseURL}/api/checkin`, { data: { token } })).json()).result).toBe("SUCCESS");
  expect((await (await request.post(`${baseURL}/api/checkin`, { data: { token } })).json()).result).toBe("DUPLICATE");
  expect((await prisma.guestPass.findUniqueOrThrow({ where: { id: pass.id } })).status).toBe("ATTENDED");

  // Once used, the same phone can buy another pass. Revenue counted when staff approved, at the price it was requested at.
  expect((await ask()).status()).toBe(201);
  await prisma.dayPassPlan.update({ where: { id: planId }, data: { price: 99000 } });
  const finance = await (await request.get(`${baseURL}/${f.slug}/finance`)).text();
  expect(finance).toContain("from day passes");
  const csv = await (await request.get(`${baseURL}/api/${f.slug}/finance/export?report=transactions`)).text();
  expect(csv).toContain("Day pass");
  expect(csv).toContain("Day Dave (guest)");
  expect(csv).toContain(",50000,");
  expect(csv).not.toContain("99000");

  // Never a member, never a check-in row.
  expect(await prisma.member.count({ where: { gymId: f.gym.id } })).toBe(0);
  expect(await prisma.checkIn.count({ where: { gymId: f.gym.id } })).toBe(0);
});

test("legacy day passes issued with a fixed visit day are still only valid on that day", async ({ request, baseURL }) => {
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
  const anon = await newVisitor(playwright);
  const post = (slug: string, data: object) => anon.post(`${baseURL}/api/${slug}/guest-passes`, { data: { fullName: "Eve", phone: phoneN(), ...data } });

  expect((await post(a.slug, { dayPassPlanId: planB.id })).status()).toBe(400); // another gym's plan
  expect((await post(a.slug, { dayPassPlanId: hidden.id })).status()).toBe(400); // hidden plan
  const own = await makeDayPass(a.gym.id);
  expect((await post(a.slug, {})).status()).toBe(400); // neither a class nor a day pass
  expect((await post(a.slug, { dayPassPlanId: own.id, sessionId: a.session.id })).status()).toBe(400); // both targets
  expect(await prisma.guestPass.count({ where: { gymId: { in: [a.gym.id, b.gym.id] } } })).toBe(0);
});

// ─── Bank-transfer payment ───────────────────────────────────

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const proofFile = { name: "transfer.png", mimeType: "image/png", buffer: PNG };

async function withBank(gymId: string) {
  await prisma.gym.update({ where: { id: gymId }, data: { bankName: "BCA", bankAccountNumber: "1234567890", bankAccountHolder: "Gym Owner" } });
}

test("guest pays a day pass by transfer: proof attached, staff verify, approve, and it counts as revenue", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  await withBank(f.gym.id);
  const plan = await makeDayPass(f.gym.id, 50000);
  const anon = await newVisitor(playwright);

  // The form shows the price and where to transfer.
  const page = await (await anon.get(`${baseURL}/${f.slug}/join/day-pass`)).text();
  expect(page).toContain("transfer-payment");
  expect(page).toContain("1234567890");

  // A non-image proof is refused; a real one is stored (privately) and the price is snapshotted.
  const bad = await anon.post(`${baseURL}/api/${f.slug}/guest-passes`, {
    multipart: { dayPassPlanId: plan.id, fullName: "Transfer Tina", phone: phoneN(), proof: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hi") } },
  });
  expect(bad.status()).toBe(400);
  const ok = await anon.post(`${baseURL}/api/${f.slug}/guest-passes`, {
    multipart: { dayPassPlanId: plan.id, fullName: "Transfer Tina", phone: phoneN(), proof: proofFile },
  });
  expect(ok.status()).toBe(201);
  const pass = await prisma.guestPass.findFirstOrThrow({ where: { gymId: f.gym.id } });
  expect(pass.proofImageUrl).toBeTruthy();
  expect(Number(pass.amount)).toBe(50000);

  // Staff see the proof, and nothing is revenue until they approve.
  await login(request, baseURL!, f.slug, f.staff);
  const img = await request.get(`${baseURL}/api/${f.slug}/guest-passes/${pass.id}/proof`);
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toContain("image/");
  const review = await (await request.get(`${baseURL}/${f.slug}/members/guests`)).text();
  expect(review).toContain("Payment received");
  expect(review).toContain("View transfer proof");
  const owner = { email: `owner-${f.slug}@test.local`, password: "owner-pass-123" };
  await prisma.staffUser.create({ data: { gymId: f.gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  const csv = async () => (await request.get(`${baseURL}/api/${f.slug}/finance/export?report=transactions`)).text();
  await login(request, baseURL!, f.slug, owner);
  expect(await csv()).not.toContain("Transfer Tina");

  expect((await request.post(`${baseURL}/api/${f.slug}/guest-passes/${pass.id}`, { data: { action: "approve" } })).ok()).toBeTruthy();
  const after = await csv();
  expect(after).toContain("Transfer Tina (guest)");
  expect(after).toContain(",50000,");
  // Approved but not yet scanned still counts: the money has arrived.
  expect((await prisma.guestPass.findUniqueOrThrow({ where: { id: pass.id } })).status).toBe("APPROVED");

  // Another gym's staff can't see this proof.
  const other = await makeGym();
  await login(request, baseURL!, other.slug, other.staff);
  expect((await request.get(`${baseURL}/api/${other.slug}/guest-passes/${pass.id}/proof`)).status()).toBe(404);
});

test("declined paid request is not revenue; free tickets take no proof; class guest tickets carry the class price", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  await withBank(f.gym.id);
  await prisma.gymClass.update({ where: { id: f.cls.id }, data: { price: 40000 } });
  const free = await prisma.dayPassPlan.create({ data: { gymId: f.gym.id, name: "Free trial", price: 0 } });
  const anon = await newVisitor(playwright);

  const paid = await anon.post(`${baseURL}/api/${f.slug}/guest-passes`, { multipart: { sessionId: f.session.id, fullName: "Class Carl", phone: phoneN(), proof: proofFile } });
  expect(paid.status()).toBe(201);
  const freeReq = await anon.post(`${baseURL}/api/${f.slug}/guest-passes`, {
    multipart: { dayPassPlanId: free.id, fullName: "Free Fred", phone: phoneN(), proof: proofFile },
  });
  expect(freeReq.status()).toBe(201);
  const carl = await prisma.guestPass.findFirstOrThrow({ where: { fullName: "Class Carl", gymId: f.gym.id } });
  const fred = await prisma.guestPass.findFirstOrThrow({ where: { fullName: "Free Fred", gymId: f.gym.id } });
  expect(Number(carl.amount)).toBe(40000);
  expect(carl.proofImageUrl).toBeTruthy();
  expect(Number(fred.amount)).toBe(0);
  expect(fred.proofImageUrl).toBeNull(); // nothing to pay, so any upload is dropped

  await login(request, baseURL!, f.slug, f.staff);
  expect((await request.post(`${baseURL}/api/${f.slug}/guest-passes/${carl.id}`, { data: { action: "reject" } })).ok()).toBeTruthy();
  expect((await request.post(`${baseURL}/api/${f.slug}/guest-passes/${fred.id}`, { data: { action: "approve" } })).ok()).toBeTruthy();
  const owner = { email: `owner2-${f.slug}@test.local`, password: "owner-pass-123" };
  await prisma.staffUser.create({ data: { gymId: f.gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  await login(request, baseURL!, f.slug, owner);
  const csv = await (await request.get(`${baseURL}/api/${f.slug}/finance/export?report=transactions`)).text();
  expect(csv).not.toContain("Class Carl");
  expect(csv).not.toContain("Free Fred");
});

test("member pays for a class by transfer: proof goes to the front desk, who confirm it", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  await withBank(f.gym.id);
  await prisma.gymClass.update({ where: { id: f.cls.id }, data: { price: 40000 } });
  const plan = await prisma.membershipPlan.create({ data: { gymId: f.gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  const mk = async (n: string) => {
    const phone = phoneN();
    const email = `m-${n}-${f.slug}@test.local`;
    const row = await prisma.member.create({
      data: {
        gymId: f.gym.id, planId: plan.id, fullName: `Member ${n}`, email, phoneWhatsapp: encrypt(phone), phoneWhatsappLookup: hmacLookup(phone),
        passwordHash: await bcrypt.hash("member-pass-123", 10), status: "ACTIVE", membershipExpiry: new Date(Date.now() + 30 * 24 * HOUR),
      },
    });
    return { row, email };
  };
  const a = await mk("a");
  const b = await mk("b");
  const regA = await prisma.classRegistration.create({ data: { gymId: f.gym.id, sessionId: f.session.id, memberId: a.row.id, status: "PENDING_PAYMENT" } });

  const memberCtx = await newVisitor(playwright);
  await login(memberCtx, baseURL!, f.slug, { email: a.email, password: "member-pass-123" });
  expect(await (await memberCtx.get(`${baseURL}/my/classes`)).text()).toContain("class-transfer");

  // Nothing without a file, nothing for the wrong file type; then it's accepted.
  expect((await memberCtx.post(`${baseURL}/api/my/classes/${regA.id}/proof`, { multipart: { note: "x" } })).status()).toBe(400);
  expect((await memberCtx.post(`${baseURL}/api/my/classes/${regA.id}/proof`, { multipart: { proof: { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hi") } } })).status()).toBe(400);
  expect((await memberCtx.post(`${baseURL}/api/my/classes/${regA.id}/proof`, { multipart: { proof: proofFile } })).ok()).toBeTruthy();
  expect((await prisma.classRegistration.findUniqueOrThrow({ where: { id: regA.id } })).proofImageUrl).toBeTruthy();

  // Another member can't attach proof to this booking.
  const otherCtx = await newVisitor(playwright);
  await login(otherCtx, baseURL!, f.slug, { email: b.email, password: "member-pass-123" });
  expect((await otherCtx.post(`${baseURL}/api/my/classes/${regA.id}/proof`, { multipart: { proof: proofFile } })).status()).toBe(404);

  // Staff see it on the roster and confirm; the booking is then confirmed, and proof is no longer accepted.
  await login(request, baseURL!, f.slug, f.staff);
  expect((await request.get(`${baseURL}/api/${f.slug}/class-registrations/${regA.id}/proof`)).status()).toBe(200);
  expect((await request.post(`${baseURL}/api/${f.slug}/class-registrations/${regA.id}/confirm`, { data: { amount: 40000 } })).ok()).toBeTruthy();
  expect((await prisma.classRegistration.findUniqueOrThrow({ where: { id: regA.id } })).status).toBe("CONFIRMED");
  expect((await memberCtx.post(`${baseURL}/api/my/classes/${regA.id}/proof`, { multipart: { proof: proofFile } })).status()).toBe(409);

  // Another gym's staff can't view it.
  const other = await makeGym();
  await login(request, baseURL!, other.slug, other.staff);
  expect((await request.get(`${baseURL}/api/${other.slug}/class-registrations/${regA.id}/proof`)).status()).toBe(404);
});

test("the public request form is rate limited per IP", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const anon = await newVisitor(playwright, "203.0.113.77");
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await requestSpot(anon, baseURL!, f, phoneN(), `Spammer ${i}`)).status());
  expect(codes.slice(0, 6)).toEqual([201, 201, 201, 201, 201, 201]);
  expect(codes[6]).toBe(429);
});

test("flexible day pass: valid until it expires, never-expiring plans work, and the owner sets the length", async ({ request, baseURL }) => {
  const f = await makeGym();
  const owner = { email: `owner3-${f.slug}@test.local`, password: "owner-pass-123" };
  await prisma.staffUser.create({ data: { gymId: f.gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });

  // The owner picks the length (blank = never expires); it's validated.
  await login(request, baseURL!, f.slug, owner);
  const mkPlan = (data: object) => request.post(`${baseURL}/api/${f.slug}/day-pass-plans`, { data: { name: "Plan", price: 10000, ...data } });
  expect((await mkPlan({ validityDays: 0 })).status()).toBe(400);
  expect((await mkPlan({ validityDays: 5000 })).status()).toBe(400);
  const def = await (await mkPlan({})).json();
  expect((await prisma.dayPassPlan.findUniqueOrThrow({ where: { id: def.planId } })).validityDays).toBe(30);
  const forever = await (await mkPlan({ validityDays: null })).json();
  expect((await prisma.dayPassPlan.findUniqueOrThrow({ where: { id: forever.planId } })).validityDays).toBeNull();
  expect((await request.patch(`${baseURL}/api/${f.slug}/day-pass-plans/${def.planId}`, { data: { validityDays: 14 } })).ok()).toBeTruthy();
  expect((await prisma.dayPassPlan.findUniqueOrThrow({ where: { id: def.planId } })).validityDays).toBe(14);

  // A forever plan: approval sets no expiry and the ticket works. A short plan's ticket stops working once expired.
  await login(request, baseURL!, f.slug, f.staff);
  const mk = (planId: string, over: object = {}) =>
    prisma.guestPass.create({ data: { gymId: f.gym.id, dayPassPlanId: planId, fullName: "Flex", phoneWhatsapp: encrypt("081200000000"), phoneWhatsappLookup: `l-${seq++}`, status: "PENDING_REVIEW", ...over } });
  const pending = await mk(forever.planId);
  expect((await request.post(`${baseURL}/api/${f.slug}/guest-passes/${pending.id}`, { data: { action: "approve" } })).ok()).toBeTruthy();
  expect((await prisma.guestPass.findUniqueOrThrow({ where: { id: pending.id } })).expiresAt).toBeNull();
  expect((await (await request.post(`${baseURL}/api/checkin`, { data: { token: ticketTokenFor(pending) } })).json()).result).toBe("SUCCESS");

  const stale = await mk(def.planId, { status: "APPROVED", expiresAt: new Date(Date.now() - 60 * 1000) });
  const res = await (await request.post(`${baseURL}/api/checkin`, { data: { token: ticketTokenFor(stale) } })).json();
  expect(res.result).toBe("EXPIRED");
  expect(res.message).toContain("expired");
  expect((await prisma.guestPass.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("APPROVED");

  const live = await mk(def.planId, { status: "APPROVED", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
  expect((await (await request.post(`${baseURL}/api/checkin`, { data: { token: ticketTokenFor(live) } })).json()).result).toBe("SUCCESS");
});

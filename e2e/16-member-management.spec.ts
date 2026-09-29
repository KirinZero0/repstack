import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { decrypt, encrypt, hmacLookup, normalizePhone } from "../src/lib/crypto";
import { generateMagicToken } from "../src/lib/magicLink";

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

/** A throwaway gym with an owner, a staff account and two membership plans, on a plan with the given member limit. */
async function makeGym(maxMembers = 100) {
  const tag = uniq("mm");
  const saasPlan = await prisma.saasPlan.create({
    data: { name: `Plan ${tag}`, price: 1, billingInterval: "monthly", maxMembers, maxStaff: 5, maxWhatsappPerMonth: 1000 },
  });
  const gym = await prisma.gym.create({
    data: { name: `Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE", nextBillingDate: new Date(Date.now() + 30 * DAY) },
  });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  const planA = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  const planB = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Quarterly", durationDays: 90, price: 600000 } });
  return { gym, saasPlan, owner, staff, planA, planB, slug: tag };
}

type Fixture = Awaited<ReturnType<typeof makeGym>>;

async function makeMember(f: Fixture, over: { status?: "ACTIVE" | "EXPIRED" | "CANCELLED"; expiry?: Date | null; name?: string } = {}) {
  const tag = uniq("m");
  const phone = `0812${Date.now().toString().slice(-8)}${seq}`;
  return prisma.member.create({
    data: {
      gymId: f.gym.id,
      planId: f.planA.id,
      fullName: over.name ?? `Member ${tag}`,
      email: `${tag}@test.local`,
      phoneWhatsapp: encrypt(phone),
      phoneWhatsappLookup: hmacLookup(phone),
      passwordHash: await bcrypt.hash("member-pass-123", 10),
      status: over.status ?? "ACTIVE",
      membershipExpiry: over.expiry === undefined ? new Date(Date.now() + 10 * DAY) : over.expiry,
    },
  });
}

async function login(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  const res = await request.post(`${baseURL}/api/${slug}/login`, { data: who });
  expect(res.ok(), `login ${who.email}`).toBeTruthy();
}

const patch = (request: APIRequestContext, baseURL: string, slug: string, memberId: string, body: object) =>
  request.patch(`${baseURL}/api/${slug}/members/${memberId}`, { data: body });

test("the plan's member limit stops owners adding members and public joins, and cancelling frees a seat", async ({ request, baseURL }) => {
  const f = await makeGym(2);
  await login(request, baseURL!, f.slug, f.owner);
  const add = (n: number) =>
    request.post(`${baseURL}/api/${f.slug}/members`, {
      data: { fullName: `Limit ${n}`, email: `${uniq("lim")}@test.local`, phoneWhatsapp: `0819${Date.now().toString().slice(-7)}${n}`, planId: f.planA.id },
    });

  expect((await add(1)).status()).toBe(201);
  expect((await add(2)).status()).toBe(201);
  const third = await add(3);
  expect(third.status()).toBe(403);
  expect((await third.json()).error).toContain("allows 2 members");

  // The members page tells the owner where they stand.
  const membersHtml = (await (await request.get(`${baseURL}/${f.slug}/members`)).text()).replace(/<!-- -->/g, "");
  expect(membersHtml).toContain("2 of 2 members");

  // A full gym doesn't take public sign-ups either, and doesn't reveal its numbers.
  await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { acceptSignups: true } });
  const join = await request.post(`${baseURL}/api/${f.slug}/join`, {
    headers: { "x-forwarded-for": "10.9.0.1" },
    multipart: {
      planId: f.planA.id,
      fullName: "Public Joiner",
      email: `${uniq("pub")}@test.local`,
      phone: "081277776666",
      password: "long-enough-1",
      acceptTerms: "true",
    },
  });
  expect(join.status()).toBe(403);
  expect((await join.json()).error).not.toMatch(/\d/);

  // Cancelling a member frees their seat; reactivating them needs a free seat again.
  const first = await prisma.member.findFirstOrThrow({ where: { gymId: f.gym.id }, orderBy: { createdAt: "asc" } });
  expect((await patch(request, baseURL!, f.slug, first.id, { action: "cancel" })).ok()).toBeTruthy();
  expect((await add(4)).status()).toBe(201);
  const blocked = await patch(request, baseURL!, f.slug, first.id, { action: "reactivate" });
  expect(blocked.status()).toBe(403);
});

test("freeze pauses the clock, cancel kills the QR, and only the owner can cancel", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const member = await makeMember(f);
  const expiryBefore = member.membershipExpiry!.getTime();

  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  await login(request, baseURL!, f.slug, f.owner);

  // Staff can freeze and unfreeze.
  expect((await patch(staffCtx, baseURL!, f.slug, member.id, { action: "freeze" })).ok()).toBeTruthy();
  let row = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(row.status).toBe("FROZEN");
  expect(row.frozenAt).not.toBeNull();
  expect((await patch(staffCtx, baseURL!, f.slug, member.id, { action: "freeze" })).status()).toBe(409);

  // Three days frozen: unfreezing adds those days back.
  await prisma.member.update({ where: { id: member.id }, data: { frozenAt: new Date(Date.now() - 3 * DAY) } });
  const un = await patch(staffCtx, baseURL!, f.slug, member.id, { action: "unfreeze" });
  expect((await un.json()).status).toBe("ACTIVE");
  row = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(row.status).toBe("ACTIVE");
  expect(row.frozenAt).toBeNull();
  expect(Math.abs(row.membershipExpiry!.getTime() - (expiryBefore + 3 * DAY))).toBeLessThan(60_000);

  // Staff can't cancel or reactivate; the owner can, and the old QR secret dies with it.
  expect((await patch(staffCtx, baseURL!, f.slug, member.id, { action: "cancel" })).status()).toBe(403);
  const secretBefore = row.qrSecret;
  expect((await patch(request, baseURL!, f.slug, member.id, { action: "cancel" })).ok()).toBeTruthy();
  row = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(row.status).toBe("CANCELLED");
  expect(row.qrSecret).not.toBe(secretBefore);
  expect((await patch(request, baseURL!, f.slug, member.id, { action: "freeze" })).status()).toBe(409);
  expect((await patch(staffCtx, baseURL!, f.slug, member.id, { action: "reactivate" })).status()).toBe(403);
  expect((await patch(request, baseURL!, f.slug, member.id, { action: "reactivate" })).ok()).toBeTruthy();
  expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).status).toBe("ACTIVE");

  // Another gym's owner can't touch this member.
  const other = await makeGym();
  const otherCtx = await playwright.request.newContext();
  await login(otherCtx, baseURL!, other.slug, other.owner);
  expect((await patch(otherCtx, baseURL!, other.slug, member.id, { action: "freeze" })).status()).toBe(404);
  expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).status).toBe("ACTIVE");
  await staffCtx.dispose();
  await otherCtx.dispose();
});

test("a frozen member stays frozen when a payment lands, and gets the time on unfreeze", async ({ request, baseURL }) => {
  const f = await makeGym();
  const member = await makeMember(f);
  await login(request, baseURL!, f.slug, f.owner);
  await patch(request, baseURL!, f.slug, member.id, { action: "freeze" });

  const paid = await request.post(`${baseURL}/api/${f.slug}/members/${member.id}/payments`, { data: { planId: f.planA.id, amount: 250000 } });
  expect(paid.status()).toBe(201);
  const row = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(row.status).toBe("FROZEN");
  expect(row.membershipExpiry!.getTime()).toBeGreaterThan(member.membershipExpiry!.getTime() + 25 * DAY);
});

test("owner and staff can edit a member's details; emails stay unique and plans stay in the gym", async ({ request, baseURL }) => {
  const f = await makeGym();
  const member = await makeMember(f);
  const other = await makeMember(f);
  await login(request, baseURL!, f.slug, f.owner);

  const newEmail = `${uniq("edited")}@test.local`;
  const ok = await patch(request, baseURL!, f.slug, member.id, { action: "edit", fullName: "Renamed Person", email: newEmail, phone: "081255550000", planId: f.planB.id });
  expect(ok.ok()).toBeTruthy();
  const row = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(row.fullName).toBe("Renamed Person");
  expect(row.email).toBe(newEmail);
  expect(decrypt(row.phoneWhatsapp)).toBe("081255550000");
  expect(row.phoneWhatsappLookup).toBe(hmacLookup(normalizePhone("081255550000")));
  expect(row.planId).toBe(f.planB.id);

  expect((await patch(request, baseURL!, f.slug, member.id, { action: "edit", email: other.email })).status()).toBe(409);

  // A plan from another gym is refused.
  const foreign = await makeGym();
  expect((await patch(request, baseURL!, f.slug, member.id, { action: "edit", planId: foreign.planA.id })).status()).toBe(400);
  expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).planId).toBe(f.planB.id);
});

test("erasing a member removes their personal data but keeps the payment history", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const member = await makeMember(f, { name: "Erase Me Please" });
  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  await login(request, baseURL!, f.slug, f.owner);

  await request.post(`${baseURL}/api/${f.slug}/members/${member.id}/payments`, { data: { planId: f.planA.id, amount: 250000 } });
  const { tokenHash } = generateMagicToken();
  await prisma.magicLink.create({ data: { memberId: member.id, tokenHash, expiresAt: new Date(Date.now() + DAY) } });
  const paymentsBefore = await prisma.payment.count({ where: { memberId: member.id } });

  const erase = (ctx: APIRequestContext, slug: string, confirmName: string) =>
    ctx.post(`${baseURL}/api/${slug}/members/${member.id}/erase`, { data: { confirmName } });

  expect((await erase(staffCtx, f.slug, "Erase Me Please")).status()).toBe(403);
  expect((await erase(request, f.slug, "Someone Else")).status()).toBe(400);
  expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).anonymizedAt).toBeNull();

  const other = await makeGym();
  const otherCtx = await playwright.request.newContext();
  await login(otherCtx, baseURL!, other.slug, other.owner);
  expect((await erase(otherCtx, other.slug, "Erase Me Please")).status()).toBe(404);

  const oldEmail = member.email;
  expect((await erase(request, f.slug, "erase me please")).ok()).toBeTruthy();

  const row = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(row.fullName).toBe("Erased member");
  expect(row.email).not.toBe(oldEmail);
  expect(decrypt(row.phoneWhatsapp)).toBe("erased");
  expect(row.passwordHash).toBeNull();
  expect(row.photoUrl).toBeNull();
  expect(row.status).toBe("CANCELLED");
  expect(row.anonymizedAt).not.toBeNull();
  expect(await prisma.magicLink.count({ where: { memberId: member.id } })).toBe(0);
  expect(await prisma.payment.count({ where: { memberId: member.id } })).toBe(paymentsBefore);

  // Their old login is gone, and the email can be used again.
  const relog = await request.post(`${baseURL}/api/${f.slug}/login`, { data: { email: oldEmail, password: "member-pass-123" } });
  expect(relog.status()).toBe(401);
  const reuse = await request.post(`${baseURL}/api/${f.slug}/members`, {
    data: { fullName: "Comes Back", email: oldEmail, phoneWhatsapp: "081211110000", planId: f.planA.id },
  });
  expect(reuse.status()).toBe(201);

  // The erased row is hidden from the list, and can't be edited.
  expect(await (await request.get(`${baseURL}/${f.slug}/members`)).text()).not.toContain("Erased member");
  expect((await patch(request, baseURL!, f.slug, member.id, { action: "edit", fullName: "Zombie" })).status()).toBe(409);
  expect((await erase(request, f.slug, "Erased member")).status()).toBe(409);
  await staffCtx.dispose();
  await otherCtx.dispose();
});

test("a member can delete their own account with their password", async ({ request, baseURL }) => {
  const f = await makeGym();
  const member = await makeMember(f);
  await login(request, baseURL!, f.slug, { email: member.email, password: "member-pass-123" });

  const wrong = await request.post(`${baseURL}/api/my/erase`, { data: { password: "not-my-password" } });
  expect(wrong.status()).toBe(403);
  expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).anonymizedAt).toBeNull();

  const ok = await request.post(`${baseURL}/api/my/erase`, { data: { password: "member-pass-123" } });
  expect(ok.ok()).toBeTruthy();
  const row = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(row.fullName).toBe("Erased member");
  expect(row.passwordHash).toBeNull();

  // The session is gone and the credentials no longer work.
  expect((await request.post(`${baseURL}/api/my/erase`, { data: { password: "member-pass-123" } })).status()).toBe(401);
  expect((await request.post(`${baseURL}/api/${f.slug}/login`, { data: { email: member.email, password: "member-pass-123" } })).status()).toBe(401);
});

test("terms must be accepted to sign up, join and activate, and the time is recorded", async ({ request, baseURL }) => {
  const plan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const stamp = Date.now();
  const details = { saasPlanId: plan.id, gymName: "Terms Gym", slug: `terms-gym-${stamp}`, ownerName: "Terms Owner", ownerEmail: `terms-${stamp}@signup.test`, ownerPhone: "081200007777", password: "long-enough-1" };

  const missing = await request.post(`${baseURL}/api/signup`, { data: details });
  expect(missing.status()).toBe(400);
  expect((await missing.json()).field).toBe("acceptTerms");
  expect((await request.post(`${baseURL}/api/signup`, { data: { ...details, acceptTerms: false } })).status()).toBe(400);
  expect(await prisma.gymSignup.count({ where: { slug: details.slug } })).toBe(0);

  const started = await request.post(`${baseURL}/api/signup`, { data: { ...details, acceptTerms: true } });
  expect(started.ok()).toBeTruthy();
  const signup = await prisma.gymSignup.findFirstOrThrow({ where: { slug: details.slug } });
  expect(signup.termsAcceptedAt).not.toBeNull();

  // Activation of a member added by the front desk.
  const f = await makeGym();
  const member = await makeMember(f);
  await prisma.member.update({ where: { id: member.id }, data: { passwordHash: null } });
  const { token, tokenHash } = generateMagicToken();
  await prisma.magicLink.create({ data: { memberId: member.id, tokenHash, expiresAt: new Date(Date.now() + DAY) } });

  const without = await request.post(`${baseURL}/api/activate/${token}`, { multipart: { password: "long-enough-1" } });
  expect(without.status()).toBe(400);
  expect((await prisma.member.findUniqueOrThrow({ where: { id: member.id } })).passwordHash).toBeNull();

  const withTerms = await request.post(`${baseURL}/api/activate/${token}`, { multipart: { password: "long-enough-1", acceptTerms: "true" } });
  expect(withTerms.ok()).toBeTruthy();
  const done = await prisma.member.findUniqueOrThrow({ where: { id: member.id } });
  expect(done.passwordHash).not.toBeNull();
  expect(done.termsAcceptedAt).not.toBeNull();
});

test("the public terms and privacy pages are served", async ({ request, baseURL }) => {
  const terms = await request.get(`${baseURL}/terms`);
  expect(terms.status()).toBe(200);
  expect(await terms.text()).toContain("Terms of Service");
  const privacy = await request.get(`${baseURL}/privacy`);
  expect(privacy.status()).toBe(200);
  expect(await privacy.text()).toContain("Privacy Policy");
});

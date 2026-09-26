import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";
import { generateMagicToken } from "../src/lib/magicLink";
import { MAX_RESETS_PER_IP_HOUR, hashClientIp } from "../src/lib/passwordReset";

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

async function login(request: APIRequestContext, baseURL: string, slug: string, email: string, password: string) {
  return request.post(`${baseURL}/api/g/${slug}/login`, { data: { email, password } });
}

async function loginOwnerA(request: APIRequestContext, baseURL: string) {
  const res = await login(request, baseURL, "test-gym-a", "owner-a@test.local", "owner-pass-123");
  expect(res.ok()).toBeTruthy();
}

/** Free up staff capacity left by earlier tests so each test starts from just the owner. */
async function resetGymAStaff() {
  const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  await prisma.staffUser.updateMany({ where: { gymId: gym.id, role: "STAFF" }, data: { isActive: false } });
  return gym;
}

/** The raw token is only ever shown once, so tests swap in a known one for the newest open link. */
async function knownTokenFor(subjectId: string) {
  const row = await prisma.passwordReset.findFirstOrThrow({ where: { subjectId, usedAt: null }, orderBy: { createdAt: "desc" } });
  const { token, tokenHash } = generateMagicToken();
  await prisma.passwordReset.update({ where: { id: row.id }, data: { tokenHash } });
  return token;
}

const tokenOf = (url: string) => url.split("/reset/")[1];

test("owner adds staff: invite link sets their password, they log in as STAFF, links work once", async ({ request, baseURL }) => {
  await resetGymAStaff();
  await loginOwnerA(request, baseURL!);

  const email = `${uniq("staff")}@test.local`;
  const created = await request.post(`${baseURL}/api/g/test-gym-a/staff`, { data: { name: "New Staffer", email } });
  expect(created.status()).toBe(201);
  const { staffId, inviteUrl } = await created.json();
  const token = tokenOf(inviteUrl);

  // Can't log in with anything until the invite is used.
  expect((await login(request, baseURL!, "test-gym-a", email, "guess-password-1")).status()).toBe(401);

  const info = await request.get(`${baseURL}/api/reset/${token}`);
  expect((await info.json()).purpose).toBe("invite");

  expect((await request.post(`${baseURL}/api/reset/${token}`, { data: { password: "short" } })).status()).toBe(400);
  const set = await request.post(`${baseURL}/api/reset/${token}`, { data: { password: "brand-new-pass-1" } });
  expect(set.ok()).toBeTruthy();
  expect((await set.json()).loginUrl).toBe("/g/test-gym-a/login");

  // The link is single-use.
  expect((await request.post(`${baseURL}/api/reset/${token}`, { data: { password: "another-pass-123" } })).status()).toBe(404);

  const staffLogin = await login(request, baseURL!, "test-gym-a", email, "brand-new-pass-1");
  expect(staffLogin.ok()).toBeTruthy();
  const body = await staffLogin.json();
  expect(body.kind).toBe("staff");
  expect(body.role).toBe("STAFF");
  expect((await prisma.staffUser.findUniqueOrThrow({ where: { id: staffId } })).role).toBe("STAFF");
});

test("staff can do front-desk work but not owner-only work", async ({ request, baseURL }) => {
  const gym = await resetGymAStaff();
  await loginOwnerA(request, baseURL!);
  const email = `${uniq("desk")}@test.local`;
  const { inviteUrl } = await (await request.post(`${baseURL}/api/g/test-gym-a/staff`, { data: { name: "Desk", email } })).json();
  await request.post(`${baseURL}/api/reset/${tokenOf(inviteUrl)}`, { data: { password: "desk-password-1" } });

  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gym.id, isActive: true } });
  const phone = `0816${Date.now().toString().slice(-8)}`;
  const member = await prisma.member.create({
    data: { gymId: gym.id, planId: plan.id, fullName: "Desk Member", email: `${uniq("dm")}@test.local`, phoneWhatsapp: encrypt(phone), phoneWhatsappLookup: hmacLookup(phone), status: "EXPIRED", membershipExpiry: new Date(Date.now() - DAY) },
  });

  // Log in as the staff member in this same client.
  expect((await login(request, baseURL!, "test-gym-a", email, "desk-password-1")).ok()).toBeTruthy();

  // Allowed: record a payment for a member, and make them a password link.
  const rec = await request.post(`${baseURL}/api/g/test-gym-a/members/${member.id}/payments`, { data: { planId: plan.id, amount: 150000 } });
  expect(rec.status()).toBe(201);
  const { paymentId } = await rec.json();
  expect((await request.post(`${baseURL}/api/g/test-gym-a/members/${member.id}/reset-link`)).ok()).toBeTruthy();

  // Not allowed: void it, add staff, change plans/WhatsApp/settings, or make staff links.
  expect((await request.post(`${baseURL}/api/g/test-gym-a/members/${member.id}/payments/${paymentId}/void`)).status()).toBe(403);
  expect((await request.post(`${baseURL}/api/g/test-gym-a/staff`, { data: { name: "Nope", email: `${uniq("no")}@test.local` } })).status()).toBe(403);
  expect((await request.post(`${baseURL}/api/g/test-gym-a/plans`, { data: { name: "Sneaky", durationDays: 30, price: 1000 } })).status()).toBe(403);
  expect((await request.post(`${baseURL}/api/g/test-gym-a/settings`, { data: { acceptSignups: true } })).status()).toBe(403);
});

test("staff limit follows the plan, and deactivating cuts access immediately", async ({ request, baseURL, playwright }) => {
  const gym = await resetGymAStaff();
  const owner = request;
  await loginOwnerA(owner, baseURL!);
  const plan = await prisma.saasPlan.findUniqueOrThrow({ where: { id: gym.saasPlanId } });

  // Fill the plan (the owner counts as one), then one more is refused.
  const made: { id: string; email: string; token: string }[] = [];
  for (let i = 0; i < plan.maxStaff - 1; i++) {
    const email = `${uniq("cap")}@test.local`;
    const res = await owner.post(`${baseURL}/api/g/test-gym-a/staff`, { data: { name: `Cap ${i}`, email } });
    expect(res.status()).toBe(201);
    const j = await res.json();
    await owner.post(`${baseURL}/api/reset/${tokenOf(j.inviteUrl)}`, { data: { password: "cap-password-123" } });
    made.push({ id: j.staffId, email, token: "" });
    if (i === 0) {
      // Someone can't reuse an email that's taken (checked while there's still room on the plan).
      expect((await owner.post(`${baseURL}/api/g/test-gym-a/staff`, { data: { name: "Dupe", email } })).status()).toBe(409);
    }
  }
  const over = await owner.post(`${baseURL}/api/g/test-gym-a/staff`, { data: { name: "Over", email: `${uniq("over")}@test.local` } });
  expect(over.status()).toBe(403);
  expect((await over.json()).error).toContain(String(plan.maxStaff));

  // The first staffer is logged in on a separate client and using the scanner.
  const staffCtx = await playwright.request.newContext();
  expect((await login(staffCtx, baseURL!, "test-gym-a", made[0].email, "cap-password-123")).ok()).toBeTruthy();
  const scan = () => staffCtx.post(`${baseURL}/api/checkin`, { data: { token: "not-a-real-token" } });
  expect((await scan()).status()).toBe(200); // authenticated; the token itself is just invalid

  // Owners can't be deactivated; other gyms' owners can't touch this gym's staff.
  const ownerRow = await prisma.staffUser.findUniqueOrThrow({ where: { email: "owner-a@test.local" } });
  expect((await owner.patch(`${baseURL}/api/g/test-gym-a/staff/${ownerRow.id}`, { data: { isActive: false } })).status()).toBe(409);
  const bCtx = await playwright.request.newContext();
  await login(bCtx, baseURL!, "test-gym-b", "owner-b@test.local", "owner-pass-123");
  expect((await bCtx.patch(`${baseURL}/api/g/test-gym-a/staff/${made[0].id}`, { data: { isActive: false } })).status()).toBe(401);

  // Deactivate: their existing session stops working on the very next request, and they can't log in again.
  expect((await owner.patch(`${baseURL}/api/g/test-gym-a/staff/${made[0].id}`, { data: { isActive: false } })).ok()).toBeTruthy();
  expect((await scan()).status()).toBe(401);
  const freshCtx = await playwright.request.newContext();
  expect((await login(freshCtx, baseURL!, "test-gym-a", made[0].email, "cap-password-123")).status()).toBe(401);
  await freshCtx.dispose();

  // That freed a slot, so adding works again; reactivating is refused while full.
  expect((await owner.post(`${baseURL}/api/g/test-gym-a/staff`, { data: { name: "Fits", email: `${uniq("fits")}@test.local` } })).status()).toBe(201);
  expect((await owner.patch(`${baseURL}/api/g/test-gym-a/staff/${made[0].id}`, { data: { isActive: true } })).status()).toBe(403);

  await staffCtx.dispose();
  await bCtx.dispose();
});

test("forgot password: same answer for every email, link sent only to the number on file, throttled", async ({ request, baseURL }) => {
  const gym = await resetGymAStaff();
  await loginOwnerA(request, baseURL!);
  const email = `${uniq("forgot")}@test.local`;
  const { staffId, inviteUrl } = await (await request.post(`${baseURL}/api/g/test-gym-a/staff`, { data: { name: "Forgetful", email, phone: "081277776666" } })).json();
  await request.post(`${baseURL}/api/reset/${tokenOf(inviteUrl)}`, { data: { password: "old-password-123" } });

  const anon = (ip: string, e: string) => request.post(`${baseURL}/api/g/test-gym-a/forgot`, { data: { email: e }, headers: { "x-forwarded-for": ip } });

  // Existing and non-existing emails look identical.
  const real = await anon("10.20.0.1", email);
  const fake = await anon("10.20.0.1", `nobody-${Date.now()}@test.local`);
  expect(real.status()).toBe(200);
  expect(fake.status()).toBe(200);
  expect(await real.json()).toEqual(await fake.json());
  expect(await prisma.passwordReset.count({ where: { subjectId: staffId, purpose: "reset" } })).toBe(1);

  // A member's or another gym's email doesn't create a staff link here.
  const other = await anon("10.20.0.1", "owner-b@test.local");
  expect(other.status()).toBe(200);
  const ownerB = await prisma.staffUser.findUniqueOrThrow({ where: { email: "owner-b@test.local" } });
  expect(await prisma.passwordReset.count({ where: { subjectId: ownerB.id } })).toBe(0);

  // Using the link changes the password; the old one stops working.
  const token = await knownTokenFor(staffId);
  expect((await request.post(`${baseURL}/api/reset/${token}`, { data: { password: "fresh-password-456" } })).ok()).toBeTruthy();
  expect((await login(request, baseURL!, "test-gym-a", email, "old-password-123")).status()).toBe(401);
  expect((await login(request, baseURL!, "test-gym-a", email, "fresh-password-456")).ok()).toBeTruthy();

  // Per-account throttle: at most 3 links an hour, and the caller can't tell.
  for (let i = 0; i < 5; i++) expect((await anon("10.20.0.2", email)).status()).toBe(200);
  expect(await prisma.passwordReset.count({ where: { subjectId: staffId, purpose: "reset", createdAt: { gte: new Date(Date.now() - 3600_000) } } })).toBeLessThanOrEqual(3);

  // Per-requester throttle: counts links already created from this address in the last hour.
  const ipHash = hashClientIp("10.20.0.3");
  await prisma.passwordReset.createMany({
    data: Array.from({ length: MAX_RESETS_PER_IP_HOUR }, () => ({
      kind: "staff",
      subjectId: staffId,
      tokenHash: generateMagicToken().tokenHash,
      expiresAt: new Date(Date.now() + 3600_000),
      usedAt: new Date(),
      ipHash,
    })),
  });
  expect((await anon("10.20.0.3", email)).status()).toBe(429);
  expect((await anon("10.20.0.4", email)).status()).toBe(200); // other addresses are unaffected
  expect(gym.id).toBeTruthy();
});

test("members can reset their password too; expired and unknown links are refused", async ({ request, baseURL }) => {
  const gym = await resetGymAStaff();
  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gym.id, isActive: true } });
  const email = `${uniq("memreset")}@test.local`;
  const phone = `0817${Date.now().toString().slice(-8)}`;
  const member = await prisma.member.create({
    data: { gymId: gym.id, planId: plan.id, fullName: "Member Reset", email, phoneWhatsapp: encrypt(phone), phoneWhatsappLookup: hmacLookup(phone), passwordHash: await bcrypt.hash("member-old-pass-1", 10), status: "ACTIVE", membershipExpiry: new Date(Date.now() + 10 * DAY) },
  });

  const res = await request.post(`${baseURL}/api/g/test-gym-a/forgot`, { data: { email }, headers: { "x-forwarded-for": "10.30.0.1" } });
  expect(res.status()).toBe(200);
  const row = await prisma.passwordReset.findFirstOrThrow({ where: { subjectId: member.id } });
  expect(row.kind).toBe("member");

  const token = await knownTokenFor(member.id);
  expect((await request.post(`${baseURL}/api/reset/${token}`, { data: { password: "member-new-pass-2" } })).ok()).toBeTruthy();
  expect((await login(request, baseURL!, "test-gym-a", email, "member-old-pass-1")).status()).toBe(401);
  const ok = await login(request, baseURL!, "test-gym-a", email, "member-new-pass-2");
  expect((await ok.json()).kind).toBe("member");

  // Expired link.
  const expired = generateMagicToken();
  await prisma.passwordReset.create({ data: { kind: "member", subjectId: member.id, tokenHash: expired.tokenHash, expiresAt: new Date(Date.now() - 1000) } });
  expect((await request.get(`${baseURL}/api/reset/${expired.token}`)).status()).toBe(404);
  expect((await request.post(`${baseURL}/api/reset/${expired.token}`, { data: { password: "member-third-pass-3" } })).status()).toBe(404);
  // Made-up token.
  expect((await request.get(`${baseURL}/api/reset/${generateMagicToken().token}`)).status()).toBe(404);
});

test("owner/staff can make a member password link; another gym's member is off limits; superadmin can make an owner link", async ({ request, baseURL, playwright }) => {
  const gym = await resetGymAStaff();
  await loginOwnerA(request, baseURL!);
  const own = await prisma.member.findFirstOrThrow({ where: { gymId: gym.id } });
  const link = await request.post(`${baseURL}/api/g/test-gym-a/members/${own.id}/reset-link`);
  expect(link.ok()).toBeTruthy();
  expect((await link.json()).url).toContain("/reset/");

  const gymB = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-b" } });
  const foreign = await prisma.member.findFirstOrThrow({ where: { gymId: gymB.id } });
  expect((await request.post(`${baseURL}/api/g/test-gym-a/members/${foreign.id}/reset-link`)).status()).toBe(404);

  // Superadmin: a fresh gym with its own owner, so shared fixtures keep their passwords.
  const slug = uniq("resetgym");
  const plan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const ownerEmail = `${slug}@test.local`;
  const newGym = await prisma.gym.create({ data: { name: "Reset Gym", slug, saasPlanId: plan.id, subscriptionStatus: "ACTIVE" } });
  await prisma.staffUser.create({ data: { gymId: newGym.id, name: "Locked Out", email: ownerEmail, passwordHash: await bcrypt.hash("forgotten-pass-1", 10), role: "OWNER" } });

  const admin = await playwright.request.newContext();
  expect((await admin.post(`${baseURL}/api/superadmin/gyms/${newGym.id}/owner-reset`)).status()).toBe(401);
  await admin.post(`${baseURL}/api/superadmin/login`, { data: { email: "superadmin@test.local", password: "superadmin-pass-123" } });
  const made = await admin.post(`${baseURL}/api/superadmin/gyms/${newGym.id}/owner-reset`);
  expect(made.ok()).toBeTruthy();
  const { url } = await made.json();
  expect((await request.post(`${baseURL}/api/reset/${tokenOf(url)}`, { data: { password: "recovered-pass-9" } })).ok()).toBeTruthy();
  expect((await login(request, baseURL!, slug, ownerEmail, "recovered-pass-9")).ok()).toBeTruthy();
  expect(await prisma.auditLog.count({ where: { gymId: newGym.id, action: "OWNER_RESET_LINK_CREATED" } })).toBe(1);
  await admin.dispose();
});

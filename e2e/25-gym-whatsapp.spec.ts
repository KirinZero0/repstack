import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { decrypt } from "../src/lib/crypto";

let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

const GOOD = "fonnte-good-token-123456";
const BAD = "bad-fonnte-token-123456"; // mock gateway rejects any key starting with "bad"

/** A gym on a plan with a zero WhatsApp allowance: any message sent through the platform number is blocked. */
async function makeGym() {
  const plan = await prisma.saasPlan.create({
    data: { name: uniq("WA"), price: 1, billingInterval: "monthly", maxMembers: 100, maxStaff: 5, maxWhatsappPerMonth: 0 },
  });
  const tag = uniq("wa");
  const gym = await prisma.gym.create({ data: { name: `WA ${tag}`, slug: tag, saasPlanId: plan.id, subscriptionStatus: "ACTIVE" } });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, phone: "081200009999", passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  const memberPlan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  return { gym, owner, staff, slug: tag, memberPlan };
}

const login = (request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) =>
  request.post(`${baseURL}/api/${slug}/login`, { data: who });

const saveToken = (request: APIRequestContext, baseURL: string, slug: string, token: string, senderNumber = "0812 3456 7890") =>
  request.post(`${baseURL}/api/${slug}/whatsapp`, { data: { token, senderNumber } });

/** Adds a member (which sends an activation WhatsApp) and returns the statuses logged for that send. */
async function addMemberAndGetStatuses(request: APIRequestContext, baseURL: string, f: Awaited<ReturnType<typeof makeGym>>) {
  const marker = new Date();
  const res = await request.post(`${baseURL}/api/${f.slug}/members`, {
    data: {
      fullName: "Msg Member",
      email: `${uniq("msg")}@test.local`,
      phoneWhatsapp: `0819${Date.now().toString().slice(-7)}${seq++}`,
      planId: f.memberPlan.id,
    },
  });
  expect(res.status()).toBe(201);
  const logs = await prisma.notificationLog.findMany({ where: { gymId: f.gym.id, sentAt: { gte: marker } } });
  expect(logs.length).toBeGreaterThan(0);
  return Array.from(new Set(logs.map((l) => l.status)));
}

test("the token is stored encrypted, never shown again, and only the owner can touch it", async ({ request, baseURL }) => {
  const f = await makeGym();
  await login(request, baseURL!, f.slug, f.owner);

  // Too short is rejected before anything is stored.
  expect((await saveToken(request, baseURL!, f.slug, "short")).status()).toBe(400);
  expect(await prisma.whatsappSenderConfig.findUnique({ where: { gymId: f.gym.id } })).toBeNull();

  const res = await saveToken(request, baseURL!, f.slug, GOOD);
  expect(res.ok()).toBeTruthy();
  expect(JSON.stringify(await res.json())).not.toContain(GOOD);

  const row = await prisma.whatsappSenderConfig.findUniqueOrThrow({ where: { gymId: f.gym.id } });
  expect(row.apiKeyEncrypted.startsWith("v1:")).toBe(true);
  expect(row.apiKeyEncrypted).not.toContain(GOOD);
  expect(decrypt(row.apiKeyEncrypted)).toBe(GOOD);
  expect(row.senderNumber).toBe("081234567890");
  expect(row.gatewayProvider).toBe("fonnte");

  // The settings page says it's connected but never contains the token.
  const html = (await (await request.get(`${baseURL}/${f.slug}/settings`)).text()).replace(/<!-- -->/g, "");
  expect(html).toContain("Connected");
  expect(html).toContain("081234567890");
  expect(html).not.toContain(GOOD);

  // Replacing keeps one row and swaps the ciphertext.
  expect((await saveToken(request, baseURL!, f.slug, BAD)).ok()).toBeTruthy();
  expect(await prisma.whatsappSenderConfig.count({ where: { gymId: f.gym.id } })).toBe(1);
  const replaced = await prisma.whatsappSenderConfig.findUniqueOrThrow({ where: { gymId: f.gym.id } });
  expect(decrypt(replaced.apiKeyEncrypted)).toBe(BAD);

  // Staff can't save, test or remove it.
  await request.post(`${baseURL}/api/${f.slug}/staff-logout`);
  await login(request, baseURL!, f.slug, f.staff);
  expect((await saveToken(request, baseURL!, f.slug, GOOD)).status()).toBe(403);
  expect((await request.post(`${baseURL}/api/${f.slug}/whatsapp/test`, { data: { phone: "081200001111" } })).status()).toBe(403);
  expect((await request.delete(`${baseURL}/api/${f.slug}/whatsapp`)).status()).toBe(403);
  expect(decrypt((await prisma.whatsappSenderConfig.findUniqueOrThrow({ where: { gymId: f.gym.id } })).apiKeyEncrypted)).toBe(BAD);

  // Logged out entirely: refused.
  await request.post(`${baseURL}/api/${f.slug}/staff-logout`);
  expect((await saveToken(request, baseURL!, f.slug, GOOD)).status()).toBe(401);
});

test("another gym's owner can't read, replace or remove a gym's token", async ({ request, baseURL }) => {
  const a = await makeGym();
  const b = await makeGym();
  await login(request, baseURL!, a.slug, a.owner);
  expect((await saveToken(request, baseURL!, a.slug, GOOD)).ok()).toBeTruthy();
  await request.post(`${baseURL}/api/${a.slug}/staff-logout`);

  await login(request, baseURL!, b.slug, b.owner);
  expect((await saveToken(request, baseURL!, a.slug, BAD)).ok()).toBeFalsy();
  expect((await request.delete(`${baseURL}/api/${a.slug}/whatsapp`)).ok()).toBeFalsy();
  expect((await request.post(`${baseURL}/api/${a.slug}/whatsapp/test`, { data: { phone: "081200001111" } })).ok()).toBeFalsy();
  expect(decrypt((await prisma.whatsappSenderConfig.findUniqueOrThrow({ where: { gymId: a.gym.id } })).apiKeyEncrypted)).toBe(GOOD);
  expect(await prisma.whatsappSenderConfig.findUnique({ where: { gymId: b.gym.id } })).toBeNull();
});

test("messages use the gym's own token, skip the plan allowance, and never fall back silently", async ({ request, baseURL }) => {
  const f = await makeGym();
  await login(request, baseURL!, f.slug, f.owner);

  // No token: goes through the platform number, and this plan allows zero messages.
  expect(await addMemberAndGetStatuses(request, baseURL!, f)).toEqual(["LIMIT"]);

  // Test send needs a saved token first.
  expect((await request.post(`${baseURL}/api/${f.slug}/whatsapp/test`, { data: { phone: "081200001111" } })).status()).toBe(409);

  // Own token: sent, even though the plan allowance is zero.
  expect((await saveToken(request, baseURL!, f.slug, GOOD)).ok()).toBeTruthy();
  expect(await addMemberAndGetStatuses(request, baseURL!, f)).toEqual(["SENT"]);
  expect((await request.post(`${baseURL}/api/${f.slug}/whatsapp/test`, { data: { phone: "081200001111" } })).ok()).toBeTruthy();

  // A rejected token is reported as a failure, not hidden by falling back to the shared number.
  expect((await saveToken(request, baseURL!, f.slug, BAD)).ok()).toBeTruthy();
  expect(await addMemberAndGetStatuses(request, baseURL!, f)).toEqual(["FAILED"]);
  const test = await request.post(`${baseURL}/api/${f.slug}/whatsapp/test`, { data: { phone: "081200001111" } });
  expect(test.status()).toBe(502);
  expect((await test.json()).error).toContain("Invalid token");

  // A saved token that can't be decrypted fails loudly too.
  await prisma.whatsappSenderConfig.update({ where: { gymId: f.gym.id }, data: { apiKeyEncrypted: "v1:not-a-real-ciphertext" } });
  expect(await addMemberAndGetStatuses(request, baseURL!, f)).toEqual(["FAILED"]);

  // Disconnecting returns the gym to the shared number (and its allowance).
  expect((await request.delete(`${baseURL}/api/${f.slug}/whatsapp`)).ok()).toBeTruthy();
  expect(await prisma.whatsappSenderConfig.findUnique({ where: { gymId: f.gym.id } })).toBeNull();
  expect(await addMemberAndGetStatuses(request, baseURL!, f)).toEqual(["LIMIT"]);
});

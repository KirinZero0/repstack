import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";

let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

async function makeGym() {
  const plan = await prisma.saasPlan.create({
    data: { name: uniq("Chan"), price: 1, billingInterval: "monthly", maxMembers: 100, maxStaff: 5, maxWhatsappPerMonth: 500 },
  });
  const tag = uniq("chan");
  const gym = await prisma.gym.create({ data: { name: `Chan ${tag}`, slug: tag, saasPlanId: plan.id, subscriptionStatus: "ACTIVE" } });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  const memberPlan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  return { gym, owner, slug: tag, memberPlan };
}

const setChannels = (request: APIRequestContext, baseURL: string, slug: string, body: { notifyWhatsapp?: boolean; notifyEmail?: boolean }) =>
  request.post(`${baseURL}/api/${slug}/settings`, { data: body });

/** Adds a member (which notifies them) and returns what was logged, as "channel:STATUS" strings. */
async function addMember(request: APIRequestContext, baseURL: string, f: Awaited<ReturnType<typeof makeGym>>, email = `${uniq("m")}@test.local`) {
  const marker = new Date();
  const res = await request.post(`${baseURL}/api/${f.slug}/members`, {
    data: { fullName: "Chan Member", email, phoneWhatsapp: `0819${Date.now().toString().slice(-7)}${seq++}`, planId: f.memberPlan.id },
  });
  expect(res.status()).toBe(201);
  const logs = await prisma.notificationLog.findMany({ where: { gymId: f.gym.id, sentAt: { gte: marker } } });
  return logs.map((l) => `${l.channel}:${l.status}`).sort();
}

test("WhatsApp is on by default and email is off, until the owner switches them", async ({ request, baseURL }) => {
  const f = await makeGym();
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });

  expect(await addMember(request, baseURL!, f)).toEqual(["whatsapp:SENT"]);

  expect((await setChannels(request, baseURL!, f.slug, { notifyEmail: true })).ok()).toBeTruthy();
  expect(await addMember(request, baseURL!, f)).toEqual(["email:SENT", "whatsapp:SENT"]);

  expect((await setChannels(request, baseURL!, f.slug, { notifyWhatsapp: false })).ok()).toBeTruthy();
  expect(await addMember(request, baseURL!, f)).toEqual(["email:SENT"]);

  expect((await setChannels(request, baseURL!, f.slug, { notifyEmail: false })).ok()).toBeTruthy();
  expect(await addMember(request, baseURL!, f)).toEqual([]);

  const settings = (await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).settings as Record<string, unknown>;
  expect(settings.notifyWhatsapp).toBe(false);
  expect(settings.notifyEmail).toBe(false);

  // Switching WhatsApp back on restores it.
  expect((await setChannels(request, baseURL!, f.slug, { notifyWhatsapp: true })).ok()).toBeTruthy();
  expect(await addMember(request, baseURL!, f)).toEqual(["whatsapp:SENT"]);
});

test("a bounced email is logged FAILED without affecting the WhatsApp message", async ({ request, baseURL }) => {
  const f = await makeGym();
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });
  await setChannels(request, baseURL!, f.slug, { notifyEmail: true });

  expect(await addMember(request, baseURL!, f, `${uniq("x")}+bounce@test.local`)).toEqual(["email:FAILED", "whatsapp:SENT"]);
});

test("only the owner can change the switches, and they must be true or false", async ({ request, baseURL }) => {
  const f = await makeGym();
  await prisma.staffUser.create({
    data: { gymId: f.gym.id, name: "Staffer", email: `staff-${f.slug}@test.local`, passwordHash: await bcrypt.hash("staff-pass-123", 10), role: "STAFF" },
  });

  await request.post(`${baseURL}/api/${f.slug}/login`, { data: { email: `staff-${f.slug}@test.local`, password: "staff-pass-123" } });
  expect((await setChannels(request, baseURL!, f.slug, { notifyEmail: true })).status()).toBe(403);

  await request.post(`${baseURL}/api/${f.slug}/staff-logout`);
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });
  expect((await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { notifyEmail: "yes" } })).status()).toBe(400);

  const settings = (await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).settings as Record<string, unknown>;
  expect(settings.notifyEmail).toBeUndefined();
});

test("the settings page shows the switches and labels each logged message with its channel", async ({ request, baseURL }) => {
  const f = await makeGym();
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });
  await setChannels(request, baseURL!, f.slug, { notifyEmail: true });
  await addMember(request, baseURL!, f);

  const html = (await (await request.get(`${baseURL}/${f.slug}/settings`)).text()).replace(/<!-- -->/g, "");
  expect(html).toContain("Send members WhatsApp messages");
  expect(html).toContain("Send members emails");
  expect(html).toContain(">email<");
  expect(html).toContain(">WhatsApp<");
});

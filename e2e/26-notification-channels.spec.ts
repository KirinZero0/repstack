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

/** Clicks "send reminder" with the chosen channel for a fresh member and returns the response plus the logged "channel:STATUS" strings. */
async function remind(request: APIRequestContext, baseURL: string, f: Awaited<ReturnType<typeof makeGym>>, channel?: "whatsapp" | "email") {
  const added = await request.post(`${baseURL}/api/${f.slug}/members`, {
    data: { fullName: "Remind Me", email: `${uniq("r")}@test.local`, phoneWhatsapp: `0819${Date.now().toString().slice(-7)}${seq++}`, planId: f.memberPlan.id },
  });
  const { memberId } = await added.json();
  const marker = new Date();
  const res = await request.post(`${baseURL}/api/${f.slug}/members/${memberId}/remind`, { data: channel ? { channel } : {} });
  const logs = await prisma.notificationLog.findMany({ where: { gymId: f.gym.id, memberId, sentAt: { gte: marker } } });
  return { res, logs: logs.map((l) => `${l.channel}:${l.status}`).sort() };
}

test("automatic messages go by email only; the switches turn email, and the WhatsApp buttons, on and off", async ({ request, baseURL }) => {
  const f = await makeGym();
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });

  // Email is on by default and WhatsApp is never automatic.
  expect(await addMember(request, baseURL!, f)).toEqual(["email:SENT"]);

  // The WhatsApp switch only governs the send buttons, so it changes nothing about automatic messages.
  expect((await setChannels(request, baseURL!, f.slug, { notifyWhatsapp: false })).ok()).toBeTruthy();
  expect(await addMember(request, baseURL!, f)).toEqual(["email:SENT"]);

  expect((await setChannels(request, baseURL!, f.slug, { notifyEmail: false })).ok()).toBeTruthy();
  expect(await addMember(request, baseURL!, f)).toEqual([]);

  const settings = (await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).settings as Record<string, unknown>;
  expect(settings.notifyWhatsapp).toBe(false);
  expect(settings.notifyEmail).toBe(false);

  expect((await setChannels(request, baseURL!, f.slug, { notifyEmail: true, notifyWhatsapp: true })).ok()).toBeTruthy();
  expect(await addMember(request, baseURL!, f)).toEqual(["email:SENT"]);
});

test("a send button sends on the channel the person picks", async ({ request, baseURL }) => {
  const f = await makeGym();
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });

  const wa = await remind(request, baseURL!, f, "whatsapp");
  expect(wa.res.ok()).toBeTruthy();
  expect(wa.logs).toEqual(["whatsapp:SENT"]);

  const mail = await remind(request, baseURL!, f, "email");
  expect(mail.res.ok()).toBeTruthy();
  expect(mail.logs).toEqual(["email:SENT"]);

  // Email still works from the button when automatic email is switched off.
  await setChannels(request, baseURL!, f.slug, { notifyEmail: false });
  expect((await remind(request, baseURL!, f, "email")).logs).toEqual(["email:SENT"]);

  // WhatsApp switched off: the button says so instead of silently doing nothing.
  await setChannels(request, baseURL!, f.slug, { notifyWhatsapp: false });
  const off = await remind(request, baseURL!, f, "whatsapp");
  expect(off.res.status()).toBe(409);
  expect((await off.res.json()).error).toContain("WhatsApp");
  expect(off.logs).toEqual([]);

  // A bounced address is reported, not hidden.
  const bounce = await request.post(`${baseURL}/api/${f.slug}/members`, {
    data: { fullName: "Bounce", email: `${uniq("b")}+bounce@test.local`, phoneWhatsapp: `0819${Date.now().toString().slice(-7)}${seq++}`, planId: f.memberPlan.id },
  });
  const { memberId } = await bounce.json();
  const failed = await request.post(`${baseURL}/api/${f.slug}/members/${memberId}/remind`, { data: { channel: "email" } });
  expect(failed.status()).toBe(409);
  expect((await failed.json()).error).toContain("email couldn't be sent");
});

test("a bounced email is logged FAILED", async ({ request, baseURL }) => {
  const f = await makeGym();
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });

  expect(await addMember(request, baseURL!, f, `${uniq("x")}+bounce@test.local`)).toEqual(["email:FAILED"]);
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
  await addMember(request, baseURL!, f);
  await remind(request, baseURL!, f, "whatsapp");

  const html = (await (await request.get(`${baseURL}/${f.slug}/settings`)).text()).replace(/<!-- -->/g, "");
  expect(html).toContain("Email members automatically");
  expect(html).toContain("Allow WhatsApp from the send buttons");
  expect(html).toContain(">email<");
  expect(html).toContain(">WhatsApp<");
});

test("a staff password link goes by the channel the owner picks, and says when it couldn't", async ({ request, baseURL }) => {
  const f = await makeGym();
  const staff = await prisma.staffUser.create({
    data: { gymId: f.gym.id, name: "Staffer", email: `staff-${f.slug}@test.local`, phone: "081200007777", passwordHash: await bcrypt.hash("staff-pass-123", 10), role: "STAFF" },
  });
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });

  const byEmail = await request.post(`${baseURL}/api/${f.slug}/staff/${staff.id}/reset-link`, { data: { channel: "email" } });
  expect(byEmail.ok()).toBeTruthy();
  const emailBody = await byEmail.json();
  expect(emailBody.url).toContain("/reset/");
  expect(emailBody.sendError).toBeNull();
  const logs = await prisma.notificationLog.findMany({ where: { gymId: f.gym.id, type: "staff_password_reset" } });
  expect(logs.map((l) => `${l.channel}:${l.status}`)).toEqual(["email:SENT"]);

  // WhatsApp from the button goes to the phone on file...
  const byWhatsapp = await request.post(`${baseURL}/api/${f.slug}/staff/${staff.id}/reset-link`, { data: { channel: "whatsapp" } });
  expect((await byWhatsapp.json()).sendError).toBeNull();
  expect((await prisma.notificationLog.count({ where: { gymId: f.gym.id, type: "staff_password_reset", channel: "whatsapp" } }))).toBe(1);

  // ...and a person with no phone gets a plain explanation instead of silence.
  const noPhone = await prisma.staffUser.create({
    data: { gymId: f.gym.id, name: "No Phone", email: `nophone-${f.slug}@test.local`, passwordHash: await bcrypt.hash("staff-pass-123", 10), role: "STAFF" },
  });
  const missing = await request.post(`${baseURL}/api/${f.slug}/staff/${noPhone.id}/reset-link`, { data: { channel: "whatsapp" } });
  expect(missing.ok()).toBeTruthy();
  expect((await missing.json()).sendError).toContain("WhatsApp");
});

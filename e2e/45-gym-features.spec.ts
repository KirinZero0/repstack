import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma, superadminLoginUI } from "./helpers";
import { encrypt } from "../src/lib/crypto";
import { dayKeyInTimezone } from "../src/lib/date";
import { ticketTokenFor } from "../src/lib/guestPass";
import { gymFeatures } from "../src/config/features";

const HOUR = 60 * 60 * 1000;
const TZ = "Asia/Jakarta";
const DAY = dayKeyInTimezone(new Date(Date.now() + 50 * HOUR), TZ);
let seq = 0;
const uniq = (t: string) => `${t}-${Date.now()}-${seq++}`;
const ip = () => `10.45.${seq++ % 250}.${Math.floor(Math.random() * 250)}`;
const phoneN = () => `0814${Date.now().toString().slice(-6)}${seq++}`;

async function makeGym(features?: object) {
  const tag = uniq("feat");
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const gym = await prisma.gym.create({
    data: { name: `Feature Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE", settings: { notifyEmail: true, keepMe: "yes" }, ...(features ? { features } : {}) },
  });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  return { gym, owner, staff, slug: tag };
}
type Gym = Awaited<ReturnType<typeof makeGym>>;

async function ctx(playwright: { request: { newContext(o?: object): Promise<APIRequestContext> } }) {
  return playwright.request.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip() } });
}
async function asOwner(playwright: Parameters<typeof ctx>[0], baseURL: string, f: Gym, who: "owner" | "staff" = "owner") {
  const c = await ctx(playwright);
  expect((await c.post(`${baseURL}/api/${f.slug}/login`, { data: f[who] })).ok()).toBeTruthy();
  return c;
}
async function asSuperadmin(playwright: Parameters<typeof ctx>[0], baseURL: string) {
  const c = await ctx(playwright);
  expect((await c.post(`${baseURL}/api/superadmin/login`, { data: { email: "superadmin@test.local", password: "superadmin-pass-123" } })).ok()).toBeTruthy();
  return c;
}
const setFeature = (c: APIRequestContext, baseURL: string, gymId: string, enabled: boolean, feature = "fieldBooking") =>
  c.post(`${baseURL}/api/superadmin/gyms/${gymId}/features`, { data: { feature, enabled } });

test("features default to off, and only known ones are listed", () => {
  expect(gymFeatures({})).toEqual({ fieldBooking: false });
  expect(gymFeatures(null)).toEqual({ fieldBooking: false });
  expect(gymFeatures({ fieldBooking: true })).toEqual({ fieldBooking: true });
  expect(gymFeatures({ fieldBooking: "yes", nonsense: true })).toEqual({ fieldBooking: false });
});

test("without the feature, field booking is closed on every side but what already happened stays manageable", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const owner = await asOwner(playwright, baseURL!, f);
  const anon = await ctx(playwright);
  const field = await prisma.field.create({ data: { gymId: f.gym.id, name: "Court 1", pricePerHour: 60000, opensAt: 0, closesAt: 1440, stepMinutes: 30 } });

  // Public: nothing to see or book.
  expect((await anon.get(`${baseURL}/api/${f.slug}/fields/${field.id}/availability?date=${DAY}`)).status()).toBe(404);
  const asked = await anon.post(`${baseURL}/api/${f.slug}/field-bookings`, { data: { fieldId: field.id, date: DAY, start: "10:00", end: "11:00", fullName: "Budi Santoso", phone: phoneN(), email: "b@guest.test" } });
  expect(asked.status()).toBe(404);
  expect(await prisma.fieldBooking.count({ where: { gymId: f.gym.id } })).toBe(0);
  const page = await (await anon.get(`${baseURL}/${f.slug}/book`)).text();
  expect(page).toContain("no fields open for booking");
  expect(await (await anon.get(`${baseURL}/${f.slug}`)).text()).not.toContain("Book a field");

  // Staff: can't set up fields, add bookings or approve; the page says why, and the menu has no Fields.
  expect((await owner.post(`${baseURL}/api/${f.slug}/fields`, { data: { name: "Court 2", sport: "Badminton", pricePerHour: 1000, opensAt: "08:00", closesAt: "22:00", stepMinutes: 30 } })).status()).toBe(403);
  expect((await owner.patch(`${baseURL}/api/${f.slug}/fields/${field.id}`, { data: { pricePerHour: 1 } })).status()).toBe(403);
  expect((await owner.post(`${baseURL}/api/${f.slug}/field-bookings/manual`, { data: { fieldId: field.id, date: DAY, start: "10:00", end: "11:00", fullName: "Walk In" } })).status()).toBe(403);
  const fieldsPage = await (await owner.get(`${baseURL}/${f.slug}/fields`)).text();
  expect(fieldsPage).toContain("isn&#x27;t enabled");
  const dash = await (await owner.get(`${baseURL}/${f.slug}/dashboard`)).text();
  expect(dash).not.toContain(`href="/${f.slug}/fields"`);

  // A booking made earlier can still be approved? No (that takes a new booking), but cancelling and declining still work.
  const mk = (status: "PENDING_REVIEW" | "APPROVED", h: number) =>
    prisma.fieldBooking.create({
      data: { gymId: f.gym.id, fieldId: field.id, startsAt: new Date(Date.now() + h * HOUR), endsAt: new Date(Date.now() + (h + 1) * HOUR), fullName: "Earlier", phoneWhatsapp: encrypt("081200000000"), phoneWhatsappLookup: `e${h}`, amount: 0, status },
    });
  const pending = await mk("PENDING_REVIEW", 60);
  const held = await mk("APPROVED", 70);
  expect((await owner.post(`${baseURL}/api/${f.slug}/field-bookings/${pending.id}`, { data: { action: "approve" } })).status()).toBe(403);
  expect((await owner.post(`${baseURL}/api/${f.slug}/field-bookings/${pending.id}`, { data: { action: "reject" } })).ok()).toBeTruthy();
  expect((await owner.post(`${baseURL}/api/${f.slug}/field-bookings/${held.id}`, { data: { action: "cancel" } })).ok()).toBeTruthy();
});

test("a superadmin grants and withdraws the feature, and it takes effect straight away and is audited", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const admin = await asSuperadmin(playwright, baseURL!);
  const owner = await asOwner(playwright, baseURL!, f);
  const anon = await ctx(playwright);

  expect((await setFeature(admin, baseURL!, f.gym.id, true)).ok()).toBeTruthy();
  expect(gymFeatures((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).features).fieldBooking).toBe(true);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { gymId: f.gym.id, action: "GYM_FEATURE_CHANGED" }, orderBy: { createdAt: "desc" } });
  expect(audit.metadata).toEqual({ feature: "fieldBooking", enabled: true, was: false });

  // The owner can now set up a field, the menu shows it, the public page and home link appear, and a request goes through.
  const made = await owner.post(`${baseURL}/api/${f.slug}/fields`, { data: { name: "Court 1", sport: "Badminton", pricePerHour: 60000, opensAt: "08:00", closesAt: "22:00", stepMinutes: 30 } });
  expect(made.status()).toBe(201);
  const { id } = await made.json();
  expect(await (await owner.get(`${baseURL}/${f.slug}/dashboard`)).text()).toContain(`href="/${f.slug}/fields"`);
  expect(await (await anon.get(`${baseURL}/${f.slug}`)).text()).toContain("Book a field");
  expect(await (await anon.get(`${baseURL}/${f.slug}/book`)).text()).toContain("Court 1");
  const ask = (start: string) => anon.post(`${baseURL}/api/${f.slug}/field-bookings`, { data: { fieldId: id, date: DAY, start, end: "12:00", fullName: "Budi Santoso", phone: phoneN(), email: "b@guest.test" } });
  expect((await ask("10:00")).status()).toBe(201);
  const booking = await prisma.fieldBooking.findFirstOrThrow({ where: { fieldId: id } });
  expect((await owner.post(`${baseURL}/api/${f.slug}/field-bookings/${booking.id}`, { data: { action: "approve" } })).ok()).toBeTruthy();

  // Withdrawn: new requests stop, the approved booking's ticket still works and still scans, and it can be cancelled.
  expect((await setFeature(admin, baseURL!, f.gym.id, false)).ok()).toBeTruthy();
  expect((await ask("14:00")).status()).toBe(404);
  expect(await (await owner.get(`${baseURL}/${f.slug}/dashboard`)).text()).not.toContain(`href="/${f.slug}/fields"`);
  const token = ticketTokenFor(await prisma.fieldBooking.findUniqueOrThrow({ where: { id: booking.id } }));
  expect(await (await anon.get(`${baseURL}/ticket/${token}`)).text()).toContain("Ticket QR code");
  expect((await owner.post(`${baseURL}/api/${f.slug}/field-bookings/${booking.id}`, { data: { action: "cancel" } })).ok()).toBeTruthy();
  // Its data stays: the field and the booking are still there.
  expect(await prisma.field.count({ where: { gymId: f.gym.id } })).toBe(1);
  expect((await prisma.auditLog.findMany({ where: { gymId: f.gym.id, action: "GYM_FEATURE_CHANGED" } })).map((a) => (a.metadata as { enabled: boolean }).enabled).sort()).toEqual([false, true]);
});

test("only a superadmin can change features or another gym's settings; the owner can't grant themselves anything", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const other = await makeGym();
  const owner = await asOwner(playwright, baseURL!, f);
  const staff = await asOwner(playwright, baseURL!, f, "staff");
  const otherOwner = await asOwner(playwright, baseURL!, other);
  const anon = await ctx(playwright);
  const admin = await asSuperadmin(playwright, baseURL!);

  for (const c of [anon, owner, staff, otherOwner]) {
    expect((await setFeature(c, baseURL!, f.gym.id, true)).status()).toBe(401);
    expect((await c.post(`${baseURL}/api/superadmin/gyms/${f.gym.id}/settings`, { data: { name: "Hijacked" } })).status()).toBe(401);
  }
  // Nor through the page.
  const page = await owner.get(`${baseURL}/superadmin/gyms/${f.gym.id}`, { maxRedirects: 0 });
  expect([307, 308, 302]).toContain(page.status());
  expect(await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } }).then((g) => g.name)).toBe(f.gym.name);

  // The owner's own settings route ignores a features key: it can't grant itself the feature.
  const own = await owner.post(`${baseURL}/api/${f.slug}/settings`, { data: { features: { fieldBooking: true } } });
  expect(own.status()).toBe(400);
  const mixed = await owner.post(`${baseURL}/api/${f.slug}/settings`, { data: { description: "Hello", features: { fieldBooking: true } } });
  expect(mixed.ok()).toBeTruthy();
  const row = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(row.description).toBe("Hello");
  expect(gymFeatures(row.features).fieldBooking).toBe(false);

  // Bad input to the superadmin routes is refused.
  expect((await setFeature(admin, baseURL!, f.gym.id, true, "teleport")).status()).toBe(400);
  expect((await admin.post(`${baseURL}/api/superadmin/gyms/${f.gym.id}/features`, { data: { feature: "fieldBooking", enabled: "yes" } })).status()).toBe(400);
  expect((await setFeature(admin, baseURL!, "00000000-0000-0000-0000-000000000000", true)).status()).toBe(404);
  // Granting one gym leaves the others alone.
  expect((await setFeature(admin, baseURL!, f.gym.id, true)).ok()).toBeTruthy();
  expect(gymFeatures((await prisma.gym.findUniqueOrThrow({ where: { id: other.gym.id } })).features).fieldBooking).toBe(false);
});

test("a superadmin changes a gym's settings like the owner would, keeps the rest, and the log has keys not values", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const admin = await asSuperadmin(playwright, baseURL!);
  const owner = await asOwner(playwright, baseURL!, f);
  const post = (data: object) => admin.post(`${baseURL}/api/superadmin/gyms/${f.gym.id}/settings`, { data });

  expect((await post({ name: "Renamed By Admin", timezone: "Asia/Makassar", notifyEmail: false, acceptSignups: true, bankName: "BCA", bankAccountNumber: "1234567890", bankAccountHolder: "Gym Owner" })).ok()).toBeTruthy();
  const row = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect([row.name, row.timezone, row.bankName, row.bankAccountNumber]).toEqual(["Renamed By Admin", "Asia/Makassar", "BCA", "1234567890"]);
  const settings = row.settings as Record<string, unknown>;
  expect(settings.notifyEmail).toBe(false);
  expect(settings.acceptSignups).toBe(true);
  expect(settings.keepMe).toBe("yes"); // what was already there is kept

  // The owner sees the change on their own side, and the same validation applies.
  expect(await (await owner.get(`${baseURL}/${f.slug}/settings`)).text()).toContain("Renamed By Admin");
  expect((await post({ timezone: "Mars/Olympus" })).status()).toBe(400);
  expect((await post({ checkinsPerDay: 99 })).status()).toBe(400);
  expect((await post({})).status()).toBe(400);
  expect((await admin.post(`${baseURL}/api/superadmin/gyms/00000000-0000-0000-0000-000000000000/settings`, { data: { name: "Nobody" } })).status()).toBe(404);

  const audit = await prisma.auditLog.findFirstOrThrow({ where: { gymId: f.gym.id, action: "GYM_SETTINGS_CHANGED" }, orderBy: { createdAt: "desc" } });
  expect((audit.metadata as { keys: string[] }).keys.sort()).toEqual(["acceptSignups", "bankAccountHolder", "bankAccountNumber", "bankName", "name", "notifyEmail", "timezone"]);
  expect(JSON.stringify(audit.metadata)).not.toContain("1234567890");
});

test("the superadmin gym page shows the features and settings, and a toggle works; the owner sees what is on", async ({ page, baseURL }) => {
  const f = await makeGym();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip() });
  await superadminLoginUI(page, baseURL!);
  await page.goto(`${baseURL}/superadmin/gyms`);
  await page.locator("tr", { hasText: f.gym.name }).getByRole("link", { name: "Settings" }).click();
  await page.waitForURL(`${baseURL}/superadmin/gyms/${f.gym.id}`);
  await expect(page.getByRole("heading", { name: f.gym.name })).toBeVisible();

  const box = page.getByRole("checkbox", { name: "Field booking" });
  await expect(box).not.toBeChecked();
  await box.check();
  await expect.poll(async () => gymFeatures((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).features).fieldBooking).toBe(true);
  await expect(page.getByText("granted", { exact: false }).first()).toBeVisible();

  // A settings form on this page changes that gym, not the superadmin's own anything.
  await page.getByLabel("Gym name").fill("Renamed In The Panel");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).name).toBe("Renamed In The Panel");

  // The owner's Settings page lists the feature as on.
  await page.goto(`${baseURL}/${f.slug}/login`);
  await page.getByLabel("Email").fill(f.owner.email);
  await page.getByLabel("Password").fill(f.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${baseURL}/${f.slug}/dashboard`);
  await page.goto(`${baseURL}/${f.slug}/settings`);
  await expect(page.getByTestId("features-list")).toContainText("Field booking");
  await expect(page.getByTestId("features-list")).toContainText("On");
});

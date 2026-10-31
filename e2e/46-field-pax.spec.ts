import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { encrypt } from "../src/lib/crypto";
import { dayKeyInTimezone } from "../src/lib/date";
import { ticketTokenFor } from "../src/lib/guestPass";
import { bookingAmount, bookingInstants, clock } from "../src/lib/fieldBooking";

const TZ = "Asia/Jakarta";
const HOUR = 60 * 60 * 1000;
const DAY = dayKeyInTimezone(new Date(Date.now() + 52 * HOUR), TZ);
let seq = 0;
const uniq = (t: string) => `${t}-${Date.now()}-${seq++}`;
const ip = () => `10.46.${seq++ % 250}.${Math.floor(Math.random() * 250)}`;
const phoneN = () => `0815${Date.now().toString().slice(-6)}${seq++}`;
const rp = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;

async function makeGym() {
  const tag = uniq("pax");
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const gym = await prisma.gym.create({ data: { name: `Pax Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE", features: { fieldBooking: true } } });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  return { gym, owner, staff, slug: tag };
}
type Gym = Awaited<ReturnType<typeof makeGym>>;

type Ctx = { request: { newContext(o?: object): Promise<APIRequestContext> } };
async function as(playwright: Ctx, baseURL: string, f: Gym, who: "owner" | "staff") {
  const c = await playwright.request.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip() } });
  expect((await c.post(`${baseURL}/api/${f.slug}/login`, { data: f[who] })).ok()).toBeTruthy();
  return c;
}
const visitor = (playwright: Ctx) => playwright.request.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip() } });

/** A per-person field (Rp 15.000 a person an hour, up to 20 people), open all day in 30-minute steps. */
const paxField = (f: Gym, over: object = {}) =>
  prisma.field.create({ data: { gymId: f.gym.id, name: "Open Play", pricingType: "PER_PAX", pricePerHour: 15000, maxPax: 20, opensAt: 0, closesAt: 1440, stepMinutes: 30, ...over } });

const book = (v: APIRequestContext, baseURL: string, slug: string, fieldId: string, over: Record<string, unknown> = {}) =>
  v.post(`${baseURL}/api/${slug}/field-bookings`, { data: { fieldId, date: DAY, start: "18:00", end: "19:30", fullName: "Budi Santoso", phone: phoneN(), email: "b@guest.test", ...over } });
const act = (c: APIRequestContext, baseURL: string, slug: string, id: string, data: object) => c.post(`${baseURL}/api/${slug}/field-bookings/${id}`, { data });
const latest = (fieldId: string) => prisma.fieldBooking.findFirstOrThrow({ where: { fieldId }, orderBy: { createdAt: "desc" } });
const ledger = async (bookingId: string) => (await prisma.fieldBookingPayment.findMany({ where: { bookingId }, orderBy: { createdAt: "asc" } })).map((p) => `${p.kind}:${Number(p.amount)}`);
const csv = async (c: APIRequestContext, baseURL: string, slug: string) => (await c.get(`${baseURL}/api/${slug}/finance/export?report=transactions`)).text();

test("per-person price maths", () => {
  expect(bookingAmount("PER_PAX", 15000, 10, 90)).toBe(225000);
  expect(bookingAmount("PER_PAX", 15000, 15, 90)).toBe(337500);
  expect(bookingAmount("PER_PAX", 15000, 1, 30)).toBe(7500);
  expect(bookingAmount("PER_FIELD", 60000, 15, 90)).toBe(90000); // people don't matter on a per-field price
  expect(bookingAmount("PER_PAX", 15000, null, 60)).toBe(15000);
});

test("an owner sets a field up per person, with an optional limit", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const owner = await as(playwright, baseURL!, f, "owner");
  const body = { name: "Open Play", sport: "Badminton", pricePerHour: 15000, pricingType: "PER_PAX", maxPax: 20, opensAt: "08:00", closesAt: "22:00", stepMinutes: 30 };
  const made = await owner.post(`${baseURL}/api/${f.slug}/fields`, { data: body });
  expect(made.status()).toBe(201);
  const row = await prisma.field.findUniqueOrThrow({ where: { id: (await made.json()).id } });
  expect([row.pricingType, row.maxPax, Number(row.pricePerHour)]).toEqual(["PER_PAX", 20, 15000]);

  // A per-field price ignores a limit on people; a nonsense limit is refused.
  const flat = await owner.post(`${baseURL}/api/${f.slug}/fields`, { data: { ...body, name: "Court A", pricingType: "PER_FIELD", maxPax: 5 } });
  expect((await prisma.field.findUniqueOrThrow({ where: { id: (await flat.json()).id } })).maxPax).toBeNull();
  expect((await owner.post(`${baseURL}/api/${f.slug}/fields`, { data: { ...body, maxPax: 0 } })).status()).toBe(400);
  expect((await owner.post(`${baseURL}/api/${f.slug}/fields`, { data: { ...body, pricingType: "PER_HOUR" } })).status()).toBe(400);
});

test("the booker says how many people: required, within the limit, and the price follows", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const field = await paxField(f);
  const v = await visitor(playwright);

  expect((await book(v, baseURL!, f.slug, field.id)).status()).toBe(400); // no people given
  expect((await book(v, baseURL!, f.slug, field.id, { pax: 0 })).status()).toBe(400);
  expect((await book(v, baseURL!, f.slug, field.id, { pax: 2.5 })).status()).toBe(400);
  const over = await book(v, baseURL!, f.slug, field.id, { pax: 21 });
  expect(over.status()).toBe(400);
  expect((await over.json()).error).toContain("up to 20");

  expect((await book(v, baseURL!, f.slug, field.id, { pax: 10 })).status()).toBe(201);
  const b = await latest(field.id);
  expect([b.pax, Number(b.rate), Number(b.amount)]).toEqual([10, 15000, 225000]); // 10 people x Rp 15.000 x 1,5 hours

  // A per-field court ignores the people count.
  const court = await prisma.field.create({ data: { gymId: f.gym.id, name: "Court 1", pricePerHour: 60000, opensAt: 0, closesAt: 1440, stepMinutes: 30 } });
  expect((await book(v, baseURL!, f.slug, court.id, { pax: 12 })).status()).toBe(201);
  const flat = await latest(court.id);
  expect([flat.pax, Number(flat.amount)]).toEqual([null, 90000]);
});

test("ten approved, fifteen came: staff change the people, see what is owed, collect it, and Finance counts each payment on its day", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const field = await paxField(f);
  const staff = await as(playwright, baseURL!, f, "staff");
  const owner = await as(playwright, baseURL!, f, "owner");
  const v = await visitor(playwright);
  expect((await book(v, baseURL!, f.slug, field.id, { pax: 10 })).status()).toBe(201);
  const b = await latest(field.id);

  // Before approval the people can be changed and the price follows, with nothing paid yet.
  const early = await act(staff, baseURL!, f.slug, b.id, { action: "edit_pax", pax: 12 });
  expect((await early.json()).amount).toBe(270000);
  expect((await act(staff, baseURL!, f.slug, b.id, { action: "edit_pax", pax: 10 })).ok()).toBeTruthy();

  // Approving is the payment of the booked price.
  expect((await act(staff, baseURL!, f.slug, b.id, { action: "approve" })).ok()).toBeTruthy();
  expect(await ledger(b.id)).toEqual(["PAYMENT:225000"]);

  // Fifteen turn up: staff change it, and the screen says what is owed.
  const edited = await (await act(staff, baseURL!, f.slug, b.id, { action: "edit_pax", pax: 15 })).json();
  expect([edited.amount, edited.paid, edited.balance]).toEqual([337500, 225000, 112500]);
  expect(await ledger(b.id)).toEqual(["PAYMENT:225000"]); // changing the people moves no money by itself
  const page = (await (await staff.get(`${baseURL}/${f.slug}/fields?date=${DAY}`)).text()).replace(/<!-- -->/g, "");
  expect(page).toContain("15 people");
  expect(page).toContain(`owes ${rp(112500)}`);
  expect(page).toContain(`Collect ${rp(112500)}`);

  // Collecting more than is owed is refused; collecting the balance settles it; nothing more is owed after.
  expect((await act(staff, baseURL!, f.slug, b.id, { action: "collect", amount: 200000 })).status()).toBe(400);
  expect((await act(staff, baseURL!, f.slug, b.id, { action: "collect" })).ok()).toBeTruthy();
  expect(await ledger(b.id)).toEqual(["PAYMENT:225000", "COLLECTION:112500"]);
  expect((await act(staff, baseURL!, f.slug, b.id, { action: "collect" })).status()).toBe(409);
  expect((await (await staff.get(`${baseURL}/${f.slug}/fields?date=${DAY}`)).text())).not.toContain("owes");

  // Finance has both payments as revenue, the second marked as the extra it was.
  const rows = await csv(owner, baseURL!, f.slug);
  expect(rows).toContain("225000");
  expect(rows).toContain("112500");
  expect(rows).toContain("Extra collected");
  expect(rows.split("\n").filter((l) => l.includes("Open Play"))).toHaveLength(2);
});

test("fewer people than booked: the guest is owed money back, and only the owner can record the refund", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const field = await paxField(f);
  const staff = await as(playwright, baseURL!, f, "staff");
  const owner = await as(playwright, baseURL!, f, "owner");
  expect((await book(await visitor(playwright), baseURL!, f.slug, field.id, { pax: 15 })).status()).toBe(201);
  const b = await latest(field.id);
  await act(staff, baseURL!, f.slug, b.id, { action: "approve" });
  expect(await ledger(b.id)).toEqual(["PAYMENT:337500"]);

  const less = await (await act(staff, baseURL!, f.slug, b.id, { action: "edit_pax", pax: 8 })).json();
  expect([less.amount, less.balance]).toEqual([180000, -157500]);
  const page = (await (await staff.get(`${baseURL}/${f.slug}/fields?date=${DAY}`)).text()).replace(/<!-- -->/g, "");
  expect(page).toContain(`refund due ${rp(157500)}`);
  // Staff can't give money back; the owner can, once, for no more than is owed.
  expect((await act(staff, baseURL!, f.slug, b.id, { action: "refund" })).status()).toBe(403);
  expect((await act(owner, baseURL!, f.slug, b.id, { action: "refund", amount: 999999 })).status()).toBe(400);
  expect((await act(owner, baseURL!, f.slug, b.id, { action: "refund" })).ok()).toBeTruthy();
  expect(await ledger(b.id)).toEqual(["PAYMENT:337500", "REFUND:-157500"]);
  expect((await act(owner, baseURL!, f.slug, b.id, { action: "refund" })).status()).toBe(409);

  // Revenue nets to what the booking really cost: 337.500 in, 157.500 out.
  const rows = (await csv(owner, baseURL!, f.slug)).split("\n").filter((l) => l.includes("Open Play"));
  expect(rows).toHaveLength(2);
  expect(rows.join("\n")).toContain("-157500");
  expect(rows.join("\n")).toContain("Refund");
});

test("the number of people can only be changed where it makes sense", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const field = await paxField(f);
  const court = await prisma.field.create({ data: { gymId: f.gym.id, name: "Court 1", pricePerHour: 60000, opensAt: 0, closesAt: 1440, stepMinutes: 30 } });
  const staff = await as(playwright, baseURL!, f, "staff");
  const v = await visitor(playwright);
  expect((await book(v, baseURL!, f.slug, field.id, { pax: 6 })).status()).toBe(201);
  const b = await latest(field.id);
  expect((await act(staff, baseURL!, f.slug, b.id, { action: "edit_pax" })).status()).toBe(400);
  expect((await act(staff, baseURL!, f.slug, b.id, { action: "edit_pax", pax: 0 })).status()).toBe(400);
  expect((await act(staff, baseURL!, f.slug, b.id, { action: "reject" })).ok()).toBeTruthy();
  expect((await act(staff, baseURL!, f.slug, b.id, { action: "edit_pax", pax: 7 })).status()).toBe(409); // declined

  // A per-field booking has no people to change.
  expect((await book(v, baseURL!, f.slug, court.id)).status()).toBe(201);
  expect((await act(staff, baseURL!, f.slug, (await latest(court.id)).id, { action: "edit_pax", pax: 3 })).status()).toBe(409);

  // The booking keeps the rate it was made at, even if the field's price changes afterwards.
  expect((await book(v, baseURL!, f.slug, field.id, { pax: 10, start: "20:00", end: "21:00" })).status()).toBe(201);
  const keep = await latest(field.id);
  await prisma.field.update({ where: { id: field.id }, data: { pricePerHour: 40000 } });
  const edited = await (await act(staff, baseURL!, f.slug, keep.id, { action: "edit_pax", pax: 12 })).json();
  expect(edited.amount).toBe(180000); // 12 x Rp 15.000, not Rp 40.000
});

test("the scan tells the desk how many people and what is still owed", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const field = await paxField(f);
  const staff = await as(playwright, baseURL!, f, "staff");
  const nowLocal = new Date(Date.now() + 7 * HOUR);
  const startMin = Math.min(Math.floor((nowLocal.getUTCHours() * 60 + nowLocal.getUTCMinutes()) / 30) * 30, 1440 - 60);
  const today = dayKeyInTimezone(new Date(), TZ);
  const made = await staff.post(`${baseURL}/api/${f.slug}/field-bookings/manual`, { data: { fieldId: field.id, date: today, start: clock(startMin), end: clock(startMin + 60), fullName: "Walk In", phone: phoneN(), pax: 10 } });
  expect(made.status()).toBe(201);
  const b = await prisma.fieldBooking.findFirstOrThrow({ where: { fieldId: field.id } });
  expect([b.pax, Number(b.amount)]).toEqual([10, 150000]);
  expect(await ledger(b.id)).toEqual(["PAYMENT:150000"]); // paid at the counter
  // A manual booking on a per-person field must say how many.
  expect((await staff.post(`${baseURL}/api/${f.slug}/field-bookings/manual`, { data: { fieldId: field.id, date: today, start: "01:00", end: "02:00", fullName: "No Count" } })).status()).toBe(400);

  await act(staff, baseURL!, f.slug, b.id, { action: "edit_pax", pax: 12 });
  const scan = await (await staff.post(`${baseURL}/api/checkin`, { data: { token: ticketTokenFor(b) } })).json();
  expect(scan.result).toBe("SUCCESS");
  expect(scan.message).toContain("12 people");
  expect(scan.message).toContain(`owes ${rp(30000)}`);
  // Still editable after the scan (they came), and collectable.
  expect((await act(staff, baseURL!, f.slug, b.id, { action: "edit_pax", pax: 14 })).ok()).toBeTruthy();
  expect((await act(staff, baseURL!, f.slug, b.id, { action: "collect" })).ok()).toBeTruthy();
  expect(await ledger(b.id)).toEqual(["PAYMENT:150000", "COLLECTION:60000"]);
});

test("cancelling a booking that took money is the owner's, and takes all of it out of revenue", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const field = await paxField(f);
  const staff = await as(playwright, baseURL!, f, "staff");
  const owner = await as(playwright, baseURL!, f, "owner");
  expect((await book(await visitor(playwright), baseURL!, f.slug, field.id, { pax: 10 })).status()).toBe(201);
  const b = await latest(field.id);
  await act(staff, baseURL!, f.slug, b.id, { action: "approve" });
  await act(staff, baseURL!, f.slug, b.id, { action: "edit_pax", pax: 12 });
  await act(staff, baseURL!, f.slug, b.id, { action: "collect" });
  expect(await csv(owner, baseURL!, f.slug)).toContain("Open Play");

  expect((await act(staff, baseURL!, f.slug, b.id, { action: "cancel" })).status()).toBe(403);
  expect((await act(owner, baseURL!, f.slug, b.id, { action: "cancel" })).ok()).toBeTruthy();
  expect(await csv(owner, baseURL!, f.slug)).not.toContain("Open Play");
  // Neither deleted nor changed afterwards; the entries stay on record.
  expect((await owner.delete(`${baseURL}/api/${f.slug}/field-bookings/${b.id}`)).status()).toBe(409);
  expect((await act(owner, baseURL!, f.slug, b.id, { action: "edit_pax", pax: 3 })).status()).toBe(409);
  expect(await ledger(b.id)).toEqual(["PAYMENT:225000", "COLLECTION:45000"]);
});

test("the public form asks for people on a per-person field and shows the price; staff edit and collect from the page", async ({ page, baseURL }) => {
  const f = await makeGym();
  await paxField(f);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip() });

  await page.goto(`${baseURL}/${f.slug}/book`);
  await page.getByLabel("Day").fill(DAY);
  await expect(page.getByLabel("How many people")).toBeVisible();
  await page.getByLabel("From").selectOption({ label: "18:00" });
  await page.getByLabel("Until").selectOption({ label: "19:00 (1h)" });
  await page.getByLabel("How many people").fill("10");
  await expect(page.getByTestId("booking-price")).toContainText("10 people");
  await expect(page.getByTestId("booking-price")).toContainText("150.000");
  await page.getByLabel("Your name").fill("Siti Rahma");
  await page.getByLabel("WhatsApp number").fill(phoneN());
  await page.getByLabel("Email").fill("siti@guest.test");
  await page.getByRole("button", { name: "Request this time" }).click();
  await expect(page.getByTestId("booking-request-sent")).toBeVisible();

  await page.goto(`${baseURL}/${f.slug}/login`);
  await page.getByLabel("Email").fill(f.staff.email);
  await page.getByLabel("Password").fill(f.staff.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${baseURL}/${f.slug}/dashboard`);
  await page.goto(`${baseURL}/${f.slug}/fields?date=${DAY}`);
  const request = page.getByTestId("booking-request").filter({ hasText: "Siti Rahma" });
  await expect(request).toContainText("10 people");
  await request.getByRole("button", { name: "Payment received, approve" }).click();
  const row = page.getByTestId("booking-row").filter({ hasText: "Siti Rahma" });
  await expect(row).toContainText("10 people");

  page.once("dialog", (d) => d.accept("15"));
  await row.getByRole("button", { name: "Edit people" }).click();
  await expect(row.getByTestId("owes")).toContainText("75.000");
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: /Collect/ }).click();
  await expect(row.getByTestId("owes")).toHaveCount(0);
  await expect(row).toContainText("paid");
  const b = await prisma.fieldBooking.findFirstOrThrow({ where: { gymId: f.gym.id } });
  expect(await ledger(b.id)).toEqual(["PAYMENT:150000", "COLLECTION:75000"]);
});

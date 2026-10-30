import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { encrypt } from "../src/lib/crypto";
import { ticketTokenFor } from "../src/lib/guestPass";
import { dayKeyInTimezone } from "../src/lib/date";
import { bookingInstants, bookingPrice, busyRanges, clock, freeRanges, parseClock, timeProblem } from "../src/lib/fieldBooking";

/** A properly encrypted number, for rows made straight in the database (the staff page decrypts them). */
const PHONE_ENC = encrypt("081200000000");
const TZ = "Asia/Jakarta";
const HOUR = 60 * 60 * 1000;
let seq = 0;
const uniq = (t: string) => `${t}-${Date.now()}-${seq++}`;
const ip = () => `10.44.${seq++ % 250}.${Math.floor(Math.random() * 250)}`;
const phoneN = () => `0813${Date.now().toString().slice(-6)}${seq++}`;
/** A day far enough ahead that every test time is in the future, whatever time the suite runs. */
const DAY = dayKeyInTimezone(new Date(Date.now() + 50 * HOUR), TZ);
const DAY2 = dayKeyInTimezone(new Date(Date.now() + 74 * HOUR), TZ);

async function makeGym() {
  const tag = uniq("fld");
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const gym = await prisma.gym.create({ data: { name: `Field Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE", features: { fieldBooking: true } } });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  return { gym, owner, staff, slug: tag };
}
type Gym = Awaited<ReturnType<typeof makeGym>>;

async function login(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  expect((await request.post(`${baseURL}/api/${slug}/login`, { data: who, headers: { "x-forwarded-for": ip() } })).ok()).toBeTruthy();
}

/** A field open all day in 30-minute steps, at Rp 60.000 an hour, made straight in the database. */
async function makeField(f: Gym, over: { name?: string; price?: number } = {}) {
  return prisma.field.create({ data: { gymId: f.gym.id, name: over.name ?? "Court 1", pricePerHour: over.price ?? 60000, opensAt: 0, closesAt: 1440, stepMinutes: 30 } });
}

async function visitor(playwright: { request: { newContext(o?: object): Promise<APIRequestContext> } }) {
  return playwright.request.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip() } });
}

async function book(
  v: APIRequestContext,
  baseURL: string,
  slug: string,
  fieldId: string,
  start: string,
  end: string,
  over: Partial<{ date: string; fullName: string; phone: string; email: string }> = {},
) {
  return v.post(`${baseURL}/api/${slug}/field-bookings`, {
    data: { fieldId, date: over.date ?? DAY, start, end, fullName: over.fullName ?? "Budi Santoso", phone: over.phone ?? phoneN(), email: over.email ?? "budi@guest.test" },
  });
}

const act = (request: APIRequestContext, baseURL: string, slug: string, id: string, action: string, channel?: string) =>
  request.post(`${baseURL}/api/${slug}/field-bookings/${id}`, { data: channel ? { action, channel } : { action } });

const latest = (fieldId: string) => prisma.fieldBooking.findFirstOrThrow({ where: { fieldId }, orderBy: { createdAt: "desc" } });

test("time maths: ranges, price, free stretches and the rules a booking must meet", () => {
  expect(parseClock("07:30")).toBe(450);
  expect(parseClock("24:00")).toBe(1440);
  expect(parseClock("25:00")).toBeNull();
  expect(parseClock("7:30")).toBeNull();
  expect(clock(450)).toBe("07:30");
  expect(bookingPrice(60000, 90)).toBe(90000);
  expect(bookingPrice(50000, 45)).toBe(37500);
  // 24:00 is midnight at the end of the day.
  const { startsAt, endsAt } = bookingInstants("2030-01-10", 22 * 60, 24 * 60, TZ);
  expect(endsAt.getTime() - startsAt.getTime()).toBe(2 * HOUR);

  const rules = { opensAt: 480, closesAt: 1320, stepMinutes: 30, pricePerHour: 60000 };
  const now = new Date("2030-01-01T00:00:00Z");
  expect(timeProblem(rules, "2030-01-10", 600, 660, TZ, now)).toBeNull();
  expect(timeProblem(rules, "2030-01-10", 610, 660, TZ, now)).toMatch(/30-minute/);
  expect(timeProblem(rules, "2030-01-10", 660, 600, TZ, now)).toMatch(/after the start/);
  expect(timeProblem(rules, "2030-01-10", 420, 540, TZ, now)).toMatch(/open 08:00 to 22:00/);
  expect(timeProblem(rules, "2030-01-10", 600, 600 + 7 * 60, TZ, now)).toMatch(/at most 6 hours/);
  expect(timeProblem(rules, "2029-12-31", 600, 660, TZ, now)).toMatch(/already started/);
  expect(timeProblem(rules, "2030-06-10", 600, 660, TZ, now)).toMatch(/days ahead/);

  // Bookings that touch share no time; free stretches are what is left of the open day.
  const day = "2030-01-10";
  const at = (s: number, e: number) => bookingInstants(day, s, e, TZ);
  const busy = busyRanges([at(600, 660), at(660, 720), at(900, 960)], day, TZ);
  expect(busy).toEqual([{ start: 600, end: 660 }, { start: 660, end: 720 }, { start: 900, end: 960 }]);
  expect(freeRanges(rules, busy)).toEqual([{ start: 480, end: 600 }, { start: 720, end: 900 }, { start: 960, end: 1320 }]);
});

test("only the owner sets up fields, and bad opening hours are refused", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  await login(request, baseURL!, f.slug, f.staff);
  const body = { name: "Court 1", sport: "Badminton", pricePerHour: 60000, opensAt: "08:00", closesAt: "22:00", stepMinutes: 30 };
  expect((await request.post(`${baseURL}/api/${f.slug}/fields`, { data: body })).status()).toBe(403);

  await request.post(`${baseURL}/api/${f.slug}/staff-logout`);
  await login(request, baseURL!, f.slug, f.owner);
  const made = await request.post(`${baseURL}/api/${f.slug}/fields`, { data: body });
  expect(made.status()).toBe(201);
  const { id } = await made.json();
  const row = await prisma.field.findUniqueOrThrow({ where: { id } });
  expect([row.opensAt, row.closesAt, row.stepMinutes, row.gymId]).toEqual([480, 1320, 30, f.gym.id]);

  for (const bad of [
    { ...body, closesAt: "07:00" },
    { ...body, opensAt: "08:10" },
    { ...body, name: "x" },
    { ...body, pricePerHour: -1 },
    { ...body, stepMinutes: 20 },
  ]) {
    expect((await request.post(`${baseURL}/api/${f.slug}/fields`, { data: bad })).status()).toBe(400);
  }

  expect((await request.patch(`${baseURL}/api/${f.slug}/fields/${id}`, { data: { pricePerHour: 75000, isActive: false } })).ok()).toBeTruthy();
  const edited = await prisma.field.findUniqueOrThrow({ where: { id } });
  expect([Number(edited.pricePerHour), edited.isActive]).toEqual([75000, false]);
  // Hours that don't sit on the field's step are refused on edit too.
  expect((await request.patch(`${baseURL}/api/${f.slug}/fields/${id}`, { data: { stepMinutes: 60, opensAt: "08:30" } })).status()).toBe(400);

  // Another gym's owner can't touch it.
  const other = await makeGym();
  const o = await visitor(playwright);
  expect((await o.post(`${baseURL}/api/${other.slug}/login`, { data: other.owner })).ok()).toBeTruthy();
  expect((await o.patch(`${baseURL}/api/${other.slug}/fields/${id}`, { data: { pricePerHour: 1 } })).status()).toBe(404);

  // A field with no bookings can be deleted; one with bookings can't.
  const withBooking = await makeField(f, { name: "Court 2" });
  await prisma.fieldBooking.create({ data: { gymId: f.gym.id, fieldId: withBooking.id, startsAt: new Date(Date.now() + 80 * HOUR), endsAt: new Date(Date.now() + 81 * HOUR), fullName: "X", phoneWhatsapp: PHONE_ENC, phoneWhatsappLookup: "x", amount: 0 } });
  expect((await request.delete(`${baseURL}/api/${f.slug}/fields/${withBooking.id}`)).status()).toBe(409);
  expect((await request.delete(`${baseURL}/api/${f.slug}/fields/${id}`)).ok()).toBeTruthy();
});

test("a request must fit the field's hours and step, be in the future, and be for a real field of this gym", async ({ baseURL, playwright }) => {
  const f = await makeGym();
  const field = await prisma.field.create({ data: { gymId: f.gym.id, name: "Court 1", pricePerHour: 60000, opensAt: 480, closesAt: 1320, stepMinutes: 30 } });
  const v = await visitor(playwright);

  expect((await book(v, baseURL!, f.slug, field.id, "10:00", "11:30")).status()).toBe(201);
  const b = await latest(field.id);
  expect(b.status).toBe("PENDING_REVIEW");
  expect(Number(b.amount)).toBe(90000); // 90 minutes at Rp 60.000 an hour
  // Personal details are stored encrypted, not as typed.
  expect(b.email).not.toContain("@");
  expect(b.phoneWhatsapp.startsWith("v1:")).toBe(true);

  const cases: [string, Awaited<ReturnType<typeof book>>][] = [
    ["not on the step", await book(v, baseURL!, f.slug, field.id, "10:10", "11:30")],
    ["end before start", await book(v, baseURL!, f.slug, field.id, "12:00", "11:00")],
    ["before opening", await book(v, baseURL!, f.slug, field.id, "07:00", "08:30")],
    ["after closing", await book(v, baseURL!, f.slug, field.id, "21:00", "22:30")],
    ["too long", await book(v, baseURL!, f.slug, field.id, "08:00", "15:00")],
    ["in the past", await book(v, baseURL!, f.slug, field.id, "10:00", "11:00", { date: "2020-01-01" })],
    ["no email", await v.post(`${baseURL}/api/${f.slug}/field-bookings`, { data: { fieldId: field.id, date: DAY, start: "10:00", end: "11:00", fullName: "Budi", phone: phoneN() } })],
    ["a link as a name", await book(v, baseURL!, f.slug, field.id, "13:00", "14:00", { fullName: "https://evil.example" })],
    ["a short phone", await book(v, baseURL!, f.slug, field.id, "13:00", "14:00", { phone: "123" })],
  ];
  for (const [label, res] of cases) expect(res.status(), label).toBe(400);

  // Asking again for the same time with the same number is refused; a different number can ask.
  const phone = phoneN();
  expect((await book(v, baseURL!, f.slug, field.id, "15:00", "16:00", { phone })).status()).toBe(201);
  expect((await book(v, baseURL!, f.slug, field.id, "15:00", "16:00", { phone })).status()).toBe(409);
  expect((await book(v, baseURL!, f.slug, field.id, "15:00", "16:00")).status()).toBe(201);

  // Tenant isolation: another gym's field, and a switched-off field, can't be booked through this gym's page.
  const other = await makeGym();
  const foreign = await makeField(other);
  expect((await book(v, baseURL!, f.slug, foreign.id, "10:00", "11:00")).status()).toBe(400);
  await prisma.field.update({ where: { id: field.id }, data: { isActive: false } });
  expect((await book(v, baseURL!, f.slug, field.id, "17:00", "18:00")).status()).toBe(400);
});

test("only an approved booking takes the time: pending ones don't, overlaps are refused, neighbours are fine", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const field = await makeField(f);
  await login(request, baseURL!, f.slug, f.staff);
  const v = await visitor(playwright);
  const avail = async (date = DAY) => (await (await v.get(`${baseURL}/api/${f.slug}/fields/${field.id}/availability?date=${date}`)).json()) as { busy: { start: number; end: number }[]; free: { start: number; end: number }[] };

  // Two people ask for overlapping times: both are accepted as requests, and nothing is busy yet.
  expect((await book(v, baseURL!, f.slug, field.id, "18:00", "20:00")).status()).toBe(201);
  const first = await latest(field.id);
  expect((await book(v, baseURL!, f.slug, field.id, "19:00", "21:00")).status()).toBe(201);
  const second = await latest(field.id);
  expect((await avail()).busy).toEqual([]);

  // Approving the first takes 18:00 to 20:00. The availability shows it, and nobody can ask for it now.
  expect((await act(request, baseURL!, f.slug, first.id, "approve")).ok()).toBeTruthy();
  const a = await avail();
  expect(a.busy).toEqual([{ start: 1080, end: 1200 }]);
  expect(a.free).toEqual([{ start: 0, end: 1080 }, { start: 1200, end: 1440 }]);
  expect((await book(v, baseURL!, f.slug, field.id, "19:30", "20:30")).status()).toBe(409);
  expect((await book(v, baseURL!, f.slug, field.id, "17:00", "18:30")).status()).toBe(409);

  // The other request, which overlaps, can't be approved; declining it works.
  const clash = await act(request, baseURL!, f.slug, second.id, "approve");
  expect(clash.status()).toBe(409);
  expect((await clash.json()).error).toContain("already holds this time");
  expect((await prisma.fieldBooking.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("PENDING_REVIEW");

  // Bookings that touch (17:00 to 18:00, 20:00 to 21:00) are fine on either side.
  expect((await book(v, baseURL!, f.slug, field.id, "17:00", "18:00")).status()).toBe(201);
  expect((await act(request, baseURL!, f.slug, (await latest(field.id)).id, "approve")).ok()).toBeTruthy();
  expect((await book(v, baseURL!, f.slug, field.id, "20:00", "21:00")).status()).toBe(201);
  expect((await act(request, baseURL!, f.slug, (await latest(field.id)).id, "approve")).ok()).toBeTruthy();
  expect((await avail()).busy).toEqual([{ start: 1020, end: 1080 }, { start: 1080, end: 1200 }, { start: 1200, end: 1260 }]);

  // Declining and acting twice are handled.
  expect((await act(request, baseURL!, f.slug, second.id, "reject")).ok()).toBeTruthy();
  expect((await act(request, baseURL!, f.slug, second.id, "reject")).status()).toBe(409);
  expect((await act(request, baseURL!, f.slug, first.id, "approve")).status()).toBe(409);

  // Another day is untouched.
  expect((await avail(DAY2)).busy).toEqual([]);
});

test("two approvals at the same instant: exactly one wins, and the database enforces it", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const field = await makeField(f);
  await login(request, baseURL!, f.slug, f.staff);
  const v = await visitor(playwright);
  const ids: string[] = [];
  for (const [s, e] of [["09:00", "11:00"], ["10:00", "12:00"], ["10:30", "11:30"]]) {
    expect((await book(v, baseURL!, f.slug, field.id, s, e)).status()).toBe(201);
    ids.push((await latest(field.id)).id);
  }
  const results = await Promise.all(ids.map((id) => act(request, baseURL!, f.slug, id, "approve")));
  expect(results.filter((r) => r.ok())).toHaveLength(1);
  expect(results.filter((r) => r.status() === 409)).toHaveLength(2);
  expect(await prisma.fieldBooking.count({ where: { fieldId: field.id, status: "APPROVED" } })).toBe(1);

  // Even a direct write can't double-book: the database refuses it.
  const held = await prisma.fieldBooking.findFirstOrThrow({ where: { fieldId: field.id, status: "APPROVED" } });
  await expect(
    prisma.fieldBooking.create({
      data: { gymId: f.gym.id, fieldId: field.id, startsAt: new Date(held.startsAt.getTime() + 30 * 60000), endsAt: new Date(held.endsAt.getTime() + 30 * 60000), fullName: "Sneaky", phoneWhatsapp: PHONE_ENC, phoneWhatsappLookup: "x", amount: 0, status: "APPROVED" },
    }),
  ).rejects.toThrow();
  // Different fields don't interfere.
  const other = await makeField(f, { name: "Court 2" });
  await expect(
    prisma.fieldBooking.create({ data: { gymId: f.gym.id, fieldId: other.id, startsAt: held.startsAt, endsAt: held.endsAt, fullName: "Fine", phoneWhatsapp: PHONE_ENC, phoneWhatsappLookup: "x", amount: 0, status: "APPROVED" } }),
  ).resolves.toBeTruthy();
});

test("staff can add a booking, block the time, and are told when it clashes", async ({ request, baseURL }) => {
  const f = await makeGym();
  const field = await makeField(f);
  await login(request, baseURL!, f.slug, f.staff);
  const manual = (data: object) => request.post(`${baseURL}/api/${f.slug}/field-bookings/manual`, { data: { fieldId: field.id, date: DAY, ...data } });

  const walkIn = await manual({ start: "08:00", end: "09:30", fullName: "Walk In" });
  expect(walkIn.status()).toBe(201);
  const row = await prisma.fieldBooking.findFirstOrThrow({ where: { fieldId: field.id } });
  expect([row.status, Number(row.amount), row.isBlock]).toEqual(["APPROVED", 90000, false]);

  const block = await manual({ start: "12:00", end: "14:00", isBlock: true, note: "Floor repair" });
  expect(block.status()).toBe(201);
  const blocked = await prisma.fieldBooking.findFirstOrThrow({ where: { fieldId: field.id, isBlock: true } });
  expect([Number(blocked.amount), blocked.status, blocked.note]).toEqual([0, "APPROVED", "Floor repair"]);

  expect((await manual({ start: "09:00", end: "10:00", fullName: "Clash" })).status()).toBe(409);
  expect((await manual({ start: "13:00", end: "15:00", fullName: "Over the block" })).status()).toBe(409);
  expect((await manual({ start: "10:10", end: "11:00", fullName: "Off step" })).status()).toBe(400);
  expect((await manual({ start: "10:00", end: "11:00" })).status()).toBe(400); // a booking needs a name

  // The block takes time on the public page, so no one can ask for it; it isn't revenue and has no ticket.
  const pub = await (await request.get(`${baseURL}/api/${f.slug}/fields/${field.id}/availability?date=${DAY}`)).json();
  expect(pub.busy).toEqual([{ start: 480, end: 570 }, { start: 720, end: 840 }]);
  expect(JSON.stringify(pub)).not.toContain("Walk In");
  expect((await request.get(`${baseURL}/ticket/${ticketTokenFor(blocked)}`)).status()).toBe(200);
  expect(await (await request.get(`${baseURL}/ticket/${ticketTokenFor(blocked)}`)).text()).toContain("isn&#x27;t valid");

  // A block can be removed, and the time is free again.
  expect((await request.delete(`${baseURL}/api/${f.slug}/field-bookings/${blocked.id}`)).ok()).toBeTruthy();
  expect((await manual({ start: "12:00", end: "13:00", fullName: "Now Free" })).status()).toBe(201);
});

test("cancelling frees the time and kills the ticket; a paid cancel is the owner's; paid bookings aren't deleted", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const field = await makeField(f);
  const v = await visitor(playwright);
  await login(request, baseURL!, f.slug, f.staff);
  expect((await book(v, baseURL!, f.slug, field.id, "16:00", "17:00")).status()).toBe(201);
  const b = await latest(field.id);
  expect((await act(request, baseURL!, f.slug, b.id, "approve")).ok()).toBeTruthy();
  const ticket = ticketTokenFor(await prisma.fieldBooking.findUniqueOrThrow({ where: { id: b.id } }));
  expect(await (await request.get(`${baseURL}/ticket/${ticket}`)).text()).toContain("Ticket QR code");

  // A paid booking can't be deleted, and staff can't cancel it.
  expect((await request.delete(`${baseURL}/api/${f.slug}/field-bookings/${b.id}`)).status()).toBe(409);
  const byStaff = await act(request, baseURL!, f.slug, b.id, "cancel");
  expect(byStaff.status()).toBe(403);

  await request.post(`${baseURL}/api/${f.slug}/staff-logout`);
  await login(request, baseURL!, f.slug, f.owner);
  expect((await act(request, baseURL!, f.slug, b.id, "cancel")).ok()).toBeTruthy();
  const after = await prisma.fieldBooking.findUniqueOrThrow({ where: { id: b.id } });
  expect(after.status).toBe("CANCELLED");
  // The old ticket is dead (its secret changed), the time is free, and it no longer counts as revenue.
  expect(await (await request.get(`${baseURL}/ticket/${ticket}`)).text()).toContain("isn&#x27;t valid");
  expect((await book(v, baseURL!, f.slug, field.id, "16:00", "17:00")).status()).toBe(201);
  expect((await act(request, baseURL!, f.slug, b.id, "cancel")).status()).toBe(409);
  const csv = await (await request.get(`${baseURL}/api/${f.slug}/finance/export?report=transactions`)).text();
  expect(csv).not.toContain("Court 1");
});

test("the ticket scan only marks it attended: in the window, once, in the right gym", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const field = await makeField(f);
  await login(request, baseURL!, f.slug, f.staff);
  const scan = async (token: string) => (await request.post(`${baseURL}/api/checkin`, { data: { token } })).json();

  // A booking that is under right now (logged by staff), so its ticket is in its window.
  const nowLocal = new Date(Date.now() + 7 * HOUR); // Jakarta wall clock as UTC fields
  const startMin = Math.floor((nowLocal.getUTCHours() * 60 + nowLocal.getUTCMinutes()) / 30) * 30;
  const today = dayKeyInTimezone(new Date(), TZ);
  const mk = (s: number, e: number, date = today) =>
    request.post(`${baseURL}/api/${f.slug}/field-bookings/manual`, { data: { fieldId: field.id, date, start: clock(s), end: clock(e), fullName: "Walk In", phone: phoneN() } });
  // Wrap near midnight: keep both ends inside the day.
  const s0 = Math.min(startMin, 1440 - 60);
  expect((await mk(s0, s0 + 60)).status()).toBe(201);
  const live = await prisma.fieldBooking.findFirstOrThrow({ where: { fieldId: field.id, startsAt: bookingInstants(today, s0, s0 + 60, TZ).startsAt } });
  const liveToken = ticketTokenFor(live);

  const first = await scan(liveToken);
  expect(first.result).toBe("SUCCESS");
  expect(first.message).toContain("Court 1");
  const done = await prisma.fieldBooking.findUniqueOrThrow({ where: { id: live.id } });
  expect(done.status).toBe("ATTENDED");
  expect(done.attendedAt).not.toBeNull();
  expect((await scan(liveToken)).result).toBe("DUPLICATE");
  // The time stays taken after the guest has come.
  expect((await mk(s0, s0 + 30)).status()).toBe(409);

  // Tomorrow's booking is too early; a booking that has ended is expired; neither changes.
  expect((await book(await visitor(playwright), baseURL!, f.slug, field.id, "10:00", "11:00")).status()).toBe(201);
  const future = await latest(field.id);
  await request.post(`${baseURL}/api/${f.slug}/field-bookings/${future.id}`, { data: { action: "approve" } });
  const early = await scan(ticketTokenFor(future));
  expect(early.result).toBe("INVALID");
  expect(early.message).toContain("Too early");
  const past = await prisma.fieldBooking.create({
    data: { gymId: f.gym.id, fieldId: field.id, startsAt: new Date(Date.now() - 5 * HOUR), endsAt: new Date(Date.now() - 4 * HOUR), fullName: "Late", phoneWhatsapp: PHONE_ENC, phoneWhatsappLookup: "late", amount: 0, status: "APPROVED" },
  });
  const over = await scan(ticketTokenFor(past));
  expect(over.result).toBe("EXPIRED");
  expect((await prisma.fieldBooking.findUniqueOrThrow({ where: { id: past.id } })).status).toBe("APPROVED");
  // ...and staff can mark a no-show once it's over (not before).
  expect((await act(request, baseURL!, f.slug, past.id, "noshow")).ok()).toBeTruthy();
  expect((await act(request, baseURL!, f.slug, future.id, "noshow")).status()).toBe(409);

  // A ticket from another gym is rejected outright, and a forged one too.
  const other = await makeGym();
  const foreignField = await makeField(other);
  const foreign = await prisma.fieldBooking.create({
    data: { gymId: other.gym.id, fieldId: foreignField.id, startsAt: new Date(Date.now() - HOUR), endsAt: new Date(Date.now() + HOUR), fullName: "Elsewhere", phoneWhatsapp: PHONE_ENC, phoneWhatsappLookup: "else", amount: 0, status: "APPROVED" },
  });
  expect((await scan(ticketTokenFor(foreign))).result).toBe("INVALID");
  expect((await scan(ticketTokenFor({ ...live, ticketSecret: "wrong" }))).result).toBe("INVALID");
  expect((await prisma.fieldBooking.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe("APPROVED");
});

test("requests and approvals send messages: email on request, ticket by WhatsApp and email on approval", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const field = await makeField(f);
  await login(request, baseURL!, f.slug, f.staff);
  const v = await visitor(playwright);
  expect((await book(v, baseURL!, f.slug, field.id, "10:00", "11:00")).status()).toBe(201);
  const b = await latest(field.id);

  const logs = async () => (await prisma.notificationLog.findMany({ where: { gymId: f.gym.id } })).map((l) => `${l.type}:${l.channel}:${l.status}`).sort();
  // The request is automatic, so email only, and it says the time isn't held yet.
  await expect.poll(logs).toEqual(["field_booking_received:email:SENT"]);

  expect((await act(request, baseURL!, f.slug, b.id, "approve")).ok()).toBeTruthy();
  await expect.poll(async () => (await logs()).filter((l) => l.startsWith("field_booking_approved")).sort()).toEqual(["field_booking_approved:email:SENT", "field_booking_approved:whatsapp:SENT"]);

  // Resend goes on the chosen channel only; a guest with no email can't be emailed.
  const before = (await logs()).length;
  expect((await act(request, baseURL!, f.slug, b.id, "resend", "email")).ok()).toBeTruthy();
  expect((await logs()).length).toBe(before + 1);
  const noEmail = await prisma.fieldBooking.create({
    data: { gymId: f.gym.id, fieldId: field.id, startsAt: new Date(Date.now() + 90 * HOUR), endsAt: new Date(Date.now() + 91 * HOUR), fullName: "Phone Only", phoneWhatsapp: PHONE_ENC, phoneWhatsappLookup: "po", amount: 0, status: "APPROVED" },
  });
  expect((await act(request, baseURL!, f.slug, noEmail.id, "resend", "email")).status()).toBe(409);

  // Declining tells the guest.
  expect((await book(v, baseURL!, f.slug, field.id, "13:00", "14:00")).status()).toBe(201);
  expect((await act(request, baseURL!, f.slug, (await latest(field.id)).id, "reject")).ok()).toBeTruthy();
  await expect.poll(async () => (await logs()).filter((l) => l.startsWith("field_booking_rejected")).length).toBeGreaterThan(0);
});

test("a booking counts as revenue once approved, in Finance and the CSV; blocks and unapproved ones don't", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const field = await makeField(f);
  await login(request, baseURL!, f.slug, f.owner);
  const v = await visitor(playwright);
  const csv = async () => (await request.get(`${baseURL}/api/${f.slug}/finance/export?report=transactions`)).text();

  expect((await book(v, baseURL!, f.slug, field.id, "10:00", "12:00")).status()).toBe(201); // Rp 120.000
  const b = await latest(field.id);
  expect(await csv()).not.toContain("Court 1");

  expect((await act(request, baseURL!, f.slug, b.id, "approve")).ok()).toBeTruthy();
  const rows = await csv();
  expect(rows).toContain("Field");
  expect(rows).toContain("Court 1");
  expect(rows).toContain("120000");
  const finance = await (await request.get(`${baseURL}/${f.slug}/finance`)).text();
  expect(finance).toContain("from fields");

  await request.post(`${baseURL}/api/${f.slug}/field-bookings/manual`, { data: { fieldId: field.id, date: DAY, start: "14:00", end: "16:00", isBlock: true } });
  const after = await csv();
  expect(after.split("\n").filter((l) => l.includes("Court 1"))).toHaveLength(1);
  const monthly = await (await request.get(`${baseURL}/api/${f.slug}/finance/export?report=monthly`)).text();
  expect(monthly).toContain("Field revenue");
});

test("the public page shows free times and takes a request; staff approve it from the Fields page", async ({ page, baseURL, playwright }) => {
  const f = await makeGym();
  const field = await makeField(f);
  await prisma.fieldBooking.create({
    data: { gymId: f.gym.id, fieldId: field.id, startsAt: bookingInstants(DAY, 600, 660, TZ).startsAt, endsAt: bookingInstants(DAY, 600, 660, TZ).endsAt, fullName: "Earlier", phoneWhatsapp: PHONE_ENC, phoneWhatsappLookup: "e", amount: 0, status: "APPROVED" },
  });
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip() });

  await page.goto(`${baseURL}/${f.slug}/book`);
  await expect(page.getByRole("heading", { name: "Book a field" })).toBeVisible();
  await page.getByLabel("Day").fill(DAY);
  await expect(page.getByTestId("booked-times")).toContainText("10:00–11:00");
  await page.getByLabel("From").selectOption({ label: "12:00" });
  await page.getByLabel("Until").selectOption({ label: "13:30 (1h 30m)" });
  await expect(page.getByTestId("booking-price")).toContainText("12:00 to 13:30");
  await expect(page.getByTestId("booking-price")).toContainText("90.000");
  await page.getByLabel("Your name").fill("Siti Rahma");
  await page.getByLabel("WhatsApp number").fill(phoneN());
  await page.getByLabel("Email").fill("siti@guest.test");
  await page.getByRole("button", { name: "Request this time" }).click();
  await expect(page.getByTestId("booking-request-sent")).toBeVisible();
  const made = await latest(field.id);
  expect(made.status).toBe("PENDING_REVIEW");

  // The staff page lists the request, the day's timeline, and approving it works.
  await page.goto(`${baseURL}/${f.slug}/login`);
  await page.getByLabel("Email").fill(f.staff.email);
  await page.getByLabel("Password").fill(f.staff.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${baseURL}/${f.slug}/dashboard`);
  await page.goto(`${baseURL}/${f.slug}/fields?date=${DAY}`);
  const row = page.getByTestId("booking-request").filter({ hasText: "Siti Rahma" });
  await expect(row).toContainText("Court 1");
  await row.getByRole("button", { name: "Payment received, approve" }).click();
  await expect(page.getByTestId("booking-request").filter({ hasText: "Siti Rahma" })).toHaveCount(0);
  await expect(page.getByTestId("booking-row").filter({ hasText: "Siti Rahma" })).toContainText("Booked");
  expect((await prisma.fieldBooking.findUniqueOrThrow({ where: { id: made.id } })).status).toBe("APPROVED");
});

test("one gym can't see or act on another gym's bookings or fields", async ({ request, baseURL, playwright }) => {
  const a = await makeGym();
  const b = await makeGym();
  const field = await makeField(a);
  const v = await visitor(playwright);
  expect((await book(v, baseURL!, a.slug, field.id, "10:00", "11:00")).status()).toBe(201);
  const booking = await latest(field.id);

  const other = await visitor(playwright);
  expect((await other.post(`${baseURL}/api/${b.slug}/login`, { data: b.owner })).ok()).toBeTruthy();
  expect((await other.post(`${baseURL}/api/${b.slug}/field-bookings/${booking.id}`, { data: { action: "approve" } })).status()).toBe(404);
  expect((await other.get(`${baseURL}/api/${b.slug}/field-bookings/${booking.id}/proof`)).status()).toBe(404);
  expect((await other.post(`${baseURL}/api/${b.slug}/field-bookings/manual`, { data: { fieldId: field.id, date: DAY, start: "08:00", end: "09:00", fullName: "Xavier" } })).status()).toBe(404);
  // The public availability of a field is only reachable through its own gym's address.
  expect((await v.get(`${baseURL}/api/${b.slug}/fields/${field.id}/availability?date=${DAY}`)).status()).toBe(404);
  expect((await prisma.fieldBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("PENDING_REVIEW");
});

test("the fields page has Bookings and Fields tabs for the owner, with add and block on the bookings list", async ({ page, baseURL }) => {
  const f = await makeGym();
  const field = await makeField(f, { name: "Court A" });
  // page.request shares the browser's cookies, so this signs the page in.
  await login(page.request, baseURL!, f.slug, f.owner);

  // Bookings is the default tab: today's list, with the add and block buttons right on it, and no setup form.
  await page.goto(`${baseURL}/${f.slug}/fields`);
  await expect(page.getByTestId("tab-bookings")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create a new field" })).toHaveCount(0);
  await page.getByRole("button", { name: "Block time" }).click();
  await expect(page.getByRole("heading", { name: "Block time" })).toBeVisible();
  await expect(page.getByLabel("Booking name")).toHaveCount(0);
  await page.getByRole("button", { name: "+ Add booking" }).click();
  await expect(page.getByRole("heading", { name: "Add a booking" })).toBeVisible();
  await expect(page.getByLabel("Booking name")).toBeVisible();

  // The Fields tab lists the fields and holds the create form.
  await page.getByTestId("tab-fields").click();
  await expect(page).toHaveURL(/tab=fields/);
  await expect(page.getByRole("heading", { name: "Create a new field" })).toBeVisible();
  await expect(page.getByTestId("field-row").filter({ hasText: field.name })).toBeVisible();
  await expect(page.getByTestId("field-day")).toHaveCount(0);

  // Staff only manage bookings: no tabs, and ?tab=fields still shows the bookings list.
  await page.context().clearCookies();
  await login(page.request, baseURL!, f.slug, f.staff);
  await page.goto(`${baseURL}/${f.slug}/fields?tab=fields`);
  await expect(page.getByTestId("tab-fields")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Create a new field" })).toHaveCount(0);
  await expect(page.getByTestId("field-day")).toHaveCount(1);
});

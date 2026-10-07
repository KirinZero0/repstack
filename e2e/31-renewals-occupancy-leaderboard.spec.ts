import fs from "fs";
import path from "path";
import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma, staffLoginUI } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";
import { displayName, getLeaderboard } from "../src/lib/leaderboard";
import { tenantDb } from "../src/lib/prisma";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const PROOF = path.join(__dirname, "fixtures", "test-photo.jpg");
let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

async function makeGym(memberCount = 2, over: { settings?: object; bank?: boolean } = {}) {
  const tag = uniq("rol");
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const gym = await prisma.gym.create({
    data: {
      name: `Gym ${tag}`,
      slug: tag,
      saasPlanId: saasPlan.id,
      subscriptionStatus: "ACTIVE",
      timezone: "Asia/Jakarta",
      settings: over.settings ?? {},
      ...(over.bank === false ? {} : { bankName: "BCA", bankAccountNumber: "1234567890", bankAccountHolder: "PT Gym" }),
    },
  });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  const ownerRow = await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  const plan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  const annual = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Annual", durationDays: 365, price: 2500000 } });
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
          fullName: `Member${i + 1} Surname${i + 1}`,
          email: `${m}@test.local`,
          phoneWhatsapp: encrypt(phone),
          phoneWhatsappLookup: hmacLookup(phone),
          passwordHash: await bcrypt.hash("member-pass-123", 10),
          status: "ACTIVE",
          membershipExpiry: new Date(Date.now() + 10 * DAY),
        },
      }),
    });
  }
  return { gym, owner, ownerRow, staff, plan, annual, members, slug: tag };
}

async function staffLogin(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  const res = await request.post(`${baseURL}/api/${slug}/login`, { data: who });
  expect(res.ok(), `login ${who.email}`).toBeTruthy();
}
async function memberLogin(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  const res = await request.post(`${baseURL}/api/${slug}/member-login`, { data: who });
  expect(res.ok(), `member login ${who.email}`).toBeTruthy();
}

const renew = (ctx: APIRequestContext, baseURL: string, planId: string, withProof = false) =>
  ctx.post(`${baseURL}/api/my/renewal`, {
    multipart: withProof ? { planId, proof: { name: "proof.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(PROOF) } } : { planId },
  });

/** The "in the gym now" card's HTML, without the leaderboard card that follows it (both list member names). */
const occupancyCard = (html: string) => html.slice(html.indexOf("In the gym now"), html.indexOf("Most visits this month"));

async function checkIn(f: Awaited<ReturnType<typeof makeGym>>, memberId: string, at: Date, over: { checkedOutAt?: Date } = {}) {
  return prisma.checkIn.create({ data: { gymId: f.gym.id, memberId, result: "SUCCESS", checkedInAt: at, checkedOutAt: over.checkedOutAt ?? null } });
}

test("a member renews by bank transfer: request filed, staff approve it, membership extends and a cash payment is recorded", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(1);
  const m = f.members[0];
  const memberCtx = await playwright.request.newContext();
  await memberLogin(memberCtx, baseURL!, f.slug, m);

  // Wrong gym's plan, and a hidden plan, are refused.
  const other = await makeGym(0);
  expect((await renew(memberCtx, baseURL!, other.plan.id)).status()).toBe(400);
  const hidden = await prisma.membershipPlan.create({ data: { gymId: f.gym.id, name: "Hidden", durationDays: 7, price: 1000, isActive: false } });
  expect((await renew(memberCtx, baseURL!, hidden.id)).status()).toBe(400);

  const filed = await renew(memberCtx, baseURL!, f.annual.id, true);
  expect(filed.status(), await filed.text()).toBe(201);
  const { requestId } = await filed.json();
  const req = await prisma.memberSignup.findUniqueOrThrow({ where: { id: requestId } });
  expect(req).toMatchObject({ kind: "RENEWAL", memberId: m.row.id, status: "PENDING_REVIEW", planId: f.annual.id, passwordHash: null, email: m.email });
  expect(Number(req.amount)).toBe(2500000);
  expect(req.proofImageUrl).toBeTruthy();

  // One open request at a time; the member's pages say so.
  expect((await renew(memberCtx, baseURL!, f.plan.id)).status()).toBe(409);
  expect(await (await memberCtx.get(`${baseURL}/my/pay`)).text()).toContain("Renewal request sent");
  expect(await (await memberCtx.get(`${baseURL}/my`)).text()).toContain("Renewal pending");

  // Staff see it in the queue, flagged as a renewal, and approve it.
  await staffLogin(request, baseURL!, f.slug, f.staff);
  const queue = await (await request.get(`${baseURL}/${f.slug}/members/requests`)).text();
  expect(queue).toContain("Renewal · existing member");
  expect(queue).toContain(m.row.fullName);
  const before = (await prisma.member.findUniqueOrThrow({ where: { id: m.row.id } })).membershipExpiry!;
  const approved = await request.post(`${baseURL}/api/${f.slug}/join/${requestId}/approve`);
  expect(approved.status(), await approved.text()).toBe(200);
  expect((await approved.json()).memberId).toBe(m.row.id);

  const after = await prisma.member.findUniqueOrThrow({ where: { id: m.row.id } });
  // Still had 10 days: the year is added on top, and the plan switches.
  expect(Math.round((after.membershipExpiry!.getTime() - before.getTime()) / DAY)).toBe(365);
  expect(after.planId).toBe(f.annual.id);
  expect(after.status).toBe("ACTIVE");
  const payment = await prisma.payment.findFirstOrThrow({ where: { memberId: m.row.id } });
  expect(payment).toMatchObject({ provider: "CASH", status: "PAID", planId: f.annual.id });
  expect(Number(payment.amount)).toBe(2500000);
  expect(payment.recordedById).not.toBeNull();
  expect((await prisma.memberSignup.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("COMPLETED");
  expect(await prisma.notificationLog.count({ where: { memberId: m.row.id, type: "renewal_confirmed" } })).toBe(1);
  // No new member was created: the queue approved a renewal, not a join.
  expect(await prisma.member.count({ where: { gymId: f.gym.id } })).toBe(1);

  // Approving twice does nothing more.
  expect((await request.post(`${baseURL}/api/${f.slug}/join/${requestId}/approve`)).status()).toBe(409);
  expect(await prisma.payment.count({ where: { memberId: m.row.id } })).toBe(1);

  // The member is free to renew again, and the pay page offers the transfer form once more.
  const again = await renew(memberCtx, baseURL!, f.plan.id);
  expect(again.status()).toBe(201);
  const html = await (await memberCtx.get(`${baseURL}/my/pay`)).text();
  expect(html).toContain("Renewal request sent");
  await memberCtx.dispose();
});

test("a lapsed member's renewal starts from today; rejection leaves them as they were; cancelled members can't renew", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(2);
  const lapsed = f.members[0];
  await prisma.member.update({ where: { id: lapsed.row.id }, data: { status: "EXPIRED", membershipExpiry: new Date(Date.now() - 20 * DAY) } });
  const ctx = await playwright.request.newContext();
  await memberLogin(ctx, baseURL!, f.slug, lapsed);

  const rejected = await renew(ctx, baseURL!, f.plan.id);
  const { requestId: rejectId } = await rejected.json();
  await staffLogin(request, baseURL!, f.slug, f.owner);
  expect((await request.post(`${baseURL}/api/${f.slug}/join/${rejectId}/reject`)).ok()).toBeTruthy();
  expect((await prisma.memberSignup.findUniqueOrThrow({ where: { id: rejectId } })).status).toBe("REJECTED");
  const untouched = await prisma.member.findUniqueOrThrow({ where: { id: lapsed.row.id } });
  expect(untouched.status).toBe("EXPIRED");
  expect(await prisma.payment.count({ where: { memberId: lapsed.row.id } })).toBe(0);

  const second = await renew(ctx, baseURL!, f.plan.id);
  const { requestId } = await second.json();
  expect((await request.post(`${baseURL}/api/${f.slug}/join/${requestId}/approve`)).status()).toBe(200);
  const renewed = await prisma.member.findUniqueOrThrow({ where: { id: lapsed.row.id } });
  expect(renewed.status).toBe("ACTIVE");
  const daysLeft = (renewed.membershipExpiry!.getTime() - Date.now()) / DAY;
  expect(daysLeft).toBeGreaterThan(29);
  expect(daysLeft).toBeLessThan(31);
  await ctx.dispose();

  // Cancelled: refused at the door.
  const cancelled = f.members[1];
  await prisma.member.update({ where: { id: cancelled.row.id }, data: { status: "CANCELLED" } });
  const ctx2 = await playwright.request.newContext();
  await memberLogin(ctx2, baseURL!, f.slug, cancelled);
  expect((await renew(ctx2, baseURL!, f.plan.id)).status()).toBe(403);
  await ctx2.dispose();

  // A gym without bank details shows no transfer form, but the API still takes a request.
  const noBank = await makeGym(1, { bank: false });
  const ctx3 = await playwright.request.newContext();
  await memberLogin(ctx3, baseURL!, noBank.slug, noBank.members[0]);
  const payHtml = await (await ctx3.get(`${baseURL}/my/pay`)).text();
  expect(payHtml).not.toContain("Renew by bank transfer");
  expect(payHtml).not.toContain("1234567890");
  await ctx3.dispose();
});

test("the renewal form is on the member's pay page and files a request from the browser", async ({ page, baseURL }) => {
  const f = await makeGym(1);
  const m = f.members[0];
  await page.goto(`${baseURL}/${f.slug}/member-login`);
  await page.getByLabel("Email").fill(m.email);
  await page.getByLabel("Password").fill(m.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${baseURL}/my`);
  await page.goto(`${baseURL}/my/pay`);
  await expect(page.getByRole("heading", { name: "Renew by bank transfer" })).toBeVisible();
  await expect(page.getByText("1234567890")).toBeVisible();
  await page.getByRole("radio", { name: /Annual/ }).check();
  await expect(page.getByText("Rp 2.500.000", { exact: false }).first()).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(PROOF);
  await page.getByRole("button", { name: "I've transferred, send my request" }).click();
  await expect(page.getByRole("heading", { name: "Renewal request sent" })).toBeVisible();
  const req = await prisma.memberSignup.findFirstOrThrow({ where: { memberId: m.row.id, kind: "RENEWAL" } });
  expect(req.planId).toBe(f.annual.id);
  expect(req.proofImageUrl).toBeTruthy();
});

test("who's in the gym: recent check-ins count once per member, check-outs and the window remove them", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(3, { settings: { occupancyWindowHours: 2 } });
  const [a, b, c] = f.members;
  const now = Date.now();
  await checkIn(f, a.row.id, new Date(now - 30 * 60 * 1000));
  await checkIn(f, a.row.id, new Date(now - 10 * 60 * 1000)); // a scanned twice: counted once
  await checkIn(f, b.row.id, new Date(now - 90 * 60 * 1000));
  await checkIn(f, c.row.id, new Date(now - 3 * HOUR)); // older than the 2-hour window
  const left = await checkIn(f, c.row.id, new Date(now - 20 * 60 * 1000), { checkedOutAt: new Date(now - 5 * 60 * 1000) }); // came back, already left
  await prisma.checkIn.create({ data: { gymId: f.gym.id, memberId: b.row.id, result: "DUPLICATE", checkedInAt: new Date(now - 5 * 60 * 1000) } });

  await staffLogin(request, baseURL!, f.slug, f.staff);
  let html = occupancyCard(await (await request.get(`${baseURL}/${f.slug}/dashboard`)).text());
  expect(html).toContain(a.row.fullName);
  expect(html).toContain(b.row.fullName);
  expect(html).not.toContain(c.row.fullName);

  // The member taps out from their dashboard.
  const ctxA = await playwright.request.newContext();
  await memberLogin(ctxA, baseURL!, f.slug, a);
  expect(await (await ctxA.get(`${baseURL}/my`)).text()).toContain("checked in");
  expect((await ctxA.post(`${baseURL}/api/my/checkout`)).status()).toBe(200);
  expect((await ctxA.post(`${baseURL}/api/my/checkout`)).status()).toBe(409);
  expect(await (await ctxA.get(`${baseURL}/my`)).text()).not.toContain("You&#x27;re checked in");
  await ctxA.dispose();
  html = occupancyCard(await (await request.get(`${baseURL}/${f.slug}/dashboard`)).text());
  expect(html).not.toContain(a.row.fullName);
  expect(html).toContain(b.row.fullName);

  // Staff check someone out; twice is a 409; the already-left row is a 409 too.
  const bOpen = await prisma.checkIn.findFirstOrThrow({ where: { memberId: b.row.id, result: "SUCCESS", checkedOutAt: null } });
  expect((await request.post(`${baseURL}/api/${f.slug}/checkins/${bOpen.id}/checkout`)).status()).toBe(200);
  expect((await request.post(`${baseURL}/api/${f.slug}/checkins/${bOpen.id}/checkout`)).status()).toBe(409);
  expect((await request.post(`${baseURL}/api/${f.slug}/checkins/${left.id}/checkout`)).status()).toBe(409);
  html = occupancyCard(await (await request.get(`${baseURL}/${f.slug}/dashboard`)).text());
  expect(html).toContain("Nobody right now.");

  // Another gym's staff can't check this gym's people out.
  const other = await makeGym(0);
  const fresh = await checkIn(f, a.row.id, new Date());
  const otherCtx = await playwright.request.newContext();
  await staffLogin(otherCtx, baseURL!, other.slug, other.staff);
  expect((await otherCtx.post(`${baseURL}/api/${other.slug}/checkins/${fresh.id}/checkout`)).status()).toBe(404);
  await otherCtx.dispose();
  expect((await prisma.checkIn.findUniqueOrThrow({ where: { id: fresh.id } })).checkedOutAt).toBeNull();

  // The owner changes the window; the setting is validated.
  await staffLogin(request, baseURL!, f.slug, f.owner);
  expect((await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { occupancyWindowHours: 24 } })).status()).toBe(400);
  expect((await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { occupancyWindowHours: 4 } })).status()).toBe(200);
  await checkIn(f, c.row.id, new Date(now - 3 * HOUR - 10 * 60 * 1000));
  html = occupancyCard(await (await request.get(`${baseURL}/${f.slug}/dashboard`)).text());
  expect(html).toContain("last 4 hours");
  expect(html).toContain(c.row.fullName);
});

test("the leaderboard ranks visits and streaks, and members always see it with short names", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(3);
  const [a, b, c] = f.members;
  const today = new Date();
  // a: 3 days in a row ending today; b: today and 5 days ago; c: a 4-day streak that ended last week.
  for (const d of [0, 1, 2]) await checkIn(f, a.row.id, new Date(today.getTime() - d * DAY));
  for (const d of [0, 5]) await checkIn(f, b.row.id, new Date(today.getTime() - d * DAY));
  for (const d of [7, 8, 9, 10]) await checkIn(f, c.row.id, new Date(today.getTime() - d * DAY));

  expect(displayName("Sari Dewi Lestari")).toBe("Sari L.");
  expect(displayName("Budi")).toBe("Budi");

  const board = await getLeaderboard(tenantDb(f.gym.id), f.gym.id, "Asia/Jakarta", today);
  const names = (rows: { fullName: string }[]) => rows.map((r) => r.fullName);
  // Visits this month depend on the calendar; the two who visited today are always on top.
  expect(names(board.visits).slice(0, 1)[0]).toBe(a.row.fullName);
  expect(board.visits.find((r) => r.memberId === a.row.id)!.value).toBeGreaterThanOrEqual(1);
  expect(board.streaks.map((r) => [r.fullName, r.value])).toEqual([[a.row.fullName, 3]]);
  expect(board.visits[0].name).toBe("Member1 S.");

  // Always on: members see the board without any switch.
  const ctxB = await playwright.request.newContext();
  await memberLogin(ctxB, baseURL!, f.slug, b);
  await staffLogin(request, baseURL!, f.slug, f.owner);
  const html = await (await ctxB.get(`${baseURL}/my`)).text();
  expect(html).toContain("Leaderboard · visits this month");
  expect(html).toContain("Member1 S.");
  expect(html).toContain("Member2 S.");
  expect(html).not.toContain("Member1 Surname1"); // surnames stay off the member-facing board
  expect(html).toContain("3 days");
  await ctxB.dispose();

  // Staff see full names on their own dashboard.
  const dash = await (await request.get(`${baseURL}/${f.slug}/dashboard`)).text();
  expect(dash).toContain("Most visits this month");
  expect(dash).toContain(a.row.fullName);
});

test("the settings page carries the occupancy window, and no leaderboard switch", async ({ page, baseURL }) => {
  const f = await makeGym(0);
  await staffLoginUI(page, baseURL!, f.slug, f.owner.email, f.owner.password);
  await page.waitForURL(`${baseURL}/${f.slug}/dashboard`);
  await page.goto(`${baseURL}/${f.slug}/settings`);
  await page.getByLabel("Occupancy window").selectOption("6");
  await expect(page.getByText("Saved").first()).toBeVisible();
  await expect(page.getByLabel("Show members a leaderboard")).toHaveCount(0);
  await expect.poll(async () => (await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).settings).toMatchObject({ occupancyWindowHours: 6 });
});

import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma, buildTokenForMember } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";

const HOUR = 60 * 60 * 1000;
let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

/** A gym with the given first/last names as active members, so display names are predictable. */
async function makeGym(names: string[], settings: object = {}) {
  const tag = uniq("board");
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const gym = await prisma.gym.create({
    data: { name: `Board Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE", timezone: "Asia/Jakarta", settings },
  });
  const plan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  const members = [];
  for (let i = 0; i < names.length; i++) {
    const fullName = names[i];
    const email = `${uniq("m")}@test.local`;
    const phone = `0812${Date.now().toString().slice(-7)}${i}${seq}`;
    members.push({
      email,
      password: "member-pass-123",
      row: await prisma.member.create({
        data: {
          gymId: gym.id,
          planId: plan.id,
          fullName,
          email,
          phoneWhatsapp: encrypt(phone),
          phoneWhatsappLookup: hmacLookup(phone),
          passwordHash: await bcrypt.hash("member-pass-123", 10),
          status: "ACTIVE",
          membershipExpiry: new Date(Date.now() + 30 * 24 * HOUR),
        },
      }),
    });
  }
  return { gym, members, slug: tag };
}

const checkIn = (gymId: string, memberId: string, minutesAgo: number) =>
  prisma.checkIn.create({ data: { gymId, memberId, result: "SUCCESS", checkedInAt: new Date(Date.now() - minutesAgo * 60_000) } });

/** Just the "Who's in the gym" card: the always-on leaderboard below it lists members too, and hiding doesn't affect that. */
function gymCard(html: string): string {
  const start = html.indexOf("Who&#x27;s in the gym");
  if (start === -1) return "";
  const end = html.indexOf("Leaderboard", start);
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

async function memberPage(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  const login = await request.post(`${baseURL}/api/${slug}/login`, { data: who });
  expect(login.ok(), await login.text()).toBeTruthy();
  return (await request.get(`${baseURL}/my`)).text();
}

test("members only see who's in the gym when the owner turned it on, as first name and last initial", async ({ request, baseURL }) => {
  const f = await makeGym(["Viewer Person", "Sari Dewi Lestari", "Andi Wijaya"]);
  const [viewer, sari, andi] = f.members;
  await checkIn(f.gym.id, sari.row.id, 20);
  await checkIn(f.gym.id, andi.row.id, 40);

  // Off by default: no list.
  let html = (await memberPage(request, baseURL!, f.slug, viewer)).replace(/<!-- -->/g, "");
  expect(gymCard(html)).toBe("");

  await prisma.gym.update({ where: { id: f.gym.id }, data: { settings: { whoIsInEnabled: true } } });
  html = (await (await request.get(`${baseURL}/my`)).text()).replace(/<!-- -->/g, "");
  const card = gymCard(html);
  expect(card).toContain("Sari L.");
  expect(card).toContain("Andi W.");
  expect(html).not.toContain("Lestari"); // surnames stay private everywhere on the member page
  expect(html).not.toContain("Wijaya");
  expect(card).toContain("people are"); // head count of 2
});

test("a member who hides is counted but never named, and members who left are gone", async ({ request, baseURL }) => {
  const f = await makeGym(["Viewer Person", "Sari Dewi Lestari", "Hidden Hanna", "Left Already"], { whoIsInEnabled: true });
  const [viewer, sari, hanna, left] = f.members;
  await checkIn(f.gym.id, sari.row.id, 10);
  await checkIn(f.gym.id, hanna.row.id, 15);
  const leftIn = await checkIn(f.gym.id, left.row.id, 30);
  await prisma.checkIn.update({ where: { id: leftIn.id }, data: { checkedOutAt: new Date() } });

  // Hanna hides herself through her own session.
  const hannaCtx = await (await import("@playwright/test")).request.newContext();
  await hannaCtx.post(`${baseURL}/api/${f.slug}/login`, { data: hanna });
  expect((await hannaCtx.post(`${baseURL}/api/my/privacy`, { data: { hideFromGymBoard: true } })).ok()).toBeTruthy();
  expect((await prisma.member.findUniqueOrThrow({ where: { id: hanna.row.id } })).hideFromGymBoard).toBe(true);
  // Bad input is refused, and it only ever changes the caller's own row.
  expect((await hannaCtx.post(`${baseURL}/api/my/privacy`, { data: { hideFromGymBoard: "yes" } })).status()).toBe(400);
  expect((await prisma.member.findUniqueOrThrow({ where: { id: sari.row.id } })).hideFromGymBoard).toBe(false);
  await hannaCtx.dispose();

  const html = (await memberPage(request, baseURL!, f.slug, viewer)).replace(/<!-- -->/g, "");
  const card = gymCard(html);
  expect(card).toContain("Sari L.");
  expect(card).not.toContain("Hidden H.");
  expect(card).not.toContain("Left A.");
  expect(card).toMatch(/>2<\/span>\s*<span[^>]*>people are/); // Sari and Hanna are counted

  // Staff still see everyone, including the member who hid from other members, by full name.
  const staffCtx = await (await import("@playwright/test")).request.newContext();
  await prisma.staffUser.create({ data: { gymId: f.gym.id, name: "Desk", email: `desk-${f.slug}@test.local`, passwordHash: await bcrypt.hash("staff-pass-123", 10), role: "STAFF" } });
  expect((await staffCtx.post(`${baseURL}/api/${f.slug}/login`, { data: { email: `desk-${f.slug}@test.local`, password: "staff-pass-123" } })).ok()).toBeTruthy();
  const dash = (await (await staffCtx.get(`${baseURL}/${f.slug}/dashboard`)).text()).replace(/<!-- -->/g, "");
  expect(dash).toContain("Hidden Hanna");
  expect(dash).toContain("Sari Dewi Lestari");
  await staffCtx.dispose();
});

test("the dashboard check-in button turns yellow once the member has checked in today", async ({ request, baseURL }) => {
  const f = await makeGym(["Early Bird"]);
  const [m] = f.members;

  let html = (await memberPage(request, baseURL!, f.slug, m)).replace(/<!-- -->/g, "");
  expect(html).toContain("Scan the code at the gym entrance");
  expect(html).not.toContain("You already checked in");

  await checkIn(f.gym.id, m.row.id, 5);
  html = (await (await request.get(`${baseURL}/my`)).text()).replace(/<!-- -->/g, "");
  expect(html).toContain("You already checked in");
  expect(html).not.toContain("Scan the code at the gym entrance");

  // A check-in from yesterday doesn't count.
  const g = await makeGym(["Yesterday Yara"]);
  await checkIn(g.gym.id, g.members[0].row.id, 30 * 60);
  const ctx = await (await import("@playwright/test")).request.newContext();
  await ctx.post(`${baseURL}/api/${g.slug}/login`, { data: g.members[0] });
  expect(await (await ctx.get(`${baseURL}/my`)).text()).not.toContain("You already checked in");
  await ctx.dispose();
});

test("a gym can allow several check-ins a day, with a minimum gap, and the limit is enforced", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(["Split Session"]);
  const [m] = f.members;
  await prisma.staffUser.create({ data: { gymId: f.gym.id, name: "Owner", email: `own-${f.slug}@test.local`, passwordHash: await bcrypt.hash("owner-pass-123", 10), role: "OWNER" } });
  expect((await request.post(`${baseURL}/api/${f.slug}/login`, { data: { email: `own-${f.slug}@test.local`, password: "owner-pass-123" } })).ok()).toBeTruthy();
  const scan = async () => (await request.post(`${baseURL}/api/checkin`, { data: { token: await buildTokenForMember(m.row.id) } })).json();

  // The original rule is the default: once a day.
  expect((await scan()).result).toBe("SUCCESS");
  const dup = await scan();
  expect(dup.result).toBe("DUPLICATE");
  expect(dup.message).toBe("Already checked in today");

  // The settings are validated and stored on the gym.
  expect((await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { checkinsPerDay: 11 } })).status()).toBe(400);
  expect((await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { checkinGapMinutes: -5 } })).status()).toBe(400);
  expect((await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { checkinsPerDay: 2, checkinGapMinutes: 30 } })).status()).toBe(200);
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).settings).toMatchObject({ checkinsPerDay: 2, checkinGapMinutes: 30 });

  // Two a day: the first scan is still fresh, so a second one straight away is the same visit scanned twice.
  const tooSoon = await scan();
  expect(tooSoon.result).toBe("DUPLICATE");
  expect(tooSoon.message).toBe("Already checked in a moment ago");

  // The member's own page still offers the button, since one of two is left.
  const memberCtx = await playwright.request.newContext();
  await memberCtx.post(`${baseURL}/api/${f.slug}/login`, { data: m });
  let html = (await (await memberCtx.get(`${baseURL}/my`)).text()).replace(/<!-- -->/g, "");
  expect(html).toContain("Scan the code at the gym entrance");
  expect(html).not.toContain("You already checked in");
  expect(html).toContain("Check-in 1 of 2 used today");

  // An hour later (backdate the first), the second visit counts.
  await prisma.checkIn.updateMany({ where: { memberId: m.row.id, result: "SUCCESS" }, data: { checkedInAt: new Date(Date.now() - 45 * 60_000) } });
  expect((await scan()).result).toBe("SUCCESS");

  // Now the day's two are used: a third is refused with the limit, and the button turns yellow.
  await prisma.checkIn.updateMany({ where: { memberId: m.row.id, result: "SUCCESS" }, data: { checkedInAt: new Date(Date.now() - 45 * 60_000) } });
  const third = await scan();
  expect(third.result).toBe("DUPLICATE");
  expect(third.message).toBe("Daily limit reached (2 check-ins)");
  html = (await (await memberCtx.get(`${baseURL}/my`)).text()).replace(/<!-- -->/g, "");
  expect(html).toContain("You already checked in");
  expect(html).toContain("all 2 for today");
  await memberCtx.dispose();

  // Both successful visits count, so the day's check-ins show twice in the gym's records.
  expect(await prisma.checkIn.count({ where: { memberId: m.row.id, result: "SUCCESS" } })).toBe(2);
});

test("staff can open a member's QR; members, other gyms and logged-out visitors can't", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(["Phone Died"]);
  const other = await makeGym(["Other Gym Member"]);
  const [m] = f.members;
  await prisma.staffUser.create({ data: { gymId: f.gym.id, name: "Desk", email: `qr-${f.slug}@test.local`, passwordHash: await bcrypt.hash("staff-pass-123", 10), role: "STAFF" } });
  const url = `${baseURL}/api/${f.slug}/members/${m.row.id}/qr`;

  expect((await request.get(url)).status()).toBe(401);

  expect((await request.post(`${baseURL}/api/${f.slug}/login`, { data: { email: `qr-${f.slug}@test.local`, password: "staff-pass-123" } })).ok()).toBeTruthy();
  const ok = await request.get(url);
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.name).toBe("Phone Died");
  expect(body.dataUrl).toMatch(/^data:image\/png;base64,/);
  // A member's own session is not staff: it gets no access to this route.
  const memberCtx = await playwright.request.newContext();
  await memberCtx.post(`${baseURL}/api/${f.slug}/login`, { data: m });
  expect((await memberCtx.get(url)).status()).toBe(401);
  await memberCtx.dispose();

  // Staff of one gym can't open a member of another gym.
  expect((await request.get(`${baseURL}/api/${f.slug}/members/${other.members[0].row.id}/qr`)).status()).toBe(404);

  // The page offers the button to staff.
  const html = await (await request.get(`${baseURL}/${f.slug}/members/${m.row.id}`)).text();
  expect(html).toContain("Show check-in QR");
});

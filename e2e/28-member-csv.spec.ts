import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma, staffLoginUI } from "./helpers";
import { decrypt, encrypt, hmacLookup } from "../src/lib/crypto";
import { parseCsv, toCsv, excelText, detectDelimiter } from "../src/lib/csv";
import { parseSheetDate, parseMemberSheet } from "../src/lib/memberImport";

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

async function makeGym(maxMembers = 100) {
  const tag = uniq("csv");
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
  const monthly = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Monthly", durationDays: 30, price: 250000 } });
  const annual = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "Annual", durationDays: 365, price: 2500000 } });
  return { gym, saasPlan, owner, staff, monthly, annual, slug: tag };
}

async function login(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  const res = await request.post(`${baseURL}/api/${slug}/login`, { data: who });
  expect(res.ok(), `login ${who.email}`).toBeTruthy();
}

function importCsv(request: APIRequestContext, baseURL: string, slug: string, csv: string, opts: { planId?: string; dryRun?: boolean; notify?: boolean } = {}) {
  return request.post(`${baseURL}/api/${slug}/members/import`, {
    multipart: {
      file: { name: "members.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") },
      planId: opts.planId ?? "",
      dryRun: opts.dryRun ? "1" : "0",
      notify: opts.notify === false ? "0" : "1",
    },
  });
}

test("the CSV helpers read what Excel writes: BOM, semicolons, quotes, Indonesian dates, text-wrapped phones", async () => {
  expect(detectDelimiter("Nama;Email;No HP\r\nA;b;c")).toBe(";");
  expect(detectDelimiter("Name,Email,Phone")).toBe(",");

  const rows = parseCsv('﻿Name;Email;Phone\r\n"Dewi, Sari";sari@x.id;="081234567890"\r\n"He said ""hi""";a@b.c;0812\r\n\r\n');
  expect(rows).toEqual([
    ["Name", "Email", "Phone"],
    ["Dewi, Sari", "sari@x.id", '="081234567890"'],
    ['He said "hi"', "a@b.c", "0812"],
  ]);

  expect(parseSheetDate("2026-12-31")).toBe("2026-12-31");
  expect(parseSheetDate("31/12/2026")).toBe("2026-12-31");
  expect(parseSheetDate("31-12-2026")).toBe("2026-12-31");
  expect(parseSheetDate("1.2.2026")).toBe("2026-02-01");
  expect(parseSheetDate("12/31/2026")).toBe("2026-12-31"); // 31 can't be a month, so US order is recognised
  expect(parseSheetDate("2026-12-31T16:59:59.000Z")).toBe("2026-12-31");
  expect(parseSheetDate("31/02/2026")).toBeNull();
  expect(parseSheetDate("next week")).toBeNull();

  // Writing: formulas defused, phones kept as text, delimiters quoted, BOM present.
  const out = toCsv([["Name", "Phone"], ["=HYPERLINK(1)", excelText("081234567890")], ['Dewi, "Sari"', excelText("+62 812-3456")]]);
  expect(out.startsWith("﻿")).toBeTruthy();
  expect(out).toContain("'=HYPERLINK(1),=\"081234567890\"");
  expect(out).toContain('"Dewi, ""Sari""",="+62 812-3456"');

  // Header mapping and per-row errors, in Indonesian.
  const sheet = parseMemberSheet(["Nama;No HP;Email;Paket;Berlaku sampai", "Sari;0812345678;sari@x.id;Monthly;31/12/2026", "B;0812;bad;;", "Sari Dua;0812345679;SARI@x.id;;"].join("\n"));
  expect(sheet.missingColumns).toEqual([]);
  expect(sheet.rows[0]).toMatchObject({ line: 2, fullName: "Sari", phone: "0812345678", plan: "Monthly", expiry: "2026-12-31" });
  expect(sheet.rows[1].error).toBe("Name is too short");
  expect(sheet.rows[2].error).toBe("Same email as line 2");
  expect(parseMemberSheet("Name,Something\nA,B").missingColumns).toEqual(["Email", "Phone"]);
});

test("owner exports the member list as CSV; staff and other gyms can't", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  const phone = "081200007777";
  const member = await prisma.member.create({
    data: {
      gymId: f.gym.id,
      planId: f.monthly.id,
      fullName: 'Sari "Dewi", Jr',
      email: `${uniq("exp")}@test.local`,
      phoneWhatsapp: encrypt(phone),
      phoneWhatsappLookup: hmacLookup(phone),
      passwordHash: await bcrypt.hash("member-pass-123", 10),
      status: "ACTIVE",
      membershipExpiry: new Date("2027-03-15T10:00:00Z"),
    },
  });
  // An erased member must not appear: the row only exists to keep payment history adding up.
  await prisma.member.create({
    data: {
      gymId: f.gym.id,
      planId: f.monthly.id,
      fullName: "Erased",
      email: `${uniq("erased")}@test.local`,
      phoneWhatsapp: encrypt("081200000000"),
      phoneWhatsappLookup: hmacLookup("081200000000"),
      status: "CANCELLED",
      anonymizedAt: new Date(),
    },
  });

  await login(request, baseURL!, f.slug, f.owner);
  const res = await request.get(`${baseURL}/api/${f.slug}/members/export`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(res.headers()["content-disposition"]).toContain(`members-${f.slug}-`);

  const text = await res.text();
  expect(text.startsWith("﻿")).toBeTruthy();
  const rows = parseCsv(text);
  expect(rows[0]).toEqual(["Name", "Email", "Phone", "Plan", "Status", "Paid until", "Activated", "Joined"]);
  expect(rows).toHaveLength(2);
  expect(rows[1]).toEqual(['Sari "Dewi", Jr', member.email, `="${phone}"`, "Monthly", "ACTIVE", "2027-03-15", "Yes", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]);
  expect(text).not.toContain("Erased");

  // Staff see members on screen, but the whole list as a file is the owner's call.
  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  expect((await staffCtx.get(`${baseURL}/api/${f.slug}/members/export`)).status()).toBe(403);
  await staffCtx.dispose();

  // Another gym's owner gets nothing from this gym's address.
  const other = await makeGym();
  const otherCtx = await playwright.request.newContext();
  await login(otherCtx, baseURL!, other.slug, other.owner);
  const cross = await otherCtx.get(`${baseURL}/api/${f.slug}/members/export`);
  expect(cross.ok()).toBeFalsy();
  expect(await cross.text()).not.toContain(member.email);
  await otherCtx.dispose();
});

test("owner imports a spreadsheet: preview first, then members are created with links and no invented payments", async ({ request, baseURL }) => {
  const f = await makeGym();
  await login(request, baseURL!, f.slug, f.owner);

  const alreadyEmail = `${uniq("already")}@test.local`;
  await prisma.member.create({
    data: {
      gymId: f.gym.id,
      planId: f.monthly.id,
      fullName: "Already Here",
      email: alreadyEmail,
      phoneWhatsapp: encrypt("081200001111"),
      phoneWhatsappLookup: hmacLookup("081200001111"),
      status: "ACTIVE",
      membershipExpiry: new Date(Date.now() + 10 * DAY),
    },
  });

  const e1 = `${uniq("imp1")}@test.local`;
  const e2 = `${uniq("imp2")}@test.local`;
  const e3 = `${uniq("imp3")}@test.local`;
  // Indonesian-locale Excel: semicolons, local headers, day-first dates, a phone wrapped as text.
  const csv = [
    "Nama;Email;No. HP;Paket;Berlaku sampai",
    `Sari Dewi;${e1};="081200002222";Annual;31/12/2027`,
    `Budi Santoso;${e2};0812 0000 3333;;`,
    `Lapsed Lila;${e3};081200004444;Monthly;01/01/2020`,
    `Already Here;${alreadyEmail};081200001111;Monthly;`,
    `Wrong Plan;${uniq("wp")}@test.local;081200005555;Platinum;`,
    `X;${uniq("short")}@test.local;081200006666;;`,
    `No Phone;${uniq("np")}@test.local;;;`,
  ].join("\r\n");

  const preview = await importCsv(request, baseURL!, f.slug, csv, { planId: f.monthly.id, dryRun: true });
  expect(preview.status(), await preview.text()).toBe(200);
  const p = await preview.json();
  expect(p.dryRun).toBe(true);
  expect(p.summary).toMatchObject({ total: 7, ok: 3, skipped: 1, errors: 3 });
  const byLine = Object.fromEntries(p.rows.map((r: { line: number }) => [r.line, r]));
  expect(byLine[2]).toMatchObject({ outcome: "ok", plan: "Annual", expiry: "2027-12-31", phone: "081200002222" });
  expect(byLine[3]).toMatchObject({ outcome: "ok", plan: "Monthly", expiry: null });
  expect(byLine[4]).toMatchObject({ outcome: "ok", plan: "Monthly", expiry: "2020-01-01" });
  expect(byLine[5]).toMatchObject({ outcome: "skipped", reason: "Already a member here" });
  expect(byLine[6].outcome).toBe("error");
  expect(byLine[6].reason).toContain('No active plan called "Platinum"');
  expect(byLine[7]).toMatchObject({ outcome: "error", reason: "Name is too short" });
  expect(byLine[8].outcome).toBe("error");
  // A preview creates nothing.
  expect(await prisma.member.count({ where: { gymId: f.gym.id } })).toBe(1);

  const run = await importCsv(request, baseURL!, f.slug, csv, { planId: f.monthly.id });
  expect(run.status(), await run.text()).toBe(200);
  const r = await run.json();
  expect(r.dryRun).toBe(false);
  expect(r.created).toBe(3);
  expect(r.summary).toMatchObject({ ok: 3, skipped: 1, errors: 3 });

  const sari = await prisma.member.findUniqueOrThrow({ where: { email: e1 } });
  expect(sari.gymId).toBe(f.gym.id);
  expect(sari.planId).toBe(f.annual.id);
  expect(sari.status).toBe("ACTIVE");
  expect(decrypt(sari.phoneWhatsapp)).toBe("081200002222");
  expect(sari.phoneWhatsappLookup).toBe(hmacLookup("081200002222"));
  expect(sari.passwordHash).toBeNull();
  expect(sari.membershipExpiry?.toISOString().slice(0, 10)).toBe("2027-12-31");

  const budi = await prisma.member.findUniqueOrThrow({ where: { email: e2 } });
  expect(budi.planId).toBe(f.monthly.id);
  expect(decrypt(budi.phoneWhatsapp)).toBe("0812 0000 3333");
  const daysLeft = (budi.membershipExpiry!.getTime() - Date.now()) / DAY;
  expect(daysLeft).toBeGreaterThan(28);
  expect(daysLeft).toBeLessThan(31);

  const lila = await prisma.member.findUniqueOrThrow({ where: { email: e3 } });
  expect(lila.status).toBe("EXPIRED");

  // Every imported member has an activation link and a logged activation message; nobody has a payment.
  for (const m of [sari, budi, lila]) {
    expect(await prisma.magicLink.count({ where: { memberId: m.id, purpose: "activate", usedAt: null } })).toBe(1);
    expect(await prisma.notificationLog.count({ where: { memberId: m.id, type: "member_activation" } })).toBeGreaterThan(0);
  }
  expect(await prisma.payment.count({ where: { gymId: f.gym.id } })).toBe(0);
  expect(await prisma.member.count({ where: { gymId: f.gym.id } })).toBe(4);

  // Importing the same file again is a no-op: everyone is "already here".
  const again = await importCsv(request, baseURL!, f.slug, csv, { planId: f.monthly.id });
  const a = await again.json();
  expect(a.created).toBe(0);
  expect(a.summary.skipped).toBe(4);
  expect(await prisma.member.count({ where: { gymId: f.gym.id } })).toBe(4);
});

test("import respects the plan's member limit, can stay quiet, needs a default plan, and is owner-only", async ({ request, baseURL, playwright }) => {
  const f = await makeGym(2);
  await login(request, baseURL!, f.slug, f.owner);

  const csv = ["Name,Email,Phone", ...[1, 2, 3].map((i) => `Member ${i},${uniq(`lim${i}`)}@test.local,08120000${String(i).padStart(4, "0")}`)].join("\n");

  // No plan column and no default: refused before anything is read.
  const noPlan = await importCsv(request, baseURL!, f.slug, csv, { planId: "" });
  expect(noPlan.status()).toBe(400);
  expect((await noPlan.json()).error).toContain("default plan");

  const quiet = await importCsv(request, baseURL!, f.slug, csv, { planId: f.monthly.id, notify: false });
  expect(quiet.status(), await quiet.text()).toBe(200);
  const q = await quiet.json();
  expect(q.created).toBe(2);
  expect(q.rows[2].outcome).toBe("error");
  expect(q.rows[2].reason).toContain("allows 2 members");
  expect(await prisma.member.count({ where: { gymId: f.gym.id } })).toBe(2);
  // Quiet import: links exist, nothing was sent.
  expect(await prisma.notificationLog.count({ where: { gymId: f.gym.id } })).toBe(0);
  expect(await prisma.magicLink.count({ where: { member: { gymId: f.gym.id } } })).toBe(2);

  // Bad inputs are told apart.
  const missing = await importCsv(request, baseURL!, f.slug, "Nama,Alamat\nA,B", { planId: f.monthly.id });
  expect(missing.status()).toBe(400);
  expect((await missing.json()).error).toContain("Email, Phone");
  const empty = await request.post(`${baseURL}/api/${f.slug}/members/import`, { multipart: { planId: f.monthly.id, dryRun: "1" } });
  expect(empty.status()).toBe(400);

  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  const asStaff = await staffCtx.post(`${baseURL}/api/${f.slug}/members/import`, {
    multipart: { file: { name: "m.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }, planId: f.monthly.id, dryRun: "1" },
  });
  expect(asStaff.status()).toBe(403);
  await staffCtx.dispose();
});

test("the members page shows Export and Import to the owner only, and the import panel previews a file", async ({ browser, page, baseURL }) => {
  const f = await makeGym();
  const staffPage = await (await browser.newContext()).newPage();
  await staffLoginUI(staffPage, baseURL!, f.slug, f.staff.email, f.staff.password);
  await staffPage.waitForURL(`${baseURL}/${f.slug}/dashboard`);
  await staffPage.goto(`${baseURL}/${f.slug}/members`);
  await expect(staffPage.getByRole("button", { name: "+ Add member" })).toBeVisible();
  await expect(staffPage.getByRole("link", { name: "Export CSV" })).toHaveCount(0);
  await expect(staffPage.getByRole("button", { name: "Import CSV" })).toHaveCount(0);
  await staffPage.context().close();

  await staffLoginUI(page, baseURL!, f.slug, f.owner.email, f.owner.password);
  await page.waitForURL(`${baseURL}/${f.slug}/dashboard`);
  await page.goto(`${baseURL}/${f.slug}/members`);
  await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", `/api/${f.slug}/members/export`);
  await page.getByRole("button", { name: "Import CSV" }).click();
  await expect(page.getByRole("link", { name: "Download a template" })).toBeVisible();

  const email = `${uniq("ui")}@test.local`;
  await page.locator('input[type="file"]').setInputFiles({
    name: "members.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`Name,Email,Phone,Plan\nUi Member,${email},081200009999,Annual\nBad,${uniq("bad")}@test.local,abc,\n`),
  });
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("1 to import")).toBeVisible();
  await expect(page.getByText("1 with problems")).toBeVisible();
  await expect(page.getByText("Phone number has letters in it")).toBeVisible();
  await page.getByRole("button", { name: "Import 1 member" }).click();
  await expect(page.getByText("1 member imported.")).toBeVisible();
  const created = await prisma.member.findUniqueOrThrow({ where: { email } });
  expect(created.planId).toBe(f.annual.id);
  // The roster behind the panel refreshed with the new member on it.
  await expect(page.getByRole("link", { name: "Ui Member" })).toBeVisible();
});

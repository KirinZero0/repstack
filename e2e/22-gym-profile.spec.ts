import fs from "fs";
import path from "path";
import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { MAX_GYM_PHOTOS } from "../src/lib/validation/tenant";

const PHOTO = path.join(__dirname, "fixtures", "test-photo.jpg");
let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

/** A throwaway gym with an owner and a staff account. */
async function makeGym() {
  const tag = uniq("prof");
  const saasPlan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const gym = await prisma.gym.create({
    data: { name: `Profile Gym ${tag}`, slug: tag, saasPlanId: saasPlan.id, subscriptionStatus: "ACTIVE" },
  });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  const staff = { email: `staff-${tag}@test.local`, password: "staff-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Staffer", email: staff.email, passwordHash: await bcrypt.hash(staff.password, 10), role: "STAFF" } });
  return { gym, owner, staff, slug: tag };
}

async function login(request: APIRequestContext, baseURL: string, slug: string, who: { email: string; password: string }) {
  const res = await request.post(`${baseURL}/api/${slug}/staff-login`, { data: who });
  expect(res.ok(), `login ${who.email}`).toBeTruthy();
}

function uploadPhoto(request: APIRequestContext, baseURL: string, slug: string) {
  return request.post(`${baseURL}/api/${slug}/photos`, {
    multipart: { photo: { name: "gym.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(PHOTO) } },
  });
}

test("the public page shows a gym's name, description, address and photos; unknown slugs 404", async ({ request, baseURL }) => {
  const f = await makeGym();
  await prisma.gym.update({
    where: { id: f.gym.id },
    data: { description: "Open 6am to 10pm.\nFree weights, cardio and a boxing ring.", address: "Jl. Sudirman 12, Jakarta", photoUrls: ["https://mock-blob.local/gym-photos/x/1", "https://mock-blob.local/gym-photos/x/2"] },
  });

  const res = await request.get(`${baseURL}/${f.slug}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain(f.gym.name);
  expect(html).toContain("Open 6am to 10pm.");
  expect(html).toContain("Jl. Sudirman 12, Jakarta");
  expect(html).toContain("https://mock-blob.local/gym-photos/x/1");
  expect(html).toContain("https://mock-blob.local/gym-photos/x/2");
  expect(html).toContain(`/${f.slug}/login`);
  // The join page is switched off platform-wide right now, so there's no join call to action.
  expect(html).not.toContain(`/${f.slug}/join"`);

  expect((await request.get(`${baseURL}/no-such-gym-${Date.now()}`)).status()).toBe(404);
});

test("the public page never leaks member data or money", async ({ request, baseURL }) => {
  const f = await makeGym();
  const plan = await prisma.membershipPlan.create({ data: { gymId: f.gym.id, name: "Secret Plan", durationDays: 30, price: 123456 } });
  const { encrypt, hmacLookup } = await import("../src/lib/crypto");
  await prisma.member.create({
    data: { gymId: f.gym.id, planId: plan.id, fullName: "Very Private Person", email: `${uniq("priv")}@test.local`, phoneWhatsapp: encrypt("081200009999"), phoneWhatsappLookup: hmacLookup("081200009999"), status: "ACTIVE" },
  });
  const html = await (await request.get(`${baseURL}/${f.slug}`)).text();
  expect(html).not.toContain("Very Private Person");
  expect(html).not.toContain("123456");
  expect(html).not.toContain("081200009999");
});

test("owner edits the public description and address from settings", async ({ request, baseURL }) => {
  const f = await makeGym();
  await login(request, baseURL!, f.slug, f.owner);

  const settingsHtml = await (await request.get(`${baseURL}/${f.slug}/settings`)).text();
  expect(settingsHtml).toContain("Public page");
  expect(settingsHtml).toContain("Gym photos");

  const ok = await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { description: "Best gym in town", address: "Somewhere 1" } });
  expect(ok.ok()).toBeTruthy();
  const row = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(row.description).toBe("Best gym in town");
  expect(row.address).toBe("Somewhere 1");
  expect(await (await request.get(`${baseURL}/${f.slug}`)).text()).toContain("Best gym in town");

  // Blank clears, too long is rejected.
  expect((await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { description: "" } })).ok()).toBeTruthy();
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).description).toBeNull();
  expect((await request.post(`${baseURL}/api/${f.slug}/settings`, { data: { description: "x".repeat(1001) } })).status()).toBe(400);
});

test("owner uploads and removes gym photos, and hits the cap", async ({ request, baseURL }) => {
  const f = await makeGym();
  await login(request, baseURL!, f.slug, f.owner);

  // BLOB_READ_WRITE_TOKEN isn't set in the test env, so uploads are faked with a mock URL (src/lib/blob.ts).
  const up = await uploadPhoto(request, baseURL!, f.slug);
  expect(up.status()).toBe(201);
  const { url } = await up.json();
  expect(url).toContain("gym-photos/");
  let row = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(row.photoUrls).toEqual([url]);
  expect(await (await request.get(`${baseURL}/${f.slug}`)).text()).toContain(url);

  // Wrong type and empty uploads are rejected.
  const bad = await request.post(`${baseURL}/api/${f.slug}/photos`, {
    multipart: { photo: { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") } },
  });
  expect(bad.status()).toBe(400);
  expect((await request.post(`${baseURL}/api/${f.slug}/photos`, { multipart: {} })).status()).toBe(400);

  // Fill up to the cap; one more is refused with a clear message.
  for (let i = 1; i < MAX_GYM_PHOTOS; i++) expect((await uploadPhoto(request, baseURL!, f.slug)).status()).toBe(201);
  const over = await uploadPhoto(request, baseURL!, f.slug);
  expect(over.status()).toBe(409);
  expect((await over.json()).error).toContain(String(MAX_GYM_PHOTOS));
  row = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(row.photoUrls).toHaveLength(MAX_GYM_PHOTOS);

  // Remove one: gone from the list and the page, and a URL the gym doesn't hold can't be removed.
  const rm = await request.post(`${baseURL}/api/${f.slug}/photos/remove`, { data: { url } });
  expect(rm.ok()).toBeTruthy();
  row = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(row.photoUrls).toHaveLength(MAX_GYM_PHOTOS - 1);
  expect(row.photoUrls).not.toContain(url);
  expect(await (await request.get(`${baseURL}/${f.slug}`)).text()).not.toContain(url);
  expect((await request.post(`${baseURL}/api/${f.slug}/photos/remove`, { data: { url: "https://mock-blob.local/gym-photos/other/1" } })).status()).toBe(404);
  expect((await request.post(`${baseURL}/api/${f.slug}/photos/remove`, { data: { url: "not a url" } })).status()).toBe(400);
});

test("staff can't touch photos or the profile, and another gym's owner can't either", async ({ request, baseURL, playwright }) => {
  const f = await makeGym();
  await login(request, baseURL!, f.slug, f.owner);
  const { url } = await (await uploadPhoto(request, baseURL!, f.slug)).json();

  // Anonymous.
  const anon = await playwright.request.newContext();
  expect((await uploadPhoto(anon, baseURL!, f.slug)).status()).toBe(401);
  expect((await anon.post(`${baseURL}/api/${f.slug}/photos/remove`, { data: { url } })).status()).toBe(401);
  await anon.dispose();

  // Staff (non-owner) of the same gym: 403.
  const staffCtx = await playwright.request.newContext();
  await login(staffCtx, baseURL!, f.slug, f.staff);
  expect((await uploadPhoto(staffCtx, baseURL!, f.slug)).status()).toBe(403);
  expect((await staffCtx.post(`${baseURL}/api/${f.slug}/photos/remove`, { data: { url } })).status()).toBe(403);
  expect((await staffCtx.post(`${baseURL}/api/${f.slug}/settings`, { data: { description: "hacked" } })).status()).toBe(403);
  await staffCtx.dispose();

  // Another gym's owner, through this gym's URL: the session belongs elsewhere.
  const other = await makeGym();
  const otherCtx = await playwright.request.newContext();
  await login(otherCtx, baseURL!, other.slug, other.owner);
  expect((await uploadPhoto(otherCtx, baseURL!, f.slug)).status()).toBe(401);
  expect((await otherCtx.post(`${baseURL}/api/${f.slug}/photos/remove`, { data: { url } })).status()).toBe(401);
  // And through their own gym's URL, this gym's photo URL isn't theirs to remove.
  expect((await otherCtx.post(`${baseURL}/api/${other.slug}/photos/remove`, { data: { url } })).status()).toBe(404);
  await otherCtx.dispose();

  const row = await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } });
  expect(row.photoUrls).toEqual([url]);
  expect(row.description).toBeNull();
});

test("a suspended gym still has a public page, with no way to join", async ({ request, baseURL }) => {
  const f = await makeGym();
  await prisma.gym.update({ where: { id: f.gym.id }, data: { subscriptionStatus: "SUSPENDED", settings: { acceptSignups: true }, description: "Still here" } });
  const res = await request.get(`${baseURL}/${f.slug}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain("Still here");
  expect(html).not.toContain(`/${f.slug}/join"`);
});

test("owner sees the photo manager in the browser and can upload from it", async ({ page, baseURL }) => {
  const f = await makeGym();
  await page.goto(`${baseURL}/${f.slug}/login`);
  await page.getByLabel("Email").fill(f.owner.email);
  await page.getByLabel("Password").fill(f.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${baseURL}/${f.slug}/dashboard`);

  await page.goto(`${baseURL}/${f.slug}/settings`);
  await expect(page.getByText("No photos yet.")).toBeVisible({ timeout: 20_000 });
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').setInputFiles(PHOTO);
  await expect(page.getByRole("button", { name: "Remove photo 1" })).toBeVisible({ timeout: 20_000 });
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: f.gym.id } })).photoUrls).toHaveLength(1);
});

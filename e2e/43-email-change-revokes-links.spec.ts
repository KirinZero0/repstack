import { test, expect, type APIRequestContext } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "./helpers";
import { encrypt, hmacLookup, normalizePhone } from "../src/lib/crypto";
import { createMagicLink } from "../src/lib/magicLink";
import { createPasswordReset } from "../src/lib/passwordReset";

let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

async function setup() {
  const tag = uniq("rv");
  const plan = await prisma.saasPlan.create({
    data: { name: tag, price: 1, billingInterval: "monthly", maxMembers: 100, maxStaff: 5, maxWhatsappPerMonth: 500 },
  });
  const gym = await prisma.gym.create({ data: { name: `Rv ${tag}`, slug: tag, saasPlanId: plan.id, subscriptionStatus: "ACTIVE" } });
  const owner = { email: `owner-${tag}@test.local`, password: "owner-pass-123" };
  await prisma.staffUser.create({ data: { gymId: gym.id, name: "Owner", email: owner.email, passwordHash: await bcrypt.hash(owner.password, 10), role: "OWNER" } });
  const memberPlan = await prisma.membershipPlan.create({ data: { gymId: gym.id, name: "M", durationDays: 30, price: 1 } });
  const phone = `0812${Date.now().toString().slice(-8)}${seq}`;
  const member = await prisma.member.create({
    data: { gymId: gym.id, planId: memberPlan.id, fullName: "Rv Member", email: `${tag}@test.local`, phoneWhatsapp: encrypt(phone), phoneWhatsappLookup: hmacLookup(normalizePhone(phone)) },
  });
  const activate = await createMagicLink({ memberId: member.id, purpose: "activate", expiresInMs: 86_400_000 });
  const fallback = await createMagicLink({ memberId: member.id, purpose: "qr_fallback", expiresInMs: 86_400_000 });
  const reset = await createPasswordReset({ kind: "member", subjectId: member.id, purpose: "reset" });
  return { gym, owner, slug: tag, member, activateToken: activate.token, fallbackToken: fallback.token, resetToken: reset };
}

const edit = (request: APIRequestContext, baseURL: string, slug: string, memberId: string, data: unknown) =>
  request.patch(`${baseURL}/api/${slug}/members/${memberId}`, { data });

test("changing a member's email kills their password links, but not the QR link", async ({ request, baseURL }) => {
  const f = await setup();
  await request.post(`${baseURL}/api/${f.slug}/login`, { data: f.owner });

  // Both links work before the change.
  expect((await request.get(`${baseURL}/api/activate/${f.activateToken}`)).ok()).toBeTruthy();
  expect((await request.get(`${baseURL}/api/reset/${f.resetToken}`)).ok()).toBeTruthy();

  // Editing something else, or saving the same email, leaves them alone.
  const same = await edit(request, baseURL!, f.slug, f.member.id, { action: "edit", fullName: "Renamed", email: f.member.email });
  expect((await same.json()).linksRevoked).toBe(0);
  expect((await request.get(`${baseURL}/api/activate/${f.activateToken}`)).ok()).toBeTruthy();

  const res = await edit(request, baseURL!, f.slug, f.member.id, { action: "edit", email: `${uniq("new")}@test.local` });
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).linksRevoked).toBe(2);

  expect((await request.get(`${baseURL}/api/activate/${f.activateToken}`)).status()).toBe(404);
  expect((await request.get(`${baseURL}/api/reset/${f.resetToken}`)).status()).toBe(404);
  // Setting a password with the old links is refused too.
  expect((await request.post(`${baseURL}/api/reset/${f.resetToken}`, { data: { password: "brand-new-pass-1" } })).ok()).toBeFalsy();
  const row = await prisma.member.findUniqueOrThrow({ where: { id: f.member.id } });
  expect(row.passwordHash).toBeNull();

  // The QR-only link isn't a password link, so it keeps working.
  const qr = await prisma.magicLink.findFirstOrThrow({ where: { memberId: f.member.id, purpose: "qr_fallback" } });
  expect(qr.usedAt).toBeNull();

  // Staff can still hand the member a fresh link afterwards.
  const fresh = await request.post(`${baseURL}/api/${f.slug}/members/${f.member.id}/reset-link`);
  expect(fresh.ok()).toBeTruthy();
  const url = (await fresh.json()).url as string;
  expect((await request.get(`${baseURL}/api/reset/${url.split("/").pop()}`)).ok()).toBeTruthy();
});

test("another gym's members' links are untouched when one member's email changes", async ({ request, baseURL }) => {
  const a = await setup();
  const b = await setup();
  await request.post(`${baseURL}/api/${a.slug}/login`, { data: a.owner });
  await edit(request, baseURL!, a.slug, a.member.id, { action: "edit", email: `${uniq("moved")}@test.local` });
  expect((await request.get(`${baseURL}/api/activate/${b.activateToken}`)).ok()).toBeTruthy();
  expect((await request.get(`${baseURL}/api/reset/${b.resetToken}`)).ok()).toBeTruthy();
});

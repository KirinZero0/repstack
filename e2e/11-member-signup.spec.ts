import fs from "fs";
import path from "path";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { prisma } from "./helpers";
import { encrypt, hmacLookup } from "../src/lib/crypto";
import { JOIN_PAGE_ENABLED } from "../src/lib/memberSignup";

const DAY = 24 * 60 * 60 * 1000;
const PROOF = path.join(__dirname, "fixtures", "test-photo.jpg");
const SKIP_REASON = "public join page is disabled until there's a business bank account to point it at";

async function setSignups(request: APIRequestContext, baseURL: string, slug: string, ownerEmail: string, on: boolean) {
  const login = await request.post(`${baseURL}/api/g/${slug}/staff-login`, { data: { email: ownerEmail, password: "owner-pass-123" } });
  expect(login.ok()).toBeTruthy();
  const res = await request.post(`${baseURL}/api/g/${slug}/settings`, { data: { acceptSignups: on } });
  expect(res.ok()).toBeTruthy();
}

async function loginOwner(request: APIRequestContext, baseURL: string, slug: string, email: string) {
  const res = await request.post(`${baseURL}/api/g/${slug}/staff-login`, { data: { email, password: "owner-pass-123" } });
  expect(res.ok()).toBeTruthy();
}

let seq = 0;
const details = (planId: string, tag: string) => ({
  planId,
  fullName: `Joiner ${tag}`,
  email: `join-${tag}-${Date.now()}-${seq++}@join.test`,
  phone: `0815${Date.now().toString().slice(-8)}`,
  password: "long-enough-1",
  acceptTerms: true,
});

/** The join route takes a manual bank-transfer request as multipart form data, proof image optional. */
function postJoin(
  request: APIRequestContext,
  baseURL: string,
  slug: string,
  d: ReturnType<typeof details>,
  headers: Record<string, string>,
  withProof = false,
) {
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    planId: d.planId,
    fullName: d.fullName,
    email: d.email,
    phone: d.phone,
    password: d.password,
    acceptTerms: String(d.acceptTerms),
  };
  if (withProof) {
    multipart.proof = { name: "proof.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(PROOF) };
  }
  return request.post(`${baseURL}/api/g/${slug}/join`, { multipart, headers });
}

test("public sign-up is off by default, then staff approving a manual transfer request creates an active member who can log in", async ({
  request,
  baseURL,
}) => {
  test.skip(!JOIN_PAGE_ENABLED, SKIP_REASON);
  const gymA = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gymA.id, isActive: true } });
  const ip = { "x-forwarded-for": "10.1.0.1" };

  // Off by default: nothing is created.
  const before = await postJoin(request, baseURL!, "test-gym-a", details(plan.id, "off"), ip);
  expect(before.status()).toBe(403);

  await setSignups(request, baseURL!, "test-gym-a", "owner-a@test.local", true);

  const d = details(plan.id, "ok");
  const started = await postJoin(request, baseURL!, "test-gym-a", d, ip, true);
  expect(started.ok()).toBeTruthy();
  const { signupId } = await started.json();
  expect(signupId).toBeTruthy();

  // Nothing exists until staff approves it, and they can't log in yet.
  expect(await prisma.member.findUnique({ where: { email: d.email } })).toBeNull();
  const status = () => request.get(`${baseURL}/api/g/test-gym-a/join/${signupId}/status`).then((r) => r.json());
  expect((await status()).status).toBe("PENDING_REVIEW");
  expect((await request.post(`${baseURL}/api/g/test-gym-a/member-login`, { data: { email: d.email, password: d.password } })).status()).toBe(401);

  const signupRow = await prisma.memberSignup.findUniqueOrThrow({ where: { id: signupId } });
  expect(signupRow.proofImageUrl).toBeTruthy();

  // Same details again resume the same request instead of duplicating it.
  const again = await postJoin(request, baseURL!, "test-gym-a", d, ip);
  expect((await again.json()).signupId).toBe(signupId);
  expect(await prisma.memberSignup.count({ where: { email: d.email } })).toBe(1);

  // Owner reviews and approves.
  await loginOwner(request, baseURL!, "test-gym-a", "owner-a@test.local");
  const approve = await request.post(`${baseURL}/api/g/test-gym-a/join/${signupId}/approve`);
  expect(approve.ok()).toBeTruthy();

  const member = await prisma.member.findUniqueOrThrow({ where: { email: d.email } });
  expect(member.gymId).toBe(gymA.id);
  expect(member.status).toBe("ACTIVE");
  expect(member.planId).toBe(plan.id);
  const days = (member.membershipExpiry!.getTime() - Date.now()) / DAY;
  expect(days).toBeGreaterThan(plan.durationDays - 1);
  expect(days).toBeLessThan(plan.durationDays + 1);
  expect(await prisma.member.count({ where: { email: d.email } })).toBe(1);
  const payments = await prisma.payment.findMany({ where: { memberId: member.id } });
  expect(payments).toHaveLength(1);
  expect(payments[0].status).toBe("PAID");
  expect(payments[0].provider).toBe("CASH");
  expect(await prisma.notificationLog.count({ where: { memberId: member.id, type: "member_welcome" } })).toBe(1);
  expect((await status()).status).toBe("COMPLETED");

  // Phone is stored encrypted, and they can log in with the password they chose.
  expect(member.phoneWhatsapp.startsWith("v1:")).toBe(true);
  const login = await request.post(`${baseURL}/api/g/test-gym-a/member-login`, { data: { email: d.email, password: d.password } });
  expect(login.ok()).toBeTruthy();

  // Can't approve (or reject) an already-completed request.
  expect((await request.post(`${baseURL}/api/g/test-gym-a/join/${signupId}/approve`)).status()).toBe(409);
  expect((await request.post(`${baseURL}/api/g/test-gym-a/join/${signupId}/reject`)).status()).toBe(409);
});

test("staff rejects a request that can't be verified, and no member is created", async ({ request, baseURL }) => {
  test.skip(!JOIN_PAGE_ENABLED, SKIP_REASON);
  await setSignups(request, baseURL!, "test-gym-a", "owner-a@test.local", true);
  const gymA = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gymA.id, isActive: true } });
  const d = details(plan.id, "rej");
  const started = await postJoin(request, baseURL!, "test-gym-a", d, { "x-forwarded-for": "10.1.0.4" });
  const { signupId } = await started.json();

  await loginOwner(request, baseURL!, "test-gym-a", "owner-a@test.local");
  const reject = await request.post(`${baseURL}/api/g/test-gym-a/join/${signupId}/reject`);
  expect(reject.ok()).toBeTruthy();

  expect((await prisma.memberSignup.findUniqueOrThrow({ where: { id: signupId } })).status).toBe("REJECTED");
  expect(await prisma.member.findUnique({ where: { email: d.email } })).toBeNull();

  const status = await request.get(`${baseURL}/api/g/test-gym-a/join/${signupId}/status`).then((r) => r.json());
  expect(status.status).toBe("REJECTED");

  // Can't reject twice, and a rejected request can't later be approved.
  expect((await request.post(`${baseURL}/api/g/test-gym-a/join/${signupId}/reject`)).status()).toBe(409);
  expect((await request.post(`${baseURL}/api/g/test-gym-a/join/${signupId}/approve`)).status()).toBe(409);
});

test("approving, rejecting and viewing proof of a join request respect tenant isolation", async ({ request, baseURL }) => {
  test.skip(!JOIN_PAGE_ENABLED, SKIP_REASON);
  await setSignups(request, baseURL!, "test-gym-a", "owner-a@test.local", true);
  const gymA = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gymA.id, isActive: true } });
  const d = details(plan.id, "iso");
  const started = await postJoin(request, baseURL!, "test-gym-a", d, { "x-forwarded-for": "10.1.0.5" }, true);
  const { signupId } = await started.json();

  // Gym B's owner can't approve, reject or view the proof for gym A's request.
  await loginOwner(request, baseURL!, "test-gym-b", "owner-b@test.local");
  expect((await request.post(`${baseURL}/api/g/test-gym-b/join/${signupId}/approve`)).status()).toBe(409);
  expect((await request.post(`${baseURL}/api/g/test-gym-b/join/${signupId}/reject`)).status()).toBe(409);
  expect((await request.get(`${baseURL}/api/g/test-gym-b/join/${signupId}/proof`)).status()).toBe(404);
  expect((await prisma.memberSignup.findUniqueOrThrow({ where: { id: signupId } })).status).toBe("PENDING_REVIEW");

  // Gym A's own owner can.
  await loginOwner(request, baseURL!, "test-gym-a", "owner-a@test.local");
  expect((await request.get(`${baseURL}/api/g/test-gym-a/join/${signupId}/proof`)).ok()).toBeTruthy();
});

test("join rejects hidden/foreign plans, existing emails and closed gyms", async ({ request, baseURL }) => {
  test.skip(!JOIN_PAGE_ENABLED, SKIP_REASON);
  await setSignups(request, baseURL!, "test-gym-a", "owner-a@test.local", true);
  const gymA = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  const gymB = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-b" } });
  const planA = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gymA.id, isActive: true } });
  const planB = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gymB.id } });
  const hidden = await prisma.membershipPlan.create({ data: { gymId: gymA.id, name: "Hidden join", durationDays: 30, price: 99000, isActive: false } });
  const ip = { "x-forwarded-for": "10.1.0.2" };
  const post = (slug: string, d: ReturnType<typeof details>) => postJoin(request, baseURL!, slug, d, ip);

  // Gym B never turned sign-up on.
  expect((await post("test-gym-b", details(planB.id, "b"))).status()).toBe(403);
  // Gym A's join can't use gym B's plan or a hidden plan.
  expect((await post("test-gym-a", details(planB.id, "x"))).status()).toBe(400);
  expect((await post("test-gym-a", details(hidden.id, "h"))).status()).toBe(400);
  // An email that already has an account (here at gym A, but it could be any gym).
  const taken = await post("test-gym-a", { ...details(planA.id, "t"), email: "active-member@test.local" });
  expect(taken.status()).toBe(409);
  expect((await taken.json()).field).toBe("email");
  // Bad input.
  expect((await post("test-gym-a", { ...details(planA.id, "p"), password: "short" })).status()).toBe(400);
  expect((await post("test-gym-nope", details(planA.id, "n"))).status()).toBe(404);
});

test("a request approved after its email was registered meanwhile is flagged, not duplicated", async ({ request, baseURL }) => {
  test.skip(!JOIN_PAGE_ENABLED, SKIP_REASON);
  await setSignups(request, baseURL!, "test-gym-a", "owner-a@test.local", true);
  const gymA = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gymA.id, isActive: true } });
  const d = details(plan.id, "race");
  const started = await postJoin(request, baseURL!, "test-gym-a", d, { "x-forwarded-for": "10.1.0.3" });
  const { signupId } = await started.json();

  // Staff adds the same email before the request is reviewed.
  const phone = "081200009999";
  await prisma.member.create({
    data: { gymId: gymA.id, planId: plan.id, fullName: "Staff added", email: d.email, phoneWhatsapp: encrypt(phone), phoneWhatsappLookup: hmacLookup(phone), status: "PENDING_PAYMENT" },
  });

  await loginOwner(request, baseURL!, "test-gym-a", "owner-a@test.local");
  expect((await request.post(`${baseURL}/api/g/test-gym-a/join/${signupId}/approve`)).status()).toBe(409);
  expect((await prisma.memberSignup.findUniqueOrThrow({ where: { id: signupId } })).status).toBe("CONFLICT");
  expect(await prisma.member.count({ where: { email: d.email } })).toBe(1);
});

test("sign-ups are throttled per IP", async ({ request, baseURL }) => {
  test.skip(!JOIN_PAGE_ENABLED, SKIP_REASON);
  await setSignups(request, baseURL!, "test-gym-a", "owner-a@test.local", true);
  const gymA = await prisma.gym.findUniqueOrThrow({ where: { slug: "test-gym-a" } });
  const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { gymId: gymA.id, isActive: true } });
  const ip = { "x-forwarded-for": "10.9.9.9" };

  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) {
    const r = await postJoin(request, baseURL!, "test-gym-a", details(plan.id, `thr${i}`), ip);
    statuses.push(r.status());
  }
  expect(statuses.slice(0, 5).every((s) => s === 200)).toBeTruthy();
  expect(statuses.slice(5)).toEqual([429, 429]);
});

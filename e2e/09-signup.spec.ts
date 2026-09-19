import { test, expect } from "@playwright/test";
import { prisma } from "./helpers";

const headers = () => ({ "x-callback-token": process.env.XENDIT_CALLBACK_TOKEN! });
const paid = (id: string) => ({ id: `evt_${id}`, external_id: id, status: "PAID", paid_at: new Date().toISOString() });

test("self-serve signup: gym only exists after payment, then the owner can log in", async ({ request, baseURL }) => {
  const plan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const stamp = Date.now();
  const details = {
    saasPlanId: plan.id,
    gymName: "Signup Test Gym",
    slug: `signup-gym-${stamp}`,
    ownerName: "Sig Owner",
    ownerEmail: `owner-${stamp}@signup.test`,
    password: "correct-horse-1",
  };

  const started = await request.post(`${baseURL}/api/signup`, { data: details });
  expect(started.ok()).toBeTruthy();
  const { signupId, invoiceUrl } = await started.json();
  expect(invoiceUrl).toContain(signupId);

  // Nothing exists yet, and the owner can't log in.
  expect(await prisma.gym.findUnique({ where: { slug: details.slug } })).toBeNull();
  const early = await request.post(`${baseURL}/api/g/${details.slug}/staff-login`, {
    data: { email: details.ownerEmail, password: details.password },
  });
  expect(early.status()).toBe(404);
  expect((await (await request.get(`${baseURL}/api/signup/${signupId}/status`)).json()).status).toBe("PENDING");

  // Retrying with the same details resumes the same signup instead of stacking a second one.
  const retry = await request.post(`${baseURL}/api/signup`, { data: details });
  expect((await retry.json()).signupId).toBe(signupId);
  expect(await prisma.gymSignup.count({ where: { slug: details.slug } })).toBe(1);

  // While it's unpaid, someone else can't grab the same address.
  const held = await request.post(`${baseURL}/api/signup`, { data: { ...details, ownerEmail: `other-${stamp}@signup.test` } });
  expect(held.status()).toBe(409);
  expect((await held.json()).field).toBe("slug");

  // Payment clears, delivered twice.
  expect((await request.post(`${baseURL}/api/webhooks/xendit`, { data: paid(signupId), headers: headers() })).ok()).toBeTruthy();
  expect((await request.post(`${baseURL}/api/webhooks/xendit`, { data: paid(signupId), headers: headers() })).ok()).toBeTruthy();

  const gym = await prisma.gym.findUniqueOrThrow({ where: { slug: details.slug }, include: { staff: true } });
  expect(gym.subscriptionStatus).toBe("ACTIVE");
  expect(gym.isLifetime).toBe(false);
  expect(gym.nextBillingDate!.getTime()).toBeGreaterThan(Date.now() + 25 * 24 * 60 * 60 * 1000);
  expect(gym.staff).toHaveLength(1);
  expect(gym.staff[0].role).toBe("OWNER");
  expect(await prisma.gym.count({ where: { slug: details.slug } })).toBe(1);
  expect(await prisma.platformPayment.count({ where: { gymId: gym.id, status: "PAID" } })).toBe(1);
  expect((await (await request.get(`${baseURL}/api/signup/${signupId}/status`)).json()).status).toBe("COMPLETED");

  // The owner logs in with the password they chose.
  const login = await request.post(`${baseURL}/api/g/${details.slug}/staff-login`, {
    data: { email: details.ownerEmail, password: details.password },
  });
  expect(login.ok()).toBeTruthy();
  expect((await login.json()).role).toBe("OWNER");
});

test("signup rejects taken, reserved and invalid details", async ({ request, baseURL }) => {
  const plan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const base = { saasPlanId: plan.id, gymName: "X Gym", slug: `ok-${Date.now()}`, ownerName: "Owner", ownerEmail: `ok-${Date.now()}@signup.test`, password: "long-enough-1" };
  const post = (over: object) => request.post(`${baseURL}/api/signup`, { data: { ...base, ...over } });

  const takenSlug = await post({ slug: "test-gym-a" });
  expect(takenSlug.status()).toBe(409);
  expect((await takenSlug.json()).field).toBe("slug");

  const takenEmail = await post({ ownerEmail: "owner-a@test.local" });
  expect(takenEmail.status()).toBe(409);
  expect((await takenEmail.json()).field).toBe("ownerEmail");

  expect((await post({ slug: "superadmin" })).status()).toBe(409);
  expect((await post({ slug: "Bad Slug!" })).status()).toBe(400);
  expect((await post({ password: "short" })).status()).toBe(400);
  expect((await post({ saasPlanId: "00000000-0000-4000-8000-000000000000" })).status()).toBe(400);
});

test("a paid signup whose address was taken meanwhile is flagged, not duplicated", async ({ request, baseURL }) => {
  const plan = await prisma.saasPlan.findFirstOrThrow({ where: { isActive: true } });
  const stamp = Date.now() + 1;
  const slug = `race-gym-${stamp}`;
  const started = await request.post(`${baseURL}/api/signup`, {
    data: { saasPlanId: plan.id, gymName: "Race Gym", slug, ownerName: "Racer", ownerEmail: `race-${stamp}@signup.test`, password: "long-enough-1" },
  });
  const { signupId } = await started.json();

  // Someone else claims the address before payment lands.
  await prisma.gym.create({ data: { name: "Squatter", slug, saasPlanId: plan.id, subscriptionStatus: "ACTIVE" } });

  await request.post(`${baseURL}/api/webhooks/xendit`, { data: paid(signupId), headers: headers() });
  expect((await prisma.gymSignup.findUniqueOrThrow({ where: { id: signupId } })).status).toBe("CONFLICT");
  expect(await prisma.gym.count({ where: { slug } })).toBe(1);
  expect(await prisma.staffUser.count({ where: { email: `race-${stamp}@signup.test` } })).toBe(0);
});

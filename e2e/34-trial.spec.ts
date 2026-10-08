import { test, expect, type APIRequestContext } from "@playwright/test";
import { prisma } from "./helpers";
import { processPaymentEvent } from "../src/lib/payments";

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;
const uniq = (tag: string) => `${tag}-${Date.now()}-${seq++}`;

async function createGym(request: APIRequestContext, baseURL: string, extra: Record<string, unknown> = {}) {
  const plan = await prisma.saasPlan.findFirstOrThrow({ where: { name: "Starter Monthly" } });
  const slug = uniq("trial");
  const res = await request.post(`${baseURL}/api/superadmin/gyms`, {
    data: { gymName: `Trial ${slug}`, slug, saasPlanId: plan.id, ownerName: "Trial Owner", ownerEmail: `owner-${slug}@test.local`, ownerTempPassword: "owner-pass-123", ...extra },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).gymId as string;
}

test("a new gym starts a trial (14 days unless the superadmin picks another length), a lifetime gym doesn't, and the first payment makes it active", async ({ request, baseURL }) => {
  expect((await request.post(`${baseURL}/api/superadmin/login`, { data: { email: "superadmin@test.local", password: "superadmin-pass-123" } })).ok()).toBeTruthy();

  const gymId = await createGym(request, baseURL!);
  const gym = await prisma.gym.findUniqueOrThrow({ where: { id: gymId } });
  expect(gym.subscriptionStatus).toBe("TRIALING");
  const days = (gym.nextBillingDate!.getTime() - Date.now()) / DAY;
  expect(days).toBeGreaterThan(13.9);
  expect(days).toBeLessThanOrEqual(14);

  // The superadmin can pick another length.
  const longId = await createGym(request, baseURL!, { trialDays: 30 });
  const longDays = ((await prisma.gym.findUniqueOrThrow({ where: { id: longId } })).nextBillingDate!.getTime() - Date.now()) / DAY;
  expect(longDays).toBeGreaterThan(29.9);
  expect(longDays).toBeLessThanOrEqual(30);

  // The superadmin list says how long the trial has left.
  const html = (await (await request.get(`${baseURL}/superadmin/gyms`)).text()).replace(/<!-- -->/g, "");
  expect(html).toContain("trial ends in 14 days");
  expect(html).toContain("trial ends in 30 days");

  // A lifetime gym is never billed, so it has no trial.
  const lifetimeId = await createGym(request, baseURL!, { isLifetime: true });
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: lifetimeId } })).subscriptionStatus).toBe("ACTIVE");

  // A paid subscription invoice turns the trial into an active subscription.
  const payment = await prisma.platformPayment.create({
    data: { gymId, saasPlanId: gym.saasPlanId, provider: "manual", amount: 300000, status: "PENDING" },
  });
  await processPaymentEvent({ id: `t-${payment.id}`, external_id: payment.id, status: "PAID", paid_at: new Date().toISOString() });
  expect((await prisma.gym.findUniqueOrThrow({ where: { id: gymId } })).subscriptionStatus).toBe("ACTIVE");
});

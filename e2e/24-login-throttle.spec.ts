import { test, expect } from "@playwright/test";
import { MAX_LOGIN_ATTEMPTS_PER_IP_HOUR } from "../src/lib/loginThrottle";

/**
 * One budget shared across every login route (global, per-gym, staff, member, superadmin) —
 * cycling between them to dodge a per-route cap still hits the same counter. Each test below uses
 * its own x-forwarded-for so it doesn't collide with the rest of the suite's un-throttled logins
 * (which share the "unknown" bucket, since local requests carry no forwarded-for header).
 */
test("a single IP is cut off after enough login attempts, across every login route", async ({ request, baseURL }) => {
  test.setTimeout(90_000); // MAX_LOGIN_ATTEMPTS_PER_IP_HOUR real bcrypt compares, sequentially
  const ip = { "x-forwarded-for": "10.50.0.1" };
  const attempt = () =>
    request.post(`${baseURL}/api/login`, { headers: ip, data: { email: "nobody@test.local", password: "wrong-password-1" } });

  for (let i = 0; i < MAX_LOGIN_ATTEMPTS_PER_IP_HOUR; i++) {
    const res = await attempt();
    expect(res.status()).toBe(401);
  }
  const blocked = await attempt();
  expect(blocked.status()).toBe(429);

  // The budget is shared: a different login route under the same IP is blocked too.
  const staffLogin = await request.post(`${baseURL}/api/test-gym-a/staff-login`, {
    headers: ip,
    data: { email: "owner-a@test.local", password: "owner-pass-123" },
  });
  expect(staffLogin.status()).toBe(429);
});

test("a different IP has its own, untouched budget", async ({ request, baseURL }) => {
  const res = await request.post(`${baseURL}/api/test-gym-a/staff-login`, {
    headers: { "x-forwarded-for": "10.50.0.2" },
    data: { email: "owner-a@test.local", password: "owner-pass-123" },
  });
  expect(res.ok()).toBeTruthy();
});

import { test, expect } from "@playwright/test";
import { superadminLoginUI, staffLoginUI } from "./helpers";

test("superadmin creates a tenant, suspends it, reactivates it", async ({ page, baseURL }) => {
  await superadminLoginUI(page, baseURL!);

  await expect(page.getByText("suspend-target")).toBeVisible();

  // Suspend the pre-seeded target gym.
  const row = page.locator("tr", { hasText: "suspend-target" });
  await row.getByRole("button", { name: "Suspend" }).click();
  await expect(row.getByText("SUSPENDED")).toBeVisible();

  // Staff login for a suspended gym must be blocked with a clear message — exercised against
  // Gym A's real owner account, since "suspend-target" has no staff account seeded.
  await page.goto(`${baseURL}/superadmin/gyms`);
  const rowA = page.locator("tr", { hasText: "test-gym-a" });
  await rowA.getByRole("button", { name: "Suspend" }).click();
  await expect(rowA.getByText("SUSPENDED")).toBeVisible();

  await staffLoginUI(page, baseURL!, "test-gym-a", "owner-a@test.local", "owner-pass-123");
  await expect(page.getByText(/suspended/i)).toBeVisible();

  await page.goto(`${baseURL}/superadmin/gyms`);
  const rowA2 = page.locator("tr", { hasText: "test-gym-a" });
  await rowA2.getByRole("button", { name: "Reactivate" }).click();
  await expect(rowA2.getByText("ACTIVE")).toBeVisible();

  await staffLoginUI(page, baseURL!, "test-gym-a", "owner-a@test.local", "owner-pass-123");
  await page.waitForURL(`${baseURL}/g/test-gym-a/dashboard`);
});

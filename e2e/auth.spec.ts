import { test, expect } from "@playwright/test";
import {
  getAdminClient,
  createTestUser,
  getUserAuthCookies,
  cleanupTestData,
  TrackedEntities,
  TestUser,
} from "./helpers/test-fixtures";

test.describe("E2E - Authentication Flow", () => {
  const adminClient = getAdminClient();
  const tracked: TrackedEntities = {
    userIds: [],
    installationIds: [],
    repoIds: [],
    settingsIds: [],
    deliveryIds: [],
    jobIds: [],
    reviewIds: [],
    commentIds: [],
  };

  let testUser: TestUser;

  test.beforeAll(async () => {
    testUser = await createTestUser(adminClient, "auth-flow");
    tracked.userIds.push(testUser.id);
  });

  test.afterAll(async () => {
    await cleanupTestData(adminClient, tracked);
  });

  test("unauthenticated access to /dashboard redirects to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /Sign in to PRPilot/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Continue with GitHub/i })).toBeVisible();
  });

  test("unauthenticated access to /dashboard/[repoId] redirects to /login", async ({ page }) => {
    await page.goto("/dashboard/00000000-0000-4000-a000-000000000099");
    await expect(page).toHaveURL(/\/login/);
  });

  test("GET /api/auth/signout returns 405 (POST-only route protection)", async ({ request }) => {
    const res = await request.get("/api/auth/signout");
    expect(res.status()).toBe(405);
  });

  test("authenticated user can view dashboard and sign out securely", async ({ context, page }) => {
    const authCookies = await getUserAuthCookies(testUser);
    await context.addCookies(authCookies);

    // 1. Visit dashboard as signed-in user
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(testUser.username)).toBeVisible();

    // 2. Click Sign Out button in header
    const signOutBtn = page.getByRole("button", { name: /Sign Out/i });
    await expect(signOutBtn).toBeVisible();
    await signOutBtn.click();

    // 3. User is redirected away (e.g. to / or /login)
    await page.waitForURL((url) => !url.pathname.startsWith("/dashboard"));

    // 4. Verify accessing /dashboard again now redirects back to /login
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});

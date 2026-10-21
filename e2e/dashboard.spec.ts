import { test, expect } from "@playwright/test";
import {
  getAdminClient,
  createTestUser,
  getUserAuthCookies,
  seedUserData,
  cleanupTestData,
  TrackedEntities,
  TestUser,
  SeededData,
} from "./helpers/test-fixtures";

test.describe("E2E - Dashboard & Repository Management", () => {
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

  let userA: TestUser;
  let userB: TestUser;
  let seededA: SeededData;

  test.beforeAll(async () => {
    userA = await createTestUser(adminClient, "dash-a");
    userB = await createTestUser(adminClient, "dash-b");
    tracked.userIds.push(userA.id, userB.id);

    seededA = await seedUserData(adminClient, userA);
    tracked.installationIds.push(seededA.installationId);
    tracked.repoIds.push(seededA.repoId);
    tracked.settingsIds.push(seededA.settingsId);
    tracked.deliveryIds.push(seededA.deliveryId);
    tracked.jobIds.push(seededA.jobId);
    tracked.reviewIds.push(seededA.reviewId);
    tracked.commentIds.push(seededA.commentId);
  });

  test.afterAll(async () => {
    await cleanupTestData(adminClient, tracked);
  });

  test("User B receives 404 when navigating to User A's repo or review details (User Isolation)", async ({
    context,
    page,
  }) => {
    const authCookiesB = await getUserAuthCookies(userB);
    await context.addCookies(authCookiesB);

    // 1. User B tries to view User A's repo dashboard
    const repoRes = await page.goto(`/dashboard/${seededA.repoId}`);
    expect([200, 404]).toContain(repoRes?.status());
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText(/Page not found/i)).toBeVisible();

    // 2. User B tries to view User A's review details directly
    const revRes = await page.goto(`/dashboard/${seededA.repoId}/reviews/${seededA.reviewId}`);
    expect([200, 404]).toContain(revRes?.status());
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText(/Page not found/i)).toBeVisible();

    // 3. User B receives strict 404 on API endpoints
    const apiRes = await page.request.get(`/api/repos/${seededA.repoId}/reviews`);
    expect(apiRes.status()).toBe(404);

    // 4. User B visits their own dashboard and sees empty state with Sync button
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /No repositories found/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sync Repositories/i })).toBeVisible();
  });

  test("User A can view dashboard, charts, accessible tables, and review history", async ({
    context,
    page,
  }) => {
    const authCookiesA = await getUserAuthCookies(userA);
    await context.addCookies(authCookiesA);

    await page.goto(`/dashboard/${seededA.repoId}`);
    await expect(page.getByRole("heading", { name: /e2e-test-repo/i })).toBeVisible();

    // Charts and accessible text tables
    const accessibleDetails = page.getByText(/View accessible data table/i).first();
    await expect(accessibleDetails).toBeVisible();
    await accessibleDetails.click();

    const table = page.locator('table[aria-label="Severity Breakdown Data Table"]');
    await expect(table).toBeVisible();
    await expect(table.getByText(/Critical/i)).toBeVisible();
  });

  test("Review detail modal: opens with focus trap and closes with Escape key", async ({
    context,
    page,
  }) => {
    const authCookiesA = await getUserAuthCookies(userA);
    await context.addCookies(authCookiesA);

    await page.goto(`/dashboard/${seededA.repoId}`);

    // Click on the review row button to open detail modal
    const reviewTrigger = page.getByRole("button", { name: /View Details/i });
    await expect(reviewTrigger).toBeVisible();
    await reviewTrigger.click();

    // Modal dialog is displayed
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    // Close button receives initial focus
    const closeBtn = page.getByRole("button", { name: /Close dialog/i });
    await expect(closeBtn).toBeFocused();

    // Focus trap: Pressing Tab cycles focus within dialog
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      const focusInside = await dialog.evaluate((el) => el.contains(document.activeElement));
      expect(focusInside).toBe(true);
    }

    // Press Escape key closes modal
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });

  test("Hostile XSS payloads are safely rendered as plain text without script execution", async ({
    context,
    page,
  }) => {
    let dialogTriggered = false;
    page.on("dialog", async (dialog) => {
      dialogTriggered = true;
      await dialog.dismiss();
    });

    const authCookiesA = await getUserAuthCookies(userA);
    await context.addCookies(authCookiesA);

    await page.goto(`/dashboard/${seededA.repoId}`);

    // Verify title with script tag is rendered as literal text
    const titleElement = page.getByText("<script>alert('xss-pr-title')</script> Fix auth token handling");
    await expect(titleElement).toBeVisible();

    // Open detail modal to check summary and comment XSS payloads
    const reviewTrigger = page.getByRole("button", { name: /View Details/i });
    await reviewTrigger.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Summary containing <img> tag is rendered as text without execution
    await expect(dialog.getByText("<img src=x onerror=alert('xss-summary')>")).toBeVisible();

    // No dialog / alert should have fired
    expect(dialogTriggered).toBe(false);
  });
});

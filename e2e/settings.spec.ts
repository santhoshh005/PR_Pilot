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

test.describe("E2E - Repository Settings Management", () => {
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
    userA = await createTestUser(adminClient, "set-a");
    userB = await createTestUser(adminClient, "set-b");
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

  test("User B receives 404 when attempting to access User A's settings page", async ({
    context,
    page,
  }) => {
    const authCookiesB = await getUserAuthCookies(userB);
    await context.addCookies(authCookiesB);

    const res = await page.goto(`/dashboard/${seededA.repoId}/settings`);
    expect([200, 404]).toContain(res?.status());
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText(/Page not found/i)).toBeVisible();

    const apiRes = await page.request.get(`/api/repos/${seededA.repoId}/settings`);
    expect(apiRes.status()).toBe(404);
  });

  test("User A can view, edit, and save strictness values", async ({
    context,
    page,
  }) => {
    const authCookiesA = await getUserAuthCookies(userA);
    await context.addCookies(authCookiesA);

    await page.goto(`/dashboard/${seededA.repoId}/settings`);
    await expect(page.getByRole("heading", { name: /Repository Settings/i })).toBeVisible();

    const strictnessSelect = page.locator("#strictness");
    const saveButton = page.getByRole("button", { name: /Save Settings/i });

    // 1. Save "strict"
    await strictnessSelect.selectOption("strict");
    await saveButton.click();
    await expect(page.getByText(/Settings saved successfully/i)).toBeVisible();

    // 2. Save "relaxed"
    await strictnessSelect.selectOption("relaxed");
    await saveButton.click();
    await expect(page.getByText(/Settings saved successfully/i)).toBeVisible();

    // 3. Save "balanced"
    await strictnessSelect.selectOption("balanced");
    await saveButton.click();
    await expect(page.getByText(/Settings saved successfully/i)).toBeVisible();
  });

  test("Settings form validates client-side limits (>2000 chars and >100 patterns)", async ({
    context,
    page,
  }) => {
    const authCookiesA = await getUserAuthCookies(userA);
    await context.addCookies(authCookiesA);

    await page.goto(`/dashboard/${seededA.repoId}/settings`);

    const customInstructionsInput = page.locator("#custom_instructions");
    const ignoredPathsInput = page.locator("#ignored_paths");
    const saveButton = page.getByRole("button", { name: /Save Settings/i });

    // 1. Exceed custom_instructions limit (> 2000 chars)
    const longInstructions = "a".repeat(2005);
    await customInstructionsInput.fill(longInstructions);
    await saveButton.click();
    await expect(
      page.getByText(/Custom instructions cannot exceed 2000 characters/i)
    ).toBeVisible();

    // Reset instructions to valid text
    await customInstructionsInput.fill("Clean instructions.");

    // 2. Exceed ignored_paths limit (> 100 lines)
    const manyPatterns = Array.from({ length: 105 }, (_, i) => `ignore/path-${i}/*`).join("\n");
    await ignoredPathsInput.fill(manyPatterns);
    await saveButton.click();
    await expect(
      page.getByText(/Cannot exceed 100 ignored path patterns/i)
    ).toBeVisible();
  });
});

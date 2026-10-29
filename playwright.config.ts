import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60 * 1000,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      PORT: `${PORT}`,
      NEXT_PUBLIC_APP_URL: BASE_URL,
      GITHUB_WEBHOOK_SECRET:
        process.env.E2E_WEBHOOK_SECRET || "e2e-test-webhook-secret-do-not-use-in-prod",
    },
  },
});

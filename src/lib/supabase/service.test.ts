import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServiceClient } from "./service";

describe("createServiceClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    // Clean up simulated window
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("creates a Supabase client using the service role key and anon url", () => {
    const client = createServiceClient();

    expect(client).toBeDefined();
    const internalClient = client as unknown as {
      supabaseUrl: string;
      supabaseKey: string;
    };
    expect(internalClient.supabaseUrl).toBe("https://test-project.supabase.co");
    expect(internalClient.supabaseKey).toBe("test-service-role-key");
  });

  it("throws an error when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => createServiceClient()).toThrow(
      "Missing Supabase service environment variables"
    );
  });

  it("throws an error when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    expect(() => createServiceClient()).toThrow(
      "Missing Supabase service environment variables"
    );
  });

  it("throws an error when called in a browser environment", () => {
    (globalThis as unknown as { window: unknown }).window = {};

    expect(() => createServiceClient()).toThrow(
      /cannot be used in the browser/i
    );
  });

  it("throws an error when imported in a browser environment", async () => {
    (globalThis as unknown as { window: unknown }).window = {};
    vi.resetModules();

    await expect(import("./service")).rejects.toThrow(
      /cannot be used in the browser/i
    );
  });
});

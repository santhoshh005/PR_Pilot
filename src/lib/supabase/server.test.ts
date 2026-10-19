import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createUserClient } from "./server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

describe("createUserClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates a server client with URL, anon key, and async cookies", async () => {
    const mockCookieStore = {
      getAll: vi.fn().mockReturnValue([{ name: "sb-token", value: "xyz" }]),
      set: vi.fn(),
    };

    vi.mocked(cookies).mockResolvedValue(
      mockCookieStore as unknown as Awaited<ReturnType<typeof cookies>>
    );
    vi.mocked(createServerClient).mockReturnValue(
      {} as ReturnType<typeof createServerClient>
    );

    const client = await createUserClient();

    expect(client).toBeDefined();
    expect(cookies).toHaveBeenCalled();
    expect(createServerClient).toHaveBeenCalledWith(
      "https://test-project.supabase.co",
      "test-anon-key",
      expect.objectContaining({
        cookies: expect.objectContaining({
          getAll: expect.any(Function),
          setAll: expect.any(Function),
        }),
      })
    );
  });

  it("handles getAll and setAll cookie delegates correctly", async () => {
    const mockCookieStore = {
      getAll: vi.fn().mockReturnValue([{ name: "sb-token", value: "xyz" }]),
      set: vi.fn(),
    };

    vi.mocked(cookies).mockResolvedValue(
      mockCookieStore as unknown as Awaited<ReturnType<typeof cookies>>
    );

    let capturedOptions: Parameters<typeof createServerClient>[2] | undefined;
    vi.mocked(createServerClient).mockImplementation((url, key, opts) => {
      capturedOptions = opts;
      return {} as ReturnType<typeof createServerClient>;
    });

    await createUserClient();

    expect(capturedOptions).toBeDefined();
    const cookiesOption = capturedOptions!.cookies;

    // Test getAll
    const cookieList = await cookiesOption.getAll();
    expect(cookieList).toEqual([{ name: "sb-token", value: "xyz" }]);
    expect(mockCookieStore.getAll).toHaveBeenCalled();

    // Test setAll
    if (cookiesOption.setAll) {
      cookiesOption.setAll(
        [{ name: "test-cookie", value: "123", options: { path: "/" } }],
        {}
      );
    }
    expect(mockCookieStore.set).toHaveBeenCalledWith(
      "test-cookie",
      "123",
      { path: "/" }
    );
  });

  it("suppresses setAll errors when called in Server Component context", async () => {
    const mockCookieStore = {
      getAll: vi.fn().mockReturnValue([]),
      set: vi.fn().mockImplementation(() => {
        throw new Error("Cookies can only be modified in a Server Action or Route Handler");
      }),
    };

    vi.mocked(cookies).mockResolvedValue(
      mockCookieStore as unknown as Awaited<ReturnType<typeof cookies>>
    );

    let capturedOptions: Parameters<typeof createServerClient>[2] | undefined;
    vi.mocked(createServerClient).mockImplementation((url, key, opts) => {
      capturedOptions = opts;
      return {} as ReturnType<typeof createServerClient>;
    });

    await createUserClient();

    expect(() => {
      if (capturedOptions?.cookies.setAll) {
        capturedOptions.cookies.setAll(
          [{ name: "test-cookie", value: "123", options: {} }],
          {}
        );
      }
    }).not.toThrow();
  });

  it("throws an error when Supabase URL or anon key is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    await expect(createUserClient()).rejects.toThrow(
      "Missing Supabase client environment variables"
    );
  });
});

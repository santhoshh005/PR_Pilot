import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createGeminiClient } from "./client";
import { GoogleGenAI } from "@google/genai";

describe("createGeminiClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws a clear error if GEMINI_API_KEY is missing", () => {
    delete process.env.GEMINI_API_KEY;

    expect(() => createGeminiClient()).toThrowError(/GEMINI_API_KEY/);
  });

  it("creates a GoogleGenAI client when GEMINI_API_KEY is configured", () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";

    const client = createGeminiClient();
    expect(client).toBeInstanceOf(GoogleGenAI);
  });

  it("never leaks secret values in error messages", () => {
    delete process.env.GEMINI_API_KEY;

    try {
      createGeminiClient();
      expect.fail("Should have thrown");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain("test-gemini-key");
    }
  });
});

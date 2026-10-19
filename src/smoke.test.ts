import { describe, it, expect } from "vitest";
import { CONFIG } from "@/types";

describe("Scaffolding Smoke Test", () => {
  it("resolves the @/ path alias and loads CONFIG from types", () => {
    expect(CONFIG.MAX_CHUNK_TOKENS).toBe(6000);
    expect(CONFIG.MAX_CHUNKS_PER_INVOCATION).toBe(3);
    expect(CONFIG.MAX_JOB_RETRIES).toBe(5);
    expect(CONFIG.CRON_TIMEOUT_MS).toBe(250_000);
    expect(CONFIG.GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(CONFIG.MAX_COMMENTS_PER_CHUNK).toBe(20);
  });
});

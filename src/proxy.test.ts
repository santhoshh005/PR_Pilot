import { describe, it, expect, vi } from "vitest";
import { proxy, config } from "./proxy";
import { NextRequest, NextResponse } from "next/server";
import * as mw from "@/lib/supabase/middleware";

describe("proxy entrypoint", () => {
  it("delegates request handling to updateSession", async () => {
    const mockResponse = NextResponse.json({ ok: true });
    const spy = vi.spyOn(mw, "updateSession").mockResolvedValue(mockResponse);

    const request = new NextRequest("http://localhost:3000/dashboard");
    const response = await proxy(request);

    expect(spy).toHaveBeenCalledWith(request);
    expect(response).toBe(mockResponse);
  });

  it("exports matcher config excluding static files", () => {
    expect(config.matcher).toBeDefined();
    expect(Array.isArray(config.matcher)).toBe(true);
  });
});

/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SyncButton } from "./sync-button";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

describe("SyncButton Component", { timeout: 15000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with default label and custom children", () => {
    const { rerender } = render(<SyncButton />);
    expect(screen.getByRole("button", { name: /Sync Repositories/i })).toBeDefined();

    rerender(<SyncButton>Sync Repos</SyncButton>);
    expect(screen.getByRole("button", { name: /Sync Repos/i })).toBeDefined();
  });

  it("calls POST /api/installations/sync and shows loading state when clicked", async () => {
    let resolveFetch: (val: unknown) => void = () => {};
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });

    globalThis.fetch = vi.fn().mockImplementation(() => fetchPromise);

    render(<SyncButton />);
    const button = screen.getByRole("button", { name: /Sync Repositories/i });
    fireEvent.click(button);

    // Verify fetch was called with POST
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/installations/sync", {
      method: "POST",
    });

    // Button shows loading text and is disabled while in-flight
    expect(screen.getByText(/Syncing\.\.\./i)).toBeDefined();
    expect(button.getAttribute("disabled")).not.toBeNull();

    // Resolve fetch successfully
    resolveFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await waitFor(() => {
      expect(screen.getByText(/Repositories synced successfully/i)).toBeDefined();
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("displays generic rate limit message when endpoint returns 429", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limited", message: "Raw server rate limit text" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(<SyncButton />);
    const button = screen.getByRole("button", { name: /Sync Repositories/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Rate limit exceeded\. Please try again later\./i)).toBeDefined();
    });

    // Ensure raw error text from server is NOT displayed
    expect(screen.queryByText(/Raw server rate limit text/i)).toBeNull();
  });

  it("displays generic error message on 500 error or network failure without leaking raw server text", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "internal", message: "FATAL internal DB schema dump" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );

    render(<SyncButton />);
    const button = screen.getByRole("button", { name: /Sync Repositories/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Failed to sync repositories\. Please try again\./i)).toBeDefined();
    });

    // Verify raw error message is never rendered
    expect(screen.queryByText(/FATAL internal DB schema dump/i)).toBeNull();
  });
});

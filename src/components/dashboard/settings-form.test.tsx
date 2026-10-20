/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsForm } from "./settings-form";

describe("SettingsForm", () => {
  const defaultSettings = {
    strictness: "balanced" as const,
    custom_instructions: "Focus on memory leaks and SQL injection.",
    ignored_paths: ["*.md", "docs/**"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("renders existing settings correctly", () => {
    render(<SettingsForm repoId="repo-123" initialSettings={defaultSettings} />);

    const strictnessSelect = screen.getByLabelText(/review strictness/i) as HTMLSelectElement;
    expect(strictnessSelect.value).toBe("balanced");

    const instructionsInput = screen.getByLabelText(/custom instructions/i) as HTMLTextAreaElement;
    expect(instructionsInput.value).toBe("Focus on memory leaks and SQL injection.");

    const ignoredPathsInput = screen.getByLabelText(/ignored paths/i) as HTMLTextAreaElement;
    expect(ignoredPathsInput.value).toBe("*.md\ndocs/**");
  });

  it("validates custom_instructions character limit (max 2000)", async () => {
    render(<SettingsForm repoId="repo-123" initialSettings={defaultSettings} />);

    const instructionsInput = screen.getByLabelText(/custom instructions/i);
    const longInstructions = "a".repeat(2001);

    fireEvent.change(instructionsInput, { target: { value: longInstructions } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/custom instructions cannot exceed 2000 characters/i)
      ).toBeDefined();
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("validates ignored_paths count (max 100 patterns)", async () => {
    render(<SettingsForm repoId="repo-123" initialSettings={defaultSettings} />);

    const ignoredPathsInput = screen.getByLabelText(/ignored paths/i);
    const tooManyPatterns = Array.from({ length: 101 }, (_, i) => `pattern_${i}`).join("\n");

    fireEvent.change(ignoredPathsInput, { target: { value: tooManyPatterns } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/cannot exceed 100 ignored path patterns/i)
      ).toBeDefined();
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("validates individual pattern length in ignored_paths (max 300 characters)", async () => {
    render(<SettingsForm repoId="repo-123" initialSettings={defaultSettings} />);

    const ignoredPathsInput = screen.getByLabelText(/ignored paths/i);
    const longPattern = "b".repeat(301);

    fireEvent.change(ignoredPathsInput, { target: { value: longPattern } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/each pattern must be 300 characters or less/i)
      ).toBeDefined();
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("successfully saves settings and shows success feedback", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          strictness: "strict",
          custom_instructions: "Check all types strictly.",
          ignored_paths: ["tests/**"],
        },
      }),
    });

    render(<SettingsForm repoId="repo-123" initialSettings={defaultSettings} />);

    const strictnessSelect = screen.getByLabelText(/review strictness/i);
    fireEvent.change(strictnessSelect, { target: { value: "strict" } });

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/repos/repo-123/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strictness: "strict",
          custom_instructions: "Focus on memory leaks and SQL injection.",
          ignored_paths: ["*.md", "docs/**"],
        }),
      });
      expect(screen.getByText(/settings saved successfully/i)).toBeDefined();
    });
  });

  it("submits relaxed strictness successfully", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          strictness: "relaxed",
          custom_instructions: "Focus on memory leaks and SQL injection.",
          ignored_paths: ["*.md", "docs/**"],
        },
      }),
    });

    render(<SettingsForm repoId="repo-123" initialSettings={defaultSettings} />);

    const strictnessSelect = screen.getByLabelText(/review strictness/i);
    fireEvent.change(strictnessSelect, { target: { value: "relaxed" } });

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/repos/repo-123/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strictness: "relaxed",
          custom_instructions: "Focus on memory leaks and SQL injection.",
          ignored_paths: ["*.md", "docs/**"],
        }),
      });
      expect(screen.getByText(/settings saved successfully/i)).toBeDefined();
    });
  });

  it("handles 429 rate-limited response cleanly without raw API text", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "30" }),
      json: async () => ({
        error: "Too Many Requests",
      }),
    });

    render(<SettingsForm repoId="repo-123" initialSettings={defaultSettings} />);

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/rate limit exceeded. please wait a moment before trying again/i)
      ).toBeDefined();
    });
  });

  it("handles generic 500 server error cleanly without raw DB errors", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: "FATAL: database query failed with code 42P01 in pg_stat_activity",
      }),
    });

    render(<SettingsForm repoId="repo-123" initialSettings={defaultSettings} />);

    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/unable to save settings. please try again/i)
      ).toBeDefined();
    });

    expect(screen.queryByText(/42P01/i)).toBeNull();
    expect(screen.queryByText(/pg_stat_activity/i)).toBeNull();
  });
});

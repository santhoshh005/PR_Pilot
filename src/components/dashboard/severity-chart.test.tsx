/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SeverityChart } from "./severity-chart";
import { SeverityBreakdown } from "@/types";

// Mock ResizeObserver for jsdom
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe("SeverityChart", () => {
  const sampleData: SeverityBreakdown[] = [
    {
      date: "2026-10-18",
      critical: 2,
      warning: 4,
      suggestion: 1,
      praise: 3,
    },
    {
      date: "2026-10-19",
      critical: 0,
      warning: 2,
      suggestion: 3,
      praise: 1,
    },
  ];

  it("renders with sample data and title", () => {
    render(<SeverityChart data={sampleData} />);

    expect(screen.getByText(/severity breakdown/i)).toBeDefined();
    // Accessible alternative table exists
    expect(screen.getByRole("table", { name: /severity breakdown data table/i })).toBeDefined();
    expect(screen.getByText("2026-10-18")).toBeDefined();
    expect(screen.getByText("2026-10-19")).toBeDefined();
  });

  it("renders empty state when data is empty", () => {
    render(<SeverityChart data={[]} />);

    expect(screen.getByText(/no severity data available/i)).toBeDefined();
    expect(screen.getByText(/findings will appear here once pull requests are reviewed/i)).toBeDefined();
  });

  it("renders generic error state when hasError is true without leaking internal details", () => {
    render(<SeverityChart data={[]} hasError={true} />);

    expect(screen.getByText(/unable to load severity breakdown/i)).toBeDefined();
    expect(screen.queryByText(/database/i)).toBeNull();
  });

  it("includes accessible text alternative table readable by assistive technology", () => {
    render(<SeverityChart data={sampleData} />);

    const table = screen.getByRole("table", { name: /severity breakdown data table/i });
    expect(table).toBeDefined();

    // Headers
    expect(screen.getByText(/critical/i)).toBeDefined();
    expect(screen.getByText(/warning/i)).toBeDefined();
    expect(screen.getByText(/suggestion/i)).toBeDefined();
    expect(screen.getByText(/praise/i)).toBeDefined();
  });

  it("renders hostile date strings as plain text without HTML execution", () => {
    const hostileData: SeverityBreakdown[] = [
      {
        date: "<script>alert('xss-chart')</script>",
        critical: 1,
        warning: 0,
        suggestion: 0,
        praise: 0,
      },
    ];

    render(<SeverityChart data={hostileData} />);

    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert('xss-chart')</script>")).toBeDefined();
  });
});

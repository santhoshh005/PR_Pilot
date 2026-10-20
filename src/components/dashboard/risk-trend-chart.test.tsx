/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RiskTrendChart } from "./risk-trend-chart";
import { RiskScoreTrend } from "@/types";

// Mock ResizeObserver for jsdom
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe("RiskTrendChart", () => {
  const sampleData: RiskScoreTrend[] = [
    {
      date: "2026-10-18",
      avg_risk_score: 65,
      review_count: 3,
    },
    {
      date: "2026-10-19",
      avg_risk_score: 35,
      review_count: 2,
    },
  ];

  it("renders with sample data and title", () => {
    render(<RiskTrendChart data={sampleData} />);

    expect(screen.getByText(/risk score trend/i)).toBeDefined();
    // Accessible alternative table exists
    expect(screen.getByRole("table", { name: /risk score trend data table/i })).toBeDefined();
    expect(screen.getByText("2026-10-18")).toBeDefined();
    expect(screen.getByText("65")).toBeDefined();
  });

  it("renders empty state when data is empty", () => {
    render(<RiskTrendChart data={[]} />);

    expect(screen.getByText(/no risk trend data available/i)).toBeDefined();
    expect(screen.getByText(/risk trends will appear here once pull requests are reviewed/i)).toBeDefined();
  });

  it("renders generic error state when hasError is true without leaking internal details", () => {
    render(<RiskTrendChart data={[]} hasError={true} />);

    expect(screen.getByText(/unable to load risk trend/i)).toBeDefined();
    expect(screen.queryByText(/database/i)).toBeNull();
  });

  it("includes accessible text alternative table readable by assistive technology", () => {
    render(<RiskTrendChart data={sampleData} />);

    const table = screen.getByRole("table", { name: /risk score trend data table/i });
    expect(table).toBeDefined();

    expect(screen.getByText(/average risk/i)).toBeDefined();
    expect(screen.getByText(/reviews/i)).toBeDefined();
  });

  it("renders hostile date strings as plain text without HTML execution", () => {
    const hostileData: RiskScoreTrend[] = [
      {
        date: "<img src=x onerror=alert('xss-trend')>",
        avg_risk_score: 45,
        review_count: 1,
      },
    ];

    render(<RiskTrendChart data={hostileData} />);

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=alert('xss-trend')>")).toBeDefined();
  });
});

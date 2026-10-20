/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RepoCard } from "./repo-card";
import { DashboardRepo } from "@/types";

describe("RepoCard Component", { timeout: 15000 }, () => {
  const baseRepo: DashboardRepo = {
    id: "repo-123",
    full_name: "acme/super-service",
    owner: "acme",
    name: "super-service",
    is_active: true,
    total_reviews: 14,
    avg_risk_score: 25,
    last_review_at: "2026-10-20T12:00:00Z",
  };

  it("renders repository name, review count, and links to repo details", () => {
    render(<RepoCard repo={baseRepo} />);

    expect(screen.getByText("acme/super-service")).toBeDefined();
    expect(screen.getByText(/14 reviews/i)).toBeDefined();
    const link = screen.getByRole("link", { name: /acme\/super-service/i });
    expect(link.getAttribute("href")).toBe("/dashboard/repo-123");
  });

  it("renders low risk badge with emerald/green styling when risk score <= 30", () => {
    render(<RepoCard repo={{ ...baseRepo, avg_risk_score: 15 }} />);
    const badge = screen.getByText(/Risk: 15/i);
    expect(badge).toBeDefined();
    expect(badge.className).toContain("emerald");
  });

  it("renders medium risk badge with amber/yellow styling when risk score is 31-69", () => {
    render(<RepoCard repo={{ ...baseRepo, avg_risk_score: 55 }} />);
    const badge = screen.getByText(/Risk: 55/i);
    expect(badge).toBeDefined();
    expect(badge.className).toContain("amber");
  });

  it("renders high risk badge with rose/red styling when risk score >= 70", () => {
    render(<RepoCard repo={{ ...baseRepo, avg_risk_score: 85 }} />);
    const badge = screen.getByText(/Risk: 85/i);
    expect(badge).toBeDefined();
    expect(badge.className).toContain("rose");
  });

  it("renders neutral 'No reviews' status when total_reviews is 0 and risk score is null", () => {
    const emptyRepo: DashboardRepo = {
      ...baseRepo,
      total_reviews: 0,
      avg_risk_score: null,
      last_review_at: null,
    };
    render(<RepoCard repo={emptyRepo} />);

    expect(screen.getByText(/0 reviews/i)).toBeDefined();
    expect(screen.getByText(/No reviews yet/i)).toBeDefined();
  });

  it("renders active vs paused/inactive status indicator", () => {
    const { rerender } = render(<RepoCard repo={baseRepo} />);
    expect(screen.getByText("Active")).toBeDefined();

    rerender(<RepoCard repo={{ ...baseRepo, is_active: false }} />);
    expect(screen.getByText("Paused")).toBeDefined();
  });
});

/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewList } from "./review-list";

describe("ReviewList", () => {
  const sampleReviews = [
    {
      id: "rev-1",
      repo_id: "repo-123",
      pr_number: 10,
      pr_title: "Fix database pool leak",
      pr_author: "alice",
      head_sha: "111122223333",
      summary: "Critical fix for database leak.",
      risk_score: 80,
      severity_counts: { critical: 2, warning: 0, suggestion: 1, praise: 0 },
      inline_comment_count: 3,
      created_at: "2026-10-20T08:00:00Z",
      comments: [],
    },
    {
      id: "rev-2",
      repo_id: "repo-123",
      pr_number: 11,
      pr_title: "Update documentation",
      pr_author: "bob",
      head_sha: "444455556666",
      summary: "Clean up README docs.",
      risk_score: 15,
      severity_counts: { critical: 0, warning: 0, suggestion: 0, praise: 2 },
      inline_comment_count: 0,
      created_at: "2026-10-19T08:00:00Z",
      comments: [],
    },
  ];

  it("renders empty state when there are no reviews", () => {
    render(<ReviewList reviews={[]} totalCount={0} currentPage={1} limit={20} repoId="repo-123" />);

    expect(screen.getByText(/no reviews yet/i)).toBeDefined();
    expect(screen.getByText(/pull requests will appear here once reviewed/i)).toBeDefined();
  });

  it("renders reviews list with titles, authors, and risk badges", () => {
    render(
      <ReviewList
        reviews={sampleReviews}
        totalCount={2}
        currentPage={1}
        limit={20}
        repoId="repo-123"
      />
    );

    expect(screen.getByText(/#10 Fix database pool leak/i)).toBeDefined();
    expect(screen.getByText("alice")).toBeDefined();
    expect(screen.getByText(/Risk: 80/i)).toBeDefined();

    expect(screen.getByText(/#11 Update documentation/i)).toBeDefined();
    expect(screen.getByText("bob")).toBeDefined();
    expect(screen.getByText(/Risk: 15/i)).toBeDefined();
  });

  it("opens ReviewDetailModal when clicking on View Details", () => {
    render(
      <ReviewList
        reviews={sampleReviews}
        totalCount={2}
        currentPage={1}
        limit={20}
        repoId="repo-123"
      />
    );

    const viewButtons = screen.getAllByRole("button", { name: /view details/i });
    expect(viewButtons.length).toBe(2);

    fireEvent.click(viewButtons[0]);

    // Modal dialog is opened
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(dialog.textContent).toContain("Critical fix for database leak.");
  });

  it("renders pagination controls correctly", () => {
    render(
      <ReviewList
        reviews={sampleReviews}
        totalCount={45}
        currentPage={2}
        limit={20}
        repoId="repo-123"
      />
    );

    expect(screen.getByText(/page 2 of 3/i)).toBeDefined();
    const prevLink = screen.getByRole("link", { name: /previous/i });
    const nextLink = screen.getByRole("link", { name: /next/i });

    expect(prevLink.getAttribute("href")).toContain("page=1");
    expect(prevLink.getAttribute("href")).toContain("limit=20");
    expect(nextLink.getAttribute("href")).toContain("page=3");
    expect(nextLink.getAttribute("href")).toContain("limit=20");
  });
});

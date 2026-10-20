/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReviewDetailModal } from "./review-detail-modal";

describe("ReviewDetailModal", () => {
  const mockOnClose = vi.fn();

  const sampleReview = {
    id: "rev-123",
    repo_id: "repo-123",
    pr_number: 42,
    pr_title: "Add authentication flow",
    pr_author: "octocat",
    head_sha: "abcdef123456",
    summary: "Comprehensive review with suggested improvements.",
    risk_score: 45,
    severity_counts: { critical: 1, warning: 2, suggestion: 1, praise: 0 },
    inline_comment_count: 2,
    created_at: "2026-10-20T10:00:00Z",
    comments: [
      {
        id: "comm-1",
        review_id: "rev-123",
        file_path: "src/auth.ts",
        line_number: 15,
        side: "RIGHT" as const,
        severity: "critical" as const,
        title: "Missing input sanitization",
        body: "User input must be sanitized to prevent injection.",
        suggestion: "const sanitized = sanitize(input);",
      },
      {
        id: "comm-2",
        review_id: "rev-123",
        file_path: "src/utils.ts",
        line_number: 8,
        side: "RIGHT" as const,
        severity: "warning" as const,
        title: "Potential memory leak",
        body: "Event listener is not removed on cleanup.",
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    render(
      <ReviewDetailModal
        isOpen={false}
        onClose={mockOnClose}
        review={sampleReview}
      />
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders review details, severity counts, and all inline comments when isOpen is true", () => {
    render(
      <ReviewDetailModal
        isOpen={true}
        onClose={mockOnClose}
        review={sampleReview}
      />
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(screen.getByText(/#42 Add authentication flow/i)).toBeDefined();
    expect(screen.getByText(/Comprehensive review with suggested improvements/i)).toBeDefined();
    expect(screen.getByText(/Risk: 45/i)).toBeDefined();

    // Severity badges
    expect(screen.getByText(/1 Critical/i)).toBeDefined();
    expect(screen.getByText(/2 Warning/i)).toBeDefined();

    // Inline comments
    expect(screen.getByText("Missing input sanitization")).toBeDefined();
    expect(screen.getByText("User input must be sanitized to prevent injection.")).toBeDefined();
    expect(screen.getByText("const sanitized = sanitize(input);")).toBeDefined();
    expect(screen.getByText("src/auth.ts:15")).toBeDefined();

    expect(screen.getByText("Potential memory leak")).toBeDefined();
    expect(screen.getByText("src/utils.ts:8")).toBeDefined();
  });

  it("renders hostile user/AI strings as plain text without injecting HTML", () => {
    const hostileReview = {
      ...sampleReview,
      summary: "<script>alert('xss-summary')</script>",
      comments: [
        {
          id: "comm-xss",
          review_id: "rev-123",
          file_path: "<script>alert('path')</script>",
          line_number: 1,
          side: "RIGHT" as const,
          severity: "critical" as const,
          title: "<img src=x onerror=alert('xss-title')>",
          body: "<svg onload=alert('xss-body')>",
          suggestion: "<b>malicious bold</b>",
        },
      ],
    };

    render(
      <ReviewDetailModal
        isOpen={true}
        onClose={mockOnClose}
        review={hostileReview}
      />
    );

    // Assert that script / img tags were not rendered into actual DOM elements
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(document.querySelector("svg[onload]")).toBeNull();

    // Assert plain text content exists
    expect(screen.getByText("<script>alert('xss-summary')</script>")).toBeDefined();
    expect(screen.getByText("<img src=x onerror=alert('xss-title')>")).toBeDefined();
    expect(screen.getByText("<svg onload=alert('xss-body')>")).toBeDefined();
    expect(screen.getByText("<b>malicious bold</b>")).toBeDefined();
  });

  it("calls onClose when close button or Escape key is pressed", () => {
    render(
      <ReviewDetailModal
        isOpen={true}
        onClose={mockOnClose}
        review={sampleReview}
      />
    );

    const closeButton = screen.getByRole("button", { name: /close dialog/i });
    fireEvent.click(closeButton);
    expect(mockOnClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(mockOnClose).toHaveBeenCalledTimes(2);
  });

  it("focuses modal and restores focus to triggerRef upon closing", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open review";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const triggerRef = { current: trigger };

    const { rerender } = render(
      <ReviewDetailModal
        isOpen={true}
        onClose={mockOnClose}
        review={sampleReview}
        triggerRef={triggerRef}
      />
    );

    // Modal close button or container is focused
    const closeBtn = screen.getByRole("button", { name: /close dialog/i });
    expect(document.activeElement).toBe(closeBtn);

    // Rerender as closed
    rerender(
      <ReviewDetailModal
        isOpen={false}
        onClose={mockOnClose}
        review={sampleReview}
        triggerRef={triggerRef}
      />
    );

    // Focus restored to trigger
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });
});

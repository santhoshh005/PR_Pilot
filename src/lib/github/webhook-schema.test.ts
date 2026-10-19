import { describe, it, expect } from "vitest";
import { WebhookPullRequestSchema } from "@/types";

describe("WebhookPullRequestSchema", () => {
  const validPayload = {
    action: "opened",
    number: 42,
    pull_request: {
      title: "Add awesome feature",
      user: {
        login: "octocat",
      },
      head: {
        sha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
      },
      base: {
        sha: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      },
      state: "open",
    },
    repository: {
      id: 123456,
      full_name: "octocat/hello-world",
    },
    installation: {
      id: 78910,
    },
  };

  it("validates a correct opened pull_request payload", () => {
    const result = WebhookPullRequestSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe("opened");
      expect(result.data.number).toBe(42);
      expect(result.data.pull_request.head.sha).toBe(
        "6dcb09b5b57875f334f61aebed695e2e4193db5e"
      );
    }
  });

  it("validates synchronize and reopened actions", () => {
    expect(
      WebhookPullRequestSchema.safeParse({
        ...validPayload,
        action: "synchronize",
      }).success
    ).toBe(true);

    expect(
      WebhookPullRequestSchema.safeParse({
        ...validPayload,
        action: "reopened",
      }).success
    ).toBe(true);
  });

  it("rejects actions not handled by the review pipeline", () => {
    expect(
      WebhookPullRequestSchema.safeParse({
        ...validPayload,
        action: "closed",
      }).success
    ).toBe(false);

    expect(
      WebhookPullRequestSchema.safeParse({
        ...validPayload,
        action: "labeled",
      }).success
    ).toBe(false);

    expect(
      WebhookPullRequestSchema.safeParse({
        ...validPayload,
        action: "edited",
      }).success
    ).toBe(false);
  });

  it("rejects payload missing repository information", () => {
    const { repository, ...withoutRepo } = validPayload;
    expect(WebhookPullRequestSchema.safeParse(withoutRepo).success).toBe(false);
  });

  it("rejects payload missing head or base SHA", () => {
    const invalidHead = {
      ...validPayload,
      pull_request: {
        ...validPayload.pull_request,
        head: {},
      },
    };
    expect(WebhookPullRequestSchema.safeParse(invalidHead).success).toBe(false);
  });

  it("accepts payload without optional installation", () => {
    const { installation, ...withoutInstallation } = validPayload;
    const result = WebhookPullRequestSchema.safeParse(withoutInstallation);
    expect(result.success).toBe(true);
  });
});

/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthErrorPage from "./page";

describe("AuthErrorPage", { timeout: 15000 }, () => {
  it("renders default error message when no error query param provided", async () => {
    const Component = await AuthErrorPage({
      searchParams: Promise.resolve({}),
    });
    render(Component);

    expect(screen.getByText("Authentication Error")).toBeDefined();
    expect(
      screen.getByText(
        "An unexpected error occurred during authentication. Please try again."
      )
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "Try Again" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Back to Home" })).toBeDefined();
  });

  it("renders specific error description when known error code is given", async () => {
    const Component = await AuthErrorPage({
      searchParams: Promise.resolve({ error: "missing_code" }),
    });
    render(Component);

    expect(
      screen.getByText(
        "No authorization code was provided by the authentication provider."
      )
    ).toBeDefined();
    expect(screen.getByText("code: missing_code")).toBeDefined();
  });
});

/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardLoading from "./loading";

describe("DashboardLoading Component", { timeout: 15000 }, () => {
  it("renders animated skeleton with proper accessibility attributes", () => {
    render(<DashboardLoading />);

    const loader = screen.getByLabelText("Loading repositories");
    expect(loader).toBeDefined();
    expect(loader.getAttribute("aria-busy")).toBe("true");
  });
});

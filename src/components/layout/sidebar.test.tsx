/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

describe("Sidebar Component", { timeout: 15000 }, () => {
  it("renders brand logo and Repositories navigation item", () => {
    render(<Sidebar />);

    expect(screen.getByText("PRPilot")).toBeDefined();
    expect(screen.getByRole("link", { name: /Repositories/i })).toBeDefined();
  });

  it("applies open translation class when isOpen is true", () => {
    const { container } = render(<Sidebar isOpen={true} />);
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("translate-x-0");
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(<Sidebar isOpen={true} onClose={onClose} />);

    const closeBtn = screen.getByRole("button", { name: /Close navigation/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

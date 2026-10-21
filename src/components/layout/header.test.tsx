/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Header } from "./header";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("Header Component", { timeout: 15000 }, () => {
  const userWithAvatar = {
    id: "user-1",
    email: "test@example.com",
    user_metadata: {
      user_name: "octocat",
      avatar_url: "https://avatar.url/avatar.png",
    },
  };

  it("renders username and avatar image when avatar_url is provided", () => {
    render(<Header user={userWithAvatar} />);

    expect(screen.getByText("octocat")).toBeDefined();
    const avatar = screen.getByRole("img", { name: "octocat" });
    expect(avatar.getAttribute("src")).toBe("https://avatar.url/avatar.png");
  });

  it("renders initial fallback avatar when avatar_url is missing", () => {
    const userNoAvatar = {
      id: "user-2",
      email: "sam@example.com",
      user_metadata: {},
    };
    render(<Header user={userNoAvatar} />);

    expect(screen.getByText("sam")).toBeDefined();
    expect(screen.getByText("S")).toBeDefined();
  });

  it("calls onMenuToggle when mobile menu hamburger is clicked", () => {
    const onToggle = vi.fn();
    render(<Header user={userWithAvatar} onMenuToggle={onToggle} />);

    const menuBtn = screen.getByRole("button", { name: /Toggle navigation menu/i });
    fireEvent.click(menuBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders sign out action button", () => {
    render(<Header user={userWithAvatar} />);
    expect(screen.getByRole("button", { name: /Sign Out/i })).toBeDefined();
  });

  it("renders sync repositories action button in header", () => {
    render(<Header user={userWithAvatar} />);
    expect(screen.getByRole("button", { name: /Sync Repos/i })).toBeDefined();
  });
});

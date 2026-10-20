/** @vitest-environment jsdom */
import React from "react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(),
}));

import { render, screen } from "@testing-library/react";
import { SettingsForm } from "@/components/dashboard/settings-form";
import { PatchSettingsSchema } from "@/app/api/repos/[repoId]/settings/route";
import { STRICTNESS_OPTIONS } from "@/lib/constants";

describe("Strictness Single Source of Truth", () => {
  it("form select options match STRICTNESS_OPTIONS and PatchSettingsSchema exactly", () => {
    render(
      <SettingsForm
        repoId="repo-123"
        initialSettings={{
          strictness: "balanced",
          custom_instructions: "",
          ignored_paths: [],
        }}
      />
    );

    const select = screen.getByLabelText(/review strictness/i) as HTMLSelectElement;
    const formOptionValues = Array.from(select.options).map((opt) => opt.value);

    // 1. Form option values match STRICTNESS_OPTIONS
    expect(formOptionValues).toEqual([...STRICTNESS_OPTIONS]);

    // 2. Round-trip: Every option in the form is accepted by PatchSettingsSchema
    for (const option of formOptionValues) {
      const parseResult = PatchSettingsSchema.safeParse({ strictness: option });
      expect(parseResult.success).toBe(true);
    }

    // 3. Invalid options (including outdated "lenient") are rejected by PatchSettingsSchema
    expect(PatchSettingsSchema.safeParse({ strictness: "lenient" }).success).toBe(false);
    expect(PatchSettingsSchema.safeParse({ strictness: "super_strict" }).success).toBe(false);
  });
});

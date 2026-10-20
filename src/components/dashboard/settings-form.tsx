"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { STRICTNESS_OPTIONS, Strictness } from "@/lib/constants";

export interface RepoSettingsData {
  strictness: Strictness;
  custom_instructions: string;
  ignored_paths: string[];
}

interface SettingsFormProps {
  repoId: string;
  initialSettings: RepoSettingsData;
}

export function SettingsForm({ repoId, initialSettings }: SettingsFormProps) {
  const [strictness, setStrictness] = useState<Strictness>(
    initialSettings.strictness || "balanced"
  );
  const [customInstructions, setCustomInstructions] = useState<string>(
    initialSettings.custom_instructions || ""
  );
  const [ignoredPathsText, setIgnoredPathsText] = useState<string>(
    (initialSettings.ignored_paths || []).join("\n")
  );

  const [errors, setErrors] = useState<{
    strictness?: string;
    custom_instructions?: string;
    ignored_paths?: string;
  }>({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const validate = (): boolean => {
    const newErrors: typeof errors = {};

    // 1. Strictness validation
    if (!STRICTNESS_OPTIONS.includes(strictness)) {
      newErrors.strictness = "Invalid strictness level selected.";
    }

    // 2. Custom instructions validation
    if (customInstructions.length > 2000) {
      newErrors.custom_instructions =
        "Custom instructions cannot exceed 2000 characters.";
    }

    // 3. Ignored paths validation
    const parsedPatterns = ignoredPathsText
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (parsedPatterns.length > 100) {
      newErrors.ignored_paths = "Cannot exceed 100 ignored path patterns.";
    } else {
      const longPattern = parsedPatterns.find((p) => p.length > 300);
      if (longPattern) {
        newErrors.ignored_paths = "Each pattern must be 300 characters or less.";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const parsedPatterns = ignoredPathsText
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      const response = await fetch(`/api/repos/${repoId}/settings`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          strictness,
          custom_instructions: customInstructions,
          ignored_paths: parsedPatterns,
        }),
      });

      if (response.ok) {
        setStatusMessage({
          type: "success",
          text: "Settings saved successfully.",
        });
      } else if (response.status === 429) {
        setStatusMessage({
          type: "error",
          text: "Rate limit exceeded. Please wait a moment before trying again.",
        });
      } else {
        setStatusMessage({
          type: "error",
          text: "Unable to save settings. Please try again.",
        });
      }
    } catch {
      setStatusMessage({
        type: "error",
        text: "Unable to save settings. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Status banner */}
      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          className={`p-4 rounded-lg text-sm flex items-start gap-3 border ${
            statusMessage.type === "success"
              ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border-emerald-500/20"
              : "bg-rose-500/10 text-rose-800 dark:text-rose-300 border-rose-500/20"
          }`}
        >
          {statusMessage.type === "success" ? (
            <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Strictness Level */}
      <div className="space-y-2">
        <label
          htmlFor="strictness"
          className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
        >
          Review Strictness
        </label>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Controls how aggressively Gemini flags potential issues, edge cases, and style warnings.
        </p>
        <select
          id="strictness"
          value={strictness}
          onChange={(e) =>
            setStrictness(e.target.value as Strictness)
          }
          aria-invalid={!!errors.strictness}
          aria-describedby={errors.strictness ? "strictness-error" : undefined}
          className="w-full sm:w-64 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600"
        >
          {STRICTNESS_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt === "relaxed"
                ? "Relaxed (Critical bugs & security only)"
                : opt === "balanced"
                ? "Balanced (Recommended)"
                : "Strict (Thorough analysis & style tips)"}
            </option>
          ))}
        </select>
        {errors.strictness && (
          <p id="strictness-error" className="text-xs text-rose-600 dark:text-rose-400">
            {errors.strictness}
          </p>
        )}
      </div>

      {/* Custom Instructions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="custom_instructions"
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            Custom Instructions
          </label>
          <span
            className={`text-xs ${
              customInstructions.length > 2000
                ? "text-rose-600 font-semibold"
                : "text-zinc-400"
            }`}
          >
            {customInstructions.length}/2000
          </span>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Provide domain-specific rules or context for the AI reviewer (e.g. &quot;Prefer async/await over promises&quot;).
        </p>
        <textarea
          id="custom_instructions"
          rows={4}
          value={customInstructions}
          onChange={(e) => setCustomInstructions(e.target.value)}
          aria-invalid={!!errors.custom_instructions}
          aria-describedby={
            errors.custom_instructions ? "custom-instructions-error" : undefined
          }
          className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600"
          placeholder="Focus on API contract stability, performance bottlenecks, and SQL injection risks."
        />
        {errors.custom_instructions && (
          <p
            id="custom-instructions-error"
            className="text-xs text-rose-600 dark:text-rose-400"
          >
            {errors.custom_instructions}
          </p>
        )}
      </div>

      {/* Ignored Paths */}
      <div className="space-y-2">
        <label
          htmlFor="ignored_paths"
          className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
        >
          Ignored Paths
        </label>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          One glob pattern per line. Files matching these patterns will be excluded from AI reviews (up to 100 patterns, 300 chars each).
        </p>
        <textarea
          id="ignored_paths"
          rows={4}
          value={ignoredPathsText}
          onChange={(e) => setIgnoredPathsText(e.target.value)}
          aria-invalid={!!errors.ignored_paths}
          aria-describedby={
            errors.ignored_paths ? "ignored-paths-error" : undefined
          }
          className="w-full font-mono rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-600"
          placeholder={`*.md\ndocs/**\nvendor/**\n*.generated.ts`}
        />
        {errors.ignored_paths && (
          <p
            id="ignored-paths-error"
            className="text-xs text-rose-600 dark:text-rose-400"
          >
            {errors.ignored_paths}
          </p>
        )}
      </div>

      {/* Submit Button */}
      <div className="pt-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </form>
  );
}

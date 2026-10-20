import { StrictnessSchema, Strictness } from "@/types";

/**
 * Single source of truth for repository review strictness values.
 * Authoritative values are defined in schema.sql CHECK constraint and types.ts.
 */
export const STRICTNESS_OPTIONS = StrictnessSchema.options;
export type { Strictness };

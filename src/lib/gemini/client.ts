import { GoogleGenAI } from "@google/genai";

/**
 * Creates and returns an authenticated GoogleGenAI client for the Gemini API.
 * Reads the GEMINI_API_KEY from environment variables without exposing secret values.
 */
export function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured");
  }

  return new GoogleGenAI({ apiKey });
}

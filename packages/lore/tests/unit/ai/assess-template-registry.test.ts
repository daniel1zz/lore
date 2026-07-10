/**
 * Tests for the SPEC-040 §T2 D6 version-keyed assess template registry
 * (`ASSESS_TEMPLATES` / `getAssessTemplate`) in `assess-template.ts`.
 *
 * Spec-first expectations:
 *   - `ASSESS_TEMPLATES[5]` is EXACTLY `buildAssessPrompt` (frozen provenance entry), and
 *     `ASSESS_TEMPLATES[6]` is EXACTLY `buildAssessPromptV6` (the active entry) — reference
 *     identity, not merely "a function that behaves the same way".
 *   - `getAssessTemplate(version)` is a Result-returning lookup: `ok(fn)` for a registered
 *     version, `err(AI_PROVIDER_ERROR)` for an unregistered one — NEVER an uncaught throw,
 *     even for a version number that was never registered at all.
 *   - The error message names the requested (unregistered) version and lists the known
 *     registered versions.
 *
 * @spec_ref AC-ADF-6
 */

import { describe, it, expect } from "vitest";
import {
  ASSESS_PROMPT_VERSION,
  ASSESS_TEMPLATES,
  buildAssessPrompt,
  buildAssessPromptV6,
  getAssessTemplate,
} from "../../../src/ai/assess-template.js";

describe("ASSESS_TEMPLATES — version-keyed registry (AC-ADF-6, SPEC-040 §T2 D6)", () => {
  it("HAPPY: ASSESS_TEMPLATES[5] is the exact buildAssessPrompt function reference (frozen provenance entry)", () => {
    expect(ASSESS_TEMPLATES[5]).toBe(buildAssessPrompt);
  });

  it("HAPPY: ASSESS_TEMPLATES[6] is the exact buildAssessPromptV6 function reference (the active entry)", () => {
    expect(ASSESS_TEMPLATES[6]).toBe(buildAssessPromptV6);
  });

  it("STATE: ASSESS_PROMPT_VERSION currently points at the v6 entry", () => {
    expect(ASSESS_PROMPT_VERSION).toBe(6);
  });
});

describe("getAssessTemplate — Result-returning lookup, never an uncaught throw (AC-ADF-6)", () => {
  it("HAPPY: getAssessTemplate(5) resolves ok with buildAssessPrompt", () => {
    const result = getAssessTemplate(5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(buildAssessPrompt);
  });

  it("HAPPY: getAssessTemplate(ASSESS_PROMPT_VERSION) resolves ok with buildAssessPromptV6", () => {
    const result = getAssessTemplate(ASSESS_PROMPT_VERSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(buildAssessPromptV6);
  });

  it("NEGATIVE/ERROR: an unregistered version returns err(AI_PROVIDER_ERROR) naming the version and known versions, without throwing", () => {
    let result: ReturnType<typeof getAssessTemplate> | undefined;
    expect(() => {
      result = getAssessTemplate(999);
    }).not.toThrow();

    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
    expect("message" in result.error ? result.error.message : "").toContain("registered for version 999");
    expect("message" in result.error ? result.error.message : "").toContain("Known versions:");
  });

  it("BOUNDARY: a negative/nonsensical version number also fails loud via err(), not a thrown TypeError", () => {
    const result = getAssessTemplate(-1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
  });
});

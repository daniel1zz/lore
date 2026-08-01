/**
 * Tests for the SPEC-040 §T2 D6 version-keyed assess template registry
 * (`ASSESS_TEMPLATES` / `getAssessTemplate`) in `assess-template.ts`, re-keyed by
 * SPEC-lore-assess-project-evidence-rows-instead-of-embedding-the T5 (6 is now the FROZEN
 * pre-projection entry, 7 is the active entry — see `assess-prompt-version-freeze.test.ts`
 * for the freeze/projection behavioural coverage, AC-AEP-9/10).
 *
 * Spec-first expectations:
 *   - `ASSESS_TEMPLATES[5]` is EXACTLY `buildAssessPrompt` (frozen provenance entry), and
 *     `ASSESS_TEMPLATES[7]` is EXACTLY `buildAssessPromptV7` (the active entry) — reference
 *     identity, not merely "a function that behaves the same way". `ASSESS_TEMPLATES[6]`
 *     (frozen, T5) is deliberately NOT `buildAssessPromptV6` — that exported name kept its
 *     PRE-T5 (projected) behaviour and moved to slot `7` instead (AC-AEP-4 pins a direct
 *     caller of that name against the projected shape).
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
  buildAssessPromptV7,
  getAssessTemplate,
} from "../../../src/ai/assess-template.js";

describe("ASSESS_TEMPLATES — version-keyed registry (AC-ADF-6, SPEC-040 §T2 D6, re-keyed T5)", () => {
  it("HAPPY: ASSESS_TEMPLATES[5] is the exact buildAssessPrompt function reference (frozen provenance entry)", () => {
    expect(ASSESS_TEMPLATES[5]).toBe(buildAssessPrompt);
  });

  it("HAPPY: ASSESS_TEMPLATES[7] is the exact buildAssessPromptV7 function reference (the active entry, T5)", () => {
    expect(ASSESS_TEMPLATES[7]).toBe(buildAssessPromptV7);
  });

  it("CONTROL: ASSESS_TEMPLATES[6] (frozen, T5) is NOT the buildAssessPromptV6 reference — that name kept its projected behaviour and moved to slot 7", () => {
    expect(ASSESS_TEMPLATES[6]).not.toBe(buildAssessPromptV6);
  });

  it("STATE: ASSESS_PROMPT_VERSION currently points at the v7 entry (T5)", () => {
    expect(ASSESS_PROMPT_VERSION).toBe(7);
  });
});

describe("getAssessTemplate — Result-returning lookup, never an uncaught throw (AC-ADF-6)", () => {
  it("HAPPY: getAssessTemplate(5) resolves ok with buildAssessPrompt", () => {
    const result = getAssessTemplate(5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(buildAssessPrompt);
  });

  it("HAPPY: getAssessTemplate(ASSESS_PROMPT_VERSION) resolves ok with buildAssessPromptV7 (T5)", () => {
    const result = getAssessTemplate(ASSESS_PROMPT_VERSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(buildAssessPromptV7);
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

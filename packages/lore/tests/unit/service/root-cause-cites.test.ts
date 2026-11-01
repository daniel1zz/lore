/**
 * @spec_ref spec-plans-close-themselves-level-triggered-reconciliation-of (BR-1379)
 *
 * Judge-text fingerprints key on the finding's structured cites, never its wording.
 * Dimensions: HAPPY (same cites share), NEGATIVE (different cites split), ERROR (no cite is an error),
 * STATE (measured dimensions ignore cites), BOUNDARY (cite normalisation).
 */

import { describe, it, expect } from "vitest";
import { issueTitleOf, rootCauseOf } from "../../../src/service/root-cause-fingerprint.js";

const base = { plan: "p", dimension: "spec_conformance", reference: "", reviewSlug: "r" } as const;

function causeOf(finding: Parameters<typeof rootCauseOf>[0]) {
  const cause = rootCauseOf(finding);
  if (!cause.ok) throw new Error(`unexpected root-cause error: ${JSON.stringify(cause.error)}`);
  return cause.value;
}

describe("judge-text fingerprints use structured cites, never wording", () => {
  it("HAPPY: different wording with the same cites (any order, spacing, duplicates) shares one fingerprint; titles keep the summary", () => {
    const one = causeOf({ ...base, reason: "The validator is duplicated per filter", cites: ["AC-ZZ-1", "src/filters.ts"] });
    const two = causeOf({ ...base, reason: "Enumerated filters each re-implement validation", cites: [" src/filters.ts", "AC-ZZ-1", "AC-ZZ-1"] });
    expect(two.fingerprint).toBe(one.fingerprint);
    expect(issueTitleOf(one)).toContain("The validator is duplicated");
    expect(issueTitleOf(two)).toContain("Enumerated filters each");
  });

  it("NEGATIVE: different cites are different fingerprints even when the reason text is identical", () => {
    const one = causeOf({ ...base, reason: "same words `readToken` in src/a.ts", cites: ["AC-ZZ-1"] });
    const other = causeOf({ ...base, reason: "same words `readToken` in src/a.ts", cites: ["AC-ZZ-2"] });
    expect(other.fingerprint).not.toBe(one.fingerprint);
  });

  it("BOUNDARY: the same cites under another dimension are another fingerprint", () => {
    const one = causeOf({ ...base, reason: "x", cites: ["AC-ZZ-1"] });
    const other = causeOf({ ...base, dimension: "security", reason: "x", cites: ["AC-ZZ-1"] });
    expect(other.fingerprint).not.toBe(one.fingerprint);
  });

  it("ERROR: a judge-text finding with no cite is an error, never a free-text fingerprint", () => {
    for (const cites of [undefined, [], ["  "]]) {
      const result = rootCauseOf({ ...base, reason: "AC-ZZ-1 is violated in src/a.ts", ...(cites !== undefined ? { cites } : {}) });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toMatchObject({ code: "VALIDATION_ERROR", field: "cites" });
    }
  });

  it("ERROR: a regression the suite did not measure also needs cites", () => {
    expect(rootCauseOf({ ...base, dimension: "regression", reason: "x" }).ok).toBe(false);
  });

  it("STATE: a regression charged with one file is keyed by that file alone, ignoring cites and the plan", () => {
    const a = causeOf({ ...base, plan: "p-one", dimension: "regression", reason: "x", cites: ["AC-ZZ-1"], causes: { regression_files: ["a.test.ts"] } });
    const b = causeOf({ ...base, plan: "p-two", dimension: "regression", reason: "y", causes: { regression_files: ["a.test.ts"] } });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.label).toBe("main red: a.test.ts");
  });

  it("STATE: measured dimensions ignore cites", () => {
    const a = causeOf({ ...base, dimension: "snapshot_accuracy", reason: "x", cites: ["AC-ZZ-1"], causes: { contradicted_rules: ["BR-99999"] } });
    const b = causeOf({ ...base, dimension: "snapshot_accuracy", reason: "y", causes: { contradicted_rules: ["BR-99999"] } });
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

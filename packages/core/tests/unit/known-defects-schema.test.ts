/**
 * @spec_ref spec-a-plan-s-known-defects-are-its-own-record-of-github-issues (AC-KD-1, BR-1421)
 *
 * `extra.known_defects` is a plan-only, keyed, validated record.
 *
 * Coverage dimensions:
 *   HAPPY:      a plan accepts valid entries; absence is fine
 *   NEGATIVE:   task / spec / knowledge refuse the field naming extra.known_defects
 *   BOUNDARY:   same issue under two dimensions is two keys (allowed); same key twice is refused
 *   ERROR:      an unknown dimension, a non-array, a non-positive number, an empty fingerprint
 *   REGRESSION: append is idempotent by key and keeps order
 */
import { describe, expect, it } from "vitest";
import { MILESTONE_DIMENSIONS, appendKnownDefects, judgeKnownDefectsExtra, knownDefectKey, readKnownDefects } from "../../src/index.js";

const entry = (over: Record<string, unknown> = {}) => ({ repo_id: 7, number: 50, dimension: "regression", fingerprint: "f".repeat(64), ...over });

describe("AC-KD-1 extra.known_defects schema", () => {
  it("a plan accepts valid entries, one per (repo_id, number, dimension)", () => {
    expect(judgeKnownDefectsExtra("plan", { known_defects: [entry(), entry({ dimension: "security" }), entry({ number: 51 })] })).toBeUndefined();
    expect(judgeKnownDefectsExtra("plan", { known_defects: [] })).toBeUndefined();
    expect(judgeKnownDefectsExtra("plan", {})).toBeUndefined();
    expect(judgeKnownDefectsExtra("task", { other: 1 })).toBeUndefined();
    for (const dimension of MILESTONE_DIMENSIONS) expect(judgeKnownDefectsExtra("plan", { known_defects: [entry({ dimension })] })).toBeUndefined();
  });

  it.each(["task", "spec", "knowledge", "adr", "prd", "phase", "baseline"])("a %s refuses the field naming extra.known_defects", (type) => {
    const refusal = judgeKnownDefectsExtra(type, { known_defects: [entry()] });
    expect(refusal?.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(refusal)).toContain("extra.known_defects");
  });

  it("a duplicate (repo_id, number, dimension) is refused naming the entry", () => {
    const refusal = judgeKnownDefectsExtra("plan", { known_defects: [entry(), entry({ fingerprint: "other" })] });
    expect(refusal?.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(refusal)).toContain("known_defects[1]");
    expect(JSON.stringify(refusal)).toContain("7#50/regression");
  });

  it("an unknown dimension is refused naming the entry and the valid dimensions", () => {
    const refusal = judgeKnownDefectsExtra("plan", { known_defects: [entry(), entry({ number: 51, dimension: "vibes" })] });
    expect(refusal?.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(refusal)).toContain("known_defects[1]");
    expect(JSON.stringify(refusal)).toContain("vibes");
  });

  it.each([
    ["a non-array", "oops"],
    ["a non-positive number", [entry({ number: 0 })]],
    ["a fractional repo id", [entry({ repo_id: 1.5 })]],
    ["an empty fingerprint", [entry({ fingerprint: "" })]],
    ["a missing field", [{ repo_id: 7, number: 5, dimension: "security" }]],
  ])("%s is refused", (_name, value) => {
    expect(judgeKnownDefectsExtra("plan", { known_defects: value })?.code).toBe("VALIDATION_ERROR");
  });

  it("readKnownDefects returns only valid entries and appendKnownDefects is idempotent by key", () => {
    const extra = { known_defects: [entry(), { junk: true }] };
    const read = readKnownDefects(extra);
    expect(read).toHaveLength(1);
    expect(knownDefectKey(read[0]!)).toBe("7#50/regression");
    const same = appendKnownDefects(read, [read[0]!]);
    expect(same).toBe(read);
    const more = appendKnownDefects(read, [read[0]!, { ...read[0]!, dimension: "security" }, { ...read[0]!, dimension: "security" }]);
    expect(more.map(knownDefectKey)).toEqual(["7#50/regression", "7#50/security"]);
    expect(readKnownDefects(undefined)).toEqual([]);
    expect(readKnownDefects({ known_defects: "x" })).toEqual([]);
  });
});

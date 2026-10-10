/**
 * Unit suite for scripts/lib/fresh-install-probe-steps.ts (AC-FIP-6): pure step evaluation, no subprocess.
 * Dimensions: HAPPY (matching output passes), NEGATIVE (wrong exit / missing text fails), BOUNDARY (empty scan),
 * ERROR (malformed JSON, usage errors), REGRESSION (the manual-probe defects F1-F6 are detected).
 *
 * @spec_ref AC-FIP-6
 */
import { describe, expect, it } from "vitest";
import {
  buildSteps,
  checkAcCiteAudited,
  checkCensusZero,
  checkRuleTotalsBothTrees,
  evaluateCommandStep,
  evaluateSkillScan,
  formatStepLine,
  formatSummary,
  mustContain,
  parseProbeArgs,
  ProbeUsageError,
  scanForSpecParentPairing,
  type CommandStep,
} from "../lib/fresh-install-probe-steps.js";

const out = (exitCode: number, stdout = "", stderr = "") => ({ exitCode, stdout, stderr });
const envelope = (data: unknown) => JSON.stringify({ ok: true, data });
const steps = buildSteps({ claudeHome: "/x/home", specBodyFile: "/x/body.md" });
const command = (name: string): CommandStep => {
  const s = steps.find((st) => st.name === name);
  if (s === undefined || s.kind !== "command") throw new Error(`no command step ${name}`);
  return s;
};

describe("parseProbeArgs", () => {
  it("HAPPY: reads --bin and --keep", () => {
    expect(parseProbeArgs(["--bin", "dist/lore", "--keep"])).toEqual({ bin: "dist/lore", keep: true });
  });
  it("ERROR: a missing --bin is a usage error", () => {
    expect(() => parseProbeArgs([])).toThrow(ProbeUsageError);
    expect(() => parseProbeArgs(["--bin"])).toThrow(ProbeUsageError);
    expect(() => parseProbeArgs(["--bin", "--keep"])).toThrow(ProbeUsageError);
  });
  it("NEGATIVE: an unknown flag is rejected", () => {
    expect(() => parseProbeArgs(["--bin", "x", "--wat"])).toThrow(ProbeUsageError);
  });
});

describe("evaluateCommandStep", () => {
  it("HAPPY: right exit and matching output passes", () => {
    const v = evaluateCommandStep(command("rule-add-br"), out(0, "Added BR-1 to baseline-pay-leaf (v2)."));
    expect(v).toEqual({ pass: true, reason: "ok" });
  });
  it("NEGATIVE: an exit 0 where 4 is expected fails (exact exit)", () => {
    const v = evaluateCommandStep(command("approve-uncited-refused"), out(0, "approved"));
    expect(v.pass).toBe(false);
    expect(v.reason).toContain("expected exit 4, got 0");
  });
  it("NEGATIVE: exit 4 for the wrong reason fails the output predicate", () => {
    const v = evaluateCommandStep(command("approve-uncited-refused"), out(4, "", "JUDGMENT_REJECTED"));
    expect(v.pass).toBe(false);
  });
  it("HAPPY: the BR-1007 refusal passes", () => {
    const text = "Error: spec-uncited-spec cites no live business or architecture rule and cannot be approved";
    expect(evaluateCommandStep(command("approve-uncited-refused"), out(4, "", text)).pass).toBe(true);
  });
  it("REGRESSION F1: review whose tree_position fails does not pass", () => {
    const v = evaluateCommandStep(command("review-cited"), out(0, "Decision: reject\ntree_position  fail  doc's parent type '(none)'"));
    expect(v.pass).toBe(false);
  });
  it("HAPPY: parentless create refusal names the contract", () => {
    expect(evaluateCommandStep(command("create-spec-with-parent-refused"), out(4, "", "a spec takes no parent: ...")).pass).toBe(true);
  });
});

describe("status predicates", () => {
  it("REGRESSION F5: unaudited provenance fails, audited passes", () => {
    expect(checkAcCiteAudited(out(0, envelope({ ac_cite: { mode: "report", provenance: "unaudited" } })))).toContain("unaudited");
    expect(checkAcCiteAudited(out(0, envelope({ ac_cite: { mode: "report", provenance: "audited" } })))).toBeNull();
  });
  it("NEGATIVE: a missing ac_cite object fails", () => {
    expect(checkAcCiteAudited(out(0, envelope({})))).toContain("no ac_cite");
  });
  it("ERROR: non-JSON stdout fails with a reason", () => {
    expect(checkAcCiteAudited(out(0, "not json"))).toContain("no JSON");
    expect(checkAcCiteAudited(out(0, "{broken"))).toContain("not valid JSON");
  });
  it("BOUNDARY: census requires both counts to be exactly 0", () => {
    const ok = { specs_without_citation: { count: 0 }, specs_with_parent: { count: 0 } };
    expect(checkCensusZero(out(0, envelope(ok)))).toBeNull();
    expect(checkCensusZero(out(0, envelope({ ...ok, specs_without_citation: { count: 1 } })))).toContain("specs_without_citation");
    expect(checkCensusZero(out(0, envelope({ specs_with_parent: { count: 0 } })))).toContain("no specs_without_citation");
  });
  it("REGRESSION F6: AS rules must be counted in rules_total", () => {
    expect(checkRuleTotalsBothTrees(out(0, envelope({ baseline: { rules_total: 1 } })))).toContain("expected 2");
    expect(checkRuleTotalsBothTrees(out(0, envelope({ baseline: { rules_total: 2 } })))).toBeNull();
  });
});

describe("skill scan", () => {
  it("REGRESSION F2/F3: flags a spec table row and the every-spec-needs-a-parent sentence", () => {
    const findings = scanForSpecParentPairing([
      { path: "skills/lore/SKILL.md", text: "| spec | --parent <id-or-slug> |" },
      { path: "skills/lore-kickoff/SKILL.md", text: "**Every spec needs a parent**" },
    ]);
    expect(findings).toHaveLength(2);
  });
  it("NEGATIVE: a create spec line carrying --parent is flagged", () => {
    expect(scanForSpecParentPairing([{ path: "a.md", text: "lore create spec --title T --parent prd-x" }])).toHaveLength(1);
  });
  it("BOUNDARY: `create spec` and `create plan --parent` on different lines is not a pairing", () => {
    const text = "lore create spec --kind tech\nlore create plan --parent prd-x";
    expect(scanForSpecParentPairing([{ path: "a.md", text }])).toEqual([]);
  });
  it("BOUNDARY: a later `create plan --parent` on the SAME line as `create spec --kind tech` is not a pairing", () => {
    const text = "`lore create spec --kind tech`; plans -> `lore create plan --parent <spec>`";
    expect(scanForSpecParentPairing([{ path: "a.md", text }])).toEqual([]);
  });
  it("HAPPY: the no-parent contract sentence is not flagged", () => {
    expect(scanForSpecParentPairing([{ path: "a.md", text: "a spec takes no parent; cite rules instead" }])).toEqual([]);
  });
  it("BOUNDARY: scanning zero files fails loud instead of passing", () => {
    expect(evaluateSkillScan([]).pass).toBe(false);
    expect(evaluateSkillScan([{ path: "a.md", text: "clean" }]).pass).toBe(true);
  });
});

describe("plan and formatting", () => {
  it("STATE: step names are unique and ordered init -> setup -> ... -> tree", () => {
    const names = steps.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toBe("init");
    expect(names.indexOf("approve-cited")).toBeLessThan(names.indexOf("approve-uncited-refused"));
    expect(names[names.length - 1]).toBe("tree-default-root");
  });
  it("HAPPY: line and summary formats", () => {
    expect(formatStepLine("init", 0, { pass: true, reason: "ok" })).toBe("PASS init (exit 0) ok");
    expect(formatStepLine("x", 4, { pass: false, reason: "why" })).toBe("FAIL x (exit 4) why");
    expect(formatSummary([{ pass: true, reason: "" }, { pass: false, reason: "" }])).toBe("1/2 steps passed, 1 failed");
  });
  it("mustContain reports the first missing pattern", () => {
    expect(mustContain("a", /b/)(out(0, "a"))).toContain("/b/");
  });
});

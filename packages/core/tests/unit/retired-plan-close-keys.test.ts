/**
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, BR-1372)
 *
 * The retired `workflow.gates."plan-close".cited_rule_check` / `prd_sync` keys: the strict config schema refuses them
 * and `removeRetiredPlanCloseKey` cuts them line-wise. Pure, so vitest.
 * Dimensions: HAPPY (key cut, siblings untouched), NEGATIVE (schema refuses the key), BOUNDARY (absent key, other
 * keys under the same gate kept, empty parents cut), ERROR (flow style refused by name, malformed YAML),
 * STATE (idempotent: a second cut finds nothing), REGRESSION (a config without the key still parses).
 */

import { describe, it, expect } from "vitest";
import { loadConfigFromString } from "../../src/config.js";
import { RETIRED_PLAN_CLOSE_KEYS, removeRetiredPlanCloseKey } from "../../src/retired-actor-identity-migration.js";

const BASE = "project:\n  name: p\n  author: a\n";

describe("retired plan-close config keys", () => {
  it("NEGATIVE: the strict schema refuses cited_rule_check", () => {
    const text = `${BASE}workflow:\n  gates:\n    plan-close:\n      cited_rule_check:\n        enabled: true\n`;
    const result = loadConfigFromString(text);
    expect(result.ok).toBe(false);
  });

  it("REGRESSION: a config without the key parses", () => {
    expect(loadConfigFromString(`${BASE}workflow:\n  gates:\n    plan-close:\n      enabled: true\n`).ok).toBe(true);
  });

  it("HAPPY: the key is cut with its value and the rest of the file is byte-identical", () => {
    const text = `${BASE}workflow:\n  gates:\n    plan-close:\n      enabled: true\n      cited_rule_check:\n        enabled: true\n    ac-cite:\n      mode: enforce\n`;
    const cut = removeRetiredPlanCloseKey(text, "cited_rule_check");
    expect(cut.ok).toBe(true);
    if (!cut.ok || cut.value === undefined) throw new Error("expected a cut");
    expect(cut.value.value).toEqual({ enabled: true });
    expect(cut.value.text).toBe(`${BASE}workflow:\n  gates:\n    plan-close:\n      enabled: true\n    ac-cite:\n      mode: enforce\n`);
    expect(loadConfigFromString(cut.value.text).ok).toBe(true);
  });

  it("BOUNDARY: parents the cut leaves empty are cut too", () => {
    const text = `${BASE}workflow:\n  gates:\n    plan-close:\n      prd_sync:\n        enabled: false\n`;
    const cut = removeRetiredPlanCloseKey(text, "prd_sync");
    expect(cut.ok && cut.value?.text).toBe(BASE);
  });

  it("BOUNDARY: an absent key (and a config with no workflow section) is ok(undefined)", () => {
    expect(removeRetiredPlanCloseKey(BASE, "cited_rule_check")).toEqual({ ok: true, value: undefined });
    expect(removeRetiredPlanCloseKey(`${BASE}workflow:\n  gates:\n    plan-close:\n      enabled: true\n`, "prd_sync")).toEqual({ ok: true, value: undefined });
  });

  it("STATE: cutting twice changes nothing the second time", () => {
    const text = `${BASE}workflow:\n  gates:\n    plan-close:\n      enabled: true\n      cited_rule_check:\n        enabled: true\n`;
    const first = removeRetiredPlanCloseKey(text, "cited_rule_check");
    if (!first.ok || first.value === undefined) throw new Error("expected a cut");
    expect(removeRetiredPlanCloseKey(first.value.text, "cited_rule_check")).toEqual({ ok: true, value: undefined });
  });

  it("ERROR: a flow-style placement is refused by name and malformed YAML is refused", () => {
    const flow = `${BASE}workflow:\n  gates:\n    plan-close: { cited_rule_check: { enabled: true }, enabled: true }\n`;
    const refused = removeRetiredPlanCloseKey(flow, "cited_rule_check");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(JSON.stringify(refused.error)).toContain('workflow.gates.\\"plan-close\\".cited_rule_check');
    expect(removeRetiredPlanCloseKey("a: [unclosed", "prd_sync").ok).toBe(false);
  });

  it("the retired key list is exactly the two names", () => {
    expect([...RETIRED_PLAN_CLOSE_KEYS]).toEqual(["cited_rule_check", "prd_sync"]);
  });
});

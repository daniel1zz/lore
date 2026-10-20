/**
 * @layer core-unit — the retired claim-time identity setting: line-wise removal (`lore migrate config-keys`).
 *
 * @spec_ref spec-every-write-is-made-by-a-known-party-an-attested-agent-run#AC-HID-4
 *
 * Dimensions: HAPPY (a lone setting is cut with every empty parent) / NEGATIVE (a flow-style placement and malformed
 * YAML are refused, nothing rewritten) / BOUNDARY (a sibling key, a trailing comment, an unrelated gate, absence) /
 * STATE (a second removal finds nothing) / REGRESSION (every other byte of the file is identical).
 */
import { describe, it, expect } from "vitest";
import { removeRetiredActorIdentityGate } from "../src/retired-actor-identity-migration.js";

const KEY = ["actor", "identity"].join("_");

function removal(text: string) {
  const result = removeRetiredActorIdentityGate(text);
  if (!result.ok) throw new Error(`unexpected error: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("removeRetiredActorIdentityGate", () => {
  it("HAPPY: a lone setting is cut together with every parent mapping it leaves empty", () => {
    const found = removal(`workflow:\n  gates:\n    "task-claim":\n      ${KEY}:\n        enabled: false\n`);
    expect(found?.text).toBe("");
    expect(found?.value).toEqual({ enabled: false });
  });

  it("REGRESSION: every other byte is identical (siblings, comments, other sections)", () => {
    const before = `# project config\nproject:\n  name: demo\nworkflow:\n  gates:\n    "task-claim":\n      anchor_overlap:\n        enabled: true # keep\n      ${KEY}:\n        enabled: false # retired\n    plan-close:\n      enabled: true\n`;
    const after = `# project config\nproject:\n  name: demo\nworkflow:\n  gates:\n    "task-claim":\n      anchor_overlap:\n        enabled: true # keep\n    plan-close:\n      enabled: true\n`;
    expect(removal(before)?.text).toBe(after);
  });

  it("STATE: a second removal finds nothing to do", () => {
    const first = removal(`workflow:\n  gates:\n    "task-claim":\n      ${KEY}:\n        enabled: false\n    plan-close:\n      enabled: true\n`);
    expect(first).toBeDefined();
    expect(removal(first!.text)).toBeUndefined();
  });

  it("BOUNDARY: absence is not an error", () => {
    expect(removal("project:\n  name: demo\n")).toBeUndefined();
    expect(removal("workflow:\n  gates:\n    plan-close:\n      enabled: true\n")).toBeUndefined();
  });

  it("NEGATIVE: a flow-style placement is refused by name, nothing rewritten", () => {
    const result = removeRetiredActorIdentityGate(`workflow: { gates: { task-claim: { ${KEY}: { enabled: false }, anchor_overlap: { enabled: true } } } }\n`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("NEGATIVE: malformed YAML is a validation error, not a throw", () => {
    const result = removeRetiredActorIdentityGate("workflow: [unclosed\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "VALIDATION_ERROR", field: "yaml" });
  });
});

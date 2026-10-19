/**
 * task-memory-file-limits-are-always-enforced-the-warn-adoption: the retired `context.memory_files.adoption` setting.
 *
 * Pure units (no spawn): the loader refusal text, the by-line removal that keeps every other byte, and the budget
 * resolution that turns the refusal into a `retired-setting` source instead of substituted defaults.
 *
 * Dimensions: HAPPY (removal bytes) / NEGATIVE (refusal for either value; flow style refused) / BOUNDARY (sole key
 * removes emptied parents; trailing comment; absent key) / ERROR (malformed YAML) / REGRESSION (no silent
 * default-budgets substitution).
 */
import { describe, expect, it } from "vitest";
import {
  isRetiredAdoptionError,
  loadConfigFromString,
  removeRetiredAdoptionSetting,
  resolveMemoryFileBudgetsFromConfigResult,
  RETIRED_ADOPTION_MESSAGE,
} from "../src/index.js";

const WITH = "# top\nproject:\n  name: x\ncontext:\n  memory_files:\n    root:\n      max_lines: 200\n    adoption: warn # why\naudit:\n  verify_since: \"2026-07-06T12:02:00Z\"\n";
const WITHOUT = "# top\nproject:\n  name: x\ncontext:\n  memory_files:\n    root:\n      max_lines: 200\naudit:\n  verify_since: \"2026-07-06T12:02:00Z\"\n";

describe("loadConfigFromString refuses the retired adoption setting", () => {
  it("NEGATIVE: both values are refused with the exact message naming the migrate action", () => {
    for (const value of ["warn", "enforce"]) {
      const result = loadConfigFromString(`context:\n  memory_files:\n    adoption: ${value}\n`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(isRetiredAdoptionError(result.error)).toBe(true);
      expect(result.error).toMatchObject({ message: RETIRED_ADOPTION_MESSAGE, value });
    }
    expect(RETIRED_ADOPTION_MESSAGE).toContain("lore migrate memory-limits --apply");
  });

  it("BOUNDARY: a config without the setting loads", () => {
    const result = loadConfigFromString("project:\n  name: x\n  author: a\ncontext:\n  memory_files:\n    root:\n      max_lines: 200\n");
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });
});

describe("removeRetiredAdoptionSetting", () => {
  it("HAPPY: cuts only the setting's line (trailing comment included), every other byte identical, value reported", () => {
    const result = removeRetiredAdoptionSetting(WITH);
    expect(result).toEqual({ ok: true, value: { text: WITHOUT, value: "warn" } });
  });

  it("BOUNDARY: absent setting is ok(undefined), never an error", () => {
    expect(removeRetiredAdoptionSetting(WITHOUT)).toEqual({ ok: true, value: undefined });
  });

  it("BOUNDARY: the only key under memory_files and context removes both emptied parents", () => {
    const result = removeRetiredAdoptionSetting("project:\n  name: x\ncontext:\n  memory_files:\n    adoption: enforce\n");
    expect(result).toEqual({ ok: true, value: { text: "project:\n  name: x\n", value: "enforce" } });
  });

  it("BOUNDARY: a sibling under context keeps context, removing only memory_files", () => {
    const result = removeRetiredAdoptionSetting("context:\n  language: en\n  memory_files:\n    adoption: warn\n");
    expect(result).toEqual({ ok: true, value: { text: "context:\n  language: en\n", value: "warn" } });
  });

  it("IDEMPOTENT: the removed text carries no setting, so a second removal finds nothing", () => {
    const first = removeRetiredAdoptionSetting(WITH);
    if (!first.ok || first.value === undefined) throw new Error("fixture: first removal must succeed");
    expect(removeRetiredAdoptionSetting(first.value.text)).toEqual({ ok: true, value: undefined });
  });

  it("NEGATIVE: a flow-style mapping is refused (cannot be cut line-wise), naming the hand edit", () => {
    const result = removeRetiredAdoptionSetting("context:\n  memory_files: { adoption: warn, enabled: true }\n");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "VALIDATION_ERROR", field: "context.memory_files.adoption" });
    expect(JSON.stringify(result.error)).toContain("delete it by hand");
  });

  it("ERROR: malformed YAML is a VALIDATION_ERROR, never a throw", () => {
    const result = removeRetiredAdoptionSetting("context: [unclosed\n");
    expect(result.ok).toBe(false);
  });
});

describe("resolveMemoryFileBudgetsFromConfigResult", () => {
  it("REGRESSION: the refusal is its own source, never substituted defaults the caller could run on silently", () => {
    const resolution = resolveMemoryFileBudgetsFromConfigResult(loadConfigFromString(WITH));
    expect(resolution.source).toBe("retired-setting");
  });
});

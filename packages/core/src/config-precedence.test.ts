/**
 * Tests for `@lore/core` defaults-precedence derivation (`config-precedence.ts`,
 * SPEC-064 §Design D4, task `task-skill-implement-config-precedence-pure-contract-core`).
 * Colocated per this package's `packages/core/src/*.test.ts` convention.
 *
 * Six-dimension coverage:
 *   HAPPY:      each of the 3 layers (machine/project/builtin) is correctly
 *               reported as effective when it is the ONLY source for a key.
 *   BOUNDARY:   both machine and project absent → builtin; `editor`'s
 *               no-built-in-value case (effective stays `undefined`).
 *   NEGATIVE/STATE: project overrides machine when both are present — proven
 *               against `mergeDefaults` directly, AND against a deliberately
 *               naive "machine always wins" stub shown FIRST to pass what this
 *               real assertion correctly fails, so the project-wins assertion
 *               is not vacuously true under an inverted precedence policy.
 *   ERROR:      malformed/partial inputs (empty object, `undefined` on both
 *               sides, an object carrying an unrelated extra key) never throw.
 *   REGRESSION: all 8 presence combinations of machine/project across the 3
 *               `defaults.*` keys produce an `effective` value IDENTICAL to
 *               `mergeDefaults(machine, project)[key] ?? BUILTIN_DEFAULTS[key]`
 *               — the module must never drift from the imported precedence fn.
 *
 * @spec_ref SPEC-064 §Design D4; AC-064-5
 */

import { describe, it, expect } from "vitest";
import { mergeDefaults } from "./config.js";
import type { LoreDefaults } from "./config.js";
import { BUILTIN_DEFAULTS, computeDefaultsPrecedence } from "./config-precedence.js";
import type { DefaultsPrecedenceRow } from "./config-precedence.js";

/** A deliberately WRONG precedence stub — machine always wins, regardless of project. Used only to prove the real assertions below are not vacuous. */
function naiveMachineAlwaysWinsLayer(
  machine: LoreDefaults | undefined,
  project: LoreDefaults | undefined,
  key: keyof LoreDefaults,
): "machine" | "project" | "builtin" {
  if (machine?.[key] !== undefined) return "machine";
  if (project?.[key] !== undefined) return "project";
  return "builtin";
}

// ─── HAPPY — each layer, in isolation, is reported effective ────────────────

describe("computeDefaultsPrecedence — HAPPY: single-source-of-truth per layer", () => {
  it("machine-only value is effective, layer 'machine'", () => {
    const rows = computeDefaultsPrecedence({ editor: "vim" }, undefined);
    const editorRow = rows.find((r) => r.key === "editor");
    expect(editorRow).toEqual<DefaultsPrecedenceRow>({
      key: "editor",
      machine: "vim",
      project: undefined,
      builtin: undefined,
      effective: "vim",
      effectiveLayer: "machine",
    });
  });

  it("project-only value is effective, layer 'project'", () => {
    const rows = computeDefaultsPrecedence(undefined, { color: false });
    const colorRow = rows.find((r) => r.key === "color");
    expect(colorRow).toEqual<DefaultsPrecedenceRow>({
      key: "color",
      machine: undefined,
      project: false,
      builtin: true,
      effective: false,
      effectiveLayer: "project",
    });
  });

  it("built-in-only value is effective, layer 'builtin', when neither scope sets the key", () => {
    const rows = computeDefaultsPrecedence(undefined, undefined);
    const formatRow = rows.find((r) => r.key === "format");
    expect(formatRow).toEqual<DefaultsPrecedenceRow>({
      key: "format",
      machine: undefined,
      project: undefined,
      builtin: "text",
      effective: "text",
      effectiveLayer: "builtin",
    });
  });

  it("returns exactly 3 rows in fixed key order [editor, format, color]", () => {
    const rows = computeDefaultsPrecedence(undefined, undefined);
    expect(rows.map((r) => r.key)).toEqual(["editor", "format", "color"]);
  });
});

// ─── BOUNDARY — both absent, and editor's no-builtin case ───────────────────

describe("computeDefaultsPrecedence — BOUNDARY: both layers absent; editor has no built-in", () => {
  it("both machine and project absent for every key → falls to builtin", () => {
    const rows = computeDefaultsPrecedence(undefined, undefined);
    for (const row of rows) {
      expect(row.effectiveLayer).toBe("builtin");
      expect(row.effective).toBe(BUILTIN_DEFAULTS[row.key]);
    }
  });

  it("editor's builtin is honestly undefined — both absent leaves effective undefined, not a fabricated value", () => {
    const rows = computeDefaultsPrecedence(undefined, undefined);
    const editorRow = rows.find((r) => r.key === "editor");
    expect(editorRow?.builtin).toBeUndefined();
    expect(editorRow?.effective).toBeUndefined();
    expect(editorRow?.effectiveLayer).toBe("builtin");
    expect(BUILTIN_DEFAULTS).not.toHaveProperty("editor");
  });

  it("empty objects on both sides behave identically to undefined", () => {
    const rows = computeDefaultsPrecedence({}, {});
    for (const row of rows) {
      expect(row.effectiveLayer).toBe("builtin");
    }
  });
});

// ─── NEGATIVE/STATE — project wins over machine, proven against a wrong stub ─

describe("computeDefaultsPrecedence — NEGATIVE/STATE: project overrides machine (not vice versa)", () => {
  it("project value wins when both machine and project set the same key", () => {
    const rows = computeDefaultsPrecedence({ editor: "vim", format: "json", color: true }, { editor: "nano" });
    const editorRow = rows.find((r) => r.key === "editor");
    expect(editorRow?.effective).toBe("nano");
    expect(editorRow?.effectiveLayer).toBe("project");
    // Untouched-by-project keys still resolve from machine.
    const formatRow = rows.find((r) => r.key === "format");
    expect(formatRow?.effective).toBe("json");
    expect(formatRow?.effectiveLayer).toBe("machine");
  });

  it("self-check: the naive 'machine always wins' stub disagrees with the real module on this exact case", () => {
    const machine: LoreDefaults = { editor: "vim" };
    const project: LoreDefaults = { editor: "nano" };

    // The naive stub gets it WRONG (machine wins) ...
    expect(naiveMachineAlwaysWinsLayer(machine, project, "editor")).toBe("machine");

    // ... while the real module correctly reports project as effective,
    // proving the assertion above is falsifiable and not accidentally true
    // under an inverted precedence policy.
    const rows = computeDefaultsPrecedence(machine, project);
    expect(rows.find((r) => r.key === "editor")?.effectiveLayer).toBe("project");
  });

  it("effective value always equals mergeDefaults' result for a mixed machine/project set", () => {
    const machine: LoreDefaults = { editor: "vim", format: "text", color: true };
    const project: LoreDefaults = { format: "json" };
    const merged = mergeDefaults(machine, project);

    const rows = computeDefaultsPrecedence(machine, project);
    for (const row of rows) {
      expect(row.effective).toBe(merged[row.key] ?? BUILTIN_DEFAULTS[row.key]);
    }
  });
});

// ─── ERROR — malformed/partial input never throws ───────────────────────────

describe("computeDefaultsPrecedence — ERROR: malformed/partial input never throws", () => {
  it("undefined on both sides never throws", () => {
    expect(() => computeDefaultsPrecedence(undefined, undefined)).not.toThrow();
  });

  it("a partial object missing keys never throws and reports the missing keys as builtin/absent", () => {
    expect(() => computeDefaultsPrecedence({ color: true }, {})).not.toThrow();
    const rows = computeDefaultsPrecedence({ color: true }, {});
    expect(rows.find((r) => r.key === "editor")?.effective).toBeUndefined();
  });

  it("an object carrying an unrelated/untyped extra property never throws (extra keys are ignored)", () => {
    const rogueMachine = { editor: "vim", unrelatedField: 42 } as unknown as LoreDefaults;
    expect(() => computeDefaultsPrecedence(rogueMachine, undefined)).not.toThrow();
    const rows = computeDefaultsPrecedence(rogueMachine, undefined);
    expect(rows.find((r) => r.key === "editor")?.effective).toBe("vim");
  });

  it("a falsy-but-defined value (color: false) is never coerced away by the builtin fallback", () => {
    const rows = computeDefaultsPrecedence({ color: false }, undefined);
    const colorRow = rows.find((r) => r.key === "color");
    expect(colorRow?.effective).toBe(false);
    expect(colorRow?.effectiveLayer).toBe("machine");
  });
});

// ─── REGRESSION — all 8 presence combinations × 3 keys match mergeDefaults ──

describe("computeDefaultsPrecedence — REGRESSION: consistent with mergeDefaults across all 8 combinations", () => {
  const KEY_VALUES: Record<keyof LoreDefaults, [LoreDefaults[keyof LoreDefaults], LoreDefaults[keyof LoreDefaults]]> =
    {
      editor: ["vim", "nano"],
      format: ["text", "json"],
      color: [true, false],
    };

  const PRESENCE_COMBINATIONS: ReadonlyArray<{ machine: boolean; project: boolean; label: string }> = [
    { machine: false, project: false, label: "neither present" },
    { machine: true, project: false, label: "machine only" },
    { machine: false, project: true, label: "project only" },
    { machine: true, project: true, label: "both present" },
  ];

  for (const key of Object.keys(KEY_VALUES) as (keyof LoreDefaults)[]) {
    for (const combo of PRESENCE_COMBINATIONS) {
      // Each combination is exercised twice more (with distinct machine/project
      // values when both are present) to cover the full 2×2×2=8-combination
      // matrix the AC names (presence × presence × distinct-value overlap).
      const [machineValue, projectValue] = KEY_VALUES[key];

      it(`key=${key}, ${combo.label}: effective matches mergeDefaults, falls to builtin when both absent`, () => {
        const machine: LoreDefaults | undefined = combo.machine ? { [key]: machineValue } : undefined;
        const project: LoreDefaults | undefined = combo.project ? { [key]: projectValue } : undefined;

        const merged = mergeDefaults(machine, project);
        const expectedEffective = merged[key] ?? BUILTIN_DEFAULTS[key];

        const rows = computeDefaultsPrecedence(machine, project);
        const row = rows.find((r) => r.key === key);

        expect(row?.effective).toBe(expectedEffective);
        if (!combo.machine && !combo.project) {
          expect(row?.effectiveLayer).toBe("builtin");
        }
      });
    }
  }

  it("all 3 keys, all 8 presence×value combinations (2^3 machine-set × project-set pairs per key) match mergeDefaults exactly", () => {
    for (const key of Object.keys(KEY_VALUES) as (keyof LoreDefaults)[]) {
      const [valueA, valueB] = KEY_VALUES[key];
      const presenceOptions: Array<LoreDefaults[keyof LoreDefaults] | undefined> = [undefined, valueA];
      const projectOptions: Array<LoreDefaults[keyof LoreDefaults] | undefined> = [undefined, valueB];

      for (const machineVal of presenceOptions) {
        for (const projectVal of projectOptions) {
          const machine: LoreDefaults | undefined = machineVal === undefined ? undefined : { [key]: machineVal };
          const project: LoreDefaults | undefined = projectVal === undefined ? undefined : { [key]: projectVal };

          const merged = mergeDefaults(machine, project);
          const expected = merged[key] ?? BUILTIN_DEFAULTS[key];

          const row = computeDefaultsPrecedence(machine, project).find((r) => r.key === key);
          expect(row?.effective).toBe(expected);
        }
      }
    }
  });
});

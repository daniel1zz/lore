/**
 * Six-dimension tests for verify-spawn.ts (SPEC-039 §2 D5, D6, D9) — pure module,
 * no Bun API, no IO, vitest-safe.
 *
 * Dimension mapping:
 *   HAPPY:      buildVerifySpawnSpec falls back to opts.defaultTimeoutMs when the
 *               criterion omits timeout_ms; the criterion's own timeout_ms wins
 *               when present (AC-VRF per-AC-override-wins semantics, SPEC-039 §2 D9)
 *   BOUNDARY:   deriveVerifyResult truth table (AC-VRF-4), including the
 *               non-obvious timeout-overrides-a-coincidental-0-exit case
 *   REGRESSION: killGraceMs is ALWAYS 5000 regardless of repoRoot/defaultTimeoutMs/
 *               per-AC timeout_ms inputs (SPEC-039 §2 D6 — not configurable)
 *
 * @spec_ref AC-VRF-4
 */

import { describe, it, expect } from "vitest";
import {
  buildVerifySpawnSpec,
  deriveVerifyResult,
  type ScriptAcceptanceCriterion,
} from "../../../src/service/verify-spawn.js";

function makeCriterion(
  overrides: Partial<{
    command: string;
    timeout_ms: number;
    oracle: ScriptAcceptanceCriterion["verify"]["oracle"];
  }> = {},
): ScriptAcceptanceCriterion {
  return {
    id: "AC-VRF-TEST",
    statement: "test criterion",
    verify: {
      mode: "script",
      oracle: "test",
      command: "bun test",
      ...overrides,
    },
  } as ScriptAcceptanceCriterion;
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("HAPPY — buildVerifySpawnSpec timeout resolution (SPEC-039 §2 D9)", () => {
  it("falls back to opts.defaultTimeoutMs when the criterion omits timeout_ms", () => {
    const criterion = makeCriterion();
    const spec = buildVerifySpawnSpec(criterion, { repoRoot: "/repo", defaultTimeoutMs: 300000 });
    expect(spec).toEqual({
      cmd: ["sh", "-c", "bun test"],
      cwd: "/repo",
      timeoutMs: 300000,
      killGraceMs: 5000,
    });
  });

  it("the criterion's own timeout_ms wins over opts.defaultTimeoutMs (per-AC override wins)", () => {
    const criterion = makeCriterion({ timeout_ms: 60000 });
    const spec = buildVerifySpawnSpec(criterion, { repoRoot: "/repo", defaultTimeoutMs: 300000 });
    expect(spec.timeoutMs).toBe(60000);
    expect(spec.timeoutMs).not.toBe(300000);
  });

  it("cmd is always exactly [sh, -c, <command>] for a different command/repoRoot pair (defeats a hardcoded-return stub)", () => {
    const criterion = makeCriterion({ command: "echo hi && exit 1" });
    const spec = buildVerifySpawnSpec(criterion, { repoRoot: "/other/repo", defaultTimeoutMs: 1000 });
    expect(spec.cmd).toEqual(["sh", "-c", "echo hi && exit 1"]);
    expect(spec.cwd).toBe("/other/repo");
    expect(spec.timeoutMs).toBe(1000);
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("REGRESSION — killGraceMs is always 5000, never configurable (SPEC-039 §2 D6)", () => {
  it("killGraceMs stays 5000 across different repoRoot/defaultTimeoutMs/per-AC timeout_ms inputs", () => {
    const specA = buildVerifySpawnSpec(makeCriterion(), { repoRoot: "/a", defaultTimeoutMs: 1000 });
    const specB = buildVerifySpawnSpec(makeCriterion({ timeout_ms: 99999 }), {
      repoRoot: "/b",
      defaultTimeoutMs: 500000,
    });
    expect(specA.killGraceMs).toBe(5000);
    expect(specB.killGraceMs).toBe(5000);
  });
});

// ─── BOUNDARY — deriveVerifyResult truth table (AC-VRF-4, the core oracle) ──

describe("BOUNDARY — deriveVerifyResult truth table (AC-VRF-4)", () => {
  it("(0, false) => pass", () => {
    expect(deriveVerifyResult(0, false)).toBe("pass");
  });

  it("(1, false) => fail", () => {
    expect(deriveVerifyResult(1, false)).toBe("fail");
  });

  it("(0, true) => fail — timeout overrides a coincidental 0 exit (the non-obvious case)", () => {
    expect(deriveVerifyResult(0, true)).toBe("fail");
  });

  it("(null, false) => fail", () => {
    expect(deriveVerifyResult(null, false)).toBe("fail");
  });

  it("(137, true) => fail — SIGKILL exit code combined with a timeout", () => {
    expect(deriveVerifyResult(137, true)).toBe("fail");
  });
});

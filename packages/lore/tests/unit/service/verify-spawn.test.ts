/**
 * Six-dimension tests for verify-spawn.ts (SPEC-039 §2 D5, D6, D9; §M2 env-allowlist
 * hardening) — pure module, no Bun API, no IO, vitest-safe.
 *
 * Dimension mapping:
 *   HAPPY:      buildVerifySpawnSpec falls back to opts.defaultTimeoutMs when the
 *               criterion omits timeout_ms; the criterion's own timeout_ms wins
 *               when present (AC-VRF per-AC-override-wins semantics, SPEC-039 §2 D9);
 *               resolveVerifyEnv filters to the default allowlist + config additions
 *   NEGATIVE:   resolveVerifyEnv excludes a secret-shaped var (LORE_SYNC_TOKEN) not
 *               on any allowlist
 *   BOUNDARY:   deriveVerifyResult truth table (AC-VRF-4), including the
 *               non-obvious timeout-overrides-a-coincidental-0-exit case;
 *               resolveVerifyEnv's LC_* prefix match; a var with value `undefined`
 *               in processEnv is never included even if allowlisted
 *   STATE:      buildVerifySpawnSpec threads opts.env verbatim onto VerifySpawnSpec.env
 *   ESCAPE:     resolveVerifyEnv({passthroughAll: true}) returns undefined regardless
 *               of allowlist content — the full-passthrough escape hatch
 *   REGRESSION: killGraceMs is ALWAYS 5000 regardless of repoRoot/defaultTimeoutMs/
 *               per-AC timeout_ms inputs (SPEC-039 §2 D6 — not configurable);
 *               buildVerifySpawnSpec omits `env` entirely (not `env: undefined`)
 *               when opts.env is omitted — pre-M2 callers/tests unaffected
 *
 * @spec_ref AC-VRF-4; SPEC-039 §M2
 */

import { describe, it, expect } from "vitest";
import {
  buildVerifySpawnSpec,
  deriveVerifyResult,
  resolveVerifyEnv,
  DEFAULT_VERIFY_ENV_ALLOWLIST,
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

// ─── resolveVerifyEnv (SPEC-039 §M2 env-allowlist hardening) ──────────────────

describe("resolveVerifyEnv — HAPPY", () => {
  it("keeps every DEFAULT_VERIFY_ENV_ALLOWLIST var present in processEnv", () => {
    const processEnv = { PATH: "/bin", HOME: "/home/alice", USER: "alice" };
    const env = resolveVerifyEnv(processEnv, { allowlist: [], passthroughAll: false });
    expect(env).toEqual({ PATH: "/bin", HOME: "/home/alice", USER: "alice" });
  });

  it("keeps a var named in the additive config allowlist", () => {
    const processEnv = { PATH: "/bin", CI_TOKEN: "abc123" };
    const env = resolveVerifyEnv(processEnv, { allowlist: ["CI_TOKEN"], passthroughAll: false });
    expect(env).toEqual({ PATH: "/bin", CI_TOKEN: "abc123" });
  });
});

describe("resolveVerifyEnv — NEGATIVE (secrets excluded by default)", () => {
  it("excludes LORE_SYNC_TOKEN — not on the default allowlist and not in the config allowlist", () => {
    const processEnv = { PATH: "/bin", LORE_SYNC_TOKEN: "super-secret" };
    const env = resolveVerifyEnv(processEnv, { allowlist: [], passthroughAll: false });
    expect(env).toEqual({ PATH: "/bin" });
    expect(env?.["LORE_SYNC_TOKEN"]).toBeUndefined();
  });

  it("excludes an arbitrary non-allowlisted var (LORE_API_KEY)", () => {
    const processEnv = { PATH: "/bin", LORE_API_KEY: "key-material" };
    const env = resolveVerifyEnv(processEnv, { allowlist: [], passthroughAll: false });
    expect(env).toEqual({ PATH: "/bin" });
  });
});

describe("resolveVerifyEnv — BOUNDARY", () => {
  it("LC_* is a PREFIX match — LC_ALL and LC_CTYPE both pass through without being individually listed", () => {
    const processEnv = { PATH: "/bin", LC_ALL: "en_US.UTF-8", LC_CTYPE: "en_US.UTF-8" };
    const env = resolveVerifyEnv(processEnv, { allowlist: [], passthroughAll: false });
    expect(env).toEqual({ PATH: "/bin", LC_ALL: "en_US.UTF-8", LC_CTYPE: "en_US.UTF-8" });
  });

  it("a var with value undefined in processEnv is never included even when its name is allowlisted", () => {
    const processEnv = { PATH: "/bin", HOME: undefined };
    const env = resolveVerifyEnv(processEnv, { allowlist: [], passthroughAll: false });
    expect(env).toEqual({ PATH: "/bin" });
    expect("HOME" in (env ?? {})).toBe(false);
  });

  it("DEFAULT_VERIFY_ENV_ALLOWLIST contains exactly the documented default set (locks the list)", () => {
    expect([...DEFAULT_VERIFY_ENV_ALLOWLIST].sort()).toEqual(
      ["HOME", "LANG", "LOGNAME", "PATH", "PWD", "SHELL", "TEMP", "TERM", "TMP", "TMPDIR", "TZ", "USER"].sort(),
    );
  });
});

describe("resolveVerifyEnv — ESCAPE (passthrough_all)", () => {
  it("passthroughAll: true returns undefined regardless of allowlist content or processEnv", () => {
    const processEnv = { PATH: "/bin", LORE_SYNC_TOKEN: "secret" };
    const env = resolveVerifyEnv(processEnv, { allowlist: [], passthroughAll: true });
    expect(env).toBeUndefined();
  });
});

// ─── buildVerifySpawnSpec.env threading (SPEC-039 §M2) ────────────────────────

describe("buildVerifySpawnSpec — STATE (env threading)", () => {
  it("threads opts.env verbatim onto VerifySpawnSpec.env", () => {
    const criterion = makeCriterion();
    const spec = buildVerifySpawnSpec(criterion, {
      repoRoot: "/repo",
      defaultTimeoutMs: 300000,
      env: { PATH: "/bin" },
    });
    expect(spec.env).toEqual({ PATH: "/bin" });
  });
});

describe("buildVerifySpawnSpec — REGRESSION (env omitted, not env: undefined)", () => {
  it("omits the env key entirely (not present as own property) when opts.env is not passed", () => {
    const criterion = makeCriterion();
    const spec = buildVerifySpawnSpec(criterion, { repoRoot: "/repo", defaultTimeoutMs: 300000 });
    expect(Object.prototype.hasOwnProperty.call(spec, "env")).toBe(false);
    expect(spec.env).toBeUndefined();
  });

  it("pre-M2 toEqual assertion shape (no env key) still matches — additive field is REGRESSION-safe", () => {
    const criterion = makeCriterion();
    const spec = buildVerifySpawnSpec(criterion, { repoRoot: "/repo", defaultTimeoutMs: 300000 });
    expect(spec).toEqual({
      cmd: ["sh", "-c", "bun test"],
      cwd: "/repo",
      timeoutMs: 300000,
      killGraceMs: 5000,
    });
  });
});

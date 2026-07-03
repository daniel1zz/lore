/**
 * Tests for sanitizeSpawnEnv() / isClaudeCliCommand() / buildHermeticSpawnSpec()
 * (SPEC-030 AC-HJ-1, AC-HJ-2, AC-HJ-5).
 *
 * Spec-first expected behaviours, derived from the module's own header JSDoc
 * (packages/lore/src/ai/hermetic-spawn.ts) BEFORE reading the implementation body in
 * detail, then cross-checked against the actual code:
 *   - sanitizeSpawnEnv strips exactly two key families: the literal key "CLAUDECODE" and
 *     any key with the "CLAUDE_" prefix. Every other key — including auth-relevant vars
 *     like ANTHROPIC_API_KEY, PATH, HOME, TERM, LANG, LC_* — passes through UNCHANGED.
 *     This is a denylist (not an allowlist), so unrelated benign vars never need updating.
 *   - undefined-valued env entries are dropped (Bun.spawn's env type is
 *     Record<string,string>, but process.env allows string|undefined).
 *   - isClaudeCliCommand matches on path BASENAME, not full string equality — an absolute
 *     path override like "/usr/local/bin/claude" is still recognized as the Claude CLI.
 *   - buildHermeticSpawnSpec injects the official `--setting-sources ""` isolation flag
 *     ONLY when the configured command resolves (by basename) to `claude` — a
 *     user-substituted judge command is left byte-for-byte untouched in its args.
 *   - buildHermeticSpawnSpec always sets cwd to the passed-in tmpDir and env to the
 *     sanitized map, regardless of which command is configured.
 *   - The module claims to be pure: no Bun.*, no IO, no Date.now()/Math.random(), no
 *     internal reads of process.env/os.tmpdir() (both accepted as parameters).
 *
 * Six-dimension coverage:
 *   HAPPY:      sanitizeSpawnEnv strips CLAUDECODE + multiple CLAUDE_*-prefixed keys while
 *               preserving ordinary vars; isClaudeCliCommand("claude") → true;
 *               buildHermeticSpawnSpec for "claude" appends the isolation flags, sets cwd,
 *               and sanitizes env
 *   NEGATIVE:   isClaudeCliCommand → false for non-claude commands, and
 *               buildHermeticSpawnSpec does NOT inject flags for them; an env map with no
 *               Claude-related keys at all passes through unchanged (no over-stripping)
 *   BOUNDARY:   empty env {} / empty args []; a bare "CLAUDE_" key (prefix-with-nothing);
 *               substring-but-not-prefix keys ("CLAUDECODER", "MY_CLAUDE_VAR") must survive
 *               (proves prefix/exact match, not loose substring search); absolute-path
 *               basename matching for isClaudeCliCommand
 *   ERROR:      never-throws / no-crash guarantee on messy inputs — empty-string env values
 *               (falsy but defined) must be KEPT, not dropped; undefined-valued entries
 *               scattered among defined ones must be dropped without throwing. This is
 *               explicitly the ERROR dimension (never-throws guarantee), NOT NEGATIVE —
 *               per SPEC-030 AC-HJ-5, a prior review round flagged conflating these
 *   STATE:      buildHermeticSpawnSpec is pure — two calls with equal inputs produce
 *               deep-equal but reference-distinct results, and the input cfg.args array is
 *               never mutated by the call (no shared-identity / memoization surprise)
 *   REGRESSION: a config resembling the real default provider entry
 *               ({command: "claude", args: ["-p"], timeout_ms: 60000}) produces
 *               args === ["-p", "--setting-sources", ""] in that exact order — pins
 *               AC-HJ-2 (no behavior change / flag-injection-is-additive-only) for the
 *               real shipped default
 *
 * @spec_ref AC-HJ-1, AC-HJ-2, AC-HJ-4, AC-HJ-5
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeSpawnEnv,
  isClaudeCliCommand,
  buildHermeticSpawnSpec,
} from "../../../src/ai/hermetic-spawn.js";
import type { AiProviderConfig } from "@lore/core";

// ─── Fixture builders ─────────────────────────────────────────────────────────

function makeCfg(overrides: Partial<AiProviderConfig> = {}): AiProviderConfig {
  return {
    command: "claude",
    args: ["-p"],
    timeout_ms: 60_000,
    ...overrides,
  };
}

// ─── sanitizeSpawnEnv — HAPPY ─────────────────────────────────────────────────

describe("sanitizeSpawnEnv — HAPPY", () => {
  it("strips CLAUDECODE and multiple CLAUDE_*-prefixed keys while preserving ordinary vars", () => {
    const input: Record<string, string | undefined> = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/user",
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      ANTHROPIC_API_KEY: "sk-ant-secret",
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "abc123",
      CLAUDE_CONFIG_DIR: "/some/dir",
    };
    const result = sanitizeSpawnEnv(input);
    expect(result).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/home/user",
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      ANTHROPIC_API_KEY: "sk-ant-secret",
    });
    expect(result).not.toHaveProperty("CLAUDECODE");
    expect(result).not.toHaveProperty("CLAUDE_CODE_SESSION_ID");
    expect(result).not.toHaveProperty("CLAUDE_CONFIG_DIR");
  });
});

describe("isClaudeCliCommand — HAPPY", () => {
  it('returns true for the literal command "claude"', () => {
    expect(isClaudeCliCommand("claude")).toBe(true);
  });
});

describe("buildHermeticSpawnSpec — HAPPY", () => {
  it('for command "claude" appends the isolation flags, sets cwd, and sanitizes env', () => {
    const cfg = makeCfg({ args: ["-p"] });
    const result = buildHermeticSpawnSpec(cfg, {
      sourceEnv: { PATH: "/bin", CLAUDECODE: "1" },
      tmpDir: "/tmp/hermetic-test",
    });
    expect(result.command).toBe("claude");
    expect(result.args).toEqual(["-p", "--setting-sources", ""]);
    expect(result.cwd).toBe("/tmp/hermetic-test");
    expect(result.env).toEqual({ PATH: "/bin" });
  });
});

// ─── NEGATIVE ──────────────────────────────────────────────────────────────────

describe("isClaudeCliCommand — NEGATIVE", () => {
  it("returns false for a custom shell-script judge command", () => {
    expect(isClaudeCliCommand("./my-judge.sh")).toBe(false);
  });

  it('returns false for "node"', () => {
    expect(isClaudeCliCommand("node")).toBe(false);
  });

  it('returns false for "python3"', () => {
    expect(isClaudeCliCommand("python3")).toBe(false);
  });
});

describe("buildHermeticSpawnSpec — NEGATIVE", () => {
  it("does NOT append isolation flags for a non-claude command; args stay exactly as configured", () => {
    const cfg = makeCfg({ command: "./my-judge.sh", args: ["--json", "--verbose"] });
    const result = buildHermeticSpawnSpec(cfg, {
      sourceEnv: { PATH: "/bin" },
      tmpDir: "/tmp/hermetic-test",
    });
    expect(result.args).toEqual(["--json", "--verbose"]);
  });
});

describe("sanitizeSpawnEnv — NEGATIVE", () => {
  it("returns an env map with no Claude-related keys unchanged (no accidental over-stripping)", () => {
    const input: Record<string, string | undefined> = {
      PATH: "/usr/bin",
      HOME: "/home/user",
      EDITOR: "vim",
      NODE_ENV: "production",
    };
    const result = sanitizeSpawnEnv(input);
    expect(result).toEqual(input);
  });
});

// ─── BOUNDARY ──────────────────────────────────────────────────────────────────

describe("sanitizeSpawnEnv — BOUNDARY", () => {
  it("empty env object {} returns {}", () => {
    expect(sanitizeSpawnEnv({})).toEqual({});
  });

  it('a key that is exactly "CLAUDE_" (prefix with nothing after) is still stripped (prefix match, not word-boundary)', () => {
    const result = sanitizeSpawnEnv({ CLAUDE_: "whatever", PATH: "/bin" });
    expect(result).not.toHaveProperty("CLAUDE_");
    expect(result).toEqual({ PATH: "/bin" });
  });

  it('a key like "CLAUDECODER" (contains "CLAUDECODE" but is NOT the exact literal) is preserved', () => {
    const result = sanitizeSpawnEnv({ CLAUDECODER: "1", PATH: "/bin" });
    expect(result).toEqual({ CLAUDECODER: "1", PATH: "/bin" });
  });

  it('a key like "MY_CLAUDE_VAR" (contains "CLAUDE_" as a substring but does not START WITH it) is preserved', () => {
    const result = sanitizeSpawnEnv({ MY_CLAUDE_VAR: "1", PATH: "/bin" });
    expect(result).toEqual({ MY_CLAUDE_VAR: "1", PATH: "/bin" });
  });
});

describe("isClaudeCliCommand — BOUNDARY", () => {
  // Boundary on the MATCHING STRATEGY (basename vs full-string equality), not on string
  // length — kept here (rather than STATE) because it exercises the same "is this a
  // proper match, not a loose one" question as the CLAUDE_ prefix boundary tests above.
  it("matches an absolute path override by basename, not literal string equality", () => {
    expect(isClaudeCliCommand("/usr/local/bin/claude")).toBe(true);
  });

  it("does not match an absolute path whose basename is not claude", () => {
    expect(isClaudeCliCommand("/usr/local/bin/claude-judge.sh")).toBe(false);
  });
});

describe("buildHermeticSpawnSpec — BOUNDARY", () => {
  it('empty args ([]) on a claude command produces args === ["--setting-sources", ""] (nothing else)', () => {
    const cfg = makeCfg({ args: [] });
    const result = buildHermeticSpawnSpec(cfg, { sourceEnv: {}, tmpDir: "/tmp/x" });
    expect(result.args).toEqual(["--setting-sources", ""]);
  });
});

// ─── ERROR: never-throws / no-crash guarantee (NOT negative-input framing) ────

describe("sanitizeSpawnEnv — ERROR: never throws / no-crash guarantee on messy inputs", () => {
  it('an env value of empty string "" (falsy but defined) is KEPT, not dropped — must check `=== undefined`, not `!value`', () => {
    const result = sanitizeSpawnEnv({ EMPTY_VAR: "", PATH: "/bin" });
    expect(result).toHaveProperty("EMPTY_VAR", "");
    expect(Object.keys(result)).toContain("EMPTY_VAR");
  });

  it("undefined values scattered among defined ones are dropped without throwing", () => {
    const input: Record<string, string | undefined> = {
      PATH: "/bin",
      GHOST_VAR: undefined,
      HOME: "/home/user",
      ANOTHER_GHOST: undefined,
      CLAUDECODE: "1",
    };
    expect(() => sanitizeSpawnEnv(input)).not.toThrow();
    const result = sanitizeSpawnEnv(input);
    expect(result).toEqual({ PATH: "/bin", HOME: "/home/user" });
    expect(result).not.toHaveProperty("GHOST_VAR");
    expect(result).not.toHaveProperty("ANOTHER_GHOST");
  });
});

describe("buildHermeticSpawnSpec — ERROR: never throws on messy inputs", () => {
  it("never throws when sourceEnv contains undefined values mixed with CLAUDE_* keys", () => {
    const cfg = makeCfg();
    expect(() =>
      buildHermeticSpawnSpec(cfg, {
        sourceEnv: { PATH: "/bin", GHOST: undefined, CLAUDE_FOO: "x" },
        tmpDir: "/tmp/x",
      }),
    ).not.toThrow();
  });
});

// ─── STATE: purity / no shared mutable state ──────────────────────────────────

describe("buildHermeticSpawnSpec — STATE: purity", () => {
  it("two calls with equal inputs produce deep-equal but reference-distinct results", () => {
    const cfg = makeCfg({ args: ["-p"] });
    const context = { sourceEnv: { PATH: "/bin" }, tmpDir: "/tmp/x" };
    const first = buildHermeticSpawnSpec(cfg, context);
    const second = buildHermeticSpawnSpec(cfg, context);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.args).not.toBe(second.args);
    expect(first.env).not.toBe(second.env);
  });

  it("does not mutate the original cfg.args array passed in", () => {
    const originalArgs = ["-p", "--foo"];
    const cfg = makeCfg({ args: originalArgs });
    buildHermeticSpawnSpec(cfg, { sourceEnv: {}, tmpDir: "/tmp/x" });
    expect(cfg.args).toEqual(["-p", "--foo"]);
    expect(cfg.args).toBe(originalArgs);
  });
});

// ─── REGRESSION: real default provider config, flag-injection order pinned ────

describe("buildHermeticSpawnSpec — REGRESSION: real default provider entry", () => {
  it('a config resembling the real default provider entry ({command: "claude", args: ["-p"], timeout_ms: 60000}) produces args starting with ["-p", "--setting-sources", ""] in that exact order', () => {
    const cfg: AiProviderConfig = { command: "claude", args: ["-p"], timeout_ms: 60_000 };
    const result = buildHermeticSpawnSpec(cfg, {
      sourceEnv: { PATH: "/bin" },
      tmpDir: "/tmp/x",
    });
    // Pins AC-HJ-2: the user's existing -p flag is preserved AHEAD of the injected
    // isolation flags, not overwritten or reordered.
    expect(result.args).toEqual(["-p", "--setting-sources", ""]);
  });
});

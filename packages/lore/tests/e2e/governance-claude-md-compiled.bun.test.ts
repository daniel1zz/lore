/**
 * RED (TDD role) — compiled-binary e2e oracle for the SPEC TARGET behavior of
 * `lore governance [topic]` positional topic dispatch, which does NOT exist
 * yet. `commands/governance.ts` currently declares only a single boolean
 * `--seat-briefing` flag and no positionals at all, so every scenario below
 * that depends on the positional-topic registry is EXPECTED TO FAIL until
 * the paired implementation task (task-skill-implement-governance-verb-topic-registry-corpus)
 * lands.
 *
 * Target behavior (spec-project-claude-md-content-contract-governance-injected
 * §Design Decisions D6, §Scope): `lore governance [topic]` is a positional
 * registry — `corpus-workflow` (default, bare `lore governance`) |
 * `seat-briefing` | `claude-md`. The pre-existing `--seat-briefing` boolean
 * flag becomes a DEPRECATED ALIAS for `lore governance seat-briefing` (same
 * byte output, plus one deprecation line on stderr). Passing more than one
 * topic token is a usage error, exit 2.
 *
 * AC-CMC-2 (spec-project-claude-md-content-contract-governance-injected):
 * "Compiled binary serves the contract verbatim: dist/lore governance
 * claude-md stdout is byte-identical to assets/governance/claude-md-contract.md,
 * and multi-topic invocation exits 2."
 *
 * Empirically verified CURRENT (pre-implementation) behavior — this is what
 * makes each case below RED, not a test bug (repo standing lesson: trace
 * every RED failure to the real gap, never a mistyped assertion):
 *   - `dist/lore governance claude-md` — the `claude-md` token is an
 *     UNDECLARED positional; citty silently drops it (this command declares
 *     no positionals), so the command falls through to the bare default and
 *     prints `corpus-workflow.md`'s content, exit 0. The byte-identity
 *     assertion against `claude-md-contract.md` therefore fails today.
 *   - `dist/lore governance` (no topic) — unaffected, already prints
 *     `corpus-workflow.md` verbatim, exit 0. This scenario is a REGRESSION
 *     pin (expected to stay GREEN before and after the implementation).
 *   - `dist/lore governance claude-md seat-briefing` (two topic tokens) —
 *     both undeclared positionals are silently dropped the same way; the
 *     command still falls through to the bare default, exit 0. The exit-2
 *     assertion fails today.
 *   - `dist/lore governance --seat-briefing` (legacy flag) — still works,
 *     prints `seat-briefing.md` verbatim, but `dist/lore governance
 *     seat-briefing` (the NEW positional form the deprecation alias must
 *     match) has no positional handling yet, so it falls through to the bare
 *     default (`corpus-workflow.md`) instead — the two invocations' stdout
 *     differ today, and the legacy flag path emits nothing on stderr, so
 *     the deprecation-line assertion also fails.
 *
 * Modeled on `tests/e2e/bootstrap-injection-compiled.bun.test.ts` (compiled
 * `dist/lore` harness conventions: `assertFreshBinary` guard, `REPO_ROOT`
 * derivation, `Bun.spawnSync` wrapper) and
 * `tests/integration/governance-compiled.bun.test.ts` (this command is
 * deliberately bootstrap-stage — no corpus, no `loadLoreApp` — so this suite
 * needs no throwaway corpus fixture either, only a fresh compiled binary and
 * the two on-disk governance assets to compare against).
 *
 * Coverage:
 *   HAPPY:      `governance claude-md` stdout byte-identical to
 *               `assets/governance/claude-md-contract.md`, exit 0.
 *   BOUNDARY:   `governance claude-md` stdout is non-empty and ends with the
 *               same trailing newline the source asset carries (a truncated
 *               or newline-appended print would fail the byte-identity
 *               assertion too, but this pins the boundary byte
 *               independently so a future regression's failure is
 *               unambiguous).
 *   REGRESSION: bare `governance` (no topic) is UNCHANGED — stdout stays
 *               byte-identical to `assets/governance/corpus-workflow.md`
 *               and still carries the `<corpus-workflow>` marker, exit 0
 *               (back-compat default, D6).
 *   ERROR:      `governance claude-md seat-briefing` (two topic tokens)
 *               exits 2, with a message naming both `claude-md` and
 *               `seat-briefing`.
 *   STATE:      legacy `governance --seat-briefing` stdout is byte-identical
 *               to `governance seat-briefing` (the new positional form) —
 *               same underlying asset served through either invocation
 *               shape.
 *   NEGATIVE:   legacy `governance --seat-briefing` emits exactly one
 *               deprecation line on stderr (the flag is a deprecated alias,
 *               not a silently-accepted duplicate spelling).
 *
 * @spec_ref spec-project-claude-md-content-contract-governance-injected
 *   §Design Decisions D6, §Acceptance Criteria AC-CMC-2; task
 *   task-skill-test-governance-topic-dispatch-red-incl-compiled-e2e.
 */

import { beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

// tests/e2e/governance-claude-md-compiled.bun.test.ts -> repo root is 4 levels
// up, same derivation as tests/e2e/bootstrap-injection-compiled.bun.test.ts.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const CLAUDE_MD_CONTRACT_ASSET_PATH = join(REPO_ROOT, "assets", "governance", "claude-md-contract.md");
const CORPUS_WORKFLOW_ASSET_PATH = join(REPO_ROOT, "assets", "governance", "corpus-workflow.md");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the compiled `dist/lore` binary with the repo root as cwd (this command needs no `.lore/` corpus — bootstrap-stage). */
function runLore(args: string[]): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd: REPO_ROOT });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

describe("AC-CMC-2: compiled dist/lore governance <topic> positional dispatch (RED — target D6 registry)", () => {
  it("HAPPY: `governance claude-md` stdout is byte-identical to assets/governance/claude-md-contract.md, exit 0", () => {
    const expected = readFileSync(CLAUDE_MD_CONTRACT_ASSET_PATH, "utf8");
    const result = runLore(["governance", "claude-md"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(expected);
  });

  it("BOUNDARY: `governance claude-md` stdout is non-empty and ends with the same trailing newline as the source asset", () => {
    const expected = readFileSync(CLAUDE_MD_CONTRACT_ASSET_PATH, "utf8");
    const result = runLore(["governance", "claude-md"]);

    expect(result.stdout.length).toBeGreaterThan(0);
    expect(expected.endsWith("\n")).toBe(true);
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout).toBe(expected);
  });

  it("REGRESSION: bare `governance` (no topic) stays byte-identical to assets/governance/corpus-workflow.md — back-compat default unchanged", () => {
    const expected = readFileSync(CORPUS_WORKFLOW_ASSET_PATH, "utf8");
    const result = runLore(["governance"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(expected);
    expect(result.stdout).toContain("<corpus-workflow>");
  });

  it("ERROR: `governance claude-md seat-briefing` (two topic tokens) exits 2, message names both topics", () => {
    const result = runLore(["governance", "claude-md", "seat-briefing"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("claude-md");
    expect(result.stderr).toContain("seat-briefing");
  });

  it("STATE: legacy `governance --seat-briefing` stdout is byte-identical to the new positional `governance seat-briefing` form", () => {
    const legacyResult = runLore(["governance", "--seat-briefing"]);
    const positionalResult = runLore(["governance", "seat-briefing"]);

    expect(legacyResult.exitCode).toBe(0);
    expect(positionalResult.exitCode).toBe(0);
    expect(legacyResult.stdout).toBe(positionalResult.stdout);
  });

  it("NEGATIVE: legacy `governance --seat-briefing` emits exactly one deprecation line on stderr", () => {
    const result = runLore(["governance", "--seat-briefing"]);

    expect(result.exitCode).toBe(0);
    const stderrLines = result.stderr.split("\n").filter((line) => line.length > 0);
    expect(stderrLines).toHaveLength(1);
    expect(stderrLines[0]?.toLowerCase()).toContain("deprecat");
  });
});

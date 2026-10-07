/**
 * AC-083-1 (extended by AC-085-1) — compiled-binary e2e oracle for
 * `lore governance` (SPEC-083 D1) and its `--seat-briefing` flag (SPEC-085
 * D1): spawning the COMPILED `dist/lore governance` binary exits 0 and its
 * stdout (RETIRED topic: now exit 2 naming `lore fragments`, see RE-BASELINE note below) was BYTE-IDENTICAL to the retired corpus-workflow asset on
 * disk; spawning `dist/lore governance --seat-briefing` exits 0 with stdout
 * byte-identical to `assets/governance/seat-briefing.md` (RAW template,
 * placeholders intact — substitution stays the session-start hook's job).
 * Modeled on `tests/integration/cli/slugify-compiled.bun.test.ts` — this
 * command is deliberately bootstrap-stage (no corpus, no `loadLoreApp`), so
 * it needs no throwaway corpus fixture at all, only a fresh compiled binary.
 *
 * `assertFreshBinary` (shared with `gate-hooks.bun.test.ts` /
 * `p2-e2e-closed-loop.bun.test.ts`) fails loud BEFORE any test body runs if
 * `dist/lore` is missing or older than the newest `.ts` source under
 * `packages/{lore,core}/src` — this file itself spawns `dist/lore`, so it
 * falls under the SPEC-061 build-freshness attestation precheck when run via
 * `lore verify`.
 *
 * Coverage:
 *   HAPPY:      `dist/lore governance` exits 0 and its stdout is
 *               byte-identical to `assets/governance/corpus-workflow.md`
 *               (proves D1's "resolves the SAME assets root `lore setup`
 *               uses, prints verbatim" contract end-to-end, not just against
 *               source-mode unit fixtures); `dist/lore governance
 *               --seat-briefing` exits 0 with stdout byte-identical to
 *               `assets/governance/seat-briefing.md`, placeholders intact
 *               (SPEC-085 D1)
 *   NEGATIVE:   `dist/lore governance --bogus-flag` is rejected exit 2 (the
 *               SPEC-051 strict-flag seam wraps this command automatically —
 *               proves the `index.ts` registration actually routes through
 *               `wrapDefault`, not a bare unwrapped `defineCommand`)
 *   BOUNDARY:   stdout is non-empty and ends with exactly the same trailing
 *               newline the source file itself carries (a truncated or
 *               newline-appended print would silently fail the byte-parity
 *               assertion above too, but this pins the specific boundary
 *               byte independently so a future regression's failure message
 *               is unambiguous)
 *   REGRESSION: the printed content still contains the `<corpus-workflow>`
 *               open tag and one of the FEED/PRODUCE/EXECUTE/CLOSE section
 *               headers `assets-ssot.test.ts` already pins on the SOURCE
 *               file — cross-checks that the COMPILED runtime path reads the
 *               real governance asset, not a stale or empty placeholder;
 *               bare `dist/lore governance` (no flag) stays byte-identical
 *               to the SPEC-083 corpus-workflow output — adding the flag
 *               did not change the no-flag default (SPEC-085 D1 regression
 *               pin)
 *
 * @spec_ref SPEC-083 §Acceptance Criteria AC-083-1, SPEC-085 §Acceptance
 *   Criteria AC-085-1
 */

import { describe, expect, it, beforeAll } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { assertFreshBinary } from "./helpers/assert-fresh-binary";

// tests/integration/governance-compiled.bun.test.ts -> repo root is 4 levels up.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const SEAT_BRIEFING_ASSET_PATH = join(REPO_ROOT, "assets", "governance", "seat-briefing.md");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the compiled `dist/lore` binary with the repo root as cwd (this command needs no `.lore/` corpus). */
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

// RE-BASELINE (SPEC-083 amended by spec-context-fragments-config-driven-layered-rule-injection D9,
// task-skill-implement-spec-083-amendment-corpus-workflow-prose): the `corpus-workflow` topic and the
// no-topic default are RETIRED — `assets/governance/corpus-workflow.md` no longer exists, its prose
// ships as `assets/context/corpus-workflow-*.md` fragments. The corpus-workflow assertions below were
// corrected (not weakened): each retired byte-parity claim became (a) a refusal claim on the CLI
// (exit 2, stderr names `lore fragments`, zero prose on stdout) PLUS (b) a positive claim that the
// same prose is carried by the shipped fragment files.
const CONTEXT_FRAGMENT_DIR = join(REPO_ROOT, "assets", "context");

/** Concatenated body of every shipped `corpus-workflow-*.md` fragment, in file-name order. */
function readCorpusWorkflowFragments(): string {
  return readdirSync(CONTEXT_FRAGMENT_DIR)
    .filter((n) => n.startsWith("corpus-workflow-") && n.endsWith(".md"))
    .sort()
    .map((n) => readFileSync(join(CONTEXT_FRAGMENT_DIR, n), "utf8"))
    .join("\n");
}

describe("AC-083-1: compiled dist/lore governance (SPEC-083 D1, amended by D9)", () => {
  it("HAPPY: `governance corpus-workflow` is retired — exits 2, stderr names `lore fragments`, stdout empty — and the fragments carry the prose", () => {
    const result = runLore(["governance", "corpus-workflow"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("lore fragments");
    expect(result.stdout).toBe("");
    expect(readCorpusWorkflowFragments()).toContain("a released-but-uncommitted worktree is what routine cleanup destroys");
  });

  it("NEGATIVE: an unknown flag is rejected exit 2 (SPEC-051 strict-flag seam wraps this command)", () => {
    const result = runLore(["governance", "--bogus-flag"]);
    expect(result.exitCode).toBe(2);
  });

  it("BOUNDARY: a file-backed topic's stdout is non-empty and its last byte matches the source file's own trailing newline (seat-briefing)", () => {
    const expected = readFileSync(SEAT_BRIEFING_ASSET_PATH, "utf8");
    const result = runLore(["governance", "seat-briefing"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(expected.endsWith("\n")).toBe(true);
    expect(result.stdout.endsWith("\n")).toBe(true);
  });

  it("REGRESSION: bare `governance` no longer prints the <corpus-workflow> tag or a FEED header; the shipped fragments carry the FEED/PRODUCE/EXECUTE/CLOSE headers", () => {
    const result = runLore(["governance"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("lore fragments");
    expect(result.stdout).not.toContain("<corpus-workflow>");
    expect(result.stdout).not.toContain("## FEED");

    const fragments = readCorpusWorkflowFragments();
    for (const header of ["## FEED", "## PRODUCE", "## EXECUTE", "## CLOSE"]) {
      expect(fragments).toContain(header);
    }
  });
});

describe("AC-085-1: compiled dist/lore governance --seat-briefing (SPEC-085 D1)", () => {
  it("HAPPY: exits 0 with stdout byte-identical to assets/governance/seat-briefing.md (raw template, placeholders intact)", () => {
    const expected = readFileSync(SEAT_BRIEFING_ASSET_PATH, "utf8");
    const result = runLore(["governance", "--seat-briefing"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(expected);
    expect(result.stdout).toContain("{{ACTOR}}");
    expect(result.stdout).toContain("{{BRANCH}}");
    expect(result.stdout).toContain("{{MAIN_CHECKOUT}}");
  });

  it("REGRESSION: bare `dist/lore governance` (no flag) is the retired default — exit 2 naming `lore fragments`, never the seat briefing; the flag form stays unaffected", () => {
    const result = runLore(["governance"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("lore fragments");
    expect(result.stdout).toBe("");
    expect(runLore(["governance", "--seat-briefing"]).exitCode).toBe(0);
  });

  it("NEGATIVE: an unknown flag alongside --seat-briefing is still rejected exit 2 (strict-flag seam applies regardless of --seat-briefing)", () => {
    const result = runLore(["governance", "--seat-briefing", "--bogus-flag"]);
    expect(result.exitCode).toBe(2);
  });

  it("BOUNDARY: --seat-briefing output and `governance claude-md` output are DIFFERENT non-empty content (the flag actually switches the source file, not a no-op)", () => {
    const seatResult = runLore(["governance", "--seat-briefing"]);
    const otherResult = runLore(["governance", "claude-md"]);

    expect(seatResult.stdout.length).toBeGreaterThan(0);
    expect(otherResult.stdout.length).toBeGreaterThan(0);
    expect(seatResult.stdout).not.toBe(otherResult.stdout);
  });
});

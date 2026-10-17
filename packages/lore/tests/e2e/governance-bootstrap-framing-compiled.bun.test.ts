/**
 * Compiled-binary e2e oracle for `lore governance bootstrap-framing`
 * (spec-context-provenance-injected-corpus-global-state-and-a D2, AC-CP-10).
 *
 * `bootstrap-framing` is the ONE governance topic with no backing asset
 * file — it serves the in-memory `BOOTSTRAP_FRAMING_LINE` constant
 * (`@lore/core`) directly, so the oracle here is identity against that
 * constant, never a file read-back the way `governance-compiled.bun.test.ts`
 * / `governance-claude-md-compiled.bun.test.ts` verify their own (file-backed)
 * topics.
 *
 * Modeled on `tests/integration/governance-compiled.bun.test.ts` and
 * `tests/e2e/governance-claude-md-compiled.bun.test.ts` (same
 * `assertFreshBinary` guard, `REPO_ROOT` derivation, `Bun.spawnSync`
 * wrapper) — this command is deliberately bootstrap-stage (no corpus, no
 * `loadLoreApp`), so this suite needs no throwaway corpus fixture either,
 * only a fresh compiled binary.
 *
 * Coverage:
 *   HAPPY:      `dist/lore governance bootstrap-framing` exits 0, stdout is
 *               `===` identical to the exported `BOOTSTRAP_FRAMING_LINE`
 *               constant (never a remembered substring, D6).
 *   BOUNDARY:   stdout carries ZERO trailing newline — the OPPOSITE
 *               convention from every file-backed topic (whose source `.md`
 *               assets all end with `\n`, per `governance-compiled.bun.test.ts`'s
 *               own BOUNDARY case) — because this topic's content is a raw
 *               constant, not a file read. Pinned explicitly so a future
 *               regression that starts appending a newline (e.g. via
 *               `console.log` instead of `writeAllSync`) fails loud here
 *               rather than only showing up as an off-by-one in the hook's
 *               composed output.
 *   REGRESSION: bare `governance` (no topic) is UNCHANGED — stdout is the RETIRED-default refusal (exit 2, `lore fragments`; SPEC-083 amended by D9) —
 *               no longer byte-identical to a corpus-workflow asset;
 *               adding a fourth topic did not disturb the default.
 *   ERROR:      `governance bootstrap-framing seat-briefing` (two distinct
 *               topic tokens) exits 2, message names both.
 *   NEGATIVE:   `governance bootstrap-framing --bogus-flag` exits 2 (SPEC-051
 *               strict-flag seam applies regardless of which topic).
 *   STATE:      `bootstrap-framing` output and `seat-briefing`
 *               output are DIFFERENT content — the topic actually switches
 *               source, not a no-op.
 *
 * @spec_ref spec-context-provenance-injected-corpus-global-state-and-a
 *   §Design Decisions D2, §Acceptance Criteria AC-CP-10.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { join } from "path";
import { BOOTSTRAP_FRAMING_LINE } from "@lore/core";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

// tests/e2e/governance-bootstrap-framing-compiled.bun.test.ts -> repo root is
// 4 levels up, same derivation as the sibling governance compiled suites.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

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

describe("AC-CP-10: compiled dist/lore governance bootstrap-framing (D2)", () => {
  it("HAPPY: exits 0 with stdout strictly identical to the exported BOOTSTRAP_FRAMING_LINE constant", () => {
    const result = runLore(["governance", "bootstrap-framing"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(BOOTSTRAP_FRAMING_LINE);
  });

  it("BOUNDARY: stdout carries ZERO trailing newline (unlike every file-backed topic's asset)", () => {
    const result = runLore(["governance", "bootstrap-framing"]);

    expect(result.stdout.length).toBeGreaterThan(0);
    expect(BOOTSTRAP_FRAMING_LINE.endsWith("\n")).toBe(false);
    expect(result.stdout.endsWith("\n")).toBe(false);
  });

  // RE-BASELINE (SPEC-083 amended by spec-context-fragments-config-driven-layered-rule-injection D9):
  // the no-topic default (`corpus-workflow`) is retired. Corrected, not weakened: the byte-parity
  // claim became a refusal claim (exit 2, stderr names `lore fragments`, zero prose on stdout) and
  // the `bootstrap-framing` topic is asserted unaffected by the retirement.
  it("REGRESSION: bare `governance` (no topic) is the retired default — exit 2, stderr names `lore fragments`, stdout empty; bootstrap-framing still serves", () => {
    const result = runLore(["governance"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("lore fragments");
    expect(result.stdout).toBe("");
    expect(result.stdout).not.toContain("<corpus-workflow>");
    expect(runLore(["governance", "bootstrap-framing"]).exitCode).toBe(0);
  });

  it("ERROR: `governance bootstrap-framing seat-briefing` (two topic tokens) exits 2, message names both topics", () => {
    const result = runLore(["governance", "bootstrap-framing", "seat-briefing"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("bootstrap-framing");
    expect(result.stderr).toContain("seat-briefing");
  });

  it("NEGATIVE: an unknown flag alongside bootstrap-framing is still rejected exit 2 (strict-flag seam applies regardless of topic)", () => {
    const result = runLore(["governance", "bootstrap-framing", "--bogus-flag"]);
    expect(result.exitCode).toBe(2);
  });

  it("STATE: bootstrap-framing output and seat-briefing output are DIFFERENT non-empty content (the topic actually switches source, not a no-op)", () => {
    const framingResult = runLore(["governance", "bootstrap-framing"]);
    const otherResult = runLore(["governance", "seat-briefing"]);

    expect(framingResult.stdout.length).toBeGreaterThan(0);
    expect(otherResult.stdout.length).toBeGreaterThan(0);
    expect(framingResult.stdout).not.toBe(otherResult.stdout);
  });
});

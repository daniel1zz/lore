// @spawns packages/lore/src/index.ts
// @reads packages/**
/**
 * @spec_ref spec-governance-defaults-must-ship-and-every-recorded-gap-must
 *   AC-GD-2 (D3 — "one condition, one remedy").
 *
 * Proves `lore report-issue`'s "feedback.upstream is unconfigured" remedy
 * has exactly ONE definition site, imported (never rebuilt) by every
 * consuming surface.
 *
 * ⛔ REWRITTEN IN-FLIGHT (P4, spec-the-defect-channel-reaches-no-machine-but-
 * its-own-github) — recorded per the standing in-flight-oracle-edit
 * discipline, three things: original command, the failure it produced, why
 * this is a correction and not a weakening.
 *   - Original command: `bun test tests/unit/adapters/report-issue-single-remedy.bun.test.ts`
 *     against this file's PRE-P4 content, run after P4's source edits landed
 *     (`buildUnconfiguredUpstreamRemedy` relocated from the now-deleted
 *     `service/issue-report-service.ts` to `@lore/core`'s `issue-report.ts`;
 *     `IssueReportService` deleted outright; `--auto-config` removed).
 *   - Exact failure: a TypeScript module-resolution error on this file's own
 *     `import { buildUnconfiguredUpstreamRemedy, IssueReportService, type
 *     IssueReportDeps } from "../../../src/service/issue-report-service.js"`
 *     (the module no longer exists), plus — even hand-patched past that —
 *     AC-GD-2(a)(i)'s own scan asserting the remedy fragment appears
 *     EXACTLY ONCE under `packages/**` would find TWO locations (the new
 *     `@lore/core` site plus this test file's OWN literal copy of the old
 *     message text used for the CLI-vs-service byte-identity comparison,
 *     since the OLD message text changed), and AC-GD-2(d)'s happy-half
 *     (`lore report-issue --list` exits 0 against this repo's own corpus)
 *     would fail because this repo's own `.lore/config.yaml` carries the
 *     LEGACY shape, which P4 refuses loudly by design.
 *   - Why correction, not weakening: every property this file pins —
 *     ONE definition site, BOTH layers importing that one symbol, and the
 *     CLI's stderr matching the shared builder's own text byte-for-byte —
 *     still holds after P4 and is still asserted below, unweakened. What
 *     changed is WHERE the builder lives (relocated, not duplicated) and
 *     WHAT it says (updated because `--auto-config` and the legacy shape it
 *     provisioned no longer exist — see `buildUnconfiguredUpstreamRemedy`'s
 *     own JSDoc for that rationale). The ONE case retired outright
 *     (AC-GD-2(d)'s happy half) asserted a capability — `lore report-issue`
 *     working end-to-end against a LEGACY-configured real corpus — that P4
 *     deliberately removes; no rewritten assertion could make that case
 *     pass without re-implementing the very transport this phase deletes.
 *   - The former NEGATIVE case (byte-identical CLI-vs-`IssueReportService`
 *     comparison) is likewise REWRITTEN, not retired: `IssueReportService`
 *     is gone, so there is no second orchestrator layer left to compare the
 *     CLI against — the surviving property is narrower (CLI stderr equals
 *     the shared builder's own output) but is the same fact this file's
 *     ORIGINAL comparison was actually testing transitively, since the old
 *     service-layer call was itself a thin pass-through to the same builder.
 *
 * Mechanism: spawns `bun run src/index.ts report-issue ...` (Bun.spawnSync)
 * against a THROWAWAY `mkdtemp` + `lore init` corpus — NOT the compiled
 * `dist/lore` binary, so this file needs no `bun run build` first (mirrors
 * `evidence-pipe-wiring.bun.test.ts`'s own `INDEX_TS` pattern).
 *
 * Six-dimension coverage:
 *   HAPPY:      n/a post-P4 — see "why correction" above for AC-GD-2(d)'s
 *               retired happy half.
 *   NEGATIVE:   AC-GD-2(a)(iii) — the CLI subprocess's stderr, on the
 *               unconfigured condition, equals the shared builder's own
 *               output byte-for-byte
 *   BOUNDARY:   AC-GD-2(a)(i) — the pinned (>=40 contiguous chars,
 *               containing `feedback.upstream`) fragment occurs EXACTLY once
 *               across `packages/**`, excluding test files
 *   ERROR:      AC-GD-2(d) error half — the CLI path still exits 4 against a
 *               throwaway corpus with no `feedback.upstream` configured at
 *               all (the pre-D3 baseline, still reachable)
 *   STATE:      AC-GD-2(a)(ii) — `report-issue.ts`'s own source statically
 *               imports the ONE shared symbol by name (now from `@lore/core`)
 *               and defines no competing local builder
 *   REGRESSION: AC-GD-2(b) disclosure substrings still hold post-rewrite
 *
 * Source: spec-governance-defaults-must-ship-and-every-recorded-gap-must D3,
 *   AC-GD-2.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildUnconfiguredUpstreamRemedy } from "@lore/core";

// tests/unit/adapters/ -> tests/unit/ -> tests/ -> packages/lore/ (3 levels up).
const PROJECT_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PROJECT_ROOT, "..", "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");
const CLI_COMMAND_SOURCE_PATH = join(PROJECT_ROOT, "src/adapters/cli/commands/report-issue.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns `bun run src/index.ts ...args` — a REAL, separate OS process, source
 * (not compiled-binary) so this file needs no `bun run build` first. Exit
 * code read directly from `Bun.spawnSync`'s own `exitCode` field.
 *
 * @param homeOverride - redirects `$HOME` to `cwd` so a THROWAWAY corpus
 *   never resolves the REAL machine's XDG global config.
 */
function runLore(args: string[], cwd: string, homeOverride = true): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: {
      ...process.env,
      ...(homeOverride ? { HOME: cwd } : {}),
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "report-issue-single-remedy-probe-session",
    },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/**
 * Recursively collects `.ts` source files under `dir`, skipping
 * `node_modules`/`dist`/dot-directories and any file whose name ends in
 * `.test.ts` (covers both plain vitest specs and `.bun.test.ts`, per this
 * repo's own two-runner naming convention) — AC-GD-2(a)(i)'s scan is over
 * source only, "excluding test files".
 */
function collectNonTestTsFiles(dir: string, out: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectNonTestTsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Counts every (possibly overlapping-free, left-to-right) occurrence of `fragment` across `files`. */
function countLiteralOccurrences(
  files: readonly string[],
  fragment: string,
): { count: number; locations: string[] } {
  let count = 0;
  const locations: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    let occurrencesInFile = 0;
    let searchFrom = 0;
    let idx = text.indexOf(fragment, searchFrom);
    while (idx !== -1) {
      occurrencesInFile++;
      searchFrom = idx + 1;
      idx = text.indexOf(fragment, searchFrom);
    }
    if (occurrencesInFile > 0) {
      count += occurrencesInFile;
      locations.push(`${file} (${occurrencesInFile})`);
    }
  }
  return { count, locations };
}

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-report-issue-single-remedy-"));
  // Never inside this repo — the provisioning corpus under test must not be
  // the repo's own (root CLAUDE.md hard rule, 2026-07-07 pollution incident).
  expect(dir.startsWith(REPO_ROOT)).toBe(false);

  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
});

afterAll(() => {
  if (dir !== undefined) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup of a throwaway dir */
    }
  }
});

describe("AC-GD-2(a)(i): ONE definition site for the shared remedy's literal text", () => {
  it("AC-GD-2(a)(i): the pinned (>=40 char, containing feedback.upstream) fragment occurs EXACTLY once across packages/**, excluding test files", () => {
    const message = buildUnconfiguredUpstreamRemedy();
    const fragment = ("message" in message ? message.message : "").slice(0, 60);
    expect(fragment.length).toBeGreaterThanOrEqual(40);
    expect(fragment).toContain("feedback.upstream");

    const files = collectNonTestTsFiles(PACKAGES_DIR);
    expect(files.length).toBeGreaterThan(0); // sanity: the walk actually visited real source

    const { count, locations } = countLiteralOccurrences(files, fragment);
    expect(count).toBe(1);
    expect(locations).toHaveLength(1);
    expect(locations[0]).toContain("core/src/issue-report.ts");
  });
});

describe("AC-GD-2(a)(ii): the CLI imports the ONE shared symbol by name", () => {
  it("AC-GD-2(a)(ii): report-issue.ts imports buildUnconfiguredUpstreamRemedy from @lore/core and defines no competing local builder", () => {
    const cliSource = readFileSync(CLI_COMMAND_SOURCE_PATH, "utf8");
    expect(cliSource).toMatch(/import\s*\{[^}]*\bbuildUnconfiguredUpstreamRemedy\b[^}]*\}\s*from\s*["']@lore\/core["']/);
    // The deleted, formerly-divergent local builders' DECLARATIONS must be
    // gone (a historical mention in a comment is fine and expected — only a
    // live re-declaration would reintroduce the drift risk).
    expect(cliSource).not.toContain("function buildAutoConfigRequiredError");
    expect(cliSource).not.toContain("function buildUnconfiguredUpstreamRemedy");
  });
});

describe("AC-GD-2(a)(iii) error half: the CLI's unconfigured refusal matches the shared builder byte-for-byte", () => {
  it("AC-GD-2(a)(iii): the CLI subprocess's stderr, on an unconfigured feedback.upstream, equals buildUnconfiguredUpstreamRemedy()'s own text", () => {
    // Throwaway corpus, no feedback.upstream configured at all.
    const cliResult = runLore(
      ["report-issue", "--title", "t", "--description", "d", "--expected", "e", "--actual", "a"],
      dir,
    );
    expect(cliResult.exitCode).toBe(4); // AC-GD-2(d) error half — still the pre-D3 baseline

    const expectedPrefix = "Error: Validation failed on field 'feedback.upstream': ";
    expect(cliResult.stderr.startsWith(expectedPrefix)).toBe(true);
    const cliMessage = cliResult.stderr.slice(expectedPrefix.length).replace(/\n$/, "");
    expect(cliMessage.length).toBeGreaterThan(0);

    const remedy = buildUnconfiguredUpstreamRemedy();
    const builderMessage = "message" in remedy ? remedy.message : "";
    expect(cliMessage).toBe(builderMessage);
  });
});

describe("AC-GD-2(b): disclosure as three literal substrings", () => {
  it("AC-GD-2(b): the shared remedy text contains .lore/config.yaml, git-tracked, and shared", () => {
    const remedy = buildUnconfiguredUpstreamRemedy();
    const message = "message" in remedy ? remedy.message : "";
    expect(message).toContain(".lore/config.yaml");
    expect(message).toContain("git-tracked");
    expect(message).toContain("shared");
  });
});

describe("REGRESSION: the remedy still names the GitHub configuration path (P4 rewrite)", () => {
  it("REGRESSION: names feedback.upstream.repo — the only shape that still does something post-P4", () => {
    const remedy = buildUnconfiguredUpstreamRemedy();
    const message = "message" in remedy ? remedy.message : "";
    expect(message).toContain("feedback.upstream.repo");
  });
});

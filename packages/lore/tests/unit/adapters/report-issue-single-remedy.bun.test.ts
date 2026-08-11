/**
 * @spec_ref spec-governance-defaults-must-ship-and-every-recorded-gap-must
 *   AC-GD-2 (D3 — "one condition, one remedy, and it works in the upstream
 *   OWN repo").
 *
 * Proves `lore report-issue`'s two formerly-independent "feedback.upstream is
 * unconfigured" remedies — `report-issue.ts`'s CLI-layer builder (deleted:
 * `buildAutoConfigRequiredError`) and `issue-report-service.ts`'s
 * service-layer builder (renamed: `buildUnconfiguredUpstreamError` →
 * `buildUnconfiguredUpstreamRemedy`) — are now ONE shared builder, so the
 * prescribed remedy cannot drift between the CLI and the MCP/service surface
 * again.
 *
 * Mechanism: spawns `bun run src/index.ts report-issue ...` (Bun.spawnSync)
 * against a THROWAWAY `mkdtemp` + `lore init` corpus for the CLI-path half of
 * AC-GD-2(a)(iii) — NOT the compiled `dist/lore` binary, so this file needs
 * no `bun run build` first (mirrors `evidence-pipe-wiring.bun.test.ts`'s own
 * `INDEX_TS` pattern). AC-GD-2(d) is the ONE clause that reads THIS repo's
 * own corpus, and it does so read-only (`--list` performs no write).
 *
 * Six-dimension coverage:
 *   HAPPY:      AC-GD-2(d) happy half — `--list` exits 0 against this repo's
 *               own corpus once `feedback.upstream` is configured
 *   NEGATIVE:   AC-GD-2(a)(iii) — the CLI subprocess and a direct
 *               `IssueReportService.report()` call, on the identical
 *               condition, emit BYTE-IDENTICAL remedy text
 *   BOUNDARY:   AC-GD-2(a)(i) — the pinned (>=40 contiguous chars,
 *               containing `feedback.upstream`) fragment occurs EXACTLY once
 *               across `packages/**`, excluding test files
 *   ERROR:      AC-GD-2(d) error half — the CLI path still exits 4 against a
 *               throwaway corpus with no `feedback.upstream` configured at
 *               all (the pre-D3 baseline, still reachable)
 *   STATE:      AC-GD-2(a)(ii) — `report-issue.ts`'s own source statically
 *               imports the ONE shared symbol by name and no longer defines
 *               a competing local builder
 *   REGRESSION: AC-GD-2(b) disclosure substrings, plus the still-live
 *               AC-072-2 (dotted-path config keys) and AC-OOB-1
 *               (`--auto-config` named, zero hand-edit-YAML template lines)
 *               floors this shared text must keep satisfying
 *
 * Source: spec-governance-defaults-must-ship-and-every-recorded-gap-must D3,
 *   AC-GD-2.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoreError } from "@lore/core";
import {
  buildUnconfiguredUpstreamRemedy,
  IssueReportService,
  type IssueReportDeps,
} from "../../../src/service/issue-report-service.js";

/**
 * Narrows a generic `LoreError` to its `message` field via cast — this
 * builder's own declared return type is the broad `LoreError` union (only 4
 * of its variants carry `message`), so TS cannot see the literal
 * `code: "VALIDATION_ERROR"` at this call site. Mirrors the SAME idiom
 * `tests/unit/service/issue-report-service.test.ts` already uses for this
 * exact function's predecessor.
 */
function loreErrorMessage(error: LoreError): string {
  return (error as { message: string }).message;
}

// tests/unit/adapters/ -> tests/unit/ -> tests/ -> packages/lore/ (3 levels up).
const PROJECT_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PROJECT_ROOT, "..", "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");
const CLI_COMMAND_SOURCE_PATH = join(PROJECT_ROOT, "src/adapters/cli/commands/report-issue.ts");
const SERVICE_SOURCE_PATH = join(PROJECT_ROOT, "src/service/issue-report-service.ts");

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
 * @param homeOverride - `true` (default) redirects `$HOME` to `cwd` so a
 *   THROWAWAY corpus never resolves the REAL machine's XDG global config —
 *   the shape every OTHER call site here needs. The one call against
 *   `REPO_ROOT` (AC-GD-2(d)) passes `false`: overriding `$HOME` to the repo
 *   root itself would make `bun`/`lore` materialise a stray
 *   `<REPO_ROOT>/Library/Caches/` (measured — an earlier draft of this file
 *   did exactly that), and this call deliberately targets the REAL
 *   environment this repo's real consumers run in.
 */
function runLore(args: string[], cwd: string, homeOverride = true): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: {
      ...process.env,
      ...(homeOverride ? { HOME: cwd } : {}),
      CLAUDECODE: "1",
      LORE_ACTOR: "agent:report-issue-single-remedy-probe",
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
    const fragment = loreErrorMessage(buildUnconfiguredUpstreamRemedy()).slice(0, 60);
    expect(fragment.length).toBeGreaterThanOrEqual(40);
    expect(fragment).toContain("feedback.upstream");

    const files = collectNonTestTsFiles(PACKAGES_DIR);
    expect(files.length).toBeGreaterThan(0); // sanity: the walk actually visited real source

    const { count, locations } = countLiteralOccurrences(files, fragment);
    expect(count).toBe(1);
    expect(locations).toHaveLength(1);
    expect(locations[0]).toContain("service/issue-report-service.ts");
  });
});

describe("AC-GD-2(a)(ii): both consumers import the ONE shared symbol by name", () => {
  it("AC-GD-2(a)(ii): report-issue.ts imports buildUnconfiguredUpstreamRemedy from issue-report-service.js and defines no competing local builder", () => {
    const cliSource = readFileSync(CLI_COMMAND_SOURCE_PATH, "utf8");
    expect(cliSource).toMatch(
      /import\s*\{[^}]*\bbuildUnconfiguredUpstreamRemedy\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/\.\.\/service\/issue-report-service\.js["']/,
    );
    // The deleted, formerly-divergent CLI-local builder's DECLARATION must be
    // gone (a historical mention in a comment, e.g. "now-deleted
    // buildAutoConfigRequiredError", is fine and expected — only a live
    // re-declaration would reintroduce the drift risk).
    expect(cliSource).not.toContain("function buildAutoConfigRequiredError");
    expect(cliSource).not.toContain("function buildUnconfiguredUpstreamRemedy");

    const serviceSource = readFileSync(SERVICE_SOURCE_PATH, "utf8");
    expect(serviceSource).toContain("export function buildUnconfiguredUpstreamRemedy");
    // And the OLD service-layer name is gone too, not left as a second export.
    expect(serviceSource).not.toContain("function buildUnconfiguredUpstreamError");
  });
});

describe("AC-GD-2(a)(iii) + (d) error half: driving both paths against an unconfigured corpus", () => {
  it("AC-GD-2(a)(iii): the CLI subprocess and a direct IssueReportService.report() call emit BYTE-IDENTICAL remedy text on the identical unconfigured condition", async () => {
    // ── CLI path: throwaway corpus, no feedback.upstream, no --auto-config.
    const cliResult = runLore(
      ["report-issue", "--title", "t", "--description", "d", "--expected", "e", "--actual", "a"],
      dir,
    );
    expect(cliResult.exitCode).toBe(4); // AC-GD-2(d) error half — still the pre-D3 exit code

    const expectedPrefix = "Error: Validation failed on field 'feedback.upstream': ";
    expect(cliResult.stderr.startsWith(expectedPrefix)).toBe(true);
    const cliMessage = cliResult.stderr.slice(expectedPrefix.length).replace(/\n$/, "");
    expect(cliMessage.length).toBeGreaterThan(0);

    // ── Service path: cfg === undefined short-circuits at report()'s step 1,
    // strictly before any `deps` member is touched — an empty deps object is
    // therefore a legitimate double for this one call.
    const service = new IssueReportService({} as IssueReportDeps);
    const serviceResult = await service.report(
      { title: "t", description: "d", expected: "e", actual: "a", by: "test" },
      undefined,
    );
    expect(serviceResult.ok).toBe(false);
    if (serviceResult.ok) throw new Error("unreachable: cfg=undefined must fail");
    const serviceMessage = loreErrorMessage(serviceResult.error);

    expect(cliMessage).toBe(serviceMessage);
    expect(cliMessage).toBe(loreErrorMessage(buildUnconfiguredUpstreamRemedy()));
  });
});

describe("AC-GD-2(b): disclosure as three literal substrings", () => {
  it("AC-GD-2(b): the shared remedy text contains .lore/config.yaml, git-tracked, and shared", () => {
    const message = loreErrorMessage(buildUnconfiguredUpstreamRemedy());
    expect(message).toContain(".lore/config.yaml");
    expect(message).toContain("git-tracked");
    expect(message).toContain("shared");
  });
});

describe("REGRESSION: still-live AC-072-2 and AC-OOB-1 floors on the now-shared text", () => {
  it("REGRESSION: names both feedback.upstream.corpus_path and feedback.upstream.root_prd (AC-072-2), names --auto-config, and carries zero hand-edit-YAML template value lines (AC-OOB-1)", () => {
    const message = loreErrorMessage(buildUnconfiguredUpstreamRemedy());
    expect(message).toContain("feedback.upstream.corpus_path");
    expect(message).toContain("feedback.upstream.root_prd");
    expect(message).toContain("--auto-config");
    expect(message).not.toContain("corpus_path: /path/to");
    expect(message).not.toContain("root_prd: prd-lore");
  });
});

describe("AC-GD-2(d) happy half: the remedy works in the upstream's OWN repo", () => {
  it("AC-GD-2(d): lore report-issue --list exits 0 against THIS repo's own corpus (read-only) — was measured exit 4 before D3 landed the feedback: stanza", () => {
    // Deliberately run from inside THIS worktree, not the throwaway `dir`:
    // `findLoreDbPath()`'s walk-up finds no local `.lore/lore.db` here and
    // falls back to the corpus this repo's own consumers all share (root
    // CLAUDE.md: "the global `lore` symlinks into the main checkout's
    // dist/" — the SAME fallback mechanism resolves config.yaml here).
    const result = runLore(["report-issue", "--list"], REPO_ROOT, false);
    expect(result.exitCode).toBe(0);
  });
});

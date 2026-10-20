// @spawns dist/lore
/**
 * @spec_ref spec-a-github-filed-defect-must-be-claimable-one-ingest-seam AC-GR-1/2/8/10/12
 * @task task-skill-implement-the-read-surface-reaches-github-and-never
 * @task task-skill-implement-the-six-read-flags-work-on-the-github-path
 *
 * The read surface reaches GitHub and never writes: `lore issues` against a
 * GitHub-configured `feedback.upstream` used to exit 4 (a hard refusal,
 * "reading it via 'lore issues' is not yet supported"). This file is the
 * oracle for the read path that replaces that refusal —
 * `report-issue-wiring.ts::resolveGithubJoinedRows` (read + join) rendered
 * by `commands/issues.ts::runGithubIssuesListing` — proving it (AC-GR-1)
 * reaches the real GitHub shape at all, (AC-GR-2) renders an un-ingested row
 * distinguishably from a computed resolution, (AC-GR-10) never unions in
 * the corpus's local-only pre-GitHub reports, (AC-GR-12) never writes, and
 * (AC-GR-8, added by `task-skill-implement-the-six-read-flags-work-on-the-
 * github-path` after a SECOND exit-4 refusal was found for
 * `--open`/`--resolved`/`--all`/`--severity`/`--category`/`--verify`
 * specifically) that all six read flags actually filter, not just exit 0.
 *
 * ── A service-layer test may NOT stand in for this (spec's own rule,
 *    mirrored from `github-defect-claim-lifecycle.bun.test.ts`) ──
 * This file spawns the COMPILED `dist/lore` binary (never `bun run
 * src/index.ts`) for every real assertion, asserting real process exit
 * codes and real stdout — the live counter-example the governing spec
 * names is a unit test staying green while the wired CLI command exits 4 on
 * the identical config.
 *
 * ── Payload-serving `gh` stub, never the real network ──
 * `payloadGhStubDir` (`tests/integration/helpers/payload-gh-stub.ts`) serves
 * the exact `gh api` responses `GitHubIntakePort.verifyTarget`/`.listIssues`
 * need — `healthyGhStubDir()` is deliberately NOT used (its empty stdout
 * would make every `JSON.parse` inside `GitHubIntakePort` fail with a FALSE
 * `VALIDATION_ERROR` that looks like a real defect in this task's code).
 *
 * ── Throwaway corpus only, seeded WITHOUT a `lore init` CLI spawn ──
 * Each describe block builds its own `mkdtempSync` corpus and opens it
 * directly via `createApp(dbPath)` (SQLiteStore auto-runs its migrations on
 * a fresh file — mirrors `issue-migration.bun.test.ts`'s seeding idiom) so
 * an "already-ingested" or "local-only pre-GitHub" fixture task can be
 * written straight through `corpusService.create` without a live
 * `report-issue` filing round-trip (which the current, still-retired local
 * write path cannot produce any more — see `report-issue.ts`'s own header).
 * Never this repo's own `.lore/` — every corpus lives under `os.tmpdir()`.
 *
 * ── Naming note (dispatch bundle's own warning) ──
 * `bun test -t` matches as a SUBSTRING: `-t 'AC-GR-1'` ALSO selects the
 * `describe` below titled `AC-GR-10: …`. Both must pass for AC-GR-1's own
 * oracle command to exit 0 — this file's scenarios are independent
 * fixtures precisely so that is never a problem in practice. `AC-GR-8` is
 * NOT a substring of `AC-GR-1`/`AC-GR-2`/`AC-GR-10`/`AC-GR-12` (checked
 * before adding it) so `-t 'AC-GR-8'` selects only its own describe below.
 *
 * Six-dimension coverage note: AC-GR-1/2/10/12's own scope is exactly those
 * four HAPPY paths (declared read-surface properties). `fileGithubIssue`'s
 * own error taxonomy (NEGATIVE/ERROR/STATE) is covered by
 * `tests/unit/service/github-filing-split-write.test.ts` and
 * `github-defect-claim-lifecycle.bun.test.ts` (AC-GR-9); duplicating them
 * here would blur which file is the oracle for which AC. AC-GR-8's OWN
 * scope (below) is wider — HAPPY (all six flags exit 0), NEGATIVE/BOUNDARY
 * (`--open`/`--resolved` are disjoint and non-empty, not silently ignored),
 * MANDATORY (`--severity` narrows a strict subset), and STATE (`--verify`
 * renders `data.clean` correctly against an agreeing fixture) — because it
 * is the oracle for a flag actually FILTERING, not merely accepting the
 * flag and exiting 0. REGRESSION for this read path is this file's own
 * re-run after any future change to
 * `resolveGithubJoinedRows`/`runGithubIssuesListing`/`runGithubVerify`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ISSUE_RESOLUTION_MEMBERS } from "@lore/core";
import { createApp, type App } from "../../../src/app.js";
import { resolutionToLabel } from "../../../src/service/resolution-projector.js";
import { assertFreshBinary } from "../helpers/assert-fresh-binary";
import { cleanupPayloadGhStubDir, payloadGhStubDir, type PayloadGhStubIssue } from "../helpers/payload-gh-stub";
import { liveAmbient, liveWriteContext } from "../../live-invocation.js";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";

// ─── Worktree-anchored dist/lore binary (never the main checkout's) ─────────

const WORKTREE_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

/** Fake, never-dialed repo string — `gh` is fully stubbed, so this never touches the network. */
const FAKE_REPO = "acme-test/read-surface-defect-channel";
/** D5's rename-proof join key — the stub's `gh api repos/<repo>` response. */
const STUB_REPO_ID = 727_384_951;

/** AC-GR-10's PINNED literal — must appear character-for-character in this listing's output. */
const GITHUB_LISTING_LOCAL_BOUNDARY_NOTE =
  "pre-GitHub local-only reports are not listed here (see 'lore issues --local')";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let isolatedConfigHome: string;

/** Synchronous `dist/lore <args>` spawn against a specific throwaway corpus + gh stub. */
function run(
  args: string[],
  corpusRoot: string,
  ghStubDir: string,
  envOverrides: Record<string, string> = {},
): RunResult {
  const proc = Bun.spawnSync([DIST_LORE, ...args], {
    cwd: corpusRoot,
    env: {
      ...process.env,
      CLAUDECODE: "1",
      LORE_CONFIG_HOME: isolatedConfigHome,
      PATH: ghStubDir,
      LORE_ACTOR: "agent:ac-gr-read-surface-e2e",
      ...envOverrides,
    },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/**
 * Builds a throwaway `.lore/lore.db` directly via `createApp` — no `lore
 * init` CLI spawn needed (SQLiteStore auto-migrates a fresh file, mirrors
 * `issue-migration.bun.test.ts`'s seeding idiom). The caller MUST close the
 * returned `App` before spawning `dist/lore` against the same file.
 */
function makeThrowawayCorpus(prefix: string): { app: App; corpusRoot: string } {
  const corpusRoot = mkdtempSync(join(TMP_ROOT, `lore-gr-read-${prefix}-`));
  const loreDir = join(corpusRoot, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient(), liveWriteContext());
  return { app, corpusRoot };
}

/**
 * Writes a `feedback.upstream.repo: <repo>` config into the corpus's own
 * `.lore/config.yaml` — `LoreConfigSchema` requires a top-level `project:
 * {name, author}` section (`.strict()`, no defaults), which `lore init`
 * normally writes; since this file bypasses `lore init` entirely (see
 * `makeThrowawayCorpus`'s own header), this function writes it directly.
 * MEASURED: omitting it makes `loadConfigFromString` return
 * `VALIDATION_ERROR` ("project: Required"), which `loadLoreApp()` then
 * silently treats as "config: undefined" — `feedback.upstream` reads back
 * as unconfigured with NO error surfaced anywhere, a false green this
 * function exists to avoid re-discovering.
 */
function writeGithubUpstreamConfig(corpusRoot: string, repo: string): void {
  patchLoreConfig(
    corpusRoot,
    [
      "project:",
      "  name: lore-gr-read-surface-fixture",
      "  author: lore-gr-read-surface-fixture",
      "feedback:",
      "  upstream:",
      `    repo: ${repo}`,
      "",
    ].join("\n"),
  );
}

/**
 * Seeds one "already-ingested" issue-report task carrying a GitHub pointer
 * (`extra.issue_report.github`, the shape `readGithubIssueRef`/`joinListing`
 * key on) — built directly via `corpusService.create` rather than a live
 * `report-issue` filing round-trip, mirroring `issue-migration.bun.test.ts`'s
 * seeding idiom for "already exists in the corpus" fixtures.
 *
 * @returns the created task's slug (unused by every current AC here, kept
 *   for a future assertion that might want it)
 */
async function seedIngestedIssueTask(app: App, planId: string, issueNumber: number, repoId: number): Promise<string> {
  const created = await app.corpusService.create({
    type: "task",
    title: `[issue-report] AC-GR-2 fixture #${issueNumber}`,
    content:
      "Synthetic already-ingested fixture for AC-GR-2. Expected: fixture behaves as specified. Actual: fixture behaves as specified.",
    parent_id: planId,
    extra: {
      plan_id: planId,
      issue_report: {
        severity: "medium",
        category: "regression",
        tags: ["e2e"],
        reporter_corpus: "lore-gr-read-surface-fixture",
        reporter_root_prd: "prd-lore-gr-read-surface-fixture-root",
        expected: "fixture behaves as specified",
        actual: "fixture behaves as specified",
        github: { repo: FAKE_REPO, number: issueNumber, repo_id: repoId },
      },
    },
  });
  if (!created.ok) {
    throw new Error(`fixture ingested-task creation failed: ${JSON.stringify(created.error)}`);
  }
  return created.value.slug;
}

/**
 * AC-GR-8's fixture: seeds one "already-ingested" issue-report task with a
 * CALLER-CHOSEN severity/category and an OPTIONAL explicit terminal
 * resolution state (`extra.issue_report.resolution.state`,
 * `computeIssueResolution`'s Rule 1) — unlike {@link seedIngestedIssueTask},
 * whose severity/category/resolution are fixed, this lets one test build
 * two rows that land on OPPOSITE sides of `--open`/`--resolved` and on
 * different sides of a `--severity`/`--category` filter.
 *
 * @returns the created task's slug
 */
async function seedTriagedIngestedIssueTask(
  app: App,
  planId: string,
  issueNumber: number,
  repoId: number,
  opts: { readonly severity: string; readonly category: string; readonly resolutionState?: string },
): Promise<string> {
  const created = await app.corpusService.create({
    type: "task",
    title: `[issue-report] AC-GR-8 fixture #${issueNumber}`,
    content:
      "Synthetic already-ingested fixture for AC-GR-8. Expected: fixture behaves as specified. Actual: fixture behaves as specified.",
    parent_id: planId,
    extra: {
      plan_id: planId,
      issue_report: {
        severity: opts.severity,
        category: opts.category,
        tags: ["e2e"],
        reporter_corpus: "lore-gr-read-surface-fixture",
        reporter_root_prd: "prd-lore-gr-read-surface-fixture-root",
        expected: "fixture behaves as specified",
        actual: "fixture behaves as specified",
        github: { repo: FAKE_REPO, number: issueNumber, repo_id: repoId },
        ...(opts.resolutionState !== undefined ? { resolution: { state: opts.resolutionState } } : {}),
      },
    },
  });
  if (!created.ok) {
    throw new Error(`fixture triaged ingested-task creation failed: ${JSON.stringify(created.error)}`);
  }
  return created.value.slug;
}

/**
 * Seeds one "local-only pre-GitHub" issue-report task — carries
 * `extra.issue_report` but NO `github` pointer, exactly the shape
 * `readGithubIssueRef` returns `undefined` for (a report filed before this
 * spec's GitHub intake existed). AC-GR-10's fixture: this task must NEVER
 * appear in a GitHub-shaped `lore issues` listing.
 */
async function seedLocalOnlyIssueTask(app: App, planId: string): Promise<string> {
  const created = await app.corpusService.create({
    type: "task",
    title: "[issue-report] AC-GR-10 local-only fixture",
    content:
      "Synthetic pre-GitHub local-only fixture for AC-GR-10. Expected: fixture behaves as specified. Actual: fixture behaves as specified.",
    parent_id: planId,
    extra: {
      plan_id: planId,
      issue_report: {
        severity: "low",
        category: "docs",
        tags: [],
        reporter_corpus: "lore-gr-read-surface-fixture",
        reporter_root_prd: "prd-lore-gr-read-surface-fixture-root",
        expected: "fixture behaves as specified",
        actual: "fixture behaves as specified",
      },
    },
  });
  if (!created.ok) {
    throw new Error(`fixture local-only task creation failed: ${JSON.stringify(created.error)}`);
  }
  return created.value.slug;
}

/** Builds three `PayloadGhStubIssue`s from three distinct numbers — the shape `listIssues()` returns. */
function threeStubIssues(numbers: readonly [number, number, number]): PayloadGhStubIssue[] {
  return numbers.map((n) => ({ number: n, title: `Fixture issue #${n}`, state: "open" as const, body: "" }));
}

/** `lore issues --local --all --json`'s `.data.total` — the count of corpus tasks carrying `extra.issue_report` (AC-GR-12's own measured shape). */
function getIssueTaskCount(corpusRoot: string, ghStubDir: string): number {
  const result = run(["issues", "--local", "--all", "--json"], corpusRoot, ghStubDir);
  if (result.exitCode !== 0) {
    throw new Error(`'lore issues --local --all --json' failed (exit ${result.exitCode}): ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as { data: { total: number } };
  return parsed.data.total;
}

/** `lore log <slug> --json`'s `.data.total` — the target doc's version-log row count (AC-GR-12's own measured shape). */
function getVersionLogCount(corpusRoot: string, ghStubDir: string, slug: string): number {
  const result = run(["log", slug, "--json"], corpusRoot, ghStubDir);
  if (result.exitCode !== 0) {
    throw new Error(`'lore log ${slug} --json' failed (exit ${result.exitCode}): ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as { data: { total: number } };
  return parsed.data.total;
}

beforeAll(() => {
  // dist/lore is built ONCE per run by the runner (scripts/test-global-setup.ts); a test never rebuilds it (TG-24).
  assertFreshBinary(DIST_LORE, [
    join(WORKTREE_ROOT, "packages", "lore", "src"),
    join(WORKTREE_ROOT, "packages", "core", "src"),
  ]);
  isolatedConfigHome = mkdtempSync(join(TMP_ROOT, "lore-gr-read-config-home-"));
}, 180_000);

afterAll(() => {
  try {
    rmSync(isolatedConfigHome, { recursive: true, force: true });
  } catch {
    // reason: best-effort cleanup only, mirrors every other scratch-dir cleanup in this suite family.
  }
});

describe("AC-GR-1: lore issues reaches the GitHub shape", () => {
  let corpusRoot: string;
  let ghStubDir: string;

  beforeAll(() => {
    const built = makeThrowawayCorpus("ac-gr-1");
    corpusRoot = built.corpusRoot;
    built.app.close();

    writeGithubUpstreamConfig(corpusRoot, FAKE_REPO);
    ghStubDir = payloadGhStubDir({
      repoId: STUB_REPO_ID,
      existingIssues: threeStubIssues([61_001, 61_002, 61_003]),
      createdNumber: 1,
      createdUrl: "https://example.invalid/never-created",
    });
  });

  afterAll(() => {
    cleanupPayloadGhStubDir(ghStubDir);
    rmSync(corpusRoot, { recursive: true, force: true });
  });

  it(
    "AC-GR-1 HAPPY: real dist/lore issues exits 0 and prints exactly 3 rows against a 3-issue gh stub",
    () => {
      const result = run(["issues", "--json"], corpusRoot, ghStubDir);
      expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        data: { total: number; reports: unknown[]; source: string };
      };
      expect(parsed.data.source).toBe("github");
      expect(parsed.data.total).toBe(3);
      expect(parsed.data.reports.length).toBe(3);
    },
    60_000,
  );
});

describe("AC-GR-2: not_ingested renders distinguishably from open", () => {
  const INGESTED_NUMBER = 62_001;
  let corpusRoot: string;
  let ghStubDir: string;

  beforeAll(async () => {
    const built = makeThrowawayCorpus("ac-gr-2");
    corpusRoot = built.corpusRoot;
    const plan = await built.app.corpusService.create({ type: "plan", title: "AC-GR-2 fixture plan" });
    if (!plan.ok) throw new Error(`fixture plan creation failed: ${JSON.stringify(plan.error)}`);
    await seedIngestedIssueTask(built.app, plan.value.id, INGESTED_NUMBER, STUB_REPO_ID);
    built.app.close();

    writeGithubUpstreamConfig(corpusRoot, FAKE_REPO);
    ghStubDir = payloadGhStubDir({
      repoId: STUB_REPO_ID,
      existingIssues: threeStubIssues([INGESTED_NUMBER, 62_002, 62_003]),
      createdNumber: 1,
      createdUrl: "https://example.invalid/never-created",
    });
  });

  afterAll(() => {
    cleanupPayloadGhStubDir(ghStubDir);
    rmSync(corpusRoot, { recursive: true, force: true });
  });

  it(
    "AC-GR-2 HAPPY: the ingested row prints its computed resolution, the other two print not_ingested — never the same token",
    () => {
      const result = run(["issues", "--json"], corpusRoot, ghStubDir);
      expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);

      const parsed = JSON.parse(result.stdout) as {
        data: { total: number; reports: Array<{ number: number; resolution: string }> };
      };
      expect(parsed.data.total).toBe(3);

      const ingestedRow = parsed.data.reports.find((r) => r.number === INGESTED_NUMBER);
      if (ingestedRow === undefined) {
        throw new Error(`no row rendered for issue #${INGESTED_NUMBER} — reports: ${JSON.stringify(parsed.data.reports)}`);
      }
      // A real 9-state computed resolution — a fresh, unresolved task computes "open".
      expect(ingestedRow.resolution).toBe("open");
      expect(ISSUE_RESOLUTION_MEMBERS as readonly string[]).toContain(ingestedRow.resolution);

      const notIngestedRows = parsed.data.reports.filter((r) => r.number !== INGESTED_NUMBER);
      expect(notIngestedRows.length).toBe(2);
      for (const row of notIngestedRows) {
        expect(row.resolution).toBe("not_ingested");
        // The discriminating assertion: "not_ingested" is NOT a member of the 9-state vocabulary.
        expect(ISSUE_RESOLUTION_MEMBERS as readonly string[]).not.toContain(row.resolution);
      }
      expect(ingestedRow.resolution).not.toBe(notIngestedRows[0]?.resolution);
    },
    60_000,
  );
});

describe("AC-GR-10: the GitHub listing excludes local-only reports and says so", () => {
  let corpusRoot: string;
  let ghStubDir: string;

  beforeAll(async () => {
    const built = makeThrowawayCorpus("ac-gr-10");
    corpusRoot = built.corpusRoot;
    const plan = await built.app.corpusService.create({ type: "plan", title: "AC-GR-10 fixture plan" });
    if (!plan.ok) throw new Error(`fixture plan creation failed: ${JSON.stringify(plan.error)}`);
    await seedLocalOnlyIssueTask(built.app, plan.value.id);
    built.app.close();

    writeGithubUpstreamConfig(corpusRoot, FAKE_REPO);
    ghStubDir = payloadGhStubDir({
      repoId: STUB_REPO_ID,
      existingIssues: threeStubIssues([63_001, 63_002, 63_003]),
      createdNumber: 1,
      createdUrl: "https://example.invalid/never-created",
    });
  });

  afterAll(() => {
    cleanupPayloadGhStubDir(ghStubDir);
    rmSync(corpusRoot, { recursive: true, force: true });
  });

  it(
    "AC-GR-10 HAPPY: exactly 3 GitHub rows, the local-only report is excluded, and the boundary literal appears verbatim",
    () => {
      const result = run(["issues", "--json"], corpusRoot, ghStubDir);
      expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain(GITHUB_LISTING_LOCAL_BOUNDARY_NOTE);

      const parsed = JSON.parse(result.stdout) as { data: { total: number; reports: unknown[] } };
      // Would be 4 if the local-only pre-GitHub report were ever unioned in — this is the
      // discriminating assertion the AC's own falsifier names ("union the two sources and the
      // row count exceeds 3").
      expect(parsed.data.total).toBe(3);
      expect(parsed.data.reports.length).toBe(3);
    },
    60_000,
  );
});

describe("AC-GR-12: lore issues mutates nothing", () => {
  let corpusRoot: string;
  let ghStubDir: string;
  let prdSlug: string;

  beforeAll(async () => {
    const built = makeThrowawayCorpus("ac-gr-12");
    corpusRoot = built.corpusRoot;
    const prd = await built.app.corpusService.create({
      type: "prd",
      title: "AC-GR-12 fixture root PRD",
      content: "Throwaway root PRD whose version log this AC checks for a byte-equal count before/after a real read.",
    });
    if (!prd.ok) throw new Error(`fixture PRD creation failed: ${JSON.stringify(prd.error)}`);
    prdSlug = prd.value.slug;
    built.app.close();

    writeGithubUpstreamConfig(corpusRoot, FAKE_REPO);
    ghStubDir = payloadGhStubDir({
      repoId: STUB_REPO_ID,
      existingIssues: threeStubIssues([64_001, 64_002, 64_003]),
      createdNumber: 1,
      createdUrl: "https://example.invalid/never-created",
    });
  });

  afterAll(() => {
    cleanupPayloadGhStubDir(ghStubDir);
    rmSync(corpusRoot, { recursive: true, force: true });
  });

  it(
    "AC-GR-12 HAPPY: the corpus task count (extra.issue_report) and the PRD's version-log count are byte-equal before and after a real run",
    () => {
      const taskCountBefore = getIssueTaskCount(corpusRoot, ghStubDir);
      const versionCountBefore = getVersionLogCount(corpusRoot, ghStubDir, prdSlug);
      expect(taskCountBefore).toBe(0); // sanity: 3 un-ingested GitHub issues, 0 corpus tasks

      const result = run(["issues", "--json"], corpusRoot, ghStubDir);
      expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      const parsed = JSON.parse(result.stdout) as { data: { total: number } };
      expect(parsed.data.total).toBe(3); // sanity: all 3 seeded issues are un-ingested

      const taskCountAfter = getIssueTaskCount(corpusRoot, ghStubDir);
      const versionCountAfter = getVersionLogCount(corpusRoot, ghStubDir, prdSlug);

      // The discriminating assertion: a read path that minted a task for even one
      // un-ingested issue would raise taskCountAfter above taskCountBefore (the AC's own
      // falsifier: "the task count rises from 0 to 3").
      expect(taskCountAfter).toBe(taskCountBefore);
      expect(taskCountAfter).toBe(0);
      expect(versionCountAfter).toBe(versionCountBefore);
    },
    60_000,
  );
});

describe("AC-GR-8: all six read flags work against a GitHub-configured feedback.upstream", () => {
  const OPEN_HIGH_NUMBER = 65_001;
  const REJECTED_CRITICAL_NUMBER = 65_002;
  let corpusRoot: string;
  let ghStubDir: string;
  let openHighSlug: string;
  let rejectedCriticalSlug: string;

  beforeAll(async () => {
    const built = makeThrowawayCorpus("ac-gr-8");
    corpusRoot = built.corpusRoot;
    const plan = await built.app.corpusService.create({ type: "plan", title: "AC-GR-8 fixture plan" });
    if (!plan.ok) throw new Error(`fixture plan creation failed: ${JSON.stringify(plan.error)}`);

    // Two ingested tasks on OPPOSITE sides of every filter this AC exercises:
    // openHigh is non-terminal ("open") / severity "high" / category "regression";
    // rejectedCritical is terminal ("rejected") / severity "critical" / category "security".
    openHighSlug = await seedTriagedIngestedIssueTask(built.app, plan.value.id, OPEN_HIGH_NUMBER, STUB_REPO_ID, {
      severity: "high",
      category: "regression",
    });
    rejectedCriticalSlug = await seedTriagedIngestedIssueTask(
      built.app,
      plan.value.id,
      REJECTED_CRITICAL_NUMBER,
      STUB_REPO_ID,
      { severity: "critical", category: "security", resolutionState: "rejected" },
    );
    built.app.close();

    writeGithubUpstreamConfig(corpusRoot, FAKE_REPO);
    ghStubDir = payloadGhStubDir({
      repoId: STUB_REPO_ID,
      // Each stub issue's `resolution:*` label agrees with its task's own
      // computed resolution — this fixture is `--verify`-CLEAN by
      // construction, so exit 0 for `--verify` proves it reached the real
      // read path rather than accidentally landing on the divergence exit.
      existingIssues: [
        {
          number: OPEN_HIGH_NUMBER,
          title: "AC-GR-8 fixture (open, high, regression)",
          state: "open",
          body: "",
          labels: [resolutionToLabel("open")],
        },
        {
          number: REJECTED_CRITICAL_NUMBER,
          title: "AC-GR-8 fixture (rejected, critical, security)",
          state: "closed",
          body: "",
          labels: [resolutionToLabel("rejected")],
        },
      ],
      createdNumber: 1,
      createdUrl: "https://example.invalid/never-created",
    });
  });

  afterAll(() => {
    cleanupPayloadGhStubDir(ghStubDir);
    rmSync(corpusRoot, { recursive: true, force: true });
  });

  it(
    "AC-GR-8 HAPPY: --open/--resolved/--all/--severity/--category/--verify each exit 0 against a GitHub-configured upstream",
    () => {
      const invocations: string[][] = [
        ["issues", "--open", "--json"],
        ["issues", "--resolved", "--json"],
        ["issues", "--all", "--json"],
        ["issues", "--severity", "critical", "--json"],
        ["issues", "--category", "security", "--json"],
        ["issues", "--verify", "--json"],
      ];
      for (const args of invocations) {
        const result = run(args, corpusRoot, ghStubDir);
        expect(result.exitCode, `'${args.join(" ")}' — stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      }
    },
    60_000,
  );

  it(
    "AC-GR-8 NEGATIVE/BOUNDARY: --open and --resolved return different, non-empty, disjoint row sets — not an ignored flag",
    () => {
      const openResult = run(["issues", "--open", "--json"], corpusRoot, ghStubDir);
      expect(openResult.exitCode, `stdout: ${openResult.stdout}\nstderr: ${openResult.stderr}`).toBe(0);
      const openParsed = JSON.parse(openResult.stdout) as {
        data: { total: number; reports: Array<{ slug?: string }> };
      };

      const resolvedResult = run(["issues", "--resolved", "--json"], corpusRoot, ghStubDir);
      expect(resolvedResult.exitCode, `stdout: ${resolvedResult.stdout}\nstderr: ${resolvedResult.stderr}`).toBe(0);
      const resolvedParsed = JSON.parse(resolvedResult.stdout) as {
        data: { total: number; reports: Array<{ slug?: string }> };
      };

      // Non-vacuous: both sets must be non-empty — a filter that always
      // returns [] would otherwise satisfy a bare "the two sets differ" check.
      expect(openParsed.data.total).toBeGreaterThan(0);
      expect(resolvedParsed.data.total).toBeGreaterThan(0);

      const openSlugs = openParsed.data.reports.map((r) => r.slug);
      const resolvedSlugs = resolvedParsed.data.reports.map((r) => r.slug);
      expect(openSlugs).toContain(openHighSlug);
      expect(openSlugs).not.toContain(rejectedCriticalSlug);
      expect(resolvedSlugs).toContain(rejectedCriticalSlug);
      expect(resolvedSlugs).not.toContain(openHighSlug);
    },
    60_000,
  );

  it(
    "AC-GR-8 MANDATORY: --severity selects a strict, non-empty subset of --all — not an ignored flag",
    () => {
      const allResult = run(["issues", "--all", "--json"], corpusRoot, ghStubDir);
      expect(allResult.exitCode, `stdout: ${allResult.stdout}\nstderr: ${allResult.stderr}`).toBe(0);
      const allParsed = JSON.parse(allResult.stdout) as { data: { total: number } };
      expect(allParsed.data.total).toBe(2);

      const severityResult = run(["issues", "--all", "--severity", "critical", "--json"], corpusRoot, ghStubDir);
      expect(severityResult.exitCode, `stdout: ${severityResult.stdout}\nstderr: ${severityResult.stderr}`).toBe(0);
      const severityParsed = JSON.parse(severityResult.stdout) as {
        data: { total: number; reports: Array<{ slug?: string; severity?: string }> };
      };
      // Strict, non-empty subset: fewer rows than the unfiltered --all, never zero.
      expect(severityParsed.data.total).toBe(1);
      expect(severityParsed.data.total).toBeLessThan(allParsed.data.total);
      expect(severityParsed.data.reports[0]?.slug).toBe(rejectedCriticalSlug);
      expect(severityParsed.data.reports[0]?.severity).toBe("critical");
    },
    60_000,
  );

  it(
    "AC-GR-8 STATE: --verify against a matching-labels fixture is clean (data.clean true, zero divergences)",
    () => {
      const result = run(["issues", "--verify", "--json"], corpusRoot, ghStubDir);
      expect(result.exitCode, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
      const parsed = JSON.parse(result.stdout) as { data: { clean: boolean; divergences: unknown[] } };
      expect(parsed.data.clean).toBe(true);
      expect(parsed.data.divergences).toHaveLength(0);
    },
    60_000,
  );
});

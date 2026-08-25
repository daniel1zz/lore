/**
 * @spec_ref spec-a-github-filed-defect-must-be-claimable-one-ingest-seam AC-GR-9
 * @spec_ref spec-a-github-filed-defect-must-be-claimable-one-ingest-seam AC-GR-3
 * @task task-skill-implement-filing-mints-the-corpus-task-and-a-landed
 * @task task-skill-implement-lore-issue-adopt-and-the-label-round-trip
 *
 * AC-GR-9: filing a defect through `lore report-issue` (GitHub-configured
 * upstream) makes it claimable with NO further command — `fileGithubIssue`
 * (D8) mints the corpus task in the SAME call that files the GitHub issue,
 * so the deterministic slug `githubIssueTaskSlug(repo_id, number)` (D1)
 * resolves to a real, claimable task immediately.
 *
 * AC-GR-3: the everyday bar, end to end — one SEEDED (never filed by this
 * test) GitHub issue is `lore issue adopt <n>`'d, `lore claim`'d, then
 * `lore issue resolve --state wontfix`'d, and the gh stub RECORDS a
 * `resolution:wontfix` label write for that issue number (`payload-gh-
 * stub.ts::readRecordedLabelWrites` — the load-bearing half: a clean exit 0
 * on all three commands proves the CLI ran, never that the label call
 * actually reached "GitHub"). Runs in its OWN nested `describe` with its
 * own corpus/stub/config — AC-GR-9's task above already occupies its own
 * derived slug in AC-GR-9's corpus, and reusing one corpus across two
 * differently-shaped scenarios would make either test's outcome depend on
 * the other's run order. Also covers, in the same nested describe:
 *   - STATE (idempotency): re-`adopt`ing the same issue number reports the
 *     EXISTING task (`already_adopted: true`, exit 0), never a second task.
 *   - ERROR: `adopt`ing a number absent from the live listing refuses
 *     loudly (`VALIDATION_ERROR`, exit 4) — never a silent no-op, never a
 *     task minted anyway.
 *   - D9 (in scope for this task and only this task): after a SIMULATED
 *     repository rename (`.lore/config.yaml`'s `feedback.upstream.repo`
 *     rewritten in place), a SECOND `resolve` call's label write is
 *     recorded under the NEW configured repo, never the repo string stored
 *     on the task at adopt time — pinning `commands/issue.ts`'s
 *     `resolutionProjector` call site building its live `GithubIssueRef`
 *     from `classifyFeedbackUpstream(config)`, not from
 *     `readGithubIssueRef(updated.extra)` alone.
 *
 * ── A service-layer test may NOT stand in for this (spec's own rule) ──
 * The live counter-example the spec names: AC-GI-12 was green on a
 * `GitHubIntakePort` unit test while `lore issues` exited 4 on the same
 * config. This file therefore spawns the COMPILED `dist/lore` binary (never
 * `bun run src/index.ts`) for BOTH the filing step and the claim step, and
 * asserts real process exit codes.
 *
 * ── Payload-serving `gh` stub, never the real network ──
 * `payloadGhStubDir` (`tests/integration/helpers/payload-gh-stub.ts`, a NEW
 * sibling to `healthy-gh-stub.ts`) serves the exact four `gh api` responses
 * `GitHubIntakePort` needs (`user`, `repos/<repo>`, the issues list, the
 * issue-create POST) — `healthyGhStubDir()` is deliberately NOT reused here:
 * its empty stdout would make every JSON.parse inside `GitHubIntakePort`
 * fail with a FALSE `VALIDATION_ERROR` that looks like a real defect in
 * `fileGithubIssue`.
 *
 * ── Throwaway corpus only ──
 * A fresh `mkdtempSync` directory, `lore init`'d, is this suite's entire
 * corpus — never this repo's own `.lore/`. `LORE_CONFIG_HOME` is also
 * pointed at an isolated throwaway dir for every spawn, so a developer
 * machine's real `~/.config/lore/config.yaml` is never consulted (mirrors
 * `github-intake-reach.bun.test.ts`'s isolation).
 *
 * Runner: `bun:test` (spawns the compiled binary; `bun:sqlite`-touching
 * `TaskWorkflowService.claim` runs inside that spawned process, not this
 * test file, so vitest would work file-mechanically too — but every OTHER
 * AC-GR-* surface test in this plan is `.bun.test.ts`, kept consistent).
 *
 * Six-dimension coverage note: this file's scope is exactly AC-GR-9 (HAPPY:
 * file then claim, no adopt step) plus a BOUNDARY case asserting the
 * derived slug is EXACTLY `task-gh-<repo_id>-<number>` (not merely "some
 * claimable slug") — REGRESSION/NEGATIVE/ERROR/STATE for `fileGithubIssue`'s
 * OWN error taxonomy are covered by
 * `tests/unit/service/github-filing-split-write.test.ts` (AC-GR-7) and
 * `tests/unit/service/issue-task-shaping.test.ts` (AC-GR-6); duplicating
 * them here would blur which file is the oracle for which AC.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { assembleIssueBody, type IssueFrontMatterFields } from "@lore/core";

import { assertFreshBinary } from "../helpers/assert-fresh-binary";
import { cleanupPayloadGhStubDir, payloadGhStubDir, readRecordedLabelWrites } from "../helpers/payload-gh-stub";

// ─── Worktree-anchored dist/lore binary (never the main checkout's) ─────────

const WORKTREE_ROOT = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

/** Fake, never-dialed repo string — `gh` is fully stubbed, so this never touches the network. */
const FAKE_REPO = "acme-test/widget-defect-channel";
/** D1's rename-proof identity key input — the stub's `gh api repos/<repo>` response. */
const STUB_REPO_ID = 918_273_645;
/** The stub's issue-create response — deterministic, distinct from STUB_REPO_ID so a transposition bug would be visible. */
const STUB_ISSUE_NUMBER = 4_242;
const STUB_ISSUE_URL = `https://github.com/${FAKE_REPO}/issues/${STUB_ISSUE_NUMBER}`;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let ghStubDir: string;
let isolatedConfigHome: string;
let corpusRoot: string;

/** Synchronous `dist/lore <args>` spawn, pinned to the throwaway corpus's isolation. */
function run(args: string[], envOverrides: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync([DIST_LORE, ...args], {
    cwd: corpusRoot,
    env: {
      ...process.env,
      CLAUDECODE: "1",
      LORE_CONFIG_HOME: isolatedConfigHome,
      PATH: ghStubDir,
      LORE_ACTOR: "agent:ac-gr-9-e2e",
      ...envOverrides,
    },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

beforeAll(() => {
  const buildResult = Bun.spawnSync(["bun", "run", "build"], { cwd: WORKTREE_ROOT });
  if (buildResult.exitCode !== 0) {
    throw new Error(
      `'bun run build' failed (exit ${buildResult.exitCode}):\n` +
        `stdout: ${buildResult.stdout.toString()}\nstderr: ${buildResult.stderr.toString()}`,
    );
  }
  assertFreshBinary(DIST_LORE, [
    join(WORKTREE_ROOT, "packages", "lore", "src"),
    join(WORKTREE_ROOT, "packages", "core", "src"),
  ]);

  ghStubDir = payloadGhStubDir({
    repoId: STUB_REPO_ID,
    createdNumber: STUB_ISSUE_NUMBER,
    createdUrl: STUB_ISSUE_URL,
  });

  isolatedConfigHome = mkdtempSync(join(TMP_ROOT, "lore-gr9-config-home-"));
  corpusRoot = mkdtempSync(join(TMP_ROOT, "lore-gr9-corpus-"));

  const initResult = run(["init"]);
  if (initResult.exitCode !== 0) {
    throw new Error(`'lore init' failed (exit ${initResult.exitCode}): ${initResult.stderr}`);
  }

  const prdResult = run([
    "create",
    "prd",
    "--title",
    "AC-GR-9 throwaway root PRD",
    "--content",
    "Throwaway root PRD for AC-GR-9's claim-lifecycle e2e. Not read by anything else.",
  ]);
  if (prdResult.exitCode !== 0) {
    throw new Error(`root PRD creation failed (exit ${prdResult.exitCode}): ${prdResult.stderr}`);
  }

  const configPath = join(corpusRoot, ".lore", "config.yaml");
  const existingConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  writeFileSync(configPath, existingConfig + ["feedback:", "  upstream:", `    repo: ${FAKE_REPO}`, ""].join("\n"));
}, 180_000);

afterAll(() => {
  if (ghStubDir !== undefined) cleanupPayloadGhStubDir(ghStubDir);
  for (const path of [isolatedConfigHome, corpusRoot]) {
    if (path === undefined) continue;
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup only.
    }
  }
});

describe("AC-GR-9: filing alone makes the defect claimable", () => {
  it(
    "AC-GR-9 HAPPY: report-issue exits 0 against the stub gh, then claim on the derived slug exits 0 — no adopt step",
    () => {
      const fileResult = run([
        "report-issue",
        "--title",
        "AC-GR-9 e2e: filed defect must be claimable with no extra command",
        "--description",
        "Filed by github-defect-claim-lifecycle.bun.test.ts against a payload-serving gh stub.",
        "--expected",
        "the minted task is claimable immediately",
        "--actual",
        "captured by this test run",
        "--severity",
        "high",
        "--category",
        "regression",
        "--tags",
        "e2e,ac-gr-9",
        "--json",
      ]);
      expect(
        fileResult.exitCode,
        `report-issue failed (exit ${fileResult.exitCode}). stdout: ${fileResult.stdout}\nstderr: ${fileResult.stderr}`,
      ).toBe(0);

      const parsed = JSON.parse(fileResult.stdout) as { ok: true; data: { number: number; url: string; retried: boolean } };
      expect(parsed.data.number).toBe(STUB_ISSUE_NUMBER);
      expect(parsed.data.url).toBe(STUB_ISSUE_URL);
      expect(parsed.data.retried).toBe(false);

      // D1's deterministic slug — BOUNDARY: exactly this shape, not merely "some slug".
      const derivedSlug = `task-gh-${STUB_REPO_ID}-${STUB_ISSUE_NUMBER}`;

      const claimResult = run(["claim", derivedSlug, "--by", "agent:ac-gr-9-e2e"]);
      expect(
        claimResult.exitCode,
        `claim on the derived slug '${derivedSlug}' failed (exit ${claimResult.exitCode}) — the filed defect was ` +
          `not claimable with no extra command. stdout: ${claimResult.stdout}\nstderr: ${claimResult.stderr}`,
      ).toBe(0);

      // Falsifier (this task's report names the mutation actually run): remove
      // fileGithubIssue's corpus-mint call — the slug above resolves to
      // nothing and this claim call reddens (DOC_NOT_FOUND, exit 3).
      const getResult = run(["get", derivedSlug, "--json"]);
      expect(getResult.exitCode, `get on the derived slug failed: ${getResult.stderr}`).toBe(0);
      const parsedDoc = JSON.parse(getResult.stdout) as { data: { doc: { extra?: Record<string, unknown> } } };
      const extra = parsedDoc.data.doc.extra ?? {};
      expect(extra["adhoc"]).toBe(true);
      expect("plan_id" in extra).toBe(false);
    },
    60_000,
  );
});

// ─── AC-GR-3: adopt → claim → resolve, own corpus/stub/config ──────────────
//
// A dedicated corpus/stub (never AC-GR-9's) — AC-GR-9's task above already
// occupies its own derived slug in AC-GR-9's corpus, and giving AC-GR-3 a
// SEPARATE throwaway corpus means neither describe block's outcome depends
// on the other's run order. `DIST_LORE` is already built (this file's outer
// `beforeAll` above ran first, sequentially, per bun:test's per-file
// ordering) — no second `bun run build` here.

const FAKE_REPO_GR3 = "acme-test/widget-defect-channel-gr3";
const RENAMED_REPO_GR3 = "acme-test/widget-defect-channel-gr3-renamed";
const STUB_REPO_ID_GR3 = 553_311_772;
const STUB_ISSUE_NUMBER_GR3 = 9_001;

/** The seeded issue's front-matter fields — arbitrary but schema-valid; `toIssueTaskInput` reads them back verbatim into `extra.issue_report`. */
const GR3_FRONT_MATTER_FIELDS: IssueFrontMatterFields = {
  severity: "high",
  category: "regression",
  tags: ["e2e", "ac-gr-3"],
  reporter_corpus: "~/gr3-throwaway-corpus",
  reporter_root_prd: "prd-gr3-throwaway-root",
  idempotency_key: "01JGR3SEEDEDISSUE00000000",
};

/** The seeded issue's full body — a REAL `assembleIssueBody` front-matter block, never hand-rolled text, so `parseIssueBody` (inside `toIssueTaskInput`) parses it exactly as a real GitHub-filed issue's body would. */
const GR3_ISSUE_BODY = assembleIssueBody(
  GR3_FRONT_MATTER_FIELDS,
  "AC-GR-3 seeded issue body.\n\n**Expected:** adopt mints a claimable task\n**Actual:** captured by github-defect-claim-lifecycle.bun.test.ts",
);

let gr3GhStubDir: string;
let gr3ConfigHome: string;
let gr3CorpusRoot: string;

/** Synchronous `dist/lore <args>` spawn against AC-GR-3's OWN throwaway corpus/stub — never AC-GR-9's `run()`/module-level state above. */
function runGr3(args: string[], envOverrides: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync([DIST_LORE, ...args], {
    cwd: gr3CorpusRoot,
    env: {
      ...process.env,
      CLAUDECODE: "1",
      LORE_CONFIG_HOME: gr3ConfigHome,
      PATH: gr3GhStubDir,
      LORE_ACTOR: "agent:ac-gr-3-e2e",
      ...envOverrides,
    },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

describe("AC-GR-3: adopt then claim then resolve round-trips the label", () => {
  const derivedSlug = `task-gh-${STUB_REPO_ID_GR3}-${STUB_ISSUE_NUMBER_GR3}`;

  beforeAll(() => {
    gr3GhStubDir = payloadGhStubDir({
      repoId: STUB_REPO_ID_GR3,
      existingIssues: [
        {
          number: STUB_ISSUE_NUMBER_GR3,
          title: "AC-GR-3 e2e: adopt then claim then resolve round-trips the label",
          state: "open",
          body: GR3_ISSUE_BODY,
        },
      ],
      // reason: the create-issue POST response — `adopt` never files a NEW
      // GitHub issue (it only reads the live listing), so this is never
      // exercised; an obviously-unused sentinel so a wiring bug that
      // accidentally called the filing path would be visible immediately.
      createdNumber: -1,
      createdUrl: "https://example.invalid/unused-create-response",
    });

    gr3ConfigHome = mkdtempSync(join(TMP_ROOT, "lore-gr3-config-home-"));
    gr3CorpusRoot = mkdtempSync(join(TMP_ROOT, "lore-gr3-corpus-"));

    const initResult = runGr3(["init"]);
    if (initResult.exitCode !== 0) {
      throw new Error(`'lore init' failed (exit ${initResult.exitCode}): ${initResult.stderr}`);
    }

    const prdResult = runGr3([
      "create",
      "prd",
      "--title",
      "AC-GR-3 throwaway root PRD",
      "--content",
      "Throwaway root PRD for AC-GR-3's adopt-claim-resolve e2e. Not read by anything else.",
    ]);
    if (prdResult.exitCode !== 0) {
      throw new Error(`root PRD creation failed (exit ${prdResult.exitCode}): ${prdResult.stderr}`);
    }

    const configPath = join(gr3CorpusRoot, ".lore", "config.yaml");
    const existingConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
    writeFileSync(
      configPath,
      existingConfig + ["feedback:", "  upstream:", `    repo: ${FAKE_REPO_GR3}`, ""].join("\n"),
    );
  }, 180_000);

  afterAll(() => {
    if (gr3GhStubDir !== undefined) cleanupPayloadGhStubDir(gr3GhStubDir);
    for (const path of [gr3ConfigHome, gr3CorpusRoot]) {
      if (path === undefined) continue;
      try {
        rmSync(path, { recursive: true, force: true });
      } catch {
        // reason: best-effort cleanup only.
      }
    }
  });

  it(
    "AC-GR-3 HAPPY: adopt exits 0, claim exits 0, resolve exits 0, and the gh stub records the resolution:wontfix label write",
    () => {
      const adoptResult = runGr3(["issue", "adopt", String(STUB_ISSUE_NUMBER_GR3), "--json"]);
      expect(
        adoptResult.exitCode,
        `adopt failed (exit ${adoptResult.exitCode}). stdout: ${adoptResult.stdout}\nstderr: ${adoptResult.stderr}`,
      ).toBe(0);
      const parsedAdopt = JSON.parse(adoptResult.stdout) as {
        ok: true;
        data: { doc: { slug: string }; already_adopted: boolean };
      };
      expect(parsedAdopt.data.doc.slug).toBe(derivedSlug);
      expect(parsedAdopt.data.already_adopted).toBe(false);

      const claimResult = runGr3(["claim", derivedSlug, "--by", "agent:ac-gr-3-e2e"]);
      expect(
        claimResult.exitCode,
        `claim failed (exit ${claimResult.exitCode}). stdout: ${claimResult.stdout}\nstderr: ${claimResult.stderr}`,
      ).toBe(0);

      const resolveResult = runGr3([
        "issue",
        "resolve",
        derivedSlug,
        "--state",
        "wontfix",
        "--reason",
        "AC-GR-3 e2e: exercising the adopt-claim-resolve round trip end to end.",
      ]);
      expect(
        resolveResult.exitCode,
        `resolve failed (exit ${resolveResult.exitCode}). stdout: ${resolveResult.stdout}\nstderr: ${resolveResult.stderr}`,
      ).toBe(0);

      // The load-bearing half (this task's own header): the corpus verdict
      // landing is not enough — the label write must have actually reached
      // "GitHub" (this stub), for the RIGHT issue number and label string.
      const writes = readRecordedLabelWrites(gr3GhStubDir);
      const matching = writes.filter((w) => w.issueNumber === STUB_ISSUE_NUMBER_GR3);
      expect(
        matching.length,
        `expected exactly one resolution:wontfix label write for issue #${STUB_ISSUE_NUMBER_GR3}, saw: ${JSON.stringify(writes)}`,
      ).toBe(1);
      expect(matching[0]?.label).toBe("resolution:wontfix");
      expect(matching[0]?.repo).toBe(FAKE_REPO_GR3);
    },
    60_000,
  );

  it(
    "AC-GR-3 STATE (idempotency): re-adopting the same issue reports the EXISTING task, exit 0, no second task",
    () => {
      const secondAdopt = runGr3(["issue", "adopt", String(STUB_ISSUE_NUMBER_GR3), "--json"]);
      expect(
        secondAdopt.exitCode,
        `re-adopt failed (exit ${secondAdopt.exitCode}). stdout: ${secondAdopt.stdout}\nstderr: ${secondAdopt.stderr}`,
      ).toBe(0);
      const parsedSecond = JSON.parse(secondAdopt.stdout) as {
        ok: true;
        data: { doc: { slug: string }; already_adopted: boolean };
      };
      expect(parsedSecond.data.doc.slug).toBe(derivedSlug);
      expect(parsedSecond.data.already_adopted).toBe(true);

      // Human-render prefix distinguishes the two paths (this task's own
      // idempotency decision — never a distinct exit code for the two).
      const humanRerun = runGr3(["issue", "adopt", String(STUB_ISSUE_NUMBER_GR3)]);
      expect(humanRerun.exitCode).toBe(0);
      expect(humanRerun.stdout).toContain("Already adopted");

      // Falsifier this test would catch: were `adopt` to call
      // `corpusService.create` a second time WITHOUT the deterministic D1
      // slug (or without treating DUPLICATE_SLUG as "already adopted"),
      // this would either exit nonzero or the task count would rise to 2.
      const listResult = runGr3(["list", "--type", "task", "--json"]);
      expect(listResult.exitCode).toBe(0);
      const parsedList = JSON.parse(listResult.stdout) as { data: { docs: { slug: string }[] } };
      const matchingTasks = parsedList.data.docs.filter((doc) => doc.slug === derivedSlug);
      expect(matchingTasks.length).toBe(1);
    },
    60_000,
  );

  it(
    "AC-GR-3 ERROR: adopting an issue number absent from the live listing refuses loudly (exit 4), never a silent no-op or a task created anyway",
    () => {
      const missingNumber = STUB_ISSUE_NUMBER_GR3 + 999;

      const before = runGr3(["list", "--type", "task", "--json"]);
      expect(before.exitCode).toBe(0);
      const beforeCount = (JSON.parse(before.stdout) as { data: { total: number } }).data.total;

      const result = runGr3(["issue", "adopt", String(missingNumber)]);
      expect(
        result.exitCode,
        `expected exit 4 (VALIDATION_ERROR) for an unlisted issue number, got ${result.exitCode}. ` +
          `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
      ).toBe(4);
      expect(result.stderr).toContain(String(missingNumber));

      const after = runGr3(["list", "--type", "task", "--json"]);
      expect(after.exitCode).toBe(0);
      const afterCount = (JSON.parse(after.stdout) as { data: { total: number } }).data.total;
      expect(afterCount, "adopt on an unlisted issue number must not mint a task anyway").toBe(beforeCount);
    },
    60_000,
  );

  it(
    "AC-GR-3/D9: a repository rename after adopt is reflected in the LIVE label call, never the stored provenance repo",
    () => {
      // reason: a bare rewrite of ONLY the `feedback:` block (as the initial
      // `beforeAll` setup does against a freshly-`lore init`'d file) would
      // DROP the `project:` block `lore init` also writes — `loadConfig`
      // then fails schema validation on the truncated file and
      // `loadLoreApp()` silently falls back to `config: undefined`
      // (`loader.ts`'s own documented non-goal for non-`ai`-block parse
      // failures), which would make this test's "rename" indistinguishable
      // from "upstream de-configured entirely" — MEASURED while writing
      // this test (a first draft did exactly that and saw ZERO label
      // writes of ANY kind on the second resolve, not merely the wrong
      // repo). A plain substring replace on the ALREADY-WRITTEN file
      // preserves every other key untouched.
      const configPath = join(gr3CorpusRoot, ".lore", "config.yaml");
      const configBeforeRename = readFileSync(configPath, "utf8");
      expect(configBeforeRename).toContain(FAKE_REPO_GR3);
      writeFileSync(configPath, configBeforeRename.replace(FAKE_REPO_GR3, RENAMED_REPO_GR3));

      const resolveAgain = runGr3([
        "issue",
        "resolve",
        derivedSlug,
        "--state",
        "rejected",
        "--reason",
        "AC-GR-3/D9 e2e: re-resolving after a simulated repository rename.",
      ]);
      expect(
        resolveAgain.exitCode,
        `re-resolve after rename failed (exit ${resolveAgain.exitCode}). stdout: ${resolveAgain.stdout}\n` +
          `stderr: ${resolveAgain.stderr}`,
      ).toBe(0);

      const writes = readRecordedLabelWrites(gr3GhStubDir);
      const rejectedWrites = writes.filter(
        (w) => w.issueNumber === STUB_ISSUE_NUMBER_GR3 && w.label === "resolution:rejected",
      );
      expect(
        rejectedWrites.length,
        `expected exactly one resolution:rejected label write, saw: ${JSON.stringify(writes)}`,
      ).toBe(1);
      // The assertion that reddens if D9's fix were reverted (the call site
      // reading `readGithubIssueRef(updated.extra).repo` verbatim instead
      // of substituting the CONFIGURED repo): the write would be recorded
      // under FAKE_REPO_GR3 (the repo stored at adopt time), not the
      // renamed one.
      expect(rejectedWrites[0]?.repo).toBe(RENAMED_REPO_GR3);
      expect(rejectedWrites.some((w) => w.repo === FAKE_REPO_GR3 && w.label === "resolution:rejected")).toBe(
        false,
      );

      // Restore the config to its original repo (same preserve-the-rest
      // substring replace as above) — hygiene/order-independence, even
      // though no later test in this describe reads it.
      writeFileSync(configPath, readFileSync(configPath, "utf8").replace(RENAMED_REPO_GR3, FAKE_REPO_GR3));
    },
    60_000,
  );
});

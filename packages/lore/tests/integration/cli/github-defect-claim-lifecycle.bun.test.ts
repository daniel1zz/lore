/**
 * @spec_ref spec-a-github-filed-defect-must-be-claimable-one-ingest-seam AC-GR-9
 * @task task-skill-implement-filing-mints-the-corpus-task-and-a-landed
 *
 * AC-GR-9: filing a defect through `lore report-issue` (GitHub-configured
 * upstream) makes it claimable with NO further command — `fileGithubIssue`
 * (D8) mints the corpus task in the SAME call that files the GitHub issue,
 * so the deterministic slug `githubIssueTaskSlug(repo_id, number)` (D1)
 * resolves to a real, claimable task immediately.
 *
 * ⛔ Scope boundary — this file will ALSO host AC-GR-3 (adopt → claim →
 * resolve round-trip) once a LATER phase implements `lore issue adopt`
 * (`commands/issue.ts`, explicitly out of THIS task's anchors). Only
 * AC-GR-9's `describe` block exists here today.
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

import { assertFreshBinary } from "../helpers/assert-fresh-binary";
import { cleanupPayloadGhStubDir, payloadGhStubDir } from "../helpers/payload-gh-stub";

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

#!/usr/bin/env bun
/**
 * Falsifier negative-control oracle (Finding 1,
 * `task-make-the-falsifier-s-negative-control-a-permanent-runnable`;
 * `spec-a-falsifier-s-scratch-worktree-must-be-runnable-and`;
 * `adr-a-falsifier-s-scratch-worktree-gets-dependencies-by-hybrid`).
 *
 * `lore verify --falsify` REFUSES a falsifier whose declared exit code does
 * not match what the mutated command actually produces, rather than
 * recording a red. That refusal is correct behavior, but a refused run
 * persists NOTHING to the corpus — so the control proving the refusal
 * actually happened leaves no queryable trace an auditor can revisit later.
 * Eight affirmative attested reds elsewhere in this repo's own falsifier
 * plan are consistent with a mechanism that says "yes" to every falsifier it
 * is handed, unless something ALSO proves it says "no" to a bad one. This
 * script IS that something — a standing, re-runnable oracle, never a
 * one-shot terminal transcript that stops being checkable once the scrollback
 * is gone.
 *
 * Two halves, same throwaway corpus, same tracked target file, same probe
 * command — running the SECOND half is what gives the first one any
 * discriminating power at all (a mechanism that refuses EVERYTHING is
 * indistinguishable from one that refuses only bad declarations unless both
 * directions are exercised):
 *
 *   NEGATIVE (this task's own core deliverable) — declares an AC whose
 *   falsifier's `find`/`replace` text are IDENTICAL, i.e. the "mutation"
 *   changes nothing on disk. The green control (the AC's own unmutated
 *   command) passes, the "mutated" command then runs unchanged and produces
 *   the SAME exit code as before, and the declared `--falsifier-exit-code`
 *   (deliberately chosen to differ from that code) can never match reality.
 *   Asserts `lore verify --falsify` exits EXACTLY 4, that its output names
 *   the exit-code mismatch and states nothing was recorded, and — read back
 *   via a SEPARATE `lore get --json` subprocess call, never an in-process
 *   spy — that no evidence row exists for this AC afterward.
 *
 *   POSITIVE (without this half the NEGATIVE half proves nothing — see
 *   above) — the SAME target file and probe command, but a genuinely
 *   discriminating falsifier: `find` present, `replace` removes it, and the
 *   declared exit code is the value the probe command actually returns once
 *   the marker is gone. Asserts `lore verify --falsify` exits EXACTLY 0,
 *   that its output names the attested-red outcome, and — read back the
 *   same way — that an `expected-fail` row was persisted with an
 *   `attestation` block whose `exit_code` equals the declared value exactly.
 *
 * Side-effect class: IO. Spawns real `lore` CLI subprocesses — `bun run
 * <repo>/packages/lore/src/index.ts ...`, the same "source-entry" spawn
 * shape `packages/lore/tests/integration/cli/*.test.ts` already use — and
 * real `git` subprocesses, against a THROWAWAY `mkdtemp` git repo. NEVER
 * this repo's own `.lore/` or working tree (root CLAUDE.md's 2026-07-07
 * pollution-incident rule: a manual smoke run against a live corpus once
 * absorbed a write suite and corrupted export numbering). The throwaway
 * repo is removed on exit, best-effort, in a `finally` block.
 *
 * Exit code: 0 only when BOTH halves pass; 1 with a printed reason
 * otherwise — either half failing is fatal to the whole script, never a
 * silent partial pass. `import.meta.main`'s block below is the ONLY call
 * site for `process.exit` (mirrors `scripts/check-unclaimed-oracle.ts`'s own
 * convention of a `main()` that never exits the process itself).
 *
 * Run directly: `bun scripts/falsifier-negative-control.ts`.
 *
 * @spec_ref spec-a-falsifier-s-scratch-worktree-must-be-runnable-and
 * @spec_ref task-make-the-falsifier-s-negative-control-a-permanent-runnable
 */

import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractEvidence } from "@lore/core";
import type { DocRecord, EvidenceEntry } from "@lore/core";

// ─── Path plumbing ──────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
/** repo root = two levels up from `<repo>/scripts/falsifier-negative-control.ts`. */
const REPO_ROOT = join(__filename, "..", "..");
const INDEX_TS = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

const GIT_AUTHOR_ARGS = [
  "-c",
  "user.email=lore-negative-control@example.com",
  "-c",
  "user.name=Lore Negative Control",
] as const;

// ─── CLI subprocess plumbing (same shape as the integration CLI test suites) ─

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir — a real CLI invocation, never an in-process call. */
function runLore(args: readonly string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    // reason: ⛔ measured without a pipe — `spawnSync`'s own `.status` is
    // the process's real exit code, never a downstream shell pipeline's.
    exitCode: result.status ?? 1,
  };
}

function extractSlug(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (slug === undefined) {
    throw new Error(`could not extract a slug from lore's own output:\n${stdout}`);
  }
  return slug;
}

/** Disables every `lore gate` service-layer checkpoint — this fixture's spec/plan/task stay "draft" on purpose. */
function disableAllGates(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      '    "task-create":',
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

function createPrd(dir: string, title: string): string {
  const r = runLore(["create", "prd", "--title", title, "--no-ai", "--content", "body"], dir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createSpec(dir: string, title: string, parentSlug: string): string {
  const r = runLore(
    ["create", "spec", "--title", title, "--parent", parentSlug, "--no-ai", "--content", "body"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createPlan(dir: string, title: string, parentSlug: string): string {
  const r = runLore(
    ["create", "plan", "--title", title, "--parent", parentSlug, "--no-ai", "--content", "body"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createTask(dir: string, planSlug: string, title: string, acScope: readonly string[]): string {
  const args = [
    "create",
    "task",
    "--title",
    title,
    "--parent",
    planSlug,
    "--plan-id",
    planSlug,
    "--no-ai",
    "--content",
    "body",
  ];
  for (const acId of acScope) args.push("--ac-scope", acId);
  const r = runLore(args, dir);
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

interface DeclaredFalsifier {
  readonly path: string;
  readonly find: string;
  readonly replace: string;
  readonly exitCode: number;
}

/** Declares a script-mode AC carrying a DECLARED falsifier via the real `lore ac add` CLI. */
function declareScriptAcWithFalsifier(
  dir: string,
  specSlug: string,
  acId: string,
  command: string,
  falsifier: DeclaredFalsifier,
): void {
  const r = runLore(
    [
      "ac",
      "add",
      specSlug,
      acId,
      "--statement",
      `${TARGET_FILE} contains MAGIC_MARKER (falsifier negative-control fixture, task-make-the-falsifier-s-negative-control-a-permanent-runnable).`,
      "--mode",
      "script",
      "--oracle",
      "other",
      "--command",
      command,
      "--falsifier-path",
      falsifier.path,
      "--falsifier-find",
      falsifier.find,
      "--falsifier-replace",
      falsifier.replace,
      "--falsifier-exit-code",
      String(falsifier.exitCode),
    ],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`ac add (falsifier "${acId}") failed: ${r.stderr}`);
}

/** Reads a task's evidence log back OUT of the throwaway corpus via a SEPARATE `lore get --json` subprocess call — never an injected recorder spy. */
function readEvidenceRows(dir: string, taskSlug: string): readonly EvidenceEntry[] {
  const readBack = runLore(["get", taskSlug, "--json"], dir);
  if (readBack.exitCode !== 0) {
    throw new Error(`lore get --json failed reading back task "${taskSlug}": ${readBack.stderr}`);
  }
  const parsed = JSON.parse(readBack.stdout) as { data: { doc: DocRecord } };
  return extractEvidence(parsed.data.doc);
}

// ─── Fixture: a throwaway `mkdtemp` + `git init` + `lore init` repo ────────

const TARGET_FILE = "target.txt";
const TARGET_FILE_CONTENT = "MAGIC_MARKER\n";
/** Green (exit 0) while MAGIC_MARKER is present; exit 7 once it is removed. */
const PROBE_COMMAND = `grep -q MAGIC_MARKER ${TARGET_FILE} && exit 0 || exit 7`;

const NEGATIVE_AC_ID = "AC-NEGCTRL-INERT";
const POSITIVE_AC_ID = "AC-NEGCTRL-REAL";

/**
 * The REJECTED-by-design declaration: `find` and `replace` are IDENTICAL, so
 * `applyFalsifierMutation` writes the SAME content back — a no-op mutation.
 * `exitCode: 1` is deliberately chosen to differ from what the probe command
 * actually returns either way (0 unmutated, still 0 "mutated") — the point
 * is that NO exit code this declaration could name would ever be honest,
 * short of the one the un-mutated command already produces, which is not
 * what a falsifier declaration is for.
 */
const INERT_FALSIFIER: DeclaredFalsifier = { path: TARGET_FILE, find: "MAGIC_MARKER", replace: "MAGIC_MARKER", exitCode: 1 };

/** A genuinely discriminating declaration: removes the marker, and `7` is exactly what the probe command's `else` branch returns once it is gone. */
const POSITIVE_FALSIFIER: DeclaredFalsifier = { path: TARGET_FILE, find: "MAGIC_MARKER", replace: "", exitCode: 7 };

interface FixtureRepo {
  readonly repoRoot: string;
}

function makeFixtureRepo(): FixtureRepo {
  const repoRoot = mkdtempSync(join(tmpdir(), "lore-falsifier-negative-control-"));
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "lore-negative-control@example.com"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Lore Negative Control"], { cwd: repoRoot });
  writeFileSync(join(repoRoot, TARGET_FILE), TARGET_FILE_CONTENT, "utf8");

  const init = runLore(["init"], repoRoot);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed in throwaway corpus "${repoRoot}": ${init.stderr}`);
  }
  disableAllGates(repoRoot);
  return { repoRoot };
}

/** Commits the fixture's current state — `target.txt` MUST be tracked before any `--falsify` run, or the scratch worktree's `git worktree add --detach <dir> HEAD` checkout would not carry it and the green control would fail for an unrelated reason. */
function commitFixtureRepo(repoRoot: string): void {
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync("git", [...GIT_AUTHOR_ARGS, "commit", "-q", "-m", "seed falsifier negative-control fixture"], {
    cwd: repoRoot,
  });
}

// ─── Assertion helpers (plain script — no test runner underneath) ─────────

class NegativeControlAssertionError extends Error {}

function assertExactly<T>(actual: T, expected: T, description: string): void {
  if (actual !== expected) {
    throw new NegativeControlAssertionError(
      `${description} — expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`,
    );
  }
}

function assertContains(haystack: string, needle: string, description: string): void {
  if (!haystack.includes(needle)) {
    throw new NegativeControlAssertionError(
      `${description} — expected output to contain ${JSON.stringify(needle)}, got:\n${haystack}`,
    );
  }
}

function assertUndefined(value: unknown, description: string): void {
  if (value !== undefined) {
    throw new NegativeControlAssertionError(`${description} — expected undefined, observed ${JSON.stringify(value)}`);
  }
}

function assertDefined<T>(value: T | undefined, description: string): asserts value is T {
  if (value === undefined) {
    throw new NegativeControlAssertionError(`${description} — expected a defined value, observed undefined`);
  }
}

// ─── The two halves ─────────────────────────────────────────────────────────

/**
 * NEGATIVE control — Finding 1's own core deliverable. Drives a REAL
 * `lore verify --falsify` against the inert-falsifier AC and asserts it
 * refuses loud (exit 4), names the mismatch, and persists NOTHING.
 */
function runNegativeControl(repoRoot: string, planSlug: string, taskSlug: string): void {
  const result = runLore(
    ["verify", planSlug, "--task", taskSlug, "--falsify", NEGATIVE_AC_ID, "--by", "falsifier-negative-control-script"],
    repoRoot,
  );
  assertExactly(result.exitCode, 4, "NEGATIVE control: lore verify --falsify exit code for an inert falsifier");
  assertContains(
    result.stderr,
    "does not match reality",
    "NEGATIVE control: refusal output must name the exit-code mismatch",
  );
  assertContains(
    result.stderr,
    "Nothing recorded",
    "NEGATIVE control: refusal output must state that nothing was recorded",
  );

  const evidence = readEvidenceRows(repoRoot, taskSlug);
  const row = evidence.find((e) => e.ac_ref === NEGATIVE_AC_ID);
  assertUndefined(row, "NEGATIVE control: no evidence row must exist for the inert-falsifier AC after the refused run");
}

/**
 * POSITIVE control — without this half, the NEGATIVE half's "refused loud"
 * result cannot be told apart from a mechanism that refuses EVERY falsifier
 * it is ever handed. Drives a REAL `lore verify --falsify` against a
 * genuinely discriminating falsifier on the SAME fixture and asserts a real
 * attested red is recorded. Also re-confirms the NEGATIVE AC's own row is
 * STILL absent — "nothing recorded" means literally nothing, not "nothing
 * recorded so far".
 */
function runPositiveControl(repoRoot: string, planSlug: string, taskSlug: string): void {
  const result = runLore(
    ["verify", planSlug, "--task", taskSlug, "--falsify", POSITIVE_AC_ID, "--by", "falsifier-negative-control-script"],
    repoRoot,
  );
  assertExactly(
    result.exitCode,
    0,
    "POSITIVE control: lore verify --falsify exit code for a genuinely discriminating falsifier",
  );
  assertContains(result.stdout, "Attested red recorded", "POSITIVE control: stdout must name the attested-red outcome");
  assertContains(result.stdout, POSITIVE_AC_ID, "POSITIVE control: stdout must name the AC id");

  const evidence = readEvidenceRows(repoRoot, taskSlug);
  const row = evidence.find((e) => e.ac_ref === POSITIVE_AC_ID);
  assertDefined(row, "POSITIVE control: an evidence row must exist for the discriminating-falsifier AC");
  assertExactly(row.result, "expected-fail", "POSITIVE control: persisted row's result");
  assertExactly(row.capture_source, "runner", "POSITIVE control: persisted row's capture_source");
  assertDefined(row.attestation, "POSITIVE control: persisted row must carry an attestation block");
  assertExactly(
    row.attestation.exit_code,
    POSITIVE_FALSIFIER.exitCode,
    "POSITIVE control: attestation.exit_code must equal the declared falsifier exit code exactly",
  );

  const negativeRow = evidence.find((e) => e.ac_ref === NEGATIVE_AC_ID);
  assertUndefined(
    negativeRow,
    "cross-check: the inert-falsifier AC's row must STILL be absent after the positive control ran",
  );
}

// ─── Entry point ────────────────────────────────────────────────────────────

/** Builds the fixture, runs both controls, and cleans up — never calls `process.exit` itself (see the `import.meta.main` block below). */
function main(): void {
  const { repoRoot } = makeFixtureRepo();
  try {
    const prdSlug = createPrd(repoRoot, "Falsifier Negative Control PRD");
    const specSlug = createSpec(repoRoot, "Falsifier Negative Control Spec", prdSlug);

    declareScriptAcWithFalsifier(repoRoot, specSlug, NEGATIVE_AC_ID, PROBE_COMMAND, INERT_FALSIFIER);
    declareScriptAcWithFalsifier(repoRoot, specSlug, POSITIVE_AC_ID, PROBE_COMMAND, POSITIVE_FALSIFIER);

    const planSlug = createPlan(repoRoot, "Falsifier Negative Control Plan", specSlug);
    const taskSlug = createTask(repoRoot, planSlug, "Falsifier Negative Control Task", [
      NEGATIVE_AC_ID,
      POSITIVE_AC_ID,
    ]);

    // target.txt MUST be committed (tracked) before either --falsify run —
    // see commitFixtureRepo's own doc for why.
    commitFixtureRepo(repoRoot);

    runNegativeControl(repoRoot, planSlug, taskSlug);
    runPositiveControl(repoRoot, planSlug, taskSlug);

    console.log(
      "falsifier-negative-control: PASS — an inert falsifier is refused " +
        "(lore verify --falsify exit 4, exit-code mismatch named, no evidence row persisted) AND a " +
        "genuinely discriminating falsifier on the SAME fixture is accepted (exit 0, attested " +
        "expected-fail row persisted with attestation.exit_code === 7).",
    );
  } finally {
    try {
      rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup of the throwaway corpus — never fatal to the run above */
    }
  }
}

if (import.meta.main) {
  try {
    main();
    process.exit(0);
  } catch (e) {
    console.error(`falsifier-negative-control: FAIL — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

/**
 * Compiled-binary e2e for the `lore evidence` mixed-runner invocation guard —
 * closes task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a,
 * driven end-to-end through the COMPILED `dist/lore` binary against a
 * THROWAWAY `mkdtemp` corpus (never this repo's own `.lore/`; project
 * CLAUDE.md hard rule, 2026-07-07 pollution incident).
 *
 * Why a compiled suite exists at all: the guard's decision function is pure
 * and exhaustively unit-tested from vitest
 * (`tests/unit/adapters/evidence-mixed-runner-guard.test.ts`), but the CLI
 * command that must CALL it (`src/adapters/cli/commands/evidence.ts`) imports
 * the bun-only `loader.ts` (`bun:sqlite`) and is unreachable from vitest — the
 * SAME reason `evidence-completeness-guard-compiled.bun.test.ts` (SPEC-061
 * AC-061-16) exists for the sibling filtered-pass guard. A guard wired to
 * nothing would leave every unit test green; this file is the only oracle
 * that the wiring exists in the artifact a consumer actually runs.
 *
 * The refusal assertions are guarded against a CONFOUND: `lore evidence` runs
 * the older missing-oracle-file precheck FIRST, and it also exits 4. Every
 * command below names test files that genuinely EXIST inside the throwaway
 * corpus (`seedOracleFiles`), and each refusal assertion pins the
 * mixed-runner wording AND asserts the missing-file wording is ABSENT — so a
 * pass here can never be a right-exit-code-for-the-wrong-reason.
 *
 * Freshness guard (repo CLAUDE.md false-oracle vector #4 — a stale
 * `dist/lore` silently validates stale compiled logic against current
 * source): `beforeAll` calls `assertFreshBinary`. Run `bun run build` (repo
 * root) first.
 *
 * ⛔ SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-own,
 * spec-falsifiability-reachability-a-feedable-checkpoint-an §D5): a
 * self-reported oracle-"test" `--result pass` is now refused by the SEPARATE,
 * later-running `rejectMissingPassOutputTail` guard regardless of tail
 * content — clearing THIS mixed-runner guard is necessary but no longer
 * sufficient. Scenarios 3-4 below now assert THIS guard's own verdict (via
 * MIXED_RUNNER_WORDING's absence) while the overall write is refused by D5
 * (naming --capture); row counts stay flat at 0 throughout.
 *
 * Coverage (sequential scenarios over ONE task):
 *   1. a single `vitest run` command naming BOTH a real vitest file and a
 *      real `.bun.test.ts` file → exit 4, 0 rows, mixed-runner wording
 *   2. the symmetric `bun test` command naming BOTH files → exit 4, 0 rows
 *   3. the same file set split into two separate recordings → clears THIS
 *      guard both times, refused by D5 instead, 0 rows
 *   4. a plain unfiltered single-runner pass → clears THIS guard, refused by
 *      D5, 0 rows
 *
 * @spec_ref task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors every sibling compiled-binary e2e suite's own REPO_ROOT derivation.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

/** Paths (relative to the throwaway corpus root) of the two oracle files every command names. */
const VITEST_FILE_RELATIVE = "tests/sample.test.ts";
const BUN_FILE_RELATIVE = "tests/sample.bun.test.ts";

/** A single vitest invocation naming BOTH files — the exact defect shape. */
const MIXED_VITEST_COMMAND = `bunx vitest run ${VITEST_FILE_RELATIVE} ${BUN_FILE_RELATIVE}`;
/** The symmetric case: a single bun test invocation naming BOTH files. */
const MIXED_BUN_COMMAND = `bun test ${BUN_FILE_RELATIVE} ${VITEST_FILE_RELATIVE}`;
/** The same file set, correctly split. */
const SPLIT_VITEST_COMMAND = `bunx vitest run ${VITEST_FILE_RELATIVE}`;
const SPLIT_BUN_COMMAND = `bun test ${BUN_FILE_RELATIVE}`;

/** Wording unique to the guard under test. */
const MIXED_RUNNER_WORDING = "Mixed-runner --command";
/** Wording unique to the OLDER precheck — its presence would mean a confounded refusal. */
const MISSING_FILE_WORDING = "Oracle file(s) not found";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns the COMPILED binary. `CLAUDECODE=1` resolves the "agent" caller
 * surface (SPEC-024) so no `create` risks a nested AI call; a fixed
 * `LORE_ACTOR` keeps writes attributable and avoids an unrelated
 * actor-traceability warning polluting the exact stderr assertions below.
 */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
      CLAUDECODE: "1",
      LORE_ACTOR: "agent:mixed-runner-guard-probe",
    },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from: ${stdout}`);
  return slug;
}

/**
 * Creates the two files every recorded command names, so the older
 * missing-oracle-file precheck is satisfied and cannot confound the
 * assertions (see module header). Contents are irrelevant — nothing ever
 * executes these files; only their EXISTENCE is checked, by
 * `findMissingOracleFilesForEvidence`.
 */
function seedOracleFiles(dir: string): void {
  mkdirSync(join(dir, "tests"), { recursive: true });
  writeFileSync(join(dir, VITEST_FILE_RELATIVE), "// existence-only fixture\n");
  writeFileSync(join(dir, BUN_FILE_RELATIVE), "// existence-only fixture\n");
}

/** Reads the task's CURRENT evidence-row count straight from the corpus. */
function readEvidenceCount(dir: string, taskSlug: string): number {
  const result = runLore(["get", taskSlug, "--json"], dir);
  if (result.exitCode !== 0) throw new Error(`lore get failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as {
    data: { doc: { extra: { verification_evidence?: unknown[] } } };
  };
  return parsed.data.doc.extra.verification_evidence?.length ?? 0;
}

function recordEvidence(dir: string, taskSlug: string, command: string): RunResult {
  return runLore(
    ["evidence", taskSlug, "--oracle", "test", "--result", "pass", "--command", command, "--output-tail", "ok"],
    dir,
  );
}

let dir: string;
let taskSlug: string;

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);

  dir = mkdtempSync(join(tmpdir(), "lore-mixed-runner-guard-"));
  // Never inside this repo — the corpus under test must not be the repo's own.
  expect(dir.startsWith(REPO_ROOT)).toBe(false);

  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  seedOracleFiles(dir);

  const prd = runLore(
    ["create", "prd", "--title", "Mixed Runner Guard Root", "--content", "# PRD\n\nroot.", "--no-ai"],
    dir,
  );
  if (prd.exitCode !== 0) throw new Error(`create prd failed: ${prd.stderr}`);

  const plan = runLore(
    [
      "create", "plan",
      "--title", "Mixed Runner Guard Plan",
      "--parent", parseSlug(prd.stdout),
      "--content", "## Plan\n\nbody",
      "--no-ai",
    ],
    dir,
  );
  if (plan.exitCode !== 0) throw new Error(`create plan failed: ${plan.stderr}`);

  const task = runLore(
    [
      "create", "task",
      "--title", "Mixed Runner Guard Task",
      "--plan-id", parseSlug(plan.stdout),
      "--content", "## Task\n\nbody",
      "--no-ai",
    ],
    dir,
  );
  if (task.exitCode !== 0) throw new Error(`create task failed: ${task.stderr}`);
  taskSlug = parseSlug(task.stdout);
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

describe("compiled lore evidence refuses a mixed-runner --command", () => {
  it("a single vitest run invocation naming a .bun.test.ts file too exits 4 and writes no row", () => {
    expect(readEvidenceCount(dir, taskSlug)).toBe(0);

    const refused = recordEvidence(dir, taskSlug, MIXED_VITEST_COMMAND);

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain(MIXED_RUNNER_WORDING);
    expect(refused.stderr).toContain(BUN_FILE_RELATIVE);
    expect(refused.stderr).toContain("vitest run");
    expect(refused.stderr).toContain("bun test");
    // CONFOUND CONTROL: refused by THIS guard, not by the older missing-file precheck.
    expect(refused.stderr).not.toContain(MISSING_FILE_WORDING);
    expect(readEvidenceCount(dir, taskSlug)).toBe(0);
  });

  it("the symmetric bun test invocation naming the plain .test.ts file too exits 4 and writes no row", () => {
    const refused = recordEvidence(dir, taskSlug, MIXED_BUN_COMMAND);

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain(MIXED_RUNNER_WORDING);
    expect(refused.stderr).toContain(VITEST_FILE_RELATIVE);
    expect(refused.stderr).not.toContain(MISSING_FILE_WORDING);
    expect(readEvidenceCount(dir, taskSlug)).toBe(0);
  });

  // reason: SUPERSEDED (task-raise-the-evidence-tail-guard-s-predicate-to-its-
  // own, spec-falsifiability-reachability-a-feedable-checkpoint-an §D5) —
  // clearing THIS mixed-runner guard is now necessary but no longer
  // sufficient: `rejectMissingPassOutputTail` separately refuses EVERY
  // self-reported oracle-"test" pass without --capture, regardless of tail
  // content. `--oracle manual` is not usable here (it would skip the guard
  // this file exists to test). Both calls below now clear THIS guard (proven
  // by MIXED_RUNNER_WORDING's absence) but are refused by D5 instead (naming
  // --capture); row counts stay flat at 0.
  it("the same file set split into two separate recordings clears the mixed-runner guard both times, but D5 still refuses without --capture", () => {
    const first = recordEvidence(dir, taskSlug, SPLIT_VITEST_COMMAND);
    expect(first.exitCode).toBe(4);
    expect(first.stderr).not.toContain(MIXED_RUNNER_WORDING);
    expect(first.stderr).toContain("--capture");
    expect(readEvidenceCount(dir, taskSlug)).toBe(0);

    const second = recordEvidence(dir, taskSlug, SPLIT_BUN_COMMAND);
    expect(second.exitCode).toBe(4);
    expect(second.stderr).not.toContain(MIXED_RUNNER_WORDING);
    expect(second.stderr).toContain("--capture");
    expect(readEvidenceCount(dir, taskSlug)).toBe(0);
  });

  it("CONTROL: an unrelated unfiltered single-runner pass clears the mixed-runner guard, but D5 still refuses without --capture", () => {
    const accepted = recordEvidence(dir, taskSlug, SPLIT_VITEST_COMMAND);

    expect(accepted.exitCode).toBe(4);
    expect(accepted.stderr).not.toContain(MIXED_RUNNER_WORDING);
    expect(accepted.stderr).toContain("--capture");
    expect(readEvidenceCount(dir, taskSlug)).toBe(0);
  });
});

/**
 * Compiled-binary e2e for SPEC-061 AC-061-16 — the `lore evidence`
 * filtered-pass matched-count guard, driven end-to-end through the COMPILED
 * `dist/lore` binary against a THROWAWAY `mkdtemp` corpus (never this repo's
 * own `.lore/`; project CLAUDE.md hard rule, 2026-07-07 pollution incident).
 *
 * Why a compiled suite exists at all: the guard's decision function is pure and
 * exhaustively unit-tested from vitest
 * (`tests/unit/adapters/evidence-completeness-guard.test.ts`), but the CLI
 * command that must CALL it (`src/adapters/cli/commands/evidence.ts`) imports
 * the bun-only `loader.ts` (`bun:sqlite`) and is unreachable from vitest. A
 * guard wired to nothing would leave every unit test green — this file is the
 * only oracle that the wiring exists, in the artifact a consumer actually runs.
 *
 * The refusal assertions are guarded against a CONFOUND: `lore evidence` runs
 * the older missing-oracle-file precheck FIRST, and it also exits 4. Every
 * command below therefore names a test file that genuinely EXISTS inside the
 * throwaway corpus (`seedOracleFile`), and each refusal assertion pins the
 * matched-count wording AND asserts the missing-file wording is ABSENT — so a
 * pass here can never be a right-exit-code-for-the-wrong-reason.
 *
 * Freshness guard (repo CLAUDE.md false-oracle vector #4 — a stale `dist/lore`
 * silently validates stale compiled logic against current source): `beforeAll`
 * calls `assertFreshBinary`. Run `bun run build` (repo root) first.
 *
 * Coverage (sequential scenarios over ONE task, each asserting the evidence-row
 * count it leaves behind — the write is the state, so counting it is how
 * "refused" is distinguished from "recorded"):
 *   1. filtered `--result pass`, NO output tail  → exit 4, 0 rows (AC-061-16)
 *   2. UNFILTERED pass, no tail                  → exit 0, exactly 1 row (AC-061-16 control)
 *   3. filtered pass + proving `--output-tail`   → exit 0, 2 rows
 *   4. filtered pass + `--output-tail-file`      → exit 0, 3 rows
 * Scenarios 3-4 prove the refusal is about the PROOF and not about the mere
 * presence of a `-t` flag (a guard that blocked every filtered pass would pass
 * scenarios 1-2 just as happily), and that BOTH tail-supplying flags satisfy it
 * — the CLI resolves `--output-tail-file` into the same `outputTail` the guard
 * reads, an ordering a unit test on the pure function cannot reach.
 *
 * @spec_ref AC-061-16; adr-lore-evidence-proves-a-filtered-pass-with-the-runner-s-own;
 *   task-lore-evidence-must-refuse-a-t-filtered-pass-with-no
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors every sibling compiled-binary e2e suite's own REPO_ROOT derivation.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

/** Path (relative to the throwaway corpus root) of the oracle file every command names. */
const ORACLE_FILE_RELATIVE = "tests/sample.test.ts";

/** A `-t`-filtered command over that file — the shape the guard governs. */
const FILTERED_COMMAND = `bunx vitest run ${ORACLE_FILE_RELATIVE} -t 'AC-061-16'`;

/** The same file with no case filter — the control shape the guard must ignore. */
const UNFILTERED_COMMAND = `bunx vitest run ${ORACLE_FILE_RELATIVE}`;

/** A real vitest summary pair proving 2 cases matched. */
const PROVING_TAIL = " Test Files  1 passed (1)\n      Tests  2 passed (2)\n";

/** Wording unique to the guard under test. */
const MATCHED_COUNT_WORDING = "matched-count proof";
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
      LORE_ACTOR: "agent:ac-061-16-probe",
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
 * Creates the file every recorded command names, so the older
 * missing-oracle-file precheck is satisfied and cannot confound the assertions
 * (see module header). Contents are irrelevant — nothing ever executes it; only
 * its EXISTENCE is checked, by `findMissingOracleFilesForEvidence`.
 */
function seedOracleFile(dir: string): void {
  mkdirSync(join(dir, "tests"), { recursive: true });
  writeFileSync(join(dir, ORACLE_FILE_RELATIVE), "// existence-only fixture\n");
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

function recordEvidence(dir: string, taskSlug: string, extraArgs: string[]): RunResult {
  return runLore(["evidence", taskSlug, "--oracle", "test", "--result", "pass", ...extraArgs], dir);
}

let dir: string;
let taskSlug: string;

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);

  dir = mkdtempSync(join(tmpdir(), "lore-ac-061-16-"));
  // Never inside this repo — the corpus under test must not be the repo's own.
  expect(dir.startsWith(REPO_ROOT)).toBe(false);

  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  seedOracleFile(dir);

  const prd = runLore(
    ["create", "prd", "--title", "AC-061-16 Root", "--content", "# PRD\n\nroot.", "--no-ai"],
    dir,
  );
  if (prd.exitCode !== 0) throw new Error(`create prd failed: ${prd.stderr}`);

  const plan = runLore(
    [
      "create", "plan",
      "--title", "AC-061-16 Plan",
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
      "--title", "AC-061-16 Task",
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

describe("AC-061-16 — compiled lore evidence refuses an unproven filtered pass", () => {
  it("a -t-filtered --result pass with NO output tail exits 4 and writes no evidence row", () => {
    expect(readEvidenceCount(dir, taskSlug)).toBe(0);

    const refused = recordEvidence(dir, taskSlug, ["--command", FILTERED_COMMAND]);

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain(MATCHED_COUNT_WORDING);
    // CONFOUND CONTROL: refused by THIS guard, not by the older missing-file precheck.
    expect(refused.stderr).not.toContain(MISSING_FILE_WORDING);
    expect(readEvidenceCount(dir, taskSlug)).toBe(0);
  });

  // reason: SUPERSEDED title (task-a-non-empty-output-tail-can-be-hand-authored-
  // prose-and-the) — "no tail required" was true only for the FILTERED-pass
  // guard this describe block is about; the SEPARATE pass-tail guard now
  // requires SOME non-empty tail for every self-reported pass, filtered or not.
  it("CONTROL: an UNFILTERED pass is exempt from the FILTERED-pass guard specifically (still needs a tail for the separate pass-tail guard)", () => {
    const accepted = recordEvidence(dir, taskSlug, ["--command", UNFILTERED_COMMAND, "--output-tail", "ok"]);

    expect(accepted.exitCode).toBe(0);
    expect(accepted.stderr).not.toContain(MATCHED_COUNT_WORDING);
    expect(readEvidenceCount(dir, taskSlug)).toBe(1);
  });

  it("a filtered pass carrying a proving --output-tail is accepted", () => {
    const accepted = recordEvidence(dir, taskSlug, [
      "--command", FILTERED_COMMAND,
      "--output-tail", PROVING_TAIL,
    ]);

    expect(accepted.exitCode).toBe(0);
    expect(readEvidenceCount(dir, taskSlug)).toBe(2);
  });

  it("a filtered pass whose proof arrives via --output-tail-file is accepted", () => {
    const tailPath = join(dir, "run-output.txt");
    writeFileSync(tailPath, `some earlier noise\n${PROVING_TAIL}`);

    const accepted = recordEvidence(dir, taskSlug, [
      "--command", FILTERED_COMMAND,
      "--output-tail-file", tailPath,
    ]);

    expect(accepted.exitCode).toBe(0);
    expect(readEvidenceCount(dir, taskSlug)).toBe(3);
  });

  it("a filtered pass whose tail reports every case skipped is refused, naming zero_match", () => {
    const refused = recordEvidence(dir, taskSlug, [
      "--command", FILTERED_COMMAND,
      "--output-tail", " Test Files  1 skipped (1)\n      Tests  46 skipped (46)\n",
    ]);

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("zero_match");
    expect(refused.stderr).not.toContain(MISSING_FILE_WORDING);
    // Unchanged from the previous scenario — the refusal wrote nothing.
    expect(readEvidenceCount(dir, taskSlug)).toBe(3);
  });
});

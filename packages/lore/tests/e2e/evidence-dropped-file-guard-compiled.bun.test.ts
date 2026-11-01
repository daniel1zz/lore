// @reads assets/project/lore-config-template.yaml
/**
 * Compiled-binary e2e for the `lore evidence` dropped-file guard — closes
 * task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a (re-derived by
 * task-skill-implement-tg-32-evidence-precheck-follows-the-one), driven
 * end-to-end through the COMPILED `dist/lore` binary against a THROWAWAY
 * `mkdtemp` corpus (never this repo's own `.lore/`; project CLAUDE.md hard
 * rule, 2026-07-07 pollution incident).
 *
 * Why a compiled suite exists at all: the guard's decision function is pure
 * and unit-tested from vitest
 * (`tests/unit/adapters/evidence-dropped-file-guard.test.ts`), but the CLI
 * command that must CALL it (`src/adapters/cli/commands/evidence.ts`) imports
 * the bun-only `loader.ts` (`bun:sqlite`) and is unreachable from vitest — the
 * SAME reason `evidence-completeness-guard-compiled.bun.test.ts` (SPEC-061
 * AC-061-16) exists for the sibling filtered-pass guard. A guard wired to
 * nothing would leave every unit test green; this file is the only oracle
 * that the wiring exists in the artifact a consumer actually runs.
 *
 * The runner is a STUB `node_modules/.bin/vitest` inside the throwaway corpus
 * that prints a fixed one-file summary, so `--capture` runs a real child
 * process through `bunx --bun vitest run ...` without needing vitest installed
 * and without depending on how many files the command names. That makes the
 * two scenarios exact: the stub always reports ONE executed file, so a command
 * naming one file is complete and a command naming two is the silent drop.
 *
 * Freshness guard (repo CLAUDE.md false-oracle vector #4 — a stale
 * `dist/lore` silently validates stale compiled logic against current
 * source): `beforeAll` calls `assertFreshBinary`. Run `bun run build` (repo
 * root) first.
 *
 * Coverage (sequential scenarios over ONE task):
 *   1. `--capture` of `bunx --bun vitest run <x>.bun.test.ts` (the one-runner
 *      command this repo records since 90c2b081; the old filename-suffix guard
 *      refused it) -> exit 0, one runner-captured row
 *   2. `--capture` of a command naming TWO files while the runner executes one
 *      -> exit 4, dropped-file wording, no new row
 *   3. the same two-file command naming a consumer-style plain `.test.ts` pair
 *      is refused the same way (no repo naming convention involved)
 *
 * @spec_ref task-skill-implement-tg-32-evidence-precheck-follows-the-one
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors every sibling compiled-binary e2e suite's own REPO_ROOT derivation.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

/** Paths (relative to the throwaway corpus root) of the files the commands name. */
const PLAIN_FILE_RELATIVE = "tests/sample.test.ts";
const BUN_FILE_RELATIVE = "tests/sample.bun.test.ts";
const OTHER_PLAIN_FILE_RELATIVE = "tests/other.test.ts";

/** The one-runner command for a `.bun.test.ts` file; the stub runner executes one file. */
const ONE_FILE_COMMAND = `bunx --bun vitest run ${BUN_FILE_RELATIVE}`;
/** Two files named; the stub runner still reports ONE executed — the silent drop. */
const TWO_FILE_COMMAND = `bunx --bun vitest run ${PLAIN_FILE_RELATIVE} ${BUN_FILE_RELATIVE}`;
/** A consumer-style pair with no `.bun.test.ts` involved at all. */
const CONSUMER_PAIR_COMMAND = `bunx --bun vitest run ${PLAIN_FILE_RELATIVE} ${OTHER_PLAIN_FILE_RELATIVE}`;

/** Wording unique to the guard under test. */
const DROPPED_FILE_WORDING = "Dropped-file --result pass";
/** Wording the retired filename-suffix guard used; its presence would be the regression. */
const RETIRED_WORDING = "Mixed-runner --command";
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
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: {
      ...process.env,
      HOME: cwd,
      CLAUDECODE: "1",
      LORE_ACTOR: "agent:dropped-file-guard-probe",
    },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
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
  for (const relative of [PLAIN_FILE_RELATIVE, BUN_FILE_RELATIVE, OTHER_PLAIN_FILE_RELATIVE]) {
    writeFileSync(join(dir, relative), "// existence-only fixture\n");
  }
  // reason: a stub runner, not real vitest — `bunx` resolves a project-local
  // node_modules/.bin entry first, so `--capture` spawns this script. It prints
  // a fixed ONE-file summary regardless of arguments, which is exactly the
  // runner behaviour under test (a runner that executed fewer files than named).
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  const stub = join(dir, "node_modules", ".bin", "vitest");
  writeFileSync(
    stub,
    "#!/bin/sh\necho ' Test Files  1 passed (1)'\necho '      Tests  3 passed (3)'\n",
  );
  chmodSync(stub, 0o755);
}

/** Reads the task's CURRENT evidence-row count straight from the corpus. */
async function readEvidenceCount(dir: string, taskSlug: string): Promise<number> {
  const result = await runLore(["get", taskSlug, "--json"], dir);
  if (result.exitCode !== 0) throw new Error(`lore get failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as {
    data: { doc: { extra: { verification_evidence?: unknown[] } } };
  };
  return parsed.data.doc.extra.verification_evidence?.length ?? 0;
}

async function recordCapturedEvidence(dir: string, taskSlug: string, command: string): Promise<RunResult> {
  return await runLore(
    ["evidence", taskSlug, "--oracle", "test", "--result", "pass", "--capture", "--command", command],
    dir,
  );
}

let dir: string;
let taskSlug: string;

beforeAll(async () => {

  dir = mkdtempSync(join(tmpdir(), "lore-dropped-file-guard-"));
  // Never inside this repo — the corpus under test must not be the repo's own.
  expect(dir.startsWith(REPO_ROOT)).toBe(false);

  const init = await runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  seedOracleFiles(dir);

  const prd = await runLore(
    ["create", "prd", "--title", "Dropped File Guard Root", "--content", "# PRD\n\nroot.", "--no-ai"],
    dir,
  );
  if (prd.exitCode !== 0) throw new Error(`create prd failed: ${prd.stderr}`);

  const plan = await runLore(
    [
      "create", "plan",
      "--title", "Dropped File Guard Plan",
      "--parent", parseSlug(prd.stdout),
      "--content", "## Plan\n\nbody",
      "--no-ai",
    ],
    dir,
  );
  if (plan.exitCode !== 0) throw new Error(`create plan failed: ${plan.stderr}`);

  const task = await runLore(
    [
      "create", "task",
      "--title", "Dropped File Guard Task",
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

describe("compiled lore evidence follows the one-runner rule and still refuses a dropped file", () => {
  it("--capture accepts `bunx --bun vitest run <x>.bun.test.ts` and records one runner-captured row", async () => {
    expect(await readEvidenceCount(dir, taskSlug)).toBe(0);

    const accepted = await recordCapturedEvidence(dir, taskSlug, ONE_FILE_COMMAND);

    expect(accepted.stderr).not.toContain(RETIRED_WORDING);
    expect(accepted.stderr).not.toContain(DROPPED_FILE_WORDING);
    expect(accepted.exitCode).toBe(0);
    expect(await readEvidenceCount(dir, taskSlug)).toBe(1);
  });

  it("a captured command naming two files while the runner executes one exits 4 and writes no row", async () => {
    const before = await readEvidenceCount(dir, taskSlug);

    const refused = await recordCapturedEvidence(dir, taskSlug, TWO_FILE_COMMAND);

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain(DROPPED_FILE_WORDING);
    expect(refused.stderr).toContain("under_match");
    expect(refused.stderr).not.toContain(RETIRED_WORDING);
    // CONFOUND CONTROL: refused by THIS guard, not by the older missing-file precheck.
    expect(refused.stderr).not.toContain(MISSING_FILE_WORDING);
    expect(await readEvidenceCount(dir, taskSlug)).toBe(before);
  });

  it("a consumer-style pair of plain .test.ts files is refused for the same reason, with no repo naming rule involved", async () => {
    const before = await readEvidenceCount(dir, taskSlug);

    const refused = await recordCapturedEvidence(dir, taskSlug, CONSUMER_PAIR_COMMAND);

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain(DROPPED_FILE_WORDING);
    expect(refused.stderr).not.toContain("CLAUDE.md");
    expect(await readEvidenceCount(dir, taskSlug)).toBe(before);
  });
});

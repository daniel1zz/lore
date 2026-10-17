// @spawns packages/lore/src/index.ts
/**
 * @spec_ref task-wire-findpiperefusal-into-the-live-lore-evidence-and-mcp
 *   AC-FALS-9 (spec-oracle-tier-falsifiability-a-criterion-never-observed-red
 *   M2; ADR falsifiability-moves-from-the-task-tier-to-the-oracle-tier)
 *
 * Proves `findPipeRefusal` is actually WIRED into the live `lore evidence` CLI
 * call sequence — not merely authored and unit-tested in isolation.
 *
 * Why this file exists, distinct from `evidence-pipe-refusal.bun.test.ts`:
 * that sibling file calls `findPipeRefusal` DIRECTLY as a decision function —
 * it proves the guard's LOGIC is correct, but (per its own module header,
 * written by the task that authored the guard) explicitly could NOT prove the
 * guard was reachable from a real `lore evidence` invocation, because neither
 * adapter called it yet. Root CLAUDE.md's own dogfooding log records four
 * prior same-shape false-greens in this exact repo (a capability implemented
 * and exhaustively tested, with its production call site never wired) — a
 * grep proving the call exists in source would be a PROXY for "the guard
 * fires", not the property itself; a real subprocess's real exit code is the
 * property.
 *
 * Mechanism: spawns `bun run src/index.ts evidence ...` (Bun.spawnSync) — NOT
 * the compiled `dist/lore` binary, so this file needs no `bun run build`
 * first and no `assertFreshBinary` guard (source-fresh by construction,
 * mirrors `tests/e2e/cli.bun.test.ts`'s own `INDEX_TS` pattern) — against a
 * THROWAWAY `mkdtemp` + `lore init` corpus (never this repo's own `.lore/`,
 * project CLAUDE.md hard rule, 2026-07-07 pollution incident).
 *
 * The single PIPE-WIRING-H1 test below is the load-bearing capture control
 * (same shape `evidence-pipe-refusal.bun.test.ts`'s own PIPE-H1 uses, one
 * layer up the stack): the IDENTICAL piped `--command` string is recorded
 * twice — once without `--capture` (must refuse, exit 4) and once WITH
 * `--capture` (must succeed, exit 0) — in the SAME test. A "refuse every
 * piped command unconditionally" implementation would pass the first half and
 * fail the second; only an implementation that actually calls
 * `findPipeRefusal({ ..., capture })` with the real per-call boolean passes
 * both. Both exit codes are read directly off `Bun.spawnSync`'s own
 * `proc.exitCode` — a native process exit status, never derived from a
 * shell pipe in THIS test's own measurement (the pipe under test lives only
 * inside the STRING passed as `--command`, evaluated by lore's inner
 * `--capture` spawn — a completely separate process from the one whose exit
 * code this test reads).
 *
 * The piped `--command` under test (`echo pipe-wiring-probe | cat`) is
 * deliberately inert with respect to every OTHER precheck this adapter runs
 * before the pipe guard: it names no test-file-like token (missing-oracle-
 * file precheck fail-opens), invokes neither `vitest run` nor `bun test`
 * (mixed-runner guard fail-opens), and carries no case filter (filtered-pass
 * guard fail-opens) — so a refusal can only be attributed to the pipe guard,
 * and an acceptance can only be attributed to `--capture`'s escape, never a
 * confound with a sibling guard.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// tests/unit/adapters/ -> tests/unit/ -> tests/ -> packages/lore/ (3 levels up).
const PROJECT_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

/** The exact piped command recorded on both invocations — see module header. */
const PIPED_COMMAND = "echo pipe-wiring-probe | cat";

/** Wording unique to `findPipeRefusal`'s refusal message. */
const PIPE_REFUSAL_WORDING = "shell pipe in --command";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns `bun run src/index.ts ...args` — a REAL, separate OS process. Its
 * exit code is read directly from `Bun.spawnSync`'s own `exitCode` field
 * (never through a shell pipe of this test's own — see module header).
 * `CLAUDECODE=1` resolves the "agent" caller surface (SPEC-024) so no
 * `create` risks a nested AI call; a fixed `LORE_ACTOR` keeps writes
 * attributable.
 */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
      CLAUDECODE: "1",
      LORE_ACTOR: "agent:pipe-wiring-probe",
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

/** Reads the task's CURRENT evidence-row count straight from the corpus. */
function readEvidence(dir: string, taskSlug: string): { count: number; lastCaptureSource: string | undefined } {
  const result = runLore(["get", taskSlug, "--json"], dir);
  if (result.exitCode !== 0) throw new Error(`lore get failed: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as {
    data: { doc: { extra: { verification_evidence?: Array<{ capture_source?: string }> } } };
  };
  const rows = parsed.data.doc.extra.verification_evidence ?? [];
  return {
    count: rows.length,
    lastCaptureSource: rows[rows.length - 1]?.capture_source,
  };
}

let dir: string;
let taskSlug: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-pipe-wiring-"));
  // Never inside this repo — the corpus under test must not be the repo's own.
  expect(dir.startsWith(PROJECT_ROOT)).toBe(false);

  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);

  const prd = runLore(
    ["create", "prd", "--title", "Pipe Wiring Root", "--content", "# PRD\n\nroot.", "--no-ai"],
    dir,
  );
  if (prd.exitCode !== 0) throw new Error(`create prd failed: ${prd.stderr}`);

  const plan = runLore(
    [
      "create", "plan",
      "--title", "Pipe Wiring Plan",
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
      "--title", "Pipe Wiring Task",
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

describe("live lore evidence process refuses a piped self-report, unless --capture measures it", () => {
  it("pipe-wiring: the same piped --command exits 4 without --capture and exits 0 with it", () => {
    expect(readEvidence(dir, taskSlug).count).toBe(0);

    // ── Half 1: NO --capture — findPipeRefusal must fire and block the write.
    const refused = runLore(
      ["evidence", taskSlug, "--oracle", "test", "--result", "pass", "--command", PIPED_COMMAND],
      dir,
    );

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain(PIPE_REFUSAL_WORDING);
    expect(refused.stderr).toContain("belongs to the LAST stage");
    expect(readEvidence(dir, taskSlug).count).toBe(0);

    // ── Half 2 (LOAD-BEARING): the IDENTICAL command WITH --capture — lore
    // spawns it itself, measures the real (successful, piped-through) exit
    // code, and the write proceeds. A blanket "refuse every piped command"
    // implementation fails this half while still passing half 1.
    const accepted = runLore(
      ["evidence", taskSlug, "--oracle", "test", "--result", "pass", "--command", PIPED_COMMAND, "--capture"],
      dir,
    );

    expect(accepted.exitCode).toBe(0);
    expect(accepted.stderr).not.toContain(PIPE_REFUSAL_WORDING);
    const afterCapture = readEvidence(dir, taskSlug);
    expect(afterCapture.count).toBe(1);
    // Confirms the write really went through --capture's runner path (the
    // command's own real stdout, "pipe-wiring-probe", was captured), not some
    // other unrelated escape.
    expect(afterCapture.lastCaptureSource).toBe("runner");
  });
});

// @spawns packages/lore/src/index.ts
/**
 * `lore evidence`'s tail guard — the PREDICATE now matches its own MESSAGE
 * (task-raise-the-evidence-tail-guard-s-predicate-to-its-own,
 * spec-falsifiability-reachability-a-feedable-checkpoint-an §D5, G4).
 *
 * Defect closed: `lore evidence` already refused a self-reported `--result
 * pass` with an EMPTY `--output-tail`, and its refusal message already said
 * "a hand-authored summary is not proof the command actually ran". The
 * PREDICATE behind that message was only `outputTail.trim().length > 0` —
 * ANY non-empty tail satisfied it, hand-typed or not. Measured 2026-08-10: of
 * three implementer agents given the rule "the tail must be non-empty and
 * contain the runner's summary line", TWO satisfied it by WRITING the
 * summary themselves (a fabricated one-liner vitest never prints, and a
 * fabricated sentence no runner emits) — both PASSED the old guard.
 *
 * D5's fix: the observable property (non-empty) is replaced by the MECHANISM
 * (`capture_source: "runner"`, i.e. `--capture`), with self-report available
 * only under ONE explicit, recorded justification — `--oracle manual`, the
 * sole oracle kind `--capture` structurally can never reach (nothing to
 * spawn for a visual/manual check).
 *
 * Driven via the REAL CLI subprocess (never the service directly) — same
 * `runLore`-over-`spawnSync` pattern as `tests/integration/cli/task-
 * workflow.test.ts` — against a throwaway `mkdtemp`-rooted corpus. NEVER
 * touches this repo's own `.lore/`.
 *
 * ⛔ The global `lore` binary symlinks into the MAIN checkout's `dist/` —
 * this file spawns `bun run <INDEX_TS> ...` against THIS worktree's own
 * source entry, never the bare `lore` binary, so it is unaffected by that
 * staleness hazard.
 *
 * Coverage:
 *   HAPPY:      --capture on a real, genuinely-passing command succeeds and
 *               stamps capture_source: "runner" (AC-FR-4 RED (b))
 *   NEGATIVE:   a non-empty HAND-AUTHORED tail (no --capture) is refused —
 *               today's defect, AC-FR-4 RED (a)
 *   BOUNDARY:   the non-empty-tail refusal's exit code is EXACTLY the
 *               empty-tail refusal's exit code (same guard, same code path);
 *               --oracle manual is the ONE surviving self-report escape
 *   ERROR:      the refusal names --capture explicitly
 *   STATE:      a refused call writes NO evidence row; a --capture call that
 *               follows on the SAME task writes exactly one
 *   REGRESSION: --capture combined with a command that ACTUALLY fails still
 *               refuses on the exit-code mismatch (pre-existing behavior,
 *               untouched by this raise)
 *
 * @spec_ref AC-FR-4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` — the real CLI, this worktree's own source entry. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `lore-tail-guard-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

function createPlan(): string {
  const r = runLore(["create", "plan", "--title", "Tail Guard Plan", "--no-ai", "--content", "body"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`Could not extract plan slug from: ${r.stdout}`);
  return m[1];
}

function createTask(planSlug: string): string {
  const r = runLore(
    ["create", "task", "--title", "Tail Guard Task", "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`Could not extract task slug from: ${r.stdout}`);
  return m[1];
}

function evidenceCount(taskSlug: string): number {
  const r = runLore(["get", taskSlug, "--json"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`get failed: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout) as { data?: { doc?: { extra?: { verification_evidence?: unknown[] } } } };
  return parsed.data?.doc?.extra?.verification_evidence?.length ?? 0;
}

describe("AC-FR-4 — the tail guard's predicate matches its own message", () => {
  // reason: spec-a-test-case-s-timeout-budget-must-be-declared-when-its D1 —
  // this body spawns the real CLI subprocess >=3 times (createPlan/createTask/
  // evidence/--capture); an explicit timeout is a DECLARATION requirement
  // (check-test-budgets), never a signal something here is slow.
  it("predicate-matches-message: a hand-authored non-empty tail is refused (RED a) at the SAME exit code the empty-tail case returns, naming --capture; the identical call WITH --capture succeeds (RED b)", () => {
    const planSlug = createPlan();

    // ── baseline: the PRE-EXISTING empty-tail refusal (never touched by this raise) ──
    const emptyTailTask = createTask(planSlug);
    const emptyTailResult = runLore(
      ["evidence", emptyTailTask, "--oracle", "test", "--command", "echo hi", "--result", "pass"],
      tmpDir,
    );
    expect(emptyTailResult.exitCode).toBe(4);

    // ── RED (a): TODAY this is ACCEPTED — that is the defect this task fixes.
    // A hand-authored tail that LOOKS like a genuine runner summary (real-
    // looking numbers embedded) — exactly the shape 2 of 3 measured agents
    // used to fool the pre-raise guard.
    const handTypedTask = createTask(planSlug);
    const handTypedResult = runLore(
      [
        "evidence",
        handTypedTask,
        "--oracle",
        "test",
        "--command",
        "echo hi",
        "--result",
        "pass",
        "--output-tail",
        "Test Files 1 passed (1); Tests 6 passed (6); Duration 4.24s",
      ],
      tmpDir,
    );
    // Same exit code as the empty-tail case — same guard, same code path.
    expect(handTypedResult.exitCode).toBe(emptyTailResult.exitCode);
    expect(handTypedResult.exitCode).toBe(4);
    expect(handTypedResult.stderr).toContain("--capture");
    expect(evidenceCount(handTypedTask)).toBe(0);

    // ── RED (b): --capture on the IDENTICAL command/result must NOT be refused —
    // proves the guard did not become a blanket denial, only a proof-mechanism raise.
    const capturedTask = createTask(planSlug);
    const capturedResult = runLore(
      ["evidence", capturedTask, "--oracle", "test", "--command", "echo hi", "--result", "pass", "--capture"],
      tmpDir,
    );
    expect(capturedResult.exitCode).toBe(0);
    expect(evidenceCount(capturedTask)).toBe(1);
  }, 20_000);

  it("BOUNDARY: --oracle manual is the ONE surviving self-report escape — a hand-typed, genuinely non-empty description still succeeds", () => {
    const planSlug = createPlan();
    const taskSlug = createTask(planSlug);

    const result = runLore(
      [
        "evidence",
        taskSlug,
        "--oracle",
        "manual",
        "--command",
        "checked the login page by hand",
        "--result",
        "pass",
        "--output-tail",
        "logged in 3 times rapidly, 4th attempt correctly blocked",
      ],
      tmpDir,
    );
    expect(result.exitCode).toBe(0);
    expect(evidenceCount(taskSlug)).toBe(1);
  });

  it("BOUNDARY: --oracle manual is NOT a blanket escape — an EMPTY tail on manual is still refused, same exit code", () => {
    const planSlug = createPlan();
    const taskSlug = createTask(planSlug);

    const result = runLore(
      ["evidence", taskSlug, "--oracle", "manual", "--command", "checked by hand", "--result", "pass"],
      tmpDir,
    );
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("--capture");
    expect(evidenceCount(taskSlug)).toBe(0);
  });

  it("STATE: a refused call writes NO evidence row; the --capture call that follows on the SAME task writes exactly one", () => {
    const planSlug = createPlan();
    const taskSlug = createTask(planSlug);

    const refused = runLore(
      ["evidence", taskSlug, "--oracle", "tsc", "--command", "echo ok", "--result", "pass", "--output-tail", "typecheck:core, typecheck:lore, ... all exit 0"],
      tmpDir,
    );
    expect(refused.exitCode).toBe(4);
    expect(evidenceCount(taskSlug)).toBe(0);

    const captured = runLore(
      ["evidence", taskSlug, "--oracle", "tsc", "--command", "echo ok", "--result", "pass", "--capture"],
      tmpDir,
    );
    expect(captured.exitCode).toBe(0);
    expect(evidenceCount(taskSlug)).toBe(1);
  });

  it("REGRESSION: --capture combined with a command that ACTUALLY fails still refuses on the exit-code mismatch (pre-existing behavior, untouched by this raise)", () => {
    const planSlug = createPlan();
    const taskSlug = createTask(planSlug);

    const result = runLore(
      ["evidence", taskSlug, "--oracle", "test", "--command", "exit 1", "--result", "pass", "--capture"],
      tmpDir,
    );
    expect(result.exitCode).toBe(4);
    expect(evidenceCount(taskSlug)).toBe(0);
  });

  it("ERROR: the refusal's message names --capture, not merely 'refused'", () => {
    const planSlug = createPlan();
    const taskSlug = createTask(planSlug);

    const result = runLore(
      ["evidence", taskSlug, "--oracle", "lint", "--command", "echo ok", "--result", "pass", "--output-tail", "0 problems"],
      tmpDir,
    );
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("--capture");
    expect(result.stderr).toContain("output_tail");
  });
});

/**
 * @spec_ref IoC vertical-slice tech-spec §4.1/§5.1/§11 — closed-loop e2e for the P2
 * gate slice's C2 state machine (task AC-P2-8): "authoring is free; every COMMIT
 * transition gates on real upstream corpus state."
 *
 * bun test (not vitest): spawns the real compiled `dist/lore` binary (rebuilt in P2 T5,
 * current) against a THROWAWAY corpus (`mkdtemp` + `lore init`, cwd inside it) —
 * mirrors `gate-config-disable.bun.test.ts`'s harness, which is the closest in-repo
 * template for full-binary subprocess gate tests.
 *
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule) — every
 * test operates inside its own `mkdtempSync` directory, and `dist/lore` runs with
 * `cwd` and `HOME` both pointed at that directory.
 *
 * Sequence under test (single narrative, matching the C2 state machine end to end):
 *   1. HAPPY   — create prd → spec (draft) → plan (draft) → task (draft): every
 *                `create` call exits 0. Authoring has no create-time gate on the
 *                downstream tiers (plan/task) — only `spec-create` gates spec
 *                *shape*, never plan/task creation.
 *   2. NEGATIVE — `gate plan-promote --plan <plan>` while the spec is still draft →
 *                exit 4 (UPSTREAM_NOT_APPROVED + UPSTREAM_NO_AC).
 *   3. NEGATIVE — `gate task-claim --task <task>` while the spec is still draft →
 *                exit 4 (UPSTREAM_NOT_APPROVED).
 *   4. STATE   — add ≥1 acceptance criterion (`lore ac add`) then approve the spec
 *                (`lore approve`).
 *   5. HAPPY   — `gate plan-promote --plan <plan>` now exits 0.
 *   6. HAPPY   — `gate task-claim --task <task>` now exits 0.
 *   7. BOUNDARY (optional, AC-P2-8 config brake) — on a SEPARATE draft-spec-parented
 *                plan/task fixture, writing `workflow.gates.task-claim.enabled: false`
 *                into `.lore/config.yaml` flips `task-claim`'s otherwise-blocking
 *                exit 4 to exit 0, while `plan-promote` (not disabled) still exits 4
 *                on the same unapproved ancestor spec — proving the two commit-time
 *                gates are independently configurable, not a single monolithic switch.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION (the same
 * ancestor spec is re-queried by both gates before and after approval and must agree).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "./helpers/assert-fresh-binary";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(PROJECT_ROOT, "dist", "lore");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Runs the compiled `dist/lore` binary directly (real e2e binary, not `bun run src/`). */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse slug from create output: ${stdout}`);
  }
  return slug;
}

/** Creates a PRD → spec (draft, no AC) → plan (draft) → task (draft) chain. */
function createFullChain(dir: string): {
  prdSlug: string;
  specSlug: string;
  planSlug: string;
  taskSlug: string;
} {
  const prdResult = runLore(
    ["create", "prd", "--title", "P2 E2E PRD", "--content", "PRD body.", "--no-ai"],
    dir,
  );
  expect(prdResult.exitCode).toBe(0);
  const prdSlug = parseSlug(prdResult.stdout);

  const specResult = runLore(
    [
      "create",
      "spec",
      "--title",
      "P2 E2E Spec",
      "--parent",
      prdSlug,
      "--content",
      "## Overview\n\nSpec body for the P2 closed-loop e2e.\n",
      "--no-ai",
    ],
    dir,
  );
  expect(specResult.exitCode).toBe(0);
  const specSlug = parseSlug(specResult.stdout);

  const planResult = runLore(
    ["create", "plan", "--title", "P2 E2E Plan", "--parent", specSlug, "--content", "Plan body.", "--no-ai"],
    dir,
  );
  expect(planResult.exitCode).toBe(0);
  const planSlug = parseSlug(planResult.stdout);

  const taskResult = runLore(
    [
      "create",
      "task",
      "--title",
      "P2 E2E Task",
      "--parent",
      planSlug,
      "--plan-id",
      planSlug,
      "--content",
      "Task body.",
      "--no-ai",
    ],
    dir,
  );
  expect(taskResult.exitCode).toBe(0);
  const taskSlug = parseSlug(taskResult.stdout);

  return { prdSlug, specSlug, planSlug, taskSlug };
}

/** Appends a `workflow.gates.<checkpoint>.enabled: false` override to `.lore/config.yaml`. */
function disableGateInConfig(dir: string, checkpoint: string): void {
  const cfgPath = join(dir, ".lore", "config.yaml");
  const existing = readFileSync(cfgPath, "utf8");
  const override = `\nworkflow:\n  gates:\n    "${checkpoint}":\n      enabled: false\n`;
  writeFileSync(cfgPath, existing + override, "utf8");
}

// ─── Project-level state ──────────────────────────────────────────────────────

let tmpDir: string;

// Fails loud (throws) if dist/lore is missing or older than the newest .ts source under
// packages/{lore,core}/src — this suite spawns the COMPILED binary directly (see `runLore`
// above), so a stale artifact would otherwise let the test silently validate old logic
// against new source. Computed once for the whole suite (AC3), not per-test.
beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(PROJECT_ROOT, "packages", "lore", "src"),
    join(PROJECT_ROOT, "packages", "core", "src"),
  ]);
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-p2-e2e-closed-loop-"));
  initCorpus(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ─── AC-P2-8: full closed-loop narrative ─────────────────────────────────────

describe("AC-P2-8: authoring is free, every COMMIT transition gates on real upstream corpus state", () => {
  it("walks prd → spec → plan → task creation (ungated) through both commit-time gates blocking-then-passing as the spec is approved", () => {
    // -- 1. HAPPY: authoring the full chain is never blocked --
    const { specSlug, planSlug, taskSlug } = createFullChain(tmpDir);

    // -- 2. NEGATIVE: plan-promote blocked while spec is draft (no AC either) --
    const planBlocked = runLore(["gate", "plan-promote", "--plan", planSlug], tmpDir);
    expect(planBlocked.exitCode).toBe(4);
    expect(planBlocked.stdout).toContain("UPSTREAM_NOT_APPROVED");
    expect(planBlocked.stdout).toContain("UPSTREAM_NO_AC");

    // -- 3. NEGATIVE: task-claim blocked while spec is draft --
    const taskBlocked = runLore(["gate", "task-claim", "--task", taskSlug], tmpDir);
    expect(taskBlocked.exitCode).toBe(4);
    expect(taskBlocked.stdout).toContain("UPSTREAM_NOT_APPROVED");

    // -- 4. STATE: add ≥1 AC, then approve the spec --
    const acResult = runLore(
      ["ac", "add", specSlug, "AC-P2-8-1", "--statement", "The gated behaviour works as declared.", "--mode", "human"],
      tmpDir,
    );
    expect(acResult.exitCode).toBe(0);

    const approveResult = runLore(["approve", specSlug], tmpDir);
    expect(approveResult.exitCode).toBe(0);
    expect(approveResult.stdout).toContain("approved");

    // -- 5. HAPPY: plan-promote now passes --
    const planPass = runLore(["gate", "plan-promote", "--plan", planSlug], tmpDir);
    expect(planPass.exitCode).toBe(0);
    expect(planPass.stdout).toContain("gate: pass");

    // -- 6. HAPPY: task-claim now passes (REGRESSION: agrees with plan-promote on the
    //    exact same ancestor spec transition) --
    const taskPass = runLore(["gate", "task-claim", "--task", taskSlug], tmpDir);
    expect(taskPass.exitCode).toBe(0);
    expect(taskPass.stdout).toContain("gate: pass");
  });

  // -- 7. BOUNDARY: per-checkpoint config disable flips task-claim's block to a pass,
  //    independently of plan-promote, on a fresh unapproved-spec fixture --
  it("workflow.gates.task-claim.enabled=false flips an otherwise-blocked task-claim to exit 0, while plan-promote (not disabled) still exits 4 on the same draft spec", () => {
    const { specSlug: _specSlug, planSlug, taskSlug } = createFullChain(tmpDir);

    disableGateInConfig(tmpDir, "task-claim");

    const taskDisabled = runLore(["gate", "task-claim", "--task", taskSlug], tmpDir);
    expect(taskDisabled.exitCode).toBe(0);
    expect(taskDisabled.stderr).toContain("task-claim disabled by config");

    const planStillBlocked = runLore(["gate", "plan-promote", "--plan", planSlug], tmpDir);
    expect(planStillBlocked.exitCode).toBe(4);
    expect(planStillBlocked.stdout).toContain("UPSTREAM_NOT_APPROVED");
  });
});

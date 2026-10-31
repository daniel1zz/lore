// @spawns packages/lore/src/index.ts
/**
 * @spec_ref IoC vertical-slice tech-spec §4.1/§11 — `workflow.gates.<checkpoint>.enabled`
 * per-checkpoint gate config override (task AC-P2-7)
 *
 * bun test (not vitest): spawns the real `lore` CLI (`bun run src/index.ts`) against a
 * throwaway corpus (mkdtemp'd temp dir + `lore init`), mirroring
 * `gate-spec-create.bun.test.ts`'s harness. ⛔ Never touches the repo's own `.lore/`
 * corpus (project CLAUDE.md hard rule).
 *
 * Acceptance criterion under test (AC-P2-7):
 *   - LORE_GATE_BYPASS=1 → every one of the four checkpoints exits 0, even on an
 *     otherwise-failing input/target.
 *   - A config declaring `workflow.gates.task-claim.enabled: false` → `task-claim` exits
 *     0 EVEN WHEN its predicate would otherwise fail (unapproved ancestor spec), while
 *     `plan-promote` (not disabled) still exits 4 on the exact same failing ancestor spec.
 *   - Precedence: LORE_GATE_BYPASS=1 beats a per-checkpoint `enabled:false`; both beat the
 *     checkpoint's own predicates; absent `workflow.gates` config gates normally
 *     (backward compatible).
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { sessionEnvFor } from "../helpers/session-actor";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";

import { ensureRequirementsDocSlug } from "../helpers/parented-create.js";
// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Run `bun run src/index.ts ...args` in `cwd`. HOME is overridden to isolate global config. */
function runLore(args: string[], cwd: string, extraEnv: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, ...extraEnv },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function makeTempDir(label: string): string {
  const dir = join(
    tmpdir(),
    `lore-gate-config-disable-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function initCorpus(tmpDir: string): void {
  const result = runLore(["init"], tmpDir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

/** Overwrites `.lore/config.yaml` with a project block plus the given `workflow.gates` map. */
function writeGatesConfig(tmpDir: string, gatesYaml: string): void {
  const config = ["project:", "  name: gate-config-disable-test", "  author: tester", "workflow:", "  gates:", gatesYaml].join(
    "\n",
  );
  patchLoreConfig(tmpDir, config, { replace: true });
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse slug from create output: ${stdout}`);
  }
  return slug;
}

/** Creates a PRD → spec (draft, no AC) → plan → task chain. Spec is left in "draft". */
function createSpecParentedPlanAndTask(tmpDir: string): {
  specSlug: string;
  planSlug: string;
  taskSlug: string;
} {
  const prdSlug = parseSlug(
    runLore(["create", "prd", "--title", "Gate Config Disable PRD", "--content", "PRD body.", "--no-ai"], tmpDir).stdout,
  );
  const specSlug = parseSlug(
    runLore(
      ["create", "spec", "--title", "Gate Config Disable Spec","--content", "## Overview\n\nBody.\n", "--no-ai"],
      tmpDir,
    ).stdout,
  );
  const planSlug = parseSlug(
    runLore(["create", "plan", "--title", "Gate Config Disable Plan", "--parent", specSlug, "--content", "Plan body.", "--no-ai"], tmpDir)
      .stdout,
  );
  const taskSlug = parseSlug(
    runLore(
      [
        "create",
        "task",
        "--kind",
        "code",
        "--title",
        "Gate Config Disable Task",
        "--parent",
        planSlug,
        "--plan-id",
        planSlug,
        "--content",
        "Task body.",
        "--no-ai",
      ],
      tmpDir,
    ).stdout,
  );
  return { specSlug, planSlug, taskSlug };
}

// ─── Project-level state ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = makeTempDir("suite");
  initCorpus(tmpDir);
});

afterEach(() => {
  cleanupDir(tmpDir);
});

// ─── AC-P2-7 (STATE): LORE_GATE_BYPASS=1 → every checkpoint exits 0 ──────────

describe("AC-P2-7: LORE_GATE_BYPASS=1 forces every checkpoint to exit 0", () => {
  it("spec-create exits 0 for a non-compliant candidate under bypass", () => {
    const result = runLore(
      ["gate", "spec-create", "--input-json", JSON.stringify({ type: "spec", title: "x" })],
      tmpDir,
      { LORE_GATE_BYPASS: "1" },
    );
    expect(result.exitCode).toBe(0);
  });

  it("spec-promote exits 0 for a spec with zero acceptance criteria under bypass", () => {
    const prdSlug = parseSlug(
      runLore(["create", "prd", "--title", "Bypass PRD", "--content", "Body.", "--no-ai"], tmpDir).stdout,
    );
    const specSlug = parseSlug(
      runLore(
        ["create", "spec", "--title", "Bypass Spec","--content", "## Overview\n\nBody.\n", "--no-ai"],
        tmpDir,
      ).stdout,
    );

    const result = runLore(["gate", "spec-promote", "--spec", specSlug], tmpDir, { LORE_GATE_BYPASS: "1" });
    expect(result.exitCode).toBe(0);
  });

  it("plan-promote exits 0 for an unapproved ancestor spec under bypass", () => {
    const { planSlug } = createSpecParentedPlanAndTask(tmpDir);

    const result = runLore(["gate", "plan-promote", "--plan", planSlug], tmpDir, { LORE_GATE_BYPASS: "1" });
    expect(result.exitCode).toBe(0);
  });

  it("task-claim exits 0 for an unapproved ancestor spec under bypass", () => {
    const { taskSlug } = createSpecParentedPlanAndTask(tmpDir);

    const result = runLore(["gate", "task-claim", "--task", taskSlug], tmpDir, { LORE_GATE_BYPASS: "1" });
    expect(result.exitCode).toBe(0);
  });
});

// ─── AC-P2-7 (HAPPY + NEGATIVE + REGRESSION): per-checkpoint config disable ──

describe("AC-P2-7: workflow.gates.task-claim.enabled=false disables only task-claim", () => {
  it("task-claim exits 0 with a 'disabled by config' stderr note, while plan-promote (not disabled) still exits 4 on the same failing ancestor spec", () => {
    const { planSlug, taskSlug } = createSpecParentedPlanAndTask(tmpDir);
    writeGatesConfig(tmpDir, '    "task-claim":\n      enabled: false');

    const taskResult = runLore(["gate", "task-claim", "--task", taskSlug], tmpDir);
    expect(taskResult.exitCode).toBe(0);
    expect(taskResult.stderr).toContain("task-claim disabled by config");

    const planResult = runLore(["gate", "plan-promote", "--plan", planSlug], tmpDir);
    expect(planResult.exitCode).toBe(4);
  });

  it("BOUNDARY: enabled=true (explicit) still gates normally — task-claim exits 4 on an unapproved ancestor spec", () => {
    const { taskSlug } = createSpecParentedPlanAndTask(tmpDir);
    writeGatesConfig(tmpDir, '    "task-claim":\n      enabled: true');

    const taskResult = runLore(["gate", "task-claim", "--task", taskSlug], tmpDir);
    expect(taskResult.exitCode).toBe(4);
  });

  it("STATE: LORE_GATE_BYPASS=1 outranks a per-checkpoint enabled=false — no behavioral difference either way, both exit 0", () => {
    const { taskSlug } = createSpecParentedPlanAndTask(tmpDir);
    writeGatesConfig(tmpDir, '    "task-claim":\n      enabled: false');

    const result = runLore(["gate", "task-claim", "--task", taskSlug], tmpDir, { LORE_GATE_BYPASS: "1" });
    expect(result.exitCode).toBe(0);
    // reason: bypass short-circuits before config is even loaded (module header) — the
    // disabled-by-config stderr note must NOT appear, since the config path never runs.
    expect(result.stderr).not.toContain("disabled by config");
  });

  it("REGRESSION: a config with no workflow.gates key at all still gates task-claim normally", () => {
    const { taskSlug } = createSpecParentedPlanAndTask(tmpDir);
    // reason: `lore init` already wrote a minimal config.yaml with no workflow section —
    // this test intentionally does NOT call writeGatesConfig, exercising the pre-existing
    // (pre-this-feature) config shape.

    const result = runLore(["gate", "task-claim", "--task", taskSlug], tmpDir);
    expect(result.exitCode).toBe(4);
  });
});

// ─── SPEC-042 §Design Decisions D6: workflow.gates.task-claim.anchor_overlap.enabled ──
//
// Config-gating parity check between `lore claim` (service-layer GateEnforcer path,
// pinned at tests/unit/service/claim-anchor-gate.test.ts's identically-named STATE
// case) and `lore gate task-claim` (this pre-flight CLI command) — both must honor
// the SAME narrower sub-key, distinct from the whole-checkpoint
// `workflow.gates.task-claim.enabled` above.

/** Creates a top-level plan (no parent at all — no spec tier) plus two tasks under it declaring overlapping `--anchor` paths. */
function createTopLevelPlanWithOverlappingAnchorTasks(tmpDir: string): {
  planSlug: string;
  taskASlug: string;
  taskBSlug: string;
} {
  const planSlug = parseSlug(
    runLore(["create", "plan", "--parent", ensureRequirementsDocSlug((a) => runLore(a, tmpDir)), "--title", "Anchor Overlap Config Plan", "--content", "Plan body.", "--no-ai"], tmpDir)
      .stdout,
  );
  const taskASlug = parseSlug(
    runLore(
      [
        "create",
        "task",
        "--kind",
        "code",
        "--title",
        "Anchor Overlap Config Task A",
        "--parent",
        planSlug,
        "--plan-id",
        planSlug,
        "--anchor",
        "src/shared.ts",
        "--content",
        "Task body.",
        "--no-ai",
      ],
      tmpDir,
    ).stdout,
  );
  const taskBSlug = parseSlug(
    runLore(
      [
        "create",
        "task",
        "--kind",
        "code",
        "--title",
        "Anchor Overlap Config Task B",
        "--parent",
        planSlug,
        "--plan-id",
        planSlug,
        "--anchor",
        "src/shared.ts",
        "--content",
        "Task body.",
        "--no-ai",
      ],
      tmpDir,
    ).stdout,
  );
  return { planSlug, taskASlug, taskBSlug };
}

describe("SPEC-042 D6: workflow.gates.'task-claim'.anchor_overlap.enabled=false disables ONLY the anchor predicate, at the `lore gate task-claim` CLI seam", () => {
  it("NEGATIVE baseline: with the sub-key absent (default enabled), a fresh foreign overlapping sibling claim blocks — exit 4, ANCHOR_OVERLAP", () => {
    const { taskASlug, taskBSlug } = createTopLevelPlanWithOverlappingAnchorTasks(tmpDir);
    const claimResult = runLore(["claim", taskASlug, "--worktree", "gcd-wt-a"], tmpDir, sessionEnvFor("agent:a"));
    expect(claimResult.exitCode).toBe(0);

    const result = runLore(["gate", "task-claim", "--task", taskBSlug], tmpDir, sessionEnvFor("agent:b"));
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("ANCHOR_OVERLAP");
  });

  it("HAPPY: with the sub-key explicitly disabled, the SAME conflicting scenario passes — exit 0, gate: pass", () => {
    const { taskASlug, taskBSlug } = createTopLevelPlanWithOverlappingAnchorTasks(tmpDir);
    const claimResult = runLore(["claim", taskASlug, "--worktree", "gcd-wt-a"], tmpDir, sessionEnvFor("agent:a"));
    expect(claimResult.exitCode).toBe(0);

    writeGatesConfig(tmpDir, '    "task-claim":\n      anchor_overlap:\n        enabled: false');

    const result = runLore(["gate", "task-claim", "--task", taskBSlug], tmpDir, sessionEnvFor("agent:b"));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("gate: pass");
  });

  it("REGRESSION: disabling ONLY anchor_overlap does not also disable the whole-checkpoint upstream-approval check", () => {
    const { taskSlug } = createSpecParentedPlanAndTask(tmpDir); // unapproved ancestor spec
    writeGatesConfig(tmpDir, '    "task-claim":\n      anchor_overlap:\n        enabled: false');

    const result = runLore(["gate", "task-claim", "--task", taskSlug], tmpDir, sessionEnvFor("agent:a"));
    // reason: the task declares no anchors and has no sibling claims at all — the
    // anchor predicate would vacuously pass regardless of the sub-key. This assertion
    // is about upstreamApproved still firing (exit 4) even with anchor_overlap
    // disabled — the two predicates are independently gated (D6), not coupled.
    expect(result.exitCode).toBe(4);
    expect(result.stdout).toContain("UPSTREAM_NOT_APPROVED");
  });
});

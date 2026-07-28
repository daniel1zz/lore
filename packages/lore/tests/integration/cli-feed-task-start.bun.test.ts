/**
 * @spec_ref spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start
 *   §Design D1, D7; §Acceptance Criteria AC-070-7, AC-070-18.
 *
 * bun test (not vitest): spawns the real compiled `dist/lore` binary against a
 * THROWAWAY corpus (`mkdtemp` + `lore init`, cwd inside it) — mirrors
 * `p2-e2e-closed-loop.bun.test.ts`'s harness, the closest in-repo template for a
 * full-binary subprocess CLI test. ⛔ Never touches the repo's own `.lore/` corpus
 * (project CLAUDE.md hard rule) — every test operates inside its own `mkdtempSync`
 * directory, and `dist/lore` runs with `cwd` and `HOME` both pointed at it.
 *
 * `assertFreshBinary` fails loud if `dist/lore` is missing or older than the newest
 * `.ts` source under `packages/{lore,core}/src` — this suite spawns the COMPILED
 * binary directly, so a stale artifact would otherwise let the test silently
 * validate old logic against new source (`bun run build` first).
 *
 * Coverage dimensions:
 *   HAPPY      — AC-070-7: `lore feed task-start <task>` against a real corpus
 *                (spec with a declared script-mode AC + evidence + anchors + a
 *                fresh claim) prints all eight section headers with real data;
 *                `--json` emits the pack object with the exact eight section keys.
 *   NEGATIVE   — unresolvable task → exit 3.
 *   BOUNDARY   — missing positional → exit 2.
 *   STATE      — `workflow.task_feed.*` config override clips a section end to end.
 *   REGRESSION — `spec-create` / `session-resume` / `phase-start` outputs are
 *                unchanged after the table-driven dispatch refactor (SPEC-070 D1);
 *                `phase-start`'s HAPPY path additionally gets a full byte-for-byte
 *                text-output pin (AC-070-18, review finding F9 — previously only
 *                its error paths were regression-pinned here).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import yaml from "yaml";
import { assertFreshBinary } from "./helpers/assert-fresh-binary";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface TaskStartPackJson {
  task_id: string;
  sections: {
    objective: string;
    acceptance: string;
    constraints: string;
    boundaries: string;
    claim: string;
    plan_state: string;
    knowledge_pointers: string;
    handoff: string;
  };
  truncated: string[];
}

// ─── Paths ──────────────────────────────────────────────────────────────────

// tests/integration/ -> packages/lore/ -> packages/ -> repo root (4 levels up).
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(PROJECT_ROOT, "dist", "lore");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Runs the compiled `dist/lore` binary directly (real e2e binary, not `bun run src/`). */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, LORE_ACTOR: "agent:cli-feed-task-start-test" },
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

/**
 * Merges a `workflow: {...}` YAML fragment into `.lore/config.yaml`, one
 * `workflow.*` sub-key at a time (shallow merge over the top-level `workflow`
 * map). Parse-merge-rewrite rather than a raw string append: a second
 * top-level `workflow:` block appended as text produces a DUPLICATE mapping
 * key, which `js-yaml`/the `yaml` package rejects outright on load — this
 * function stays call-composable (createFullChain's M2 review-judgment
 * override below, plus this file's own STATE-test task_feed override, both
 * land in the SAME file without colliding).
 */
function appendWorkflowConfig(dir: string, yamlFragment: string): void {
  const cfgPath = join(dir, ".lore", "config.yaml");
  const existing = yaml.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
  const fragment = yaml.parse(yamlFragment) as { workflow?: Record<string, unknown> };
  const mergedWorkflow = {
    ...(existing["workflow"] as Record<string, unknown> | undefined),
    ...fragment.workflow,
  };
  writeFileSync(cfgPath, yaml.stringify({ ...existing, workflow: mergedWorkflow }), "utf8");
}

/** Creates a prd -> spec (1 declared script-mode AC, approved) -> plan -> task chain, with anchors + evidence + a fresh claim. */
function createFullChain(dir: string): {
  prdSlug: string;
  specSlug: string;
  planSlug: string;
  taskSlug: string;
} {
  const prdResult = runLore(
    ["create", "prd", "--title", "T1 E2E PRD", "--content", "PRD body.", "--no-ai"],
    dir,
  );
  expect(prdResult.exitCode).toBe(0);
  const prdSlug = parseSlug(prdResult.stdout);

  const specResult = runLore(
    [
      "create",
      "spec",
      "--title",
      "T1 E2E Spec",
      "--parent",
      prdSlug,
      "--content",
      "## Overview\n\nSpec body for the task-start e2e.\n",
      "--no-ai",
    ],
    dir,
  );
  expect(specResult.exitCode).toBe(0);
  const specSlug = parseSlug(specResult.stdout);

  const acResult = runLore(
    [
      "ac",
      "add",
      specSlug,
      "AC-T1-1",
      "--statement",
      "The task-start pack renders real corpus data end to end.",
      "--mode",
      "script",
      "--oracle",
      "test",
      "--command",
      "bun test",
    ],
    dir,
  );
  expect(acResult.exitCode).toBe(0);

  // SPEC-103 §Mechanisms M2 — `review-judgment` is a SEPARATE, ADDITIVE
  // checkpoint on `ReviewService.approve` for spec/adr docs (default
  // `judgment_required_types: ["spec","adr"]`) this fixture predates. The
  // spec approve below exists purely to make this suite's task-start pack
  // reachable end to end, not to exercise M2's own review-judgment
  // semantics, so disable M2 here — mirrors `gate-hooks.bun.test.ts`'s /
  // `gate-spec-promote.bun.test.ts`'s `judgment_required_types: []`
  // precedent.
  appendWorkflowConfig(dir, "\nworkflow:\n  review:\n    judgment_required_types: []\n");

  const approveResult = runLore(["approve", specSlug], dir);
  expect(approveResult.exitCode).toBe(0);

  const planResult = runLore(
    ["create", "plan", "--title", "T1 E2E Plan", "--parent", specSlug, "--content", "Plan body.", "--no-ai"],
    dir,
  );
  expect(planResult.exitCode).toBe(0);
  const planSlug = parseSlug(planResult.stdout);

  const taskResult = runLore(
    [
      "create",
      "task",
      "--title",
      "T1 E2E Task",
      "--parent",
      planSlug,
      "--plan-id",
      planSlug,
      "--content",
      "Estimate: M\nApproach: exercise the task-start pack.",
      "--anchor",
      "packages/lore/src/flows/task-feed-flow.ts",
      "--no-ai",
    ],
    dir,
  );
  expect(taskResult.exitCode).toBe(0);
  const taskSlug = parseSlug(taskResult.stdout);

  const failEvidence = runLore(
    [
      "evidence",
      taskSlug,
      "--oracle",
      "test",
      "--command",
      "bun test",
      "--result",
      "fail",
      "--output-tail",
      "1 failing test — see stack trace",
    ],
    dir,
  );
  expect(failEvidence.exitCode).toBe(0);

  const passEvidence = runLore(
    ["evidence", taskSlug, "--oracle", "test", "--command", "bun test", "--result", "pass", "--ac", "AC-T1-1"],
    dir,
  );
  expect(passEvidence.exitCode).toBe(0);

  const claimResult = runLore(
    ["claim", taskSlug, "--by", "agent:cli-feed-task-start-test", "--worktree", "/tmp/t1-worktree"],
    dir,
  );
  expect(claimResult.exitCode).toBe(0);

  return { prdSlug, specSlug, planSlug, taskSlug };
}

/**
 * Creates a prd -> plan -> ONE task chain, then migrates that task into a phase doc
 * via `lore migrate tasks-to-phases` (the ONLY way a `phase` doc comes to exist —
 * see root CLAUDE.md's SPEC-056 entry) — deliberately NO spec ancestor, so the
 * resulting phase-start pack's `scope` section is fully deterministic
 * ("(no spec ancestor)", never a spec title/content slice that could drift or hit
 * a char budget). One-per-task fallback grouping (no `extra.phase` declared) means
 * the created phase doc's title equals the source task's own title verbatim
 * (`PhaseMigrationService.buildGroups`'s `solo:` branch).
 */
function createPhaseChain(dir: string): { planSlug: string; phaseSlug: string; taskTitle: string; planTitle: string } {
  const prdResult = runLore(
    ["create", "prd", "--title", "AC-070-18 Phase PRD", "--content", "PRD body.", "--no-ai"],
    dir,
  );
  expect(prdResult.exitCode).toBe(0);
  const prdSlug = parseSlug(prdResult.stdout);

  const planTitle = "AC-070-18 Phase Plan";
  const planResult = runLore(
    ["create", "plan", "--title", planTitle, "--parent", prdSlug, "--content", "Plan body.", "--no-ai"],
    dir,
  );
  expect(planResult.exitCode).toBe(0);
  const planSlug = parseSlug(planResult.stdout);

  const taskTitle = "AC-070-18 Phase Task";
  const taskResult = runLore(
    [
      "create",
      "task",
      "--title",
      taskTitle,
      "--parent",
      planSlug,
      "--plan-id",
      planSlug,
      "--content",
      "Estimate: S\nApproach: migrate this task into a phase doc.",
      "--no-ai",
    ],
    dir,
  );
  expect(taskResult.exitCode).toBe(0);

  const migrateResult = runLore(["migrate", "tasks-to-phases"], dir);
  expect(migrateResult.exitCode).toBe(0);

  const listResult = runLore(["list", "--type", "phase", "--json"], dir);
  expect(listResult.exitCode).toBe(0);
  const listPayload = JSON.parse(listResult.stdout) as { data: { docs: Array<{ slug: string }> } };
  const phaseSlug = listPayload.data.docs[0]?.slug;
  if (phaseSlug === undefined) {
    throw new Error(`no phase doc found after migration: ${listResult.stdout}`);
  }

  return { planSlug, phaseSlug, taskTitle, planTitle };
}

// ─── Project-level state ──────────────────────────────────────────────────────

let tmpDir: string;

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(PROJECT_ROOT, "packages", "lore", "src"),
    join(PROJECT_ROOT, "packages", "core", "src"),
  ]);
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-feed-task-start-"));
  initCorpus(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ─── AC-070-7: HAPPY — full end-to-end pack ─────────────────────────────────

describe("HAPPY — lore feed task-start <task> against a real corpus (AC-070-7)", () => {
  it("prints all eight section headers with real data, exit 0", () => {
    const { specSlug, planSlug, taskSlug } = createFullChain(tmpDir);

    const result = runLore(["feed", "task-start", taskSlug], tmpDir);

    expect(result.exitCode).toBe(0);
    for (const header of [
      "## Objective",
      "## Acceptance",
      "## Constraints",
      "## Boundaries",
      "## Claim",
      "## Plan state",
      "## Linked knowledge",
      "## Latest handoff",
    ]) {
      expect(result.stdout).toContain(header);
    }

    // objective: task/plan/spec pointers + task content verbatim
    expect(result.stdout).toContain("T1 E2E Task");
    expect(result.stdout).toContain(planSlug);
    expect(result.stdout).toContain(specSlug);
    expect(result.stdout).toContain("exercise the task-start pack");

    // acceptance: declared AC id + its script command + a pass coverage badge
    expect(result.stdout).toContain("AC-T1-1");
    expect(result.stdout).toContain("command: bun test");
    expect(result.stdout).toContain("[pass]");

    // constraints: the fail-evidence entry, oracle+command+tail
    expect(result.stdout).toContain("[test] bun test");
    expect(result.stdout).toContain("1 failing test");

    // boundaries: the declared anchor + the fixed scoped-oracle discipline line
    expect(result.stdout).toContain("packages/lore/src/flows/task-feed-flow.ts");
    expect(result.stdout).toContain("Oracle scope (SCOPED ONLY");

    // claim: the fresh claim holder
    expect(result.stdout).toContain("agent:cli-feed-task-start-test");
    expect(result.stdout).toContain("(fresh)");

    // knowledge_pointers / handoff: nothing linked in this fixture
    expect(result.stdout).toContain("no linked knowledge");
    expect(result.stdout).toContain("no handoff recorded");
  });

  it("--json emits the pack object with the exact eight section keys, and plan_state carries this task's own fresh-claim session", () => {
    const { taskSlug } = createFullChain(tmpDir);

    const result = runLore(["feed", "task-start", taskSlug, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);

    const pack = JSON.parse(result.stdout) as TaskStartPackJson;
    expect(pack.task_id).toBe(taskSlug);
    expect(Object.keys(pack.sections).sort()).toEqual(
      [
        "acceptance",
        "boundaries",
        "claim",
        "constraints",
        "handoff",
        "knowledge_pointers",
        "objective",
        "plan_state",
      ].sort(),
    );
    expect(Array.isArray(pack.truncated)).toBe(true);

    // plan_state: this task's own fresh claim surfaces as a session, keyed by
    // (by, worktree) — asserted precisely here (unlike the plain-text HAPPY
    // test above, which cannot isolate this section from the objective
    // header's own slug mention).
    expect(pack.sections.plan_state).toContain("agent:cli-feed-task-start-test");
    expect(pack.sections.plan_state).toContain(taskSlug);
    expect(pack.sections.plan_state).toContain("no anchor conflicts");
  });
});

// ─── NEGATIVE — unresolvable task ──────────────────────────────────────────

describe("NEGATIVE — an unresolvable task target exits 3", () => {
  it("exits 3 with a DOC_NOT_FOUND-shaped error", () => {
    const result = runLore(["feed", "task-start", "no-such-task-at-all"], tmpDir);
    expect(result.exitCode).toBe(3);
  });
});

// ─── BOUNDARY — missing positional ─────────────────────────────────────────

describe("BOUNDARY — a missing task positional exits 2", () => {
  it("exits 2 naming the required task ID/slug", () => {
    const result = runLore(["feed", "task-start"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("requires a task document ID or slug");
  });
});

// ─── STATE — workflow.task_feed.* config override clips a section end to end ──

describe("STATE — workflow.task_feed.* config override clips the objective section end to end", () => {
  it("a tiny max_objective_chars override truncates the objective section and records it in truncated[]", () => {
    const { taskSlug } = createFullChain(tmpDir);
    appendWorkflowConfig(tmpDir, "\nworkflow:\n  task_feed:\n    max_objective_chars: 20\n");

    const result = runLore(["feed", "task-start", taskSlug, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);

    const pack = JSON.parse(result.stdout) as TaskStartPackJson;
    expect(pack.sections.objective.length).toBeLessThanOrEqual(20);
    expect(pack.truncated).toContain("objective");
  });
});

// ─── REGRESSION — spec-create / session-resume / phase-start unchanged (AC-070-7) ──

describe("REGRESSION — spec-create / session-resume / phase-start outputs are unchanged after the table-driven dispatch refactor", () => {
  it("spec-create with no approved skill still prints the one-line note, exit 0", () => {
    const result = runLore(["feed", "spec-create"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("no approved governing skill for spec");
  });

  it("session-resume with no handoff recorded still prints '(no handoff recorded)', exit 0", () => {
    const result = runLore(["feed", "session-resume"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("(no handoff recorded)");
  });

  it("phase-start with a missing positional still exits 2 naming a phase document ID or slug", () => {
    const result = runLore(["feed", "phase-start"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("requires a phase document ID or slug");
  });

  it("phase-start with an unresolvable target still exits 3 (unchanged error-mapping path)", () => {
    const result = runLore(["feed", "phase-start", "no-such-phase-at-all"], tmpDir);
    expect(result.exitCode).toBe(3);
  });

  it("phase-start HAPPY path pins the FULL text output byte-for-byte (AC-070-18 — previously only its error paths were pinned)", () => {
    const { phaseSlug, taskTitle, planTitle } = createPhaseChain(tmpDir);

    const result = runLore(["feed", "phase-start", phaseSlug], tmpDir);
    expect(result.exitCode).toBe(0);

    // Mirrors `renderPhaseStartPackText`'s exact `console.log` call sequence
    // (commands/feed.ts) — each call appends its own trailing "\n".
    const scope = `Phase: ${taskTitle}\nPlan: ${planTitle}\n\n(no spec ancestor)`;
    const logCalls = [
      `# Phase start — ${phaseSlug}\n`,
      "## Scope",
      scope,
      "\n## Sibling phases",
      "(no other phases)",
      "\n## Linked knowledge",
      "(no linked knowledge)",
      "\n## Latest handoff",
      "(no handoff recorded)",
    ];
    const expected = logCalls.map((line) => line + "\n").join("");

    expect(result.stdout).toBe(expected);
  });

  it("an unknown checkpoint still falls through to the generic advisory note, exit 0", () => {
    const result = runLore(["feed", "totally-unknown-checkpoint"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("unknown checkpoint: totally-unknown-checkpoint");
  });
});

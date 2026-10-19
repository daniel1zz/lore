// @reads assets/project/lore-config-template.yaml
// @reads assets/governance/write-spec-rule.md
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
 *                its error paths were regression-pinned here). Additionally
 *                (spec-context-provenance-injected-corpus-global-state-and-a
 *                §Design Decisions D3, AC-CP-4, task
 *                task-t3-scope-closure-on-the-resume-ticket-cli-stdout-and-mcp):
 *                `lore feed session-resume` CLI stdout carries the exported
 *                `RESUME_SCOPE_CLOSURE` constant verbatim (identity) once a real
 *                handoff ticket is found via the ORDINARY derivation path (no
 *                `--handoff` flag), and `spec-create`/`phase-start` output stays
 *                closure-free — this is the CLI-stdout half of AC-CP-4's
 *                "both surfaces" requirement (MCP half:
 *                `tests/unit/adapters/mcp-session-tools.test.ts`; pure
 *                render-function mechanics:
 *                `tests/unit/flows/feed-flow-resume-closure.test.ts`).
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import yaml from "yaml";
import { BOOTSTRAP_RESUME_CLOSURE_KEYS, RESUME_SCOPE_CLOSURE } from "@lore/core";
import { FEED_PHASE_START_MISSING_TARGET, FEED_TASK_START_MISSING_TARGET } from "../../src/adapters/cli/cli-refusal-messages.js";
import { citeSpecViaAsyncCli, asyncLoreRunnerFor } from "../helpers/cli-live-rule.js";
import { sessionActorFor, withSessionIdentity } from "../helpers/session-actor";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Runs the compiled `dist/lore` binary directly (real e2e binary, not `bun run src/`). */
/** `actor` names the writer through the session tier (no write command takes `--by`). */
async function runLore(args: string[], cwd: string, actor: string | null = "cli-feed-task-start-test"): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: withSessionIdentity({ ...process.env, HOME: cwd }, actor) as Record<string, string>,
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

async function initCorpus(dir: string): Promise<void> {
  const result = await runLore(["init"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
  // reason: `lore init` seeds the approved write-spec rule document (DC2-5); this suite's cases govern a spec by a skill
  // doc it creates itself (and one asserts the no-skill note), so the seed is soft-deleted (a deleted doc governs nothing).
  const dropped = await runLore(["delete", "knowledge-write-spec-rules-gate-feeding-source", "--confirm"], dir);
  if (dropped.exitCode !== 0) throw new Error(`could not drop the init seed: ${dropped.stderr}`);
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
  patchLoreConfig(dir, yamlFragment);
}

/** Creates a prd -> spec (1 declared script-mode AC, approved) -> plan -> task chain, with anchors + evidence + a fresh claim. */
async function createFullChain(dir: string): Promise<{
  prdSlug: string;
  specSlug: string;
  planSlug: string;
  taskSlug: string;
}> {
  const prdResult = await runLore(
    ["create", "prd", "--title", "T1 E2E PRD", "--content", "PRD body.", "--no-ai"],
    dir,
  );
  expect(prdResult.exitCode).toBe(0);
  const prdSlug = parseSlug(prdResult.stdout);

  const specResult = await runLore(
    [
      "create",
      "spec",
      "--title",
      "T1 E2E Spec",
      "--content",
      "## Overview\n\nSpec body for the task-start e2e.\n",
      "--no-ai",
    ],
    dir,
  );
  expect(specResult.exitCode).toBe(0);
  const specSlug = parseSlug(specResult.stdout);

  const acResult = await runLore(
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

  await citeSpecViaAsyncCli(asyncLoreRunnerFor(runLore, dir), dir, undefined, specSlug, "AC-T1-1"); // BR-1007: approvable only when a criterion cites a live rule
  const approveResult = await runLore(["approve", specSlug], dir);
  expect(approveResult.exitCode).toBe(0);

  const planResult = await runLore(
    ["create", "plan", "--title", "T1 E2E Plan", "--parent", specSlug, "--content", "Plan body.", "--no-ai"],
    dir,
  );
  expect(planResult.exitCode).toBe(0);
  const planSlug = parseSlug(planResult.stdout);

  const taskResult = await runLore(
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
      // reason: spec-declaring-ac-scope-is-required-at-task-creation-so-the —
      // this plan's spec declares a script-mode AC (AC-T1-1), so task-create's
      // admission gate now requires ac_scope to be declared. Matches the
      // criterion this fixture's evidence calls reference below.
      "--ac-scope",
      "AC-T1-1",
    ],
    dir,
  );
  expect(taskResult.exitCode).toBe(0);
  const taskSlug = parseSlug(taskResult.stdout);

  const failEvidence = await runLore(
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

  // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-predicate-
  // to-its-own) — "test" self-report is now refused regardless of tail
  // content; "manual" is the one oracle that still lets a genuinely
  // non-empty self-reported tail succeed. This fixture only needs a
  // successful pass row referencing AC-T1-1, not a specific oracle kind.
  const passEvidence = await runLore(
    ["evidence", taskSlug, "--oracle", "manual", "--command", "bun test", "--result", "pass", "--ac", "AC-T1-1", "--output-tail", "ok"],
    dir,
  );
  expect(passEvidence.exitCode).toBe(0);

  const claimResult = await runLore(
    ["claim", taskSlug, "--worktree", "/tmp/t1-worktree"],
    dir,
  );
  expect(claimResult.exitCode).toBe(0);

  return { prdSlug, specSlug, planSlug, taskSlug };
}

/**
 * Creates a bare plan + a fast-tracked handoff against it (via the CLI `lore handoff`
 * writer, SPEC-041) — the minimal fixture needed to exercise `lore feed
 * session-resume`'s FOUND branch (spec-context-provenance-injected-corpus-global-state-and-a
 * D3 scope-closure block). Returns the plan/handoff slugs for assertion use.
 */
async function createHandoffChain(dir: string): Promise<{ planSlug: string; handoffSlug: string }> {
  const planResult = await runLore(
    ["create", "plan", "--title", "T3 Resume Plan", "--content", "Plan body.", "--no-ai"],
    dir,
  );
  expect(planResult.exitCode).toBe(0);
  const planSlug = parseSlug(planResult.stdout);

  const handoffResult = await runLore(
    [
      "handoff",
      "--plan",
      planSlug,
      "--file",
      "a.ts",
      "--decision",
      "closure block verified@80",
      "--next",
      "confirm the CLI stdout closure",
    ],
    dir,
    "alice",
  );
  expect(handoffResult.exitCode).toBe(0);
  const handoffSlug = parseSlug(handoffResult.stdout);

  return { planSlug, handoffSlug };
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
async function createPhaseChain(dir: string): Promise<{ planSlug: string; phaseSlug: string; taskTitle: string; planTitle: string }> {
  const prdResult = await runLore(
    ["create", "prd", "--title", "AC-070-18 Phase PRD", "--content", "PRD body.", "--no-ai"],
    dir,
  );
  expect(prdResult.exitCode).toBe(0);
  const prdSlug = parseSlug(prdResult.stdout);

  const planTitle = "AC-070-18 Phase Plan";
  const planResult = await runLore(
    ["create", "plan", "--title", planTitle, "--parent", prdSlug, "--content", "Plan body.", "--no-ai"],
    dir,
  );
  expect(planResult.exitCode).toBe(0);
  const planSlug = parseSlug(planResult.stdout);

  const taskTitle = "AC-070-18 Phase Task";
  const taskResult = await runLore(
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

  const migrateResult = await runLore(["migrate", "tasks-to-phases"], dir);
  expect(migrateResult.exitCode).toBe(0);

  const listResult = await runLore(["list", "--type", "phase", "--json"], dir);
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

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-feed-task-start-"));
  await initCorpus(tmpDir);
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
  it("prints all eight section headers with real data, exit 0", async () => {
    const { specSlug, planSlug, taskSlug } = await createFullChain(tmpDir);

    const result = await runLore(["feed", "task-start", taskSlug], tmpDir);

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

    // acceptance: declared AC id + its script command + a pass coverage badge.
    // A single self-reported pass with zero falsified evidence renders
    // "pass_unfalsified", not plain "pass" (spec-oracle-tier-falsifiability-a-
    // criterion-never-observed-red M1, AC-FALS-2) — this AC was never observed
    // able to go red.
    expect(result.stdout).toContain("AC-T1-1");
    expect(result.stdout).toContain("command: bun test");
    expect(result.stdout).toContain("[pass_unfalsified]");

    // constraints: the fail-evidence entry, oracle+command+tail
    expect(result.stdout).toContain("[test] bun test");
    expect(result.stdout).toContain("1 failing test");

    // boundaries: the declared anchor + the fixed scoped-oracle discipline line
    expect(result.stdout).toContain("packages/lore/src/flows/task-feed-flow.ts");
    expect(result.stdout).toContain("Oracle scope (SCOPED ONLY");

    // claim: the fresh claim holder
    expect(result.stdout).toContain(sessionActorFor("cli-feed-task-start-test"));
    expect(result.stdout).toContain("(fresh)");

    // knowledge_pointers / handoff: nothing linked in this fixture
    expect(result.stdout).toContain("no linked knowledge");
    expect(result.stdout).toContain("no handoff recorded");
  });

  it("--json emits the pack object with the exact eight section keys, and plan_state carries this task's own fresh-claim session", async () => {
    const { taskSlug } = await createFullChain(tmpDir);

    const result = await runLore(["feed", "task-start", taskSlug, "--json"], tmpDir);
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
    expect(pack.sections.plan_state).toContain(sessionActorFor("cli-feed-task-start-test"));
    expect(pack.sections.plan_state).toContain(taskSlug);
    expect(pack.sections.plan_state).toContain("no anchor conflicts");
  });
});

// ─── NEGATIVE — unresolvable task ──────────────────────────────────────────

describe("NEGATIVE — an unresolvable task target exits 3", () => {
  it("exits 3 with a DOC_NOT_FOUND-shaped error", async () => {
    const result = await runLore(["feed", "task-start", "no-such-task-at-all"], tmpDir);
    expect(result.exitCode).toBe(3);
  });
});

// ─── BOUNDARY — missing positional ─────────────────────────────────────────

describe("BOUNDARY — a missing task positional exits 2", () => {
  it("exits 2 naming the required task ID/slug", async () => {
    const result = await runLore(["feed", "task-start"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(FEED_TASK_START_MISSING_TARGET);
  });
});

// ─── STATE — workflow.task_feed.* config override clips a section end to end ──

describe("STATE — workflow.task_feed.* config override clips the objective section end to end", () => {
  it("a tiny max_objective_chars override truncates the objective section and records it in truncated[]", async () => {
    const { taskSlug } = await createFullChain(tmpDir);
    appendWorkflowConfig(tmpDir, "\nworkflow:\n  task_feed:\n    max_objective_chars: 20\n");

    const result = await runLore(["feed", "task-start", taskSlug, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);

    const pack = JSON.parse(result.stdout) as TaskStartPackJson;
    expect(pack.sections.objective.length).toBeLessThanOrEqual(20);
    expect(pack.truncated).toContain("objective");
  });
});

// ─── REGRESSION — spec-create / session-resume / phase-start unchanged (AC-070-7) ──

describe("REGRESSION — spec-create / session-resume / phase-start outputs are unchanged after the table-driven dispatch refactor", () => {
  it("spec-create with no approved skill still prints the one-line note, exit 0", async () => {
    const result = await runLore(["feed", "spec-create"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("no approved governing skill for spec");
  });

  it("session-resume with no handoff recorded still prints '(no handoff recorded)', exit 0", async () => {
    const result = await runLore(["feed", "session-resume"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("(no handoff recorded)");
  });

  it("phase-start with a missing positional still exits 2 naming a phase document ID or slug", async () => {
    const result = await runLore(["feed", "phase-start"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(FEED_PHASE_START_MISSING_TARGET);
  });

  it("phase-start with an unresolvable target still exits 3 (unchanged error-mapping path)", async () => {
    const result = await runLore(["feed", "phase-start", "no-such-phase-at-all"], tmpDir);
    expect(result.exitCode).toBe(3);
  });

  it("phase-start HAPPY path pins the FULL text output byte-for-byte (AC-070-18 — previously only its error paths were pinned)", async () => {
    const { phaseSlug, taskTitle, planTitle } = await createPhaseChain(tmpDir);

    const result = await runLore(["feed", "phase-start", phaseSlug], tmpDir);
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

  // reason: AC-FR-1 (task-derive-lore-feed-s-checkpoint-set-from-the-registry-
  // make) — an UNREGISTERED checkpoint name now exits EXACTLY 2, never the
  // pre-fix silent-success 0. `checkpointRegistry` (not the special-dispatch
  // table this file otherwise exercises) is the SSOT for this refusal.
  it("an unregistered checkpoint exits EXACTLY 2, never the pre-fix silent-success 0", async () => {
    const result = await runLore(["feed", "totally-unknown-checkpoint"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("totally-unknown-checkpoint");
  });

  it("REGRESSION (spec-context-provenance-injected-corpus-global-state-and-a#AC-CP-4, CLI stdout): the derivation-path call (no --handoff flag) carries RESUME_SCOPE_CLOSURE verbatim once a ticket is found", async () => {
    await createHandoffChain(tmpDir);

    // reason: no `--handoff <slug>` supplied — exercises the SAME newest-wins
    // derivation path the task's REGRESSION requirement names, not the direct
    // shortcut.
    const result = await runLore(["feed", "session-resume"], tmpDir);
    expect(result.exitCode).toBe(0);
    // reason: identity against the exported constant (D6), not a remembered
    // substring — the stdout literally ENDS with the constant (the module's
    // own `renderResumeFeed` invariant: closure is always the last block).
    expect(result.stdout.endsWith(RESUME_SCOPE_CLOSURE + "\n")).toBe(true);
    for (const key of BOOTSTRAP_RESUME_CLOSURE_KEYS) {
      expect(RESUME_SCOPE_CLOSURE.includes(key)).toBe(true);
    }
  });

  it("REGRESSION (spec-context-provenance-injected-corpus-global-state-and-a#AC-CP-4): spec-create / phase-start / an unknown checkpoint stay closure-free even once a resume ticket exists in the same corpus", async () => {
    await createHandoffChain(tmpDir);

    const specCreate = await runLore(["feed", "spec-create"], tmpDir);
    expect(specCreate.stdout.includes(RESUME_SCOPE_CLOSURE)).toBe(false);

    const phaseStart = await runLore(["feed", "phase-start"], tmpDir);
    expect(phaseStart.stderr.includes(RESUME_SCOPE_CLOSURE)).toBe(false);

    const unknown = await runLore(["feed", "totally-unknown-checkpoint"], tmpDir);
    expect(unknown.stdout.includes(RESUME_SCOPE_CLOSURE)).toBe(false);
  }, 30_000);
});

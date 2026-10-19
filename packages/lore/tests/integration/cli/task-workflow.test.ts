// @spawns packages/lore/src/index.ts
/**
 * Integration tests for `lore claim` / `lore release` / `lore evidence` / `lore ready`
 * CLI subcommands (SPEC-025). Runs the real CLI via subprocess against an isolated
 * temp SQLite DB — same pattern as tests/integration/cli/phase.test.ts.
 *
 * Scope: translation-only (args → service call → exit code / JSON shape). Business
 * rules (CLAIM_CONFLICT precedence, staleness math, evidence cap) are exhaustively
 * covered at the service layer (tests/unit/service/task-workflow-service.test.ts) —
 * this file does not re-test them, per SPEC-025 §7 "do not re-test business rules
 * at three layers".
 *
 * Coverage:
 *   HAPPY:      claim / evidence / release all exit 0 with expected stdout
 *   NEGATIVE:   claim conflict → exit 5; non-holder release → exit 5
 *   BOUNDARY:   ready --json flat shape (AC-WF-8, D9 — array of records, not
 *               grouped by phase in the JSON payload)
 *   STATE:      claim → evidence → release changes reflected in tree/list badges
 *   REGRESSION: n/a here (see service-level suite)
 *
 * @spec_ref AC-WF-1 AC-WF-3 AC-WF-4 AC-WF-6 AC-WF-7 AC-WF-8 AC-WF-9
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { join } from "path";
import { tmpdir } from "os";
import { AC_REF_NOT_ON_PARENT_SPEC } from "../../../src/service/ac-ref-messages.js";
import { sessionActorFor, withSessionIdentity } from "../../helpers/session-actor.js";

// ─── Path setup ───────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

// ─── RunResult type ───────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir.
 * MOCK RISK: none — this calls the real CLI binary path.
 */
/**
 * `actor` names the writer through the SESSION tier (no write command takes `--by`); `null` leaves the writer
 * unnamed (OS-user fallback). Ambient identity sources are always stripped.
 */
function runLore(args: string[], cwd: string, actor: string | null = null): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: withSessionIdentity({ ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" }, actor) as Record<string, string>,
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

/**
 * Disables all five `lore gate` service-layer checkpoints for this fixture's corpus
 * (retro follow-up item 8 test-fallout reconciliation — GateEnforcer is now wired ON
 * by default in every production `createApp`, which every subprocess-spawned `lore`
 * command in this file goes through). None of this file's ACs exercise spec-create/
 * task-claim gating itself — the AC-ACODE-3 evidence tests need `createSpec`'s fixed
 * "body" content to succeed as pure scaffolding for the plan→spec `ac_ref` chain, and
 * several claim/release tests deliberately need `claim` to succeed on an UNAPPROVED
 * spec-parented plan chain (translation-only scope per this file's own header —
 * business rules like task-claim upstream-approval are exhaustively covered at the
 * service/CLI-gate layers elsewhere, not re-tested here). Mirrors the config shape
 * `tests/integration/gate-config-disable.bun.test.ts` establishes
 * (`workflow.gates.<checkpoint>.enabled`, `@lore/core::resolveGateEnabled`).
 *
 * `task-create` (spec-declaring-ac-scope-is-required-at-task-creation-so-the)
 * joins this list for the SAME reason: the AC-ACODE-3 evidence fixtures declare
 * a script-mode AC on their spec specifically so `--ac`/`--ac-ref` cross-entity
 * validation has something to reference, but their `createTask` calls
 * deliberately omit `--ac-scope` (that flag is this file's own, unrelated
 * concern — declared-scope authoring has its own dedicated coverage,
 * `create-task-ac-scope.test.ts`). Without this, those fixture tasks would
 * refuse at creation with `AC_SCOPE_REQUIRED`, unrelated to what each test
 * actually exercises.
 */
function disableAllGates(dir: string): void {
  patchLoreConfig(
    dir,
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

// ─── Fixture helpers ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `lore-wf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed: ${init.stderr}`);
  }
  disableAllGates(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

function createPlan(title: string, parentSlug?: string): string {
  const args = ["create", "plan", "--title", title, "--no-ai", "--content", "body"];
  if (parentSlug !== undefined) args.push("--parent", parentSlug);
  const r = runLore(args, tmpDir);
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract plan slug from: ${r.stdout}`);
  return slug;
}

/** Create a root PRD and return its slug (specs require a prd parent). */
function createPrd(title: string): string {
  const r = runLore(["create", "prd", "--title", title, "--no-ai", "--content", "body"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract prd slug from: ${r.stdout}`);
  return slug;
}

/** Create a spec under the given prd parent and return its slug. */
function createSpec(title: string, parentSlug: string): string {
  const r = runLore(
    ["create", "spec", "--title", title,"--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract spec slug from: ${r.stdout}`);
  return slug;
}

/**
 * Declare a script-mode acceptance criterion on a spec via `lore ac add` (SPEC-038 §4).
 * Required so `lore evidence --ac <id>` on a task under a plan parented by this spec
 * resolves against a non-empty declared-id set (TaskWorkflowService.addEvidence's
 * cross-entity ac_ref validation, SPEC-038 §7 D4) instead of being fail-loud rejected.
 */
function declareAc(specSlug: string, acId: string): void {
  const r = runLore(
    [
      "ac",
      "add",
      specSlug,
      acId,
      "--statement",
      "The CLI accepts and threads --ac through to evidence.",
      "--mode",
      "script",
      "--oracle",
      "tsc",
      "--command",
      "bun run typecheck",
    ],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`lore ac add failed: ${r.stderr}`);
}

function createTask(planSlug: string, title: string): string {
  const r = runLore(
    ["create", "task", "--title", title, "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract task slug from: ${r.stdout}`);
  return slug;
}

// ─── HAPPY — lore claim ───────────────────────────────────────────────────────

describe("lore claim — HAPPY", () => {
  it("AC-WF-3.CLI.H1: exit 0 and confirms the claim under the session-tier name", () => {
    const planSlug = createPlan("Workflow Plan");
    const taskSlug = createTask(planSlug, "Claimable Task");

    const result = runLore(["claim", taskSlug], tmpDir, "alice");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Claimed");
    expect(result.stdout).toContain(sessionActorFor("alice"));
  });

  it("AC-WF-3.CLI.H2: --json output has doc.extra.claim.by", () => {
    const planSlug = createPlan("Workflow Plan JSON");
    const taskSlug = createTask(planSlug, "Claimable Task JSON");

    const result = runLore(["claim", taskSlug, "--json"], tmpDir, "alice");

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; data?: { doc?: { extra?: Record<string, unknown> } } };
    expect(parsed.ok).toBe(true);
    expect((parsed.data?.doc?.extra?.["claim"] as { by?: string } | undefined)?.by).toBe(sessionActorFor("alice"));
  });
});

// ─── NEGATIVE — lore claim: conflict ──────────────────────────────────────────

describe("lore claim — NEGATIVE", () => {
  it("AC-WF-3.CLI.N1: fresh claim by another actor → exit 5 (CLAIM_CONFLICT)", () => {
    const planSlug = createPlan("Conflict Plan");
    const taskSlug = createTask(planSlug, "Contested Task");

    runLore(["claim", taskSlug], tmpDir, "alice");
    const result = runLore(["claim", taskSlug], tmpDir, "bob");

    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain(sessionActorFor("alice"));
  });

  it("AC-WF-4.CLI.N2: --steal overrides a fresh claim and succeeds (exit 0)", () => {
    const planSlug = createPlan("Steal Plan");
    const taskSlug = createTask(planSlug, "Stealable Task");

    runLore(["claim", taskSlug], tmpDir, "alice");
    const result = runLore(["claim", taskSlug, "--steal"], tmpDir, "bob");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(sessionActorFor("bob"));
  });

  it("AC-WF-3.CLI.N3: non-existent task slug → exit 3 (DOC_NOT_FOUND)", () => {
    const result = runLore(["claim", "task-does-not-exist"], tmpDir, "alice");
    expect(result.exitCode).toBe(3);
  });
});

// ─── HAPPY / NEGATIVE — lore release ──────────────────────────────────────────

describe("lore release", () => {
  it("AC-WF-6.CLI.H1: release by the holder → exit 0", () => {
    const planSlug = createPlan("Release Plan");
    const taskSlug = createTask(planSlug, "Released Task");

    runLore(["claim", taskSlug], tmpDir, "alice");
    const result = runLore(["release", taskSlug], tmpDir, "alice");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Released");
  });

  it("AC-WF-6.CLI.N1: release by a non-holder without --force → exit 5 (CLAIM_CONFLICT)", () => {
    const planSlug = createPlan("Release Conflict Plan");
    const taskSlug = createTask(planSlug, "Guarded Task");

    runLore(["claim", taskSlug], tmpDir, "alice");
    const result = runLore(["release", taskSlug], tmpDir, "bob");

    expect(result.exitCode).toBe(5);
  });

  it("AC-WF-6.CLI.N2: release by a non-holder WITH --force → exit 0", () => {
    const planSlug = createPlan("Release Force Plan");
    const taskSlug = createTask(planSlug, "Forcibly Released Task");

    runLore(["claim", taskSlug], tmpDir, "alice");
    const result = runLore(["release", taskSlug, "--force"], tmpDir, "bob");

    expect(result.exitCode).toBe(0);
  });
});

// ─── HAPPY / NEGATIVE — lore evidence ─────────────────────────────────────────

describe("lore evidence", () => {
  it("AC-WF-1.CLI.H1: exit 0 and appends an oracle record, visible via lore log", () => {
    const planSlug = createPlan("Evidence Plan");
    const taskSlug = createTask(planSlug, "Evidenced Task");

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — "tsc" self-report is now refused regardless of
    // tail content; "manual" is the one oracle that still lets a genuinely
    // non-empty self-reported tail succeed via the real CLI. This test only
    // checks that an oracle record appends and is visible via `lore log`.
    const result = runLore(
      [
        "evidence",
        taskSlug,
        "--oracle",
        "manual",
        "--command",
        "bun run typecheck",
        "--result",
        "pass",
        "--output-tail",
        "ok",
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("manual");

    const log = runLore(["log", taskSlug], tmpDir);
    expect(log.exitCode).toBe(0);
    expect(log.stdout.toLowerCase()).toContain("evidence");
  });

  it("AC-WF-1.CLI.N1: --output-tail and --output-tail-file together → exit 2 (argument error)", () => {
    const planSlug = createPlan("Evidence Arg Plan");
    const taskSlug = createTask(planSlug, "Arg Task");

    const result = runLore(
      [
        "evidence",
        taskSlug,
        "--oracle",
        "tsc",
        "--command",
        "cmd",
        "--result",
        "pass",
        "--output-tail",
        "abc",
        "--output-tail-file",
        "/tmp/does-not-matter",
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(2);
  });

  it("AC-WF-2.CLI.N2: invalid --result value → exit 4 (VALIDATION_ERROR)", () => {
    const planSlug = createPlan("Evidence Invalid Plan");
    const taskSlug = createTask(planSlug, "Invalid Result Task");

    const result = runLore(
      ["evidence", taskSlug, "--oracle", "tsc", "--command", "cmd", "--result", "maybe"],
      tmpDir,
    );

    expect(result.exitCode).toBe(4);
  });

  // ── SPEC-038 §4/§7 D3 — --ac flag threads ac_ref through to the service ──────
  // NOTE: this suite spawns the CLI as a subprocess, so the service call args
  // cannot be spied on from here. The adapter-boundary assertion (--ac parses
  // and lands on the EvidenceInput passed to TaskWorkflowService.addEvidence)
  // lives in tests/unit/adapters/cli-evidence-ac-ref.bun.test.ts (in-process,
  // same file as the rest of the flag-parsing tests). This test only confirms
  // the flag is accepted without an argument-parsing error (exit 0).

  it("AC-ACODE-3.CLI.H1: --ac <id> is accepted alongside the other required flags (exit 0)", () => {
    // The task's parent plan must itself be parented by a spec that has
    // declared the AC id (SPEC-038 §7 D4 cross-entity validation) — otherwise
    // TaskWorkflowService.addEvidence fail-loud rejects the ac_ref.
    const prdSlug = createPrd("Evidence AC PRD");
    const specSlug = createSpec("Evidence AC Spec", prdSlug);
    declareAc(specSlug, "AC-ACODE-8");
    const planSlug = createPlan("Evidence AC Plan", specSlug);
    const taskSlug = createTask(planSlug, "AC-Referencing Task");

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — "tsc" self-report is now refused before ever
    // reaching the --ac cross-entity validation this test means to exercise;
    // "manual" is the one oracle that still lets a genuinely non-empty
    // self-reported tail proceed.
    const result = runLore(
      [
        "evidence",
        taskSlug,
        "--oracle",
        "manual",
        "--command",
        "bun run typecheck",
        "--result",
        "pass",
        "--ac",
        "AC-ACODE-8",
        "--output-tail",
        "ok",
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("manual");
  });

  it("AC-ACODE-3.CLI.N4: --ac <undeclared-id> → exit 4 (VALIDATION_ERROR), no evidence written", () => {
    // Sibling NEGATIVE case to H1 above: same plan/spec chain, but the id
    // passed to --ac was never declared via `lore ac add` — must fail loud
    // rather than silently accepting an unverifiable ac_ref.
    const prdSlug = createPrd("Evidence AC Undeclared PRD");
    const specSlug = createSpec("Evidence AC Undeclared Spec", prdSlug);
    declareAc(specSlug, "AC-ACODE-8");
    const planSlug = createPlan("Evidence AC Undeclared Plan", specSlug);
    const taskSlug = createTask(planSlug, "AC-Undeclared-Referencing Task");

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — see AC-ACODE-3.CLI.H1's identical supersession
    // above; "manual" lets the call reach the --ac cross-entity validation
    // this test means to exercise.
    const result = runLore(
      [
        "evidence",
        taskSlug,
        "--oracle",
        "manual",
        "--command",
        "bun run typecheck",
        "--result",
        "pass",
        "--ac",
        "AC-DOES-NOT-EXIST",
        "--output-tail",
        "ok",
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("ac_ref");
    expect(result.stderr).toContain(AC_REF_NOT_ON_PARENT_SPEC);
  });

  it("AC-ACODE-3.CLI.REG1: omitting --ac leaves ac_ref absent (existing no-flag behavior unchanged)", () => {
    const planSlug = createPlan("Evidence No-AC Plan");
    const taskSlug = createTask(planSlug, "No-AC Task");

    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — "tsc" self-report is now refused; "manual" is
    // the one oracle that still lets a genuinely non-empty self-reported
    // tail succeed. This test only checks ac_ref absence, not oracle-kind
    // semantics.
    const result = runLore(
      ["evidence", taskSlug, "--oracle", "manual", "--command", "cmd", "--result", "pass", "--output-tail", "ok", "--json"],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: { doc?: { extra?: { verification_evidence?: Array<{ ac_ref?: string }> } } };
    };
    const entries = parsed.data?.doc?.extra?.verification_evidence ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0]?.ac_ref).toBeUndefined();
  });
});

// ─── lore ready — BOUNDARY (flat JSON shape, AC-WF-8/D9) ─────────────────────

describe("lore ready — JSON shape", () => {
  it("AC-WF-8.CLI.J1: --json produces the full ReadyReport under data.ready, records is a flat array (D9 — no phase nesting; SPEC-042 D7 wraps records/sessions/anchor_conflicts)", () => {
    const planSlug = createPlan("Ready JSON Plan");
    createTask(planSlug, "Task One");
    createTask(planSlug, "Task Two");

    const result = runLore(["ready", planSlug, "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: {
        ready?: {
          records?: Array<{ task?: { slug?: string }; ready?: boolean; unmet_blockers?: unknown[] }>;
          sessions?: unknown[];
          anchor_conflicts?: unknown[];
        };
      };
    };
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.data?.ready?.records)).toBe(true);
    expect(parsed.data?.ready?.records).toHaveLength(2);
    expect(Array.isArray(parsed.data?.ready?.sessions)).toBe(true);
    expect(Array.isArray(parsed.data?.ready?.anchor_conflicts)).toBe(true);
    // Flat shape: each record is a plain object with `task`, not grouped under a phase key.
    for (const record of parsed.data?.ready?.records ?? []) {
      expect(typeof record.task?.slug).toBe("string");
      expect(typeof record.ready).toBe("boolean");
      expect(Array.isArray(record.unmet_blockers)).toBe(true);
    }
  });

  it("AC-WF-7.CLI.J2: empty plan (no tasks) → data.ready is an empty ReadyReport, exit 0", () => {
    const planSlug = createPlan("Empty Ready Plan");

    const result = runLore(["ready", planSlug, "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: { ready?: { records?: unknown[]; sessions?: unknown[]; anchor_conflicts?: unknown[] } };
    };
    expect(parsed.ok).toBe(true);
    // task-a-mistyped-task-file-anchor-is-stored-and-consulted — the CLI is the
    // surface that DOES inject a filesystem probe, so an empty plan reports a
    // genuinely PROBED empty result (`probed: true`), not the "not probed" value
    // MCP/HTTP return. `root` is the spawned process's real cwd; its exact value
    // is pinned in `tests/unit/adapters/cli-anchor-resolution.bun.test.ts`
    // (macOS realpaths `/var` → `/private/var`), so this exhaustive-shape
    // assertion matches its type instead of its text.
    expect(parsed.data?.ready).toEqual({
      records: [],
      counts: { ready: 0, claimed: 0, archived: 0, total: 0 },
      sessions: [],
      anchor_conflicts: [],
      anchor_resolution: { probed: true, root: expect.any(String), unresolved: [] },
    });
  });

  it("AC-WF-7.CLI.N1: ready against a non-plan doc → exit 4 (VALIDATION_ERROR)", () => {
    const planSlug = createPlan("Wrong Type Plan");
    const taskSlug = createTask(planSlug, "Not A Plan");

    const result = runLore(["ready", taskSlug], tmpDir);
    expect(result.exitCode).toBe(4);
  });
});

// ─── lore tree / lore list — STATE (claim/evidence badges, AC-WF-9) ──────────

describe("lore tree / lore list — workflow badges (AC-WF-9)", () => {
  it("a claimed task shows a claimed: badge in `lore tree <plan>`", () => {
    const planSlug = createPlan("Badge Plan");
    const taskSlug = createTask(planSlug, "Badged Task");
    runLore(["claim", taskSlug], tmpDir, "alice");

    const result = runLore(["tree", planSlug], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`claimed:${sessionActorFor("alice")}`);
  });

  it("a task with passing evidence shows a ✔ badge in `lore list --type task`", () => {
    const planSlug = createPlan("Evidence Badge Plan");
    const taskSlug = createTask(planSlug, "Evidenced Badge Task");
    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — "tsc" self-report is now refused; "manual" is
    // the one oracle that still lets a genuinely non-empty self-reported
    // tail succeed. This test only checks the ✔ badge renders, not
    // oracle-kind semantics.
    runLore(
      ["evidence", taskSlug, "--oracle", "manual", "--command", "cmd", "--result", "pass", "--output-tail", "ok"],
      tmpDir,
    );

    const result = runLore(["list", "--type", "task"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("✔1");
  });
});

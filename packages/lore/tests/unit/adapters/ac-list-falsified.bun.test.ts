// @reads scripts/check-unclaimed-oracle.ts
/**
 * Adapter-wiring tests for the M1 surfacing task (spec-oracle-tier-falsifiability-
 * a-criterion-never-observed-red, AC-FALS-4/5/6/10) — proves `lore ac list`
 * (`commands/ac.ts`) and `lore status` (`commands/status.ts`) correctly SURFACE
 * `falsified`/`pass_unfalsified` (M1, `@lore/core`'s `computeAcCoverage`/
 * `deriveAcCoverageState`) and the M3 unclaimed-oracle check
 * (`scripts/check-unclaimed-oracle.ts`), rather than re-deriving any of it.
 *
 * Runner: bun:sqlite (real `SQLiteStore`, mkdtemp'd throwaway DB per test) — must
 * run under `bun test`, not vitest (`commands/ac.ts`/`commands/status.ts`
 * transitively import `bun:sqlite` via `loader.ts`/`app.ts`). ⛔ Never touches the
 * repo's own `.lore/` corpus (project CLAUDE.md hard rule) — every test seeds a
 * fresh `mkdtemp` corpus, and `process.chdir`s into it for the duration.
 *
 * Fixture docs are inserted DIRECTLY via a raw `SQLiteStore.insert()` (mirrors
 * `tests/unit/service/phase-migration.bun.test.ts`'s own `mustInsert` pattern) —
 * this sidesteps the `spec-create` gate entirely, which is correct here: these
 * tests exercise `ac.ts`/`status.ts`'s RENDERING/AGGREGATION logic over
 * already-declared corpus data, not the create-time gate itself. Structured ACs
 * are declared via the real `AcService.addCriterion` (not raw-inserted) so the
 * AC-quantifiability lint and schema validation run for real; evidence is
 * recorded via the real `TaskWorkflowService.addEvidence` for the same reason.
 *
 * CLI commands under test are invoked IN-PROCESS (never a spawned subprocess):
 * `commands/ac.ts`'s default export nests `list` under `subCommands.list`;
 * `commands/status.ts`'s default export is a flat command. Both run inside THIS
 * bun test process, so `import.meta.url`-relative resolution inside
 * `commands/status.ts::resolveUnclaimedOracleScriptPath` sees this worktree's
 * REAL `scripts/check-unclaimed-oracle.ts` on disk — the SAME "source entry"
 * mode that command's own JSDoc documents, never the compiled-binary branch.
 *
 * Six-dimension coverage, grouped by `-t`-selectable token (per the spec's own
 * declared oracle commands — `describe`/`it` titles below name each token
 * EXACTLY once so `--test-name-pattern <token>` selects exactly 1 test):
 *   json-surfacing  (AC-FALS-4)  — HAPPY + REGRESSION (fail state unaffected)
 *   human-render    (AC-FALS-5)  — HAPPY+NEGATIVE (bundled per the AC's own
 *                                  two-part statement) + BOUNDARY (zero-evidence
 *                                  "none" state carries no marker either)
 *   status-count    (AC-FALS-6)  — HAPPY (rises by exactly 1, exit code pinned)
 *                                  + BOUNDARY (zero criteria → count 0, exit 0)
 *                                  + REGRESSION (pre-existing --json fields intact)
 *   unclaimed-wiring (AC-FALS-10) — HAPPY (nonzero for unbound, zero for the
 *                                  SAME-file bound value) + ERROR (no fixture
 *                                  test files/declared commands at all → empty,
 *                                  available, exit 0, never a crash)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../../src/app.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { App } from "../../../src/app.js";
import type { DocRecord } from "@lore/core";
import { liveInvocation } from "../../live-invocation.js";
import type { Invocation } from "@lore/core";

// ─── Command type + in-process importers ────────────────────────────────────

type RunnableCommand = {
  run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void>;
};

async function importAcListCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/ac.js");
  const acCmd = mod.default as unknown as { subCommands: Record<string, RunnableCommand> };
  const listCmd = acCmd.subCommands["list"];
  if (listCmd === undefined) throw new Error("ac list subcommand not exported");
  return listCmd;
}

async function importStatusCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/status.js");
  const cmd = (mod as { default?: RunnableCommand }).default;
  if (cmd?.run === undefined) throw new Error("status command not exported");
  return cmd;
}

/** Captures every `console.log` call's raw first-argument string, in order, for the duration of one command invocation. */
function captureConsoleLog(): { lines: () => string[]; restore: () => void } {
  const original = console.log;
  const lines: string[] = [];
  console.log = ((...args: unknown[]) => {
    lines.push(args.length === 1 ? String(args[0]) : args.map((a) => String(a)).join(" "));
  }) as typeof console.log;
  return {
    lines: () => lines,
    restore: () => {
      console.log = original;
    },
  };
}

// ─── Fixture corpus setup ────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;
let dbPath: string;
let rawStore: SQLiteStore;

beforeEach(() => {
  process.exitCode = 0;
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-ac-list-falsified-test-")));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  dbPath = join(tmpDir, ".lore", "lore.db");
  rawStore = new SQLiteStore(dbPath);
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  // reason: AC-TG-6 — a command naming a missing test file renders `not_measured`; the fixtures' command
  // names this file, so it must exist under the cwd the CLI resolves against.
  writeFileSync(join(tmpDir, "fixture-one.test.ts"), "// fixture oracle file\n");
  writeFileSync(join(tmpDir, "fixture.test.ts"), "// fixture oracle file\n");
});

afterEach(() => {
  process.exitCode = 0;
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

const NOW = "2026-08-07T00:00:00.000Z";

async function mustInsert(doc: DocRecord): Promise<void> {
  const result = await rawStore.insert(doc);
  if (!result.ok) {
    throw new Error(`fixture insert failed for ${doc.slug}: ${JSON.stringify(result.error)}`);
  }
}

let idCounter = 0;
/** Monotonic 26-char pseudo-ULID, unique per fixture doc within one test run. */
function fixtureId(): string {
  idCounter += 1;
  return `01FALS${String(idCounter).padStart(20, "0")}`;
}

function specDoc(slug: string, title: string): DocRecord {
  return {
    id: fixtureId(),
    slug,
    type: "spec",
    role: "spec",
    title,
    // reason: a draft spec — these suites declare criteria on it through AcService after seeding, and
    // `ac add` on an approved (locked) spec is refused by the record-edit gate. Nothing here reads the status.
    status: "draft",
    priority: "medium",
    content: "## Overview\nFixture spec.\n## Scope\nFixture.\n## Acceptance Criteria\nSee lore ac list.",
    parent_id: null,
    created_at: NOW,
    updated_at: NOW,
    created_by: "fixture",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
}

function planDoc(slug: string, title: string, specId: string): DocRecord {
  return {
    id: fixtureId(),
    slug,
    type: "plan",
    role: "plan",
    title,
    status: "approved",
    priority: "medium",
    content: "Fixture plan.",
    parent_id: specId,
    created_at: NOW,
    updated_at: NOW,
    created_by: "fixture",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
}

function taskDoc(slug: string, title: string, planId: string): DocRecord {
  return {
    id: fixtureId(),
    slug,
    type: "task",
    role: "plan",
    title,
    status: "draft",
    priority: "medium",
    content: "Fixture task.",
    parent_id: planId,
    created_at: NOW,
    updated_at: NOW,
    created_by: "fixture",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: planId },
  };
}

/** Seeds a fresh spec + one child plan + one child task, returns their slugs/ids. */
async function seedSpecPlanTask(prefix: string): Promise<{
  specId: string;
  specSlug: string;
  planId: string;
  taskId: string;
  taskSlug: string;
}> {
  const spec = specDoc(`spec-${prefix}`, `Fixture spec (${prefix})`);
  await mustInsert(spec);
  const plan = planDoc(`plan-${prefix}`, `Fixture plan (${prefix})`, spec.id);
  await mustInsert(plan);
  const task = taskDoc(`task-${prefix}`, `Fixture task (${prefix})`, plan.id);
  await mustInsert(task);
  return { specId: spec.id, specSlug: spec.slug, planId: plan.id, taskId: task.id, taskSlug: task.slug };
}

async function withApp<T>(fn: (app: App) => Promise<T>): Promise<T> {
  const app = createApp(dbPath);
  try {
    return await fn(app);
  } finally {
    app.close();
  }
}

/**
 * `App.acService` is typed optional only to keep pre-existing hand-built App test
 * stubs compiling elsewhere (`commands/ac.ts::requireAcService`'s own JSDoc) —
 * `createApp` (this fixture's only App source) always wires a real one.
 */
function acService(app: App): NonNullable<App["acService"]> {
  if (app.acService === undefined) throw new Error("fixture error: AcService not wired on App");
  return app.acService;
}

// ─── AC-FALS-4: lore ac list --json coverage state + falsified field ────────

describe("lore ac list --json — falsified + coverage state (AC-FALS-4)", () => {
  it("HAPPY: json-surfacing — a criterion with pass evidence and zero falsified refs emits falsified:0 and state:pass_unfalsified in --json", async () => {
    const { specSlug, taskId } = await seedSpecPlanTask("json-happy");
    await withApp(async (app) => {
      const acResult = await acService(app).addCriterion(specSlug, {
        id: "AC-1",
        statement: "the coverage state reads pass_unfalsified when pass evidence exists and falsified equals zero",
        verify: { mode: "script", oracle: "test", command: "bunx vitest run fixture.test.ts" },
      });
      expect(acResult.ok).toBe(true);

      // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
      // predicate-to-its-own) — "test" self-report is now refused regardless
      // of tail content; "manual" is the one oracle that still lets a
      // genuinely non-empty self-reported tail succeed. This test only
      // checks deriveAcCoverageState's pass_unfalsified state, not oracle
      // semantics.
      const evResult = await app.taskWorkflowService.addEvidence(taskId, {
        oracle: "manual",
        command: "bunx vitest run fixture.test.ts",
        result: "pass",
        output_tail: "1 passed",
        recorded_by: "fixture",
        ac_ref: "AC-1",
        capture_source: "self-report",
      });
      expect(evResult.ok).toBe(true);
    });

    const listCmd = await importAcListCommand();
    const capture = captureConsoleLog();
    try {
      await listCmd.run({ args: { spec: specSlug, json: true }, inv: liveInvocation() });
    } finally {
      capture.restore();
    }

    const rawOutput = capture.lines().join("");
    const parsed = JSON.parse(rawOutput) as {
      ok: boolean;
      data: { coverage: Array<{ ac_id: string; falsified: number; state: string }> | null };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.coverage).not.toBeNull();
    const fact = parsed.data.coverage?.find((f) => f.ac_id === "AC-1");
    expect(fact?.falsified).toBe(0);
    expect(fact?.state).toBe("pass_unfalsified");
  });

  it("REGRESSION: a criterion with a real fail ref still emits state:fail in --json, unaffected by the new field", async () => {
    const { specSlug, taskId } = await seedSpecPlanTask("json-regression");
    await withApp(async (app) => {
      await acService(app).addCriterion(specSlug, {
        id: "AC-1",
        statement: "the coverage state reads fail when a fail ref exists, regardless of falsified",
        verify: { mode: "script", oracle: "test", command: "bunx vitest run fixture.test.ts" },
      });
      await app.taskWorkflowService.addEvidence(taskId, {
        oracle: "test",
        command: "bunx vitest run fixture.test.ts",
        result: "fail",
        output_tail: "1 failed",
        recorded_by: "fixture",
        ac_ref: "AC-1",
        capture_source: "self-report",
      });
    });

    const listCmd = await importAcListCommand();
    const capture = captureConsoleLog();
    try {
      await listCmd.run({ args: { spec: specSlug, json: true }, inv: liveInvocation() });
    } finally {
      capture.restore();
    }

    const parsed = JSON.parse(capture.lines().join("")) as {
      data: { coverage: Array<{ ac_id: string; falsified: number; state: string }> | null };
    };
    const fact = parsed.data.coverage?.find((f) => f.ac_id === "AC-1");
    expect(fact?.falsified).toBe(1);
    expect(fact?.state).toBe("fail");
  });
});

// ─── AC-FALS-5: lore ac list human table marker ─────────────────────────────

describe("lore ac list human table — pass_unfalsified marker (AC-FALS-5)", () => {
  it("HAPPY: human-render — a never-red criterion's line carries the pass_unfalsified marker, absent for a sibling criterion with one expected-fail ref", async () => {
    const { specSlug, taskId } = await seedSpecPlanTask("human-happy");
    await withApp(async (app) => {
      await acService(app).addCriterion(specSlug, {
        id: "AC-1",
        statement: "a criterion with only pass evidence and zero falsified refs is never-red",
        verify: { mode: "script", oracle: "test", command: "bunx vitest run fixture-one.test.ts" },
      });
      await acService(app).addCriterion(specSlug, {
        id: "AC-2",
        statement: "a criterion carrying one expected-fail ref has been observed able to go red",
        verify: { mode: "script", oracle: "test", command: "bunx vitest run fixture-two.test.ts" },
      });
      // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
      // predicate-to-its-own) — "test" self-report is now refused regardless
      // of tail content; "manual" is the one oracle that still lets a
      // genuinely non-empty self-reported tail succeed. This test only
      // checks the pass_unfalsified human-render marker, not oracle
      // semantics.
      await app.taskWorkflowService.addEvidence(taskId, {
        oracle: "manual",
        command: "bunx vitest run fixture-one.test.ts",
        result: "pass",
        output_tail: "1 passed",
        recorded_by: "fixture",
        ac_ref: "AC-1",
        capture_source: "self-report",
      });
      await app.taskWorkflowService.addEvidence(taskId, {
        oracle: "manual",
        command: "bunx vitest run fixture-two.test.ts",
        result: "pass",
        output_tail: "1 passed",
        recorded_by: "fixture",
        ac_ref: "AC-2",
        capture_source: "self-report",
      });
      await app.taskWorkflowService.addEvidence(taskId, {
        oracle: "test",
        command: "bunx vitest run fixture-two.test.ts",
        result: "expected-fail",
        output_tail: "RED-first pin",
        recorded_by: "fixture",
        ac_ref: "AC-2",
        capture_source: "self-report",
      });
    });

    const listCmd = await importAcListCommand();
    const capture = captureConsoleLog();
    try {
      await listCmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      capture.restore();
    }

    const lines = capture.lines();
    const ac1Line = lines.find((l) => l.includes("AC-1"));
    const ac2Line = lines.find((l) => l.includes("AC-2"));
    expect(ac1Line).toBeDefined();
    expect(ac2Line).toBeDefined();
    expect(ac1Line).toContain("[pass_unfalsified]");
    expect(ac2Line).not.toContain("[pass_unfalsified]");
  });

  it("BOUNDARY: a criterion with zero evidence at all (state none) carries no marker either", async () => {
    const { specSlug } = await seedSpecPlanTask("human-boundary");
    await withApp(async (app) => {
      await acService(app).addCriterion(specSlug, {
        id: "AC-1",
        statement: "a criterion declared with no oracle run yet renders the none state",
        verify: { mode: "script", oracle: "test", command: "bunx vitest run fixture-none.test.ts" },
      });
    });

    const listCmd = await importAcListCommand();
    const capture = captureConsoleLog();
    try {
      await listCmd.run({ args: { spec: specSlug }, inv: liveInvocation() });
    } finally {
      capture.restore();
    }

    const ac1Line = capture.lines().find((l) => l.includes("AC-1"));
    expect(ac1Line).toBeDefined();
    expect(ac1Line).not.toContain("[pass_unfalsified]");
  });
});

// ─── AC-FALS-6: lore status --json corpus-wide pass_unfalsified count ───────

describe("lore status --json — corpus-wide pass_unfalsified count (AC-FALS-6)", () => {
  it("HAPPY: status-count — the count rises by exactly 1 when one more never-red criterion is declared, and the exit code stays 0 both times", async () => {
    const { specSlug, taskId } = await seedSpecPlanTask("status-happy");
    await withApp(async (app) => {
      await acService(app).addCriterion(specSlug, {
        id: "AC-1",
        statement: "a first never-red criterion contributes one pass_unfalsified count",
        verify: { mode: "script", oracle: "test", command: "bunx vitest run fixture-first.test.ts" },
      });
      // reason: AC-EI-2 — a pass on a script AC whose oracle file does not exist is `not_measured`, not `pass_unfalsified`;
      // this test counts pass_unfalsified, so the declared oracle file must exist (cwd is the throwaway corpus).
      writeFileSync("fixture-first.test.ts", "// fixture oracle file\n");
      // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
      // predicate-to-its-own) — "test" self-report is now refused regardless
      // of tail content; "manual" is the one oracle that still lets a
      // genuinely non-empty self-reported tail succeed. This test only
      // checks the pass_unfalsified_count status field, not oracle
      // semantics.
      await app.taskWorkflowService.addEvidence(taskId, {
        oracle: "manual",
        command: "bunx vitest run fixture-first.test.ts",
        result: "pass",
        output_tail: "1 passed",
        recorded_by: "fixture",
        ac_ref: "AC-1",
        capture_source: "self-report",
      });
    });

    const statusCmd = await importStatusCommand();
    const capture1 = captureConsoleLog();
    try {
      await statusCmd.run({ args: { json: true }, inv: liveInvocation() });
    } finally {
      capture1.restore();
    }
    const firstExit = process.exitCode;
    const parsed1 = JSON.parse(capture1.lines().join("")) as { data: { pass_unfalsified_count: number } };
    const firstCount = parsed1.data.pass_unfalsified_count;
    expect(firstCount).toBe(1);
    expect(firstExit === 0 || firstExit === undefined).toBe(true);

    process.exitCode = 0;
    await withApp(async (app) => {
      await acService(app).addCriterion(specSlug, {
        id: "AC-2",
        statement: "a second never-red criterion contributes a second pass_unfalsified count",
        verify: { mode: "script", oracle: "test", command: "bunx vitest run fixture-second.test.ts" },
      });
      // reason: AC-EI-2 — a pass on a script AC whose oracle file does not exist is `not_measured`, not `pass_unfalsified`;
      // this test counts pass_unfalsified, so the declared oracle file must exist (cwd is the throwaway corpus).
      writeFileSync("fixture-second.test.ts", "// fixture oracle file\n");
      // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
      // predicate-to-its-own) — see this test's first evidence call above.
      await app.taskWorkflowService.addEvidence(taskId, {
        oracle: "manual",
        command: "bunx vitest run fixture-second.test.ts",
        result: "pass",
        output_tail: "1 passed",
        recorded_by: "fixture",
        ac_ref: "AC-2",
        capture_source: "self-report",
      });
    });

    const capture2 = captureConsoleLog();
    try {
      await statusCmd.run({ args: { json: true }, inv: liveInvocation() });
    } finally {
      capture2.restore();
    }
    const secondExit = process.exitCode;
    const parsed2 = JSON.parse(capture2.lines().join("")) as { data: { pass_unfalsified_count: number } };
    expect(parsed2.data.pass_unfalsified_count).toBe(firstCount + 1);
    expect(secondExit === 0 || secondExit === undefined).toBe(true);
  });

  it("BOUNDARY: a corpus with zero declared criteria reports pass_unfalsified_count:0 and exit code 0", async () => {
    const statusCmd = await importStatusCommand();
    const capture = captureConsoleLog();
    try {
      await statusCmd.run({ args: { json: true }, inv: liveInvocation() });
    } finally {
      capture.restore();
    }
    const exit = process.exitCode;
    const parsed = JSON.parse(capture.lines().join("")) as { data: { pass_unfalsified_count: number } };
    expect(parsed.data.pass_unfalsified_count).toBe(0);
    expect(exit === 0 || exit === undefined).toBe(true);
  });

  it("REGRESSION: pre-existing --json fields (ai_defaults, code_anchor_specs) remain present alongside the new field", async () => {
    const statusCmd = await importStatusCommand();
    const capture = captureConsoleLog();
    try {
      await statusCmd.run({ args: { json: true }, inv: liveInvocation() });
    } finally {
      capture.restore();
    }
    const parsed = JSON.parse(capture.lines().join("")) as {
      data: { ai_defaults: unknown; code_anchor_specs: unknown; pass_unfalsified_count: unknown };
    };
    expect(parsed.data.ai_defaults).toBeDefined();
    expect(parsed.data.code_anchor_specs).toBeDefined();
    expect(parsed.data.pass_unfalsified_count).toBeDefined();
  });
});

// ─── AC-FALS-10: lore status --json unclaimed-oracle findings ───────────────

describe("lore status --json — unclaimed-oracle findings (AC-FALS-10)", () => {
  it("HAPPY: unclaimed-wiring — reports the unbound token as a finding and reports zero findings for the bound token in the SAME test file, with exit code 0", async () => {
    const testFileRelPath = "packages/example/tests/unit/widget.test.ts";
    const testFileAbsDir = join(tmpDir, "packages", "example", "tests", "unit");
    mkdirSync(testFileAbsDir, { recursive: true });
    writeFileSync(
      join(testFileAbsDir, "widget.test.ts"),
      [
        'describe("Widget rendering — bound-token", () => {',
        '  it("renders the bound variant", () => {});',
        "});",
        "",
        'describe("Widget rendering — orphan-token", () => {',
        '  it("renders without crashing", () => {});',
        "});",
      ].join("\n"),
    );

    const { specSlug } = await seedSpecPlanTask("unclaimed-happy");
    await withApp(async (app) => {
      await acService(app).addCriterion(specSlug, {
        id: "AC-1",
        statement: "a declared AC command binds the bound-token test-name-pattern value",
        verify: { mode: "script", oracle: "test", command: `bunx vitest run ${testFileRelPath} -t bound-token` },
      });
    });

    const statusCmd = await importStatusCommand();
    const capture = captureConsoleLog();
    try {
      await statusCmd.run({ args: { json: true }, inv: liveInvocation() });
    } finally {
      capture.restore();
    }
    const exit = process.exitCode;
    const parsed = JSON.parse(capture.lines().join("")) as {
      data: {
        unclaimed_oracle: { available: boolean; findings: Array<{ file: string; value: string }> };
      };
    };

    expect(parsed.data.unclaimed_oracle.available).toBe(true);
    expect(parsed.data.unclaimed_oracle.findings).toContainEqual({
      file: testFileRelPath,
      value: "orphan-token",
    });
    expect(parsed.data.unclaimed_oracle.findings.some((f) => f.value === "bound-token")).toBe(false);
    expect(exit === 0 || exit === undefined).toBe(true);
  });

  it("ERROR: no fixture test files and no declared script commands at all yields an empty, available report and exit code 0 (never a crash)", async () => {
    const statusCmd = await importStatusCommand();
    const capture = captureConsoleLog();
    try {
      await statusCmd.run({ args: { json: true }, inv: liveInvocation() });
    } finally {
      capture.restore();
    }
    const exit = process.exitCode;
    const parsed = JSON.parse(capture.lines().join("")) as {
      data: { unclaimed_oracle: { available: boolean; findings: unknown[] } };
    };
    expect(parsed.data.unclaimed_oracle.available).toBe(true);
    expect(parsed.data.unclaimed_oracle.findings).toEqual([]);
    expect(exit === 0 || exit === undefined).toBe(true);
  });
});

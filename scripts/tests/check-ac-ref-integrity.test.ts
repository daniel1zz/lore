/**
 * Tests for `scripts/check-ac-ref-integrity.ts` (spec-lore-ac-set-in-place-edit-of-a-
 * declared-acceptance D7, AC-ACS-7): the corpus-wide dangling-`ac_ref` detector, its
 * pure resolution/ledger algorithm, and the real (mkdtemp + `lore init`) fixture proof
 * that the detector's assertion is actually LIVE — a detector that only ever runs
 * green is indistinguishable from one that measures nothing (AC-ACS-7's own text).
 *
 * Two halves, deliberately split by IO shape:
 *
 *   1. Pure algorithm suites (`resolveGoverningSpec`/`extractDeclaredAcIds`/
 *      `findDanglingRefs`/ledger) import directly from
 *      `../check-ac-ref-integrity-core.js` — that module has NO `bun:sqlite`
 *      dependency anywhere in its import graph (see its own header for why: the
 *      sibling `check-ac-ref-integrity.ts` IO shell imports `createApp`
 *      (`packages/lore/src/app.ts`), which top-level-imports `bun:sqlite`; a
 *      throwaway smoke test THIS task ran confirmed that importing that chain from a
 *      vitest-executed `.test.ts` file fails at module-resolve time — even behind a
 *      lazy `await import(...)` — with `Error: Cannot find package 'bun:sqlite'`).
 *
 *   2. The end-to-end fixture suite drives the REAL detector script + REAL `lore` CLI
 *      as subprocesses (mirrors `packages/lore/tests/integration/cli/task-workflow.test.ts`'s
 *      established `runLore` pattern) against a `mkdtemp` + `lore init` throwaway
 *      corpus — NEVER the repo's own `.lore/` (project CLAUDE.md's hard prohibition;
 *      see `packages/dashboard/tests/e2e/global-setup.ts` for the canonical
 *      "never pollute the live corpus" discipline this mirrors). The RED (seeded
 *      dangling ref) case is asserted BEFORE the GREEN (no dangling ref) case,
 *      per this task's verification discipline: a detector that cannot fail must be
 *      caught before it is trusted.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      resolveGoverningSpec walks task -> plan -> spec correctly; a
 *               declared ac_ref is never reported dangling; a valid ledger file
 *               parses; the e2e GREEN fixture exits 0; an applied exemption's
 *               reason reaches stdout via the real detector subprocess; an
 *               --adhoc task's non-empty ac_scope resolves via the SAME
 *               shared resolveGoverningSpecByAcScope the write path uses
 *   NEGATIVE:   an ac_ref absent from the governing spec's declared ids IS
 *               dangling; a task parented to a non-plan doc resolves no governing
 *               spec; a dangling ref with no matching ledger entry is newDangling;
 *               the e2e RED fixture exits non-zero and names the (task, ac_ref) pair;
 *               a truncated reason drops its trailing elaboration text; an
 *               --adhoc task's ac_scope matching ZERO specs is
 *               adhoc-scope-no-match
 *   BOUNDARY:   the SAME (task, ac_ref) pair from multiple evidence rows is
 *               deduped to exactly one DanglingRef; a spec with no
 *               extra.acceptance_criteria key at all yields an empty declared set;
 *               a dangling ref with specSlug===null can never be ledger-exempted;
 *               a reason at/one-over MAX_REASON_DISPLAY_CHARS; a deliberately long
 *               fixture reason (built, not assumed) still carries its version
 *               citation and merged/lost verdict past truncation; an EMPTY ledger
 *               against a clean corpus prints NO exemption lines (control); an
 *               --adhoc task's EXPLICIT EMPTY ac_scope ([], distinct from
 *               absent) never silently resolves (adhoc-scope-empty); an
 *               --adhoc task's ac_scope matching MULTIPLE specs
 *               (adhoc-scope-ambiguous) is a DISTINCT named outcome from
 *               adhoc-scope-no-match, never collapsed into one "no governing
 *               spec resolvable" bucket
 *   ERROR:      malformed ledger JSON throws AcRefLedgerError("invalid_json");
 *               schema-invalid ledger content (missing "reason") throws
 *               AcRefLedgerError("schema"); a task with no resolvable governing
 *               spec (null parent_id) still reports its dangling ac_ref; a
 *               non-boolean truthy extra.adhoc (e.g. the string "true") never
 *               takes the adhoc branch (strict === true guard)
 *   STATE:      an evidence row with NO ac_ref never contributes a finding
 *               alongside one that does, on the same task; a ledger entry whose
 *               (spec,id) no longer matches any real dangling ref is orphaned;
 *               findLedgerEntryForRef keys on the EXACT (spec,id) pair — a same-id
 *               entry for a different spec is never conflated with the right
 *               one; extra.adhoc === true selects the ac_scope branch
 *               regardless of whatever parent_id happens to be set to
 *   REGRESSION: the shipped scripts/ac-ref-exemption-ledger.json parses cleanly;
 *               findDanglingRefs output is deterministically sorted; a ledger
 *               entry matching no real dangling ref still exits 5 naming the stale
 *               row (unchanged wiring); all three REAL ledger reasons require
 *               truncation and keep their citation + verdict after it; a
 *               plan-bound task's structural walk is byte-identical to
 *               before this task's ad-hoc resolver fix
 *
 * @spec_ref task-check-ac-ref-integrity-re-implements-governing-spec (shared ad-hoc resolver)
 * @spec_ref spec-lore-ac-set-in-place-edit-of-a-declared-acceptance §D7, AC-ACS-7
 * @spec_ref adr-a-newly-armed-structural-oracle-enforces-from-a-baseline (ledger shape)
 * @spec_ref task-check-ac-ref-integrity-prints-an-exemption-count-not-its (exemption echo)
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveGoverningSpec,
  extractDeclaredAcIds,
  findDanglingRefs,
  checkAcRefLedger,
  parseAcRefLedgerFile,
  loadLedgerFromDisk,
  findLedgerEntryForRef,
  formatExemptionReasonForDisplay,
  MAX_REASON_DISPLAY_CHARS,
  AcRefLedgerError,
  LEDGER_RELATIVE_PATH,
  type AcRefLedgerEntry,
  type DanglingRef,
} from "../check-ac-ref-integrity-core.js";
import type { DocRecord, DocId } from "@lore/core";

// ─── Path setup ─────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const DETECTOR_SCRIPT = join(REPO_ROOT, "scripts", "check-ac-ref-integrity.ts");
const ACTOR = "agent:ac-ref-fixture-test";

// ─── Pure fixtures (no IO) ──────────────────────────────────────────────────

let _seq = 0;
function nextId(): DocId {
  _seq += 1;
  return `01HFIX${String(_seq).padStart(20, "0")}`;
}

function makeDoc(overrides: Partial<DocRecord> & { type: DocRecord["type"] }): DocRecord {
  const id = nextId();
  return {
    id,
    slug: `${overrides.type}-fixture-${id.slice(-4)}`,
    role: "plan",
    title: `Fixture ${overrides.type}`,
    status: "draft",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

// ─── Pure: resolveGoverningSpec / extractDeclaredAcIds ─────────────────────

describe("resolveGoverningSpec", () => {
  // ── Plan-bound branch (extra.adhoc !== true): structural task->plan->spec walk ──

  it("HAPPY: plan-bound task walks task -> plan -> plan's parent spec", () => {
    const spec = makeDoc({ type: "spec", parent_id: null });
    const plan = makeDoc({ type: "plan", parent_id: spec.id });
    const task = makeDoc({ type: "task", parent_id: plan.id, extra: { plan_id: plan.id } });
    const docsById = new Map([[plan.id, plan], [spec.id, spec]]);

    expect(resolveGoverningSpec(task, docsById, [spec])).toEqual({ spec, failureReason: null });
  });

  it("NEGATIVE: task's parent_id resolves to a non-plan doc -> structural-walk-failed", () => {
    const notAPlan = makeDoc({ type: "spec" });
    const task = makeDoc({ type: "task", parent_id: notAPlan.id });
    const docsById = new Map([[notAPlan.id, notAPlan]]);

    expect(resolveGoverningSpec(task, docsById, [])).toEqual({ spec: null, failureReason: "structural-walk-failed" });
  });

  it("NEGATIVE: plan's parent_id resolves to a non-spec doc -> structural-walk-failed", () => {
    const prd = makeDoc({ type: "prd" });
    const plan = makeDoc({ type: "plan", parent_id: prd.id });
    const task = makeDoc({ type: "task", parent_id: plan.id });
    const docsById = new Map([[prd.id, prd], [plan.id, plan]]);

    expect(resolveGoverningSpec(task, docsById, [])).toEqual({ spec: null, failureReason: "structural-walk-failed" });
  });

  it("BOUNDARY: non-adhoc task.parent_id === null -> structural-walk-failed", () => {
    const task = makeDoc({ type: "task", parent_id: null });
    expect(resolveGoverningSpec(task, new Map(), [])).toEqual({ spec: null, failureReason: "structural-walk-failed" });
  });

  it("BOUNDARY: plan.parent_id === null -> structural-walk-failed", () => {
    const plan = makeDoc({ type: "plan", parent_id: null });
    const task = makeDoc({ type: "task", parent_id: plan.id });
    const docsById = new Map([[plan.id, plan]]);

    expect(resolveGoverningSpec(task, docsById, [])).toEqual({ spec: null, failureReason: "structural-walk-failed" });
  });

  it("ERROR: task.parent_id references an id absent from docsById -> structural-walk-failed (never throws)", () => {
    const task = makeDoc({ type: "task", parent_id: "01HMISSINGPLANIDXXXXXX" });
    expect(() => resolveGoverningSpec(task, new Map(), [])).not.toThrow();
    expect(resolveGoverningSpec(task, new Map(), [])).toEqual({ spec: null, failureReason: "structural-walk-failed" });
  });

  // ── --adhoc branch: delegates to the SHARED resolveGoverningSpecByAcScope ──
  // (task-check-ac-ref-integrity-re-implements-governing-spec — this detector's
  // OWN prior copy of governing-spec resolution walked ONLY task->plan->spec,
  // so it returned null for every --adhoc task regardless of ac_scope. These
  // cases prove the fix calls the SAME resolver the write path
  // (TaskWorkflowService.addEvidence / CorpusService.resolveDeclaredAcIdsForAdhocTask)
  // already uses, rather than re-implementing a THIRD copy of the search.)

  it("HAPPY: an --adhoc task's non-empty ac_scope resolves via the SAME shared resolveGoverningSpecByAcScope the write path uses", () => {
    const spec = makeDoc({
      type: "spec",
      slug: "spec-governs-adhoc",
      extra: {
        acceptance_criteria: [
          { id: "AC-ADHOC-1", statement: "s", verify: { mode: "script", oracle: "test", command: "bun test" } },
        ],
      },
    });
    const task = makeDoc({ type: "task", parent_id: null, extra: { adhoc: true, ac_scope: ["AC-ADHOC-1"] } });

    expect(resolveGoverningSpec(task, new Map(), [spec])).toEqual({ spec, failureReason: null });
  });

  it("BOUNDARY: an --adhoc task with ABSENT ac_scope (flag never passed) -> adhoc-scope-absent, never silently resolved", () => {
    const spec = makeDoc({ type: "spec", extra: { acceptance_criteria: [] } });
    const task = makeDoc({ type: "task", parent_id: null, extra: { adhoc: true } });

    expect(resolveGoverningSpec(task, new Map(), [spec])).toEqual({ spec: null, failureReason: "adhoc-scope-absent" });
  });

  it('BOUNDARY (AC 4): an --adhoc task with the EXPLICIT EMPTY ac_scope ([], --ac-scope "") -> adhoc-scope-empty, never silently resolved', () => {
    const spec = makeDoc({
      type: "spec",
      extra: {
        acceptance_criteria: [
          { id: "AC-ANY", statement: "s", verify: { mode: "script", oracle: "test", command: "bun test" } },
        ],
      },
    });
    const task = makeDoc({ type: "task", parent_id: null, extra: { adhoc: true, ac_scope: [] } });

    // An empty scope is vacuously "covered" by every candidate spec -- must
    // NOT resolve to whichever spec happens to be first in allSpecs.
    expect(resolveGoverningSpec(task, new Map(), [spec])).toEqual({ spec: null, failureReason: "adhoc-scope-empty" });
  });

  it("NEGATIVE: an --adhoc task's ac_scope matching ZERO specs -> adhoc-scope-no-match", () => {
    const spec = makeDoc({
      type: "spec",
      extra: {
        acceptance_criteria: [
          { id: "AC-OTHER", statement: "s", verify: { mode: "script", oracle: "test", command: "bun test" } },
        ],
      },
    });
    const task = makeDoc({ type: "task", parent_id: null, extra: { adhoc: true, ac_scope: ["AC-NOWHERE"] } });

    expect(resolveGoverningSpec(task, new Map(), [spec])).toEqual({ spec: null, failureReason: "adhoc-scope-no-match" });
  });

  it("BOUNDARY (AC 5): an --adhoc task's ac_scope matching MULTIPLE specs -> adhoc-scope-ambiguous, a DISTINCT named outcome from adhoc-scope-no-match", () => {
    const specA = makeDoc({
      type: "spec",
      slug: "spec-a-covers-shared",
      extra: {
        acceptance_criteria: [
          { id: "AC-SHARED", statement: "s", verify: { mode: "script", oracle: "test", command: "bun test" } },
        ],
      },
    });
    const specB = makeDoc({
      type: "spec",
      slug: "spec-b-covers-shared",
      extra: {
        acceptance_criteria: [
          { id: "AC-SHARED", statement: "s2", verify: { mode: "script", oracle: "test", command: "bun test" } },
        ],
      },
    });
    const ambiguousTask = makeDoc({ type: "task", parent_id: null, extra: { adhoc: true, ac_scope: ["AC-SHARED"] } });
    const zeroMatchTask = makeDoc({ type: "task", parent_id: null, extra: { adhoc: true, ac_scope: ["AC-NOWHERE"] } });

    const ambiguousResult = resolveGoverningSpec(ambiguousTask, new Map(), [specA, specB]);
    const zeroMatchResult = resolveGoverningSpec(zeroMatchTask, new Map(), [specA, specB]);

    expect(ambiguousResult).toEqual({ spec: null, failureReason: "adhoc-scope-ambiguous" });
    // The core assertion of AC 5: these two refusal kinds are DISTINCT named
    // outcomes, never collapsed into one "no governing spec resolvable" fact.
    expect(zeroMatchResult.failureReason).toBe("adhoc-scope-no-match");
    expect(ambiguousResult.failureReason).not.toBe(zeroMatchResult.failureReason);
  });

  it('ERROR: a non-boolean truthy extra.adhoc (e.g. the string "true") never takes the adhoc branch (strict === true guard)', () => {
    const task = makeDoc({ type: "task", parent_id: null, extra: { adhoc: "true", ac_scope: ["AC-X"] } });
    // Falls through to the plan-bound branch (parent_id null there too) --
    // NOT adhoc-scope-absent, which would mean the loose value was accepted.
    expect(resolveGoverningSpec(task, new Map(), [])).toEqual({ spec: null, failureReason: "structural-walk-failed" });
  });

  it("STATE: extra.adhoc === true selects the ac_scope branch regardless of whatever parent_id happens to be set to", () => {
    const spec = makeDoc({
      type: "spec",
      extra: {
        acceptance_criteria: [
          { id: "AC-STATE-1", statement: "s", verify: { mode: "script", oracle: "test", command: "bun test" } },
        ],
      },
    });
    // parent_id points at a doc that doesn't even exist in docsById -- the
    // plan-bound walk would fail immediately, but the adhoc branch never
    // consults parent_id/docsById at all.
    const task = makeDoc({
      type: "task",
      parent_id: "01HSOMEUNRELATEDIDXXXX",
      extra: { adhoc: true, ac_scope: ["AC-STATE-1"] },
    });

    expect(resolveGoverningSpec(task, new Map(), [spec])).toEqual({ spec, failureReason: null });
  });
});

describe("extractDeclaredAcIds", () => {
  it("HAPPY: returns every declared criterion id", () => {
    const spec = makeDoc({
      type: "spec",
      extra: {
        acceptance_criteria: [
          { id: "AC-1", statement: "first", verify: { mode: "script", oracle: "test", command: "bun test" } },
          { id: "AC-2", statement: "second", verify: { mode: "human", note: "n/a" } },
        ],
      },
    });
    expect(extractDeclaredAcIds(spec)).toEqual(new Set(["AC-1", "AC-2"]));
  });

  it("BOUNDARY: no extra.acceptance_criteria key at all -> empty set", () => {
    const spec = makeDoc({ type: "spec", extra: {} });
    expect(extractDeclaredAcIds(spec)).toEqual(new Set());
  });

  it("ERROR: malformed extra.acceptance_criteria (not an array) never throws -> empty set", () => {
    const spec = makeDoc({ type: "spec", extra: { acceptance_criteria: "not-an-array" } });
    expect(() => extractDeclaredAcIds(spec)).not.toThrow();
    expect(extractDeclaredAcIds(spec)).toEqual(new Set());
  });
});

// ─── Pure: findDanglingRefs ─────────────────────────────────────────────────

describe("findDanglingRefs", () => {
  function harness() {
    const spec = makeDoc({
      type: "spec",
      slug: "spec-under-test",
      extra: { acceptance_criteria: [{ id: "AC-OK", statement: "declared", verify: { mode: "script", oracle: "test", command: "bun test" } }] },
    });
    const plan = makeDoc({ type: "plan", parent_id: spec.id });
    const docsById = new Map([[plan.id, plan], [spec.id, spec]]);
    return { spec, plan, docsById };
  }

  it("HAPPY: an evidence row referencing a DECLARED ac_ref is never dangling", () => {
    const { plan, docsById } = harness();
    const task = makeDoc({
      type: "task",
      slug: "task-happy",
      parent_id: plan.id,
      extra: {
        plan_id: plan.id,
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-OK" },
        ],
      },
    });
    expect(findDanglingRefs([task], docsById)).toEqual([]);
  });

  it("NEGATIVE: an evidence row referencing an UNDECLARED ac_ref is dangling, naming the governing spec", () => {
    const { spec, plan, docsById } = harness();
    const task = makeDoc({
      type: "task",
      slug: "task-negative",
      parent_id: plan.id,
      extra: {
        plan_id: plan.id,
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-GONE" },
        ],
      },
    });
    expect(findDanglingRefs([task], docsById)).toEqual([
      { taskId: task.id, taskSlug: "task-negative", acRef: "AC-GONE", specSlug: "spec-under-test", failureReason: null },
    ]);
  });

  it("BOUNDARY: the SAME dangling (task, ac_ref) pair across multiple evidence rows is deduped to ONE entry", () => {
    const { plan, docsById } = harness();
    const task = makeDoc({
      type: "task",
      slug: "task-dedup",
      parent_id: plan.id,
      extra: {
        plan_id: plan.id,
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-GONE" },
          { oracle: "e2e", command: "y", result: "fail", recorded_at: "2026-08-01T01:00:00.000Z", recorded_by: "a", ac_ref: "AC-GONE" },
        ],
      },
    });
    const result = findDanglingRefs([task], docsById);
    expect(result.length).toBe(1);
    expect(result[0]?.acRef).toBe("AC-GONE");
  });

  it("STATE: a row with no ac_ref never contributes a finding alongside a dangling one on the same task", () => {
    const { plan, docsById } = harness();
    const task = makeDoc({
      type: "task",
      slug: "task-mixed",
      parent_id: plan.id,
      extra: {
        plan_id: plan.id,
        verification_evidence: [
          { oracle: "tsc", command: "z", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a" },
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-GONE" },
        ],
      },
    });
    const result = findDanglingRefs([task], docsById);
    expect(result.length).toBe(1);
    expect(result[0]?.acRef).toBe("AC-GONE");
  });

  it("ERROR: a task with NO resolvable governing spec (null parent_id) still reports its ac_ref, with specSlug null", () => {
    const task = makeDoc({
      type: "task",
      slug: "task-orphaned",
      parent_id: null,
      extra: {
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-ANYTHING" },
        ],
      },
    });
    expect(findDanglingRefs([task], new Map())).toEqual([
      {
        taskId: task.id,
        taskSlug: "task-orphaned",
        acRef: "AC-ANYTHING",
        specSlug: null,
        failureReason: "structural-walk-failed",
      },
    ]);
  });

  it("REGRESSION: output is sorted deterministically by (taskSlug, acRef)", () => {
    const { plan, docsById } = harness();
    const taskB = makeDoc({
      type: "task",
      slug: "task-b",
      parent_id: plan.id,
      extra: { plan_id: plan.id, verification_evidence: [{ oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-GONE" }] },
    });
    const taskA = makeDoc({
      type: "task",
      slug: "task-a",
      parent_id: plan.id,
      extra: { plan_id: plan.id, verification_evidence: [{ oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-GONE" }] },
    });
    const result = findDanglingRefs([taskB, taskA], docsById);
    expect(result.map((r) => r.taskSlug)).toEqual(["task-a", "task-b"]);
  });

  // ── --adhoc tasks: the shared resolveGoverningSpecByAcScope reaching findDanglingRefs ──
  // (task-check-ac-ref-integrity-re-implements-governing-spec — these six rows are the
  // shape of the six real, previously-false-positive corpus rows this task fixes.)

  function adhocHarness() {
    const spec = makeDoc({
      type: "spec",
      slug: "spec-governs-adhoc-tasks",
      extra: {
        acceptance_criteria: [
          { id: "AC-ADHOC-OK", statement: "declared", verify: { mode: "script", oracle: "test", command: "bun test" } },
        ],
      },
    });
    // Only the spec goes into docsById -- an --adhoc task has NO plan in its
    // ancestry (SPEC-069 D2); findDanglingRefs derives its allSpecs candidate
    // list from docsById's spec-typed entries alone.
    const docsById = new Map([[spec.id, spec]]);
    return { spec, docsById };
  }

  it("HAPPY: an --adhoc task whose ac_scope resolves and whose evidence ac_ref IS declared is never dangling", () => {
    const { docsById } = adhocHarness();
    const task = makeDoc({
      type: "task",
      slug: "task-adhoc-happy",
      parent_id: null,
      extra: {
        adhoc: true,
        ac_scope: ["AC-ADHOC-OK"],
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-ADHOC-OK" },
        ],
      },
    });
    expect(findDanglingRefs([task], docsById)).toEqual([]);
  });

  it("REGRESSION: an --adhoc task whose ac_scope RESOLVES but whose evidence ac_ref is NOT declared by that spec is still dangling, naming the resolved spec", () => {
    const { spec, docsById } = adhocHarness();
    const task = makeDoc({
      type: "task",
      slug: "task-adhoc-undeclared",
      parent_id: null,
      extra: {
        adhoc: true,
        ac_scope: ["AC-ADHOC-OK"],
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-ADHOC-NEVER-DECLARED" },
        ],
      },
    });
    expect(findDanglingRefs([task], docsById)).toEqual([
      {
        taskId: task.id,
        taskSlug: "task-adhoc-undeclared",
        acRef: "AC-ADHOC-NEVER-DECLARED",
        specSlug: spec.slug,
        failureReason: null,
      },
    ]);
  });

  it("BOUNDARY (AC 4): an --adhoc task with an EXPLICIT EMPTY ac_scope plus an evidence ac_ref is dangling, not silently resolved", () => {
    const { docsById } = adhocHarness();
    const task = makeDoc({
      type: "task",
      slug: "task-adhoc-empty-scope",
      parent_id: null,
      extra: {
        adhoc: true,
        ac_scope: [],
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-ADHOC-OK" },
        ],
      },
    });
    expect(findDanglingRefs([task], docsById)).toEqual([
      {
        taskId: task.id,
        taskSlug: "task-adhoc-empty-scope",
        acRef: "AC-ADHOC-OK",
        specSlug: null,
        failureReason: "adhoc-scope-empty",
      },
    ]);
  });

  it("NEGATIVE: an --adhoc task whose ac_scope matches ZERO specs is dangling with adhoc-scope-no-match", () => {
    const { docsById } = adhocHarness();
    const task = makeDoc({
      type: "task",
      slug: "task-adhoc-no-match",
      parent_id: null,
      extra: {
        adhoc: true,
        ac_scope: ["AC-DOES-NOT-EXIST-ANYWHERE"],
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-DOES-NOT-EXIST-ANYWHERE" },
        ],
      },
    });
    expect(findDanglingRefs([task], docsById)).toEqual([
      {
        taskId: task.id,
        taskSlug: "task-adhoc-no-match",
        acRef: "AC-DOES-NOT-EXIST-ANYWHERE",
        specSlug: null,
        failureReason: "adhoc-scope-no-match",
      },
    ]);
  });

  it("BOUNDARY (AC 5): an --adhoc task whose ac_scope matches MULTIPLE specs is dangling with adhoc-scope-ambiguous -- DISTINCT from adhoc-scope-no-match in the SAME returned shape", () => {
    const specA = makeDoc({
      type: "spec",
      slug: "spec-adhoc-ambiguous-a",
      extra: {
        acceptance_criteria: [
          { id: "AC-SHARED-2", statement: "s", verify: { mode: "script", oracle: "test", command: "bun test" } },
        ],
      },
    });
    const specB = makeDoc({
      type: "spec",
      slug: "spec-adhoc-ambiguous-b",
      extra: {
        acceptance_criteria: [
          { id: "AC-SHARED-2", statement: "s2", verify: { mode: "script", oracle: "test", command: "bun test" } },
        ],
      },
    });
    const docsById = new Map([[specA.id, specA], [specB.id, specB]]);
    const task = makeDoc({
      type: "task",
      slug: "task-adhoc-ambiguous",
      parent_id: null,
      extra: {
        adhoc: true,
        ac_scope: ["AC-SHARED-2"],
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-SHARED-2" },
        ],
      },
    });
    const result = findDanglingRefs([task], docsById);
    expect(result).toEqual([
      {
        taskId: task.id,
        taskSlug: "task-adhoc-ambiguous",
        acRef: "AC-SHARED-2",
        specSlug: null,
        failureReason: "adhoc-scope-ambiguous",
      },
    ]);
    expect(result[0]?.failureReason).not.toBe("adhoc-scope-no-match");
  });
});

// ─── Pure: exemption ledger ─────────────────────────────────────────────────

describe("checkAcRefLedger", () => {
  const dangling: DanglingRef[] = [
    { taskId: "01HT1", taskSlug: "task-1", acRef: "AC-RETIRED", specSlug: "spec-a", failureReason: null },
  ];

  it("HAPPY: a dangling ref matching a ledger entry (same spec + id) is exempted, not newDangling", () => {
    const entries: AcRefLedgerEntry[] = [{ id: "AC-RETIRED", spec: "spec-a", date: "2026-08-01", reason: "merged into AC-OTHER" }];
    const result = checkAcRefLedger(dangling, entries);
    expect(result.newDangling).toEqual([]);
    expect(result.exempted).toEqual(dangling);
    expect(result.orphanedEntries).toEqual([]);
  });

  it("NEGATIVE: a dangling ref with no matching ledger entry is newDangling", () => {
    const result = checkAcRefLedger(dangling, []);
    expect(result.newDangling).toEqual(dangling);
    expect(result.exempted).toEqual([]);
  });

  it("BOUNDARY: a dangling ref with specSlug null can never be ledger-exempted, even by a coincidental id match", () => {
    const orphanRef: DanglingRef[] = [
      { taskId: "01HT2", taskSlug: "task-2", acRef: "AC-RETIRED", specSlug: null, failureReason: "structural-walk-failed" },
    ];
    const entries: AcRefLedgerEntry[] = [{ id: "AC-RETIRED", spec: "spec-a", date: "2026-08-01", reason: "n/a" }];
    const result = checkAcRefLedger(orphanRef, entries);
    expect(result.newDangling).toEqual(orphanRef);
  });

  it("STATE: a ledger entry whose (spec,id) matches no current dangling ref is orphaned", () => {
    const entries: AcRefLedgerEntry[] = [
      { id: "AC-RETIRED", spec: "spec-a", date: "2026-08-01", reason: "merged" },
      { id: "AC-STALE", spec: "spec-b", date: "2026-07-01", reason: "fixed since" },
    ];
    const result = checkAcRefLedger(dangling, entries);
    expect(result.orphanedEntries).toEqual([entries[1]]);
    expect(result.newDangling).toEqual([]);
  });

  it("REGRESSION: a spec-scoped id match is required — a same-id exemption for a DIFFERENT spec does not exempt", () => {
    const entries: AcRefLedgerEntry[] = [{ id: "AC-RETIRED", spec: "spec-different", date: "2026-08-01", reason: "n/a" }];
    const result = checkAcRefLedger(dangling, entries);
    expect(result.newDangling).toEqual(dangling);
    expect(result.orphanedEntries).toEqual(entries);
  });
});

describe("parseAcRefLedgerFile / loadLedgerFromDisk", () => {
  it("HAPPY: a well-formed ledger string parses", () => {
    const raw = JSON.stringify({ note: "n", entries: [{ id: "AC-1", spec: "spec-a", date: "2026-08-01", reason: "r" }] });
    expect(parseAcRefLedgerFile(raw)).toEqual({ note: "n", entries: [{ id: "AC-1", spec: "spec-a", date: "2026-08-01", reason: "r" }] });
  });

  it("ERROR: malformed JSON throws AcRefLedgerError('invalid_json')", () => {
    expect(() => parseAcRefLedgerFile("{not json")).toThrow(AcRefLedgerError);
    try {
      parseAcRefLedgerFile("{not json");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AcRefLedgerError);
      expect((e as AcRefLedgerError).code).toBe("invalid_json");
    }
  });

  it("ERROR: schema-invalid content (entry missing 'reason') throws AcRefLedgerError('schema')", () => {
    const raw = JSON.stringify({ entries: [{ id: "AC-1", spec: "spec-a", date: "2026-08-01" }] });
    try {
      parseAcRefLedgerFile(raw);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AcRefLedgerError);
      expect((e as AcRefLedgerError).code).toBe("schema");
    }
  });

  it("ERROR: a missing ledger file throws AcRefLedgerError('not_found')", () => {
    const bogusRoot = join(tmpdir(), "definitely-does-not-exist-ac-ref-ledger-test");
    try {
      loadLedgerFromDisk(bogusRoot);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AcRefLedgerError);
      expect((e as AcRefLedgerError).code).toBe("not_found");
    }
  });

  it("REGRESSION: the shipped scripts/ac-ref-exemption-ledger.json parses cleanly against the real repo root", () => {
    const ledger = loadLedgerFromDisk(REPO_ROOT);
    expect(Array.isArray(ledger.entries)).toBe(true);
  });

  it("REGRESSION: LEDGER_RELATIVE_PATH names the shipped file", () => {
    expect(LEDGER_RELATIVE_PATH).toBe("scripts/ac-ref-exemption-ledger.json");
  });
});

// ─── Exemption echo (task-check-ac-ref-integrity-prints-an-exemption-count-not-its) ──
//
// Deliberately long fixture reason, modeled on the real ledger's own structure
// (citation early, verdict mid-text, elaboration after — measured against the real
// scripts/ac-ref-exemption-ledger.json: version tokens land ~330-420 chars in, the
// verdict sentence ends ~730-800 chars in) but with the two load-bearing facts placed
// at POSITIONS THIS TEST CONTROLS, so it does not depend on the real ledger's prose
// surviving future edits. Built (not assumed) to actually require truncation: total
// length 1473 > MAX_REASON_DISPLAY_CHARS (850), verdict sentence ends at 613 (237
// chars of margin below 850), and the must-not-survive trailing sentence starts at
// 933 (83 chars of margin above 850) -- see this task's own measurement transcript.
const LONG_REASON_CITATION =
  "Diagnosed via `lore diff --from 10 --to 11` (fixture): the criterion was removed at v10 " +
  "and replaced one edit later at v11 by AC-FIX-REPLACEMENT, which targets the identical " +
  "test target with a refined statement. ";
const LONG_REASON_PADDING =
  "Padding sentence to push the verdict well past a trivial length so truncation is genuinely exercised. ".repeat(
    3,
  );
const LONG_REASON_VERDICT =
  "Genuinely superseded, not lost: content lives on under AC-FIX-REPLACEMENT, currently declared. ";
const LONG_REASON_POST_VERDICT_FILLER =
  "More non-essential context an auditor can still reach via the pointer if truncated, filling space between the verdict and the part that truly must not survive. ".repeat(
    2,
  );
const LONG_REASON_TRAILING =
  "Trailing elaboration only the pointer, not the inline echo, is responsible for surfacing -- this sentence must NOT survive truncation. ".repeat(
    4,
  );
const LONG_REASON =
  LONG_REASON_CITATION + LONG_REASON_PADDING + LONG_REASON_VERDICT + LONG_REASON_POST_VERDICT_FILLER + LONG_REASON_TRAILING;

describe("formatExemptionReasonForDisplay", () => {
  it("HAPPY: a reason at or under MAX_REASON_DISPLAY_CHARS is returned byte-for-byte unchanged", () => {
    const reason = "short reason, well under the threshold";
    expect(formatExemptionReasonForDisplay(reason)).toBe(reason);
  });

  it("BOUNDARY: a reason exactly MAX_REASON_DISPLAY_CHARS long is NOT truncated", () => {
    const reason = "a".repeat(MAX_REASON_DISPLAY_CHARS);
    expect(formatExemptionReasonForDisplay(reason)).toBe(reason);
  });

  it("BOUNDARY: a reason ONE char over MAX_REASON_DISPLAY_CHARS IS truncated, naming exactly 1 cut char", () => {
    const reason = "a".repeat(MAX_REASON_DISPLAY_CHARS + 1);
    const formatted = formatExemptionReasonForDisplay(reason);
    // NOT a "formatted is shorter" assertion: for content only marginally over the
    // threshold, the appended pointer text is itself longer than the single dropped
    // char, so total length can GROW. The real invariant is that the kept prefix is
    // capped at exactly MAX_REASON_DISPLAY_CHARS (never the untruncated original) and
    // the pointer names exactly how many chars were cut.
    expect(formatted).not.toBe(reason);
    expect(formatted.startsWith("a".repeat(MAX_REASON_DISPLAY_CHARS) + "…")).toBe(true);
    expect(formatted).toContain("truncated 1 more char ");
    expect(formatted).not.toContain("1 more chars");
  });

  it("BOUNDARY (deliberately long fixture, built not assumed): a reason long enough to REQUIRE truncation still carries the version citation and the merged/lost verdict", () => {
    expect(LONG_REASON.length).toBeGreaterThan(MAX_REASON_DISPLAY_CHARS);
    const formatted = formatExemptionReasonForDisplay(LONG_REASON);

    expect(formatted.length).toBeLessThan(LONG_REASON.length);
    // Independent, lone tokens -- not a remembered contiguous phrase of the whole line.
    expect(formatted).toContain("v10");
    expect(formatted).toContain("v11");
    expect(formatted).toContain("Genuinely superseded, not lost");
    expect(formatted).toContain(LEDGER_RELATIVE_PATH);
  });

  it("NEGATIVE: truncation drops the trailing elaboration text -- it does not survive past the cut", () => {
    const formatted = formatExemptionReasonForDisplay(LONG_REASON);
    expect(formatted).not.toContain("Trailing elaboration");
  });

  it("REGRESSION: all three real ledger reasons require truncation and preserve their own version citation + merged/lost verdict", () => {
    const ledger = loadLedgerFromDisk(REPO_ROOT);
    expect(ledger.entries.length).toBeGreaterThan(0);
    for (const entry of ledger.entries) {
      expect(entry.reason.length).toBeGreaterThan(MAX_REASON_DISPLAY_CHARS);
      const formatted = formatExemptionReasonForDisplay(entry.reason);
      expect(formatted).toContain("Genuinely superseded, not lost");
      const versionTokens = entry.reason.match(/\bv\d+\b/g) ?? [];
      expect(versionTokens.length).toBeGreaterThanOrEqual(2);
      for (const token of versionTokens.slice(0, 2)) {
        expect(formatted).toContain(token);
      }
    }
  });
});

describe("findLedgerEntryForRef", () => {
  const ref: DanglingRef = { taskId: "01HT1", taskSlug: "task-1", acRef: "AC-X", specSlug: "spec-a", failureReason: null };

  it("HAPPY: finds the entry matching the exact (spec, id) pair", () => {
    const entries: AcRefLedgerEntry[] = [{ id: "AC-X", spec: "spec-a", date: "2026-08-01", reason: "matched" }];
    expect(findLedgerEntryForRef(ref, entries)?.reason).toBe("matched");
  });

  it("STATE: a same-id entry for a DIFFERENT spec is never returned -- spec is part of the key, not just id", () => {
    const entries: AcRefLedgerEntry[] = [
      { id: "AC-X", spec: "spec-b", date: "2026-08-01", reason: "WRONG_SPEC" },
      { id: "AC-X", spec: "spec-a", date: "2026-08-01", reason: "RIGHT_SPEC" },
    ];
    expect(findLedgerEntryForRef(ref, entries)?.reason).toBe("RIGHT_SPEC");
  });

  it("BOUNDARY: specSlug === null never matches, even with a coincidental id match in entries", () => {
    const nullSpecRef: DanglingRef = {
      taskId: "01HT2",
      taskSlug: "task-2",
      acRef: "AC-X",
      specSlug: null,
      failureReason: "structural-walk-failed",
    };
    const entries: AcRefLedgerEntry[] = [{ id: "AC-X", spec: "spec-a", date: "2026-08-01", reason: "n/a" }];
    expect(findLedgerEntryForRef(nullSpecRef, entries)).toBeUndefined();
  });

  it("NEGATIVE: no entry matches -> undefined (never throws)", () => {
    expect(() => findLedgerEntryForRef(ref, [])).not.toThrow();
    expect(findLedgerEntryForRef(ref, [])).toBeUndefined();
  });

  it("ERROR: an entries array containing only unrelated ids never coincidentally matches", () => {
    const entries: AcRefLedgerEntry[] = [
      { id: "AC-UNRELATED-1", spec: "spec-a", date: "2026-08-01", reason: "n/a" },
      { id: "AC-UNRELATED-2", spec: "spec-a", date: "2026-08-01", reason: "n/a" },
    ];
    expect(findLedgerEntryForRef(ref, entries)).toBeUndefined();
  });
});

// ─── End-to-end fixture: mkdtemp + lore init, never the repo's own .lore/ ─────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns `bun run <LORE_ENTRY> ...args` in `cwd` — explicit maxBuffer per this repo's spawnSync-truncation discipline (project CLAUDE.md), even though every payload here is small. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", LORE_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: "1" },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

/**
 * Builds a throwaway "repo root" containing `scripts/ac-ref-exemption-ledger.json` at the
 * exact `LEDGER_RELATIVE_PATH` the real detector reads, with `entries` (default EMPTY —
 * `{"entries": []}`). Passed to `runDetector` via `LORE_AC_REF_LEDGER_REPO_ROOT` so this
 * fixture's corpus-scan assertions stay independent of the REAL repo's shipped ledger
 * content — which, once it carries any entry (task-t3, 2026-08-01), would otherwise make
 * every one of THIS fixture's unrelated, throwaway-corpus runs report those real entries as
 * spuriously "orphaned" (they match no dangling ref in a fixture corpus that never produced
 * them) and fail loud for a reason that has nothing to do with what this suite is actually
 * proving. Accepting `entries` (task-check-ac-ref-integrity-prints-an-exemption-count-not-its)
 * lets a test seed a REAL exemption (or a deliberately stale one) for the fixture corpus's
 * OWN dangling ref, still isolated from the real repo's ledger.
 */
function initFixtureLedgerRoot(entries: AcRefLedgerEntry[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "lore-ac-ref-ledger-root-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, LEDGER_RELATIVE_PATH), JSON.stringify({ entries }), "utf8");
  return root;
}

/**
 * Spawns the REAL detector script (`bun run scripts/check-ac-ref-integrity.ts`) with `cwd`
 * set to the fixture corpus directory, exactly as the registered AC-ACS-7 oracle command
 * would run it from that directory — pointed at an isolated throwaway ledger (see
 * `initFixtureLedgerRoot`) so this fixture's own corpus-scan assertions are never coupled to
 * the real repo's shipped ledger content. `ledgerEntries` defaults to EMPTY (the original
 * behaviour every pre-existing caller relies on); a caller seeding a specific exemption (or a
 * deliberately stale row) passes its own entries.
 */
function runDetector(cwd: string, ledgerEntries: AcRefLedgerEntry[] = []): RunResult {
  const ledgerRoot = initFixtureLedgerRoot(ledgerEntries);
  try {
    const result = spawnSync("bun", ["run", DETECTOR_SCRIPT], {
      cwd,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, LORE_AC_REF_LEDGER_REPO_ROOT: ledgerRoot },
    });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
  } finally {
    rmSync(ledgerRoot, { recursive: true, force: true });
  }
}

function initFixtureCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-ac-ref-fixture-"));
  const init = runLore(["init", "--json"], dir);
  if (init.exitCode !== 0) {
    throw new Error(`fixture setup: lore init failed (exit ${init.exitCode}): ${init.stderr}`);
  }
  return dir;
}

function createDoc(
  cwd: string,
  type: string,
  title: string,
  content: string,
  extraArgs: string[],
): { id: string; slug: string } {
  const result = runLore(["create", type, "--title", title, "--content", content, "--json", ...extraArgs], cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture setup: create ${type} failed (exit ${result.exitCode}): ${result.stderr}\n${result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout) as { data: { id: string; slug: string } };
  return { id: parsed.data.id, slug: parsed.data.slug };
}

const FIXTURE_SPEC_CONTENT =
  "## Overview/Goal\n\nFixture spec for check-ac-ref-integrity's negative-control test.\n\n" +
  "## Scope\n\nOne throwaway criterion, force-removed after one evidence row references it.\n\n" +
  "## Acceptance Criteria\n\n- AC-FIX-1 -- placeholder, retired via `lore ac rm --force` immediately after use.\n";

const FIXTURE_AC_ID = "AC-FIX-1";

/**
 * Builds a fixture corpus (already `lore init`'d at `cwd`) carrying one task whose
 * evidence references `FIXTURE_AC_ID` on a declared criterion — and, when
 * `opts.forceRemove` is true, immediately force-removes that criterion the SAME way
 * a real `lore ac rm --force` (or a historical rm+add re-declare cycle) would,
 * leaving the evidence row's `ac_ref` genuinely dangling (spec D6/D7's own
 * described mechanism — this fixture does not fabricate a shortcut around it).
 */
function buildFixture(cwd: string, opts: { forceRemove: boolean }): { taskSlug: string; specSlug: string } {
  const prd = createDoc(cwd, "prd", "Fixture root PRD", "Fixture prd body.", []);
  const spec = createDoc(cwd, "spec", "Fixture spec with a retired criterion", FIXTURE_SPEC_CONTENT, []);

  const addAc = runLore(
    ["ac", "add", spec.id, FIXTURE_AC_ID, "--statement", "check-ac-ref-integrity negative-control criterion", "--mode", "script", "--oracle", "test", "--command", "true", "--json"],
    cwd,
  );
  if (addAc.exitCode !== 0) {
    throw new Error(`fixture setup: ac add failed (exit ${addAc.exitCode}): ${addAc.stderr}`);
  }

  const plan = createDoc(cwd, "plan", "Fixture plan", "Fixture plan body.", ["--parent", spec.id]);
  // reason: spec-declaring-ac-scope-is-required-at-task-creation-so-the (landed on
  // main mid-task, merged into this branch) — task-create is a gated checkpoint:
  // when the parent plan's spec-tier ancestor declares >= 1 script-mode AC, creation
  // is REFUSED without a declared --ac-scope (D1). This fixture's spec declares
  // exactly FIXTURE_AC_ID, so the task must claim it explicitly — an empty
  // --ac-scope would also satisfy the gate (D2) but would misrepresent what this
  // fixture task actually claims (it genuinely references FIXTURE_AC_ID in its
  // evidence below), so the real id is declared, not a vacuous empty array.
  const task = createDoc(cwd, "task", "Fixture task", "Fixture task body.", [
    "--plan-id",
    plan.id,
    "--ac-scope",
    FIXTURE_AC_ID,
  ]);

  // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
  // predicate-to-its-own) — "test" self-report is now refused regardless of
  // tail content; "manual" is the one oracle that still lets a genuinely
  // non-empty self-reported tail succeed. This fixture only needs a
  // successful evidence row referencing FIXTURE_AC_ID, not a specific
  // oracle kind.
  const evidence = runLore(
    ["evidence", task.id, "--oracle", "manual", "--command", "true", "--result", "pass", "--ac", FIXTURE_AC_ID, "--output-tail", "ok", "--json"],
    cwd,
  );
  if (evidence.exitCode !== 0) {
    throw new Error(`fixture setup: evidence add failed (exit ${evidence.exitCode}): ${evidence.stderr}`);
  }

  if (opts.forceRemove) {
    const rm = runLore(["ac", "rm", spec.id, FIXTURE_AC_ID, "--force", "--json"], cwd);
    if (rm.exitCode !== 0) {
      throw new Error(`fixture setup: ac rm --force failed (exit ${rm.exitCode}): ${rm.stderr}`);
    }
  }

  return { taskSlug: task.slug, specSlug: spec.slug };
}

describe("check-ac-ref-integrity: end-to-end fixture (mkdtemp + lore init, never the repo's own .lore/)", () => {
  // NON-NEGOTIABLE: RED asserted before GREEN — a detector that cannot fail must be
  // caught before it is trusted (this task's verification discipline).

  it("NEGATIVE (RED first): a seeded dangling ac_ref (declare -> evidence -> rm --force) makes the real detector exit non-zero and name the (task, ac_ref) pair", () => {
    const cwd = initFixtureCorpus();
    try {
      const { taskSlug } = buildFixture(cwd, { forceRemove: true });
      const result = runDetector(cwd);

      expect(result.exitCode).not.toBe(0);
      const combinedOutput = result.stdout + result.stderr;
      expect(combinedOutput).toContain(taskSlug);
      expect(combinedOutput).toContain(FIXTURE_AC_ID);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("HAPPY (GREEN second): a corpus with no dangling ac_ref makes the real detector exit 0", () => {
    const cwd = initFixtureCorpus();
    try {
      buildFixture(cwd, { forceRemove: false });
      const result = runDetector(cwd);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OK");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});

describe("check-ac-ref-integrity: exemption echo wiring (task-check-ac-ref-integrity-prints-an-exemption-count-not-its)", () => {
  it("HAPPY: an applied exemption's (spec, id) and reason reach the real detector's stdout, keyed on independent tokens (never a remembered contiguous phrase)", () => {
    const cwd = initFixtureCorpus();
    try {
      const { specSlug } = buildFixture(cwd, { forceRemove: true });
      const result = runDetector(cwd, [
        { id: FIXTURE_AC_ID, spec: specSlug, date: "2026-08-01", reason: LONG_REASON },
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(specSlug);
      expect(result.stdout).toContain(FIXTURE_AC_ID);
      // Independent, lone tokens -- not the whole reason sentence copied verbatim.
      expect(result.stdout).toContain("v10");
      expect(result.stdout).toContain("v11");
      expect(result.stdout).toContain("Genuinely superseded, not lost");
      // Independent negative-adjacent condition: the count claim in the SAME run must
      // actually be non-zero, not a static string present regardless of scan outcome.
      expect(result.stdout).toContain("1 pre-existing exemption(s)");
      // The trailing elaboration must NOT survive -- proves this is a genuinely
      // truncated echo, not an accidental full dump that happens to contain the tokens.
      expect(result.stdout).not.toContain("Trailing elaboration");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("CONTROL: an empty ledger against a clean (non-dangling) corpus prints NO exemption lines at all -- the assertion above cannot pass vacuously", () => {
    const cwd = initFixtureCorpus();
    try {
      buildFixture(cwd, { forceRemove: false });
      const result = runDetector(cwd, []);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("0 pre-existing exemption(s)");
      expect(result.stdout).not.toContain("applied exemption");
      expect(result.stdout).not.toContain(" — recorded ");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("REGRESSION: a ledger entry matching no real dangling ref still exits 5, naming the stale row (unchanged behaviour, not touched by this task)", () => {
    const cwd = initFixtureCorpus();
    try {
      buildFixture(cwd, { forceRemove: false }); // zero dangling refs in this corpus
      const result = runDetector(cwd, [
        { id: "AC-DOES-NOT-EXIST", spec: "spec-does-not-exist", date: "2026-08-01", reason: "stale row, never matched by any real scan" },
      ]);

      expect(result.exitCode).toBe(5);
      const combinedOutput = result.stdout + result.stderr;
      expect(combinedOutput).toContain("AC-DOES-NOT-EXIST");
      expect(combinedOutput).toContain("spec-does-not-exist");
      expect(combinedOutput).toContain("no longer match a real dangling ac_ref");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});

// The REAL repo tree + REAL corpus arming cases moved to scripts/check-live-corpus-detectors.ts
// (run by check:live-repo-state): LORE_TEST_SANDBOX refuses this repo's own corpus inside vitest.
// task-skill-implement-tg-4, AC-TG-2.

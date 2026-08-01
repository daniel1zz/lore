/**
 * Tests for the evidence-row projection change in `assess-template.ts`
 * (SPEC-lore-assess-project-evidence-rows-instead-of-embedding-the D1, D2):
 * `renderTaskEvidence` now projects `(oracle, ac_ref, result, command, tail_bytes)` per row
 * instead of embedding the raw evidence body, keeping the rendered evidence block itself
 * small regardless of row count (the root fix for a heavily-evidenced task's rendered
 * materials ballooning unboundedly — see
 * `knowledge-a-task-doc-that-accumulated-10-evidence-rows`). `truncateSection(task.content,
 * max_task_chars)` is UNCHANGED — it measures `task.content` ALONE, never the rendered
 * evidence text (AC-067-5, `assessment-finalize-downgrade.test.ts`, pins this in isolation).
 *
 * Spec-first expectations:
 *   - AC-AEP-1: each evidence row's rendered line carries `oracle`, `ac_ref`, `result`,
 *     `command`, and `tail_bytes` — `tail_bytes` is ALWAYS present (0 for an absent or
 *     empty `output_tail`, never simply omitted); the full clipped `output_tail` text is
 *     shown ONLY for a row whose `ac_ref` names an AC currently under judgment.
 *   - AC-AEP-2: a task with 10 evidence rows whose OLD (unprojected, full-tail) rendering
 *     would have overflowed `max_task_chars` now renders a task block that fits comfortably
 *     within that same budget (a size fact about the compact projection — task.content's own
 *     truncation flag is unaffected either way, per the invariant above).
 *   - AC-AEP-3: REGRESSION GUARD (D2) — when a task block still overflows budget after
 *     projection, the `truncated[]` entry is byte-identical to `` `task:${slug}` `` — the
 *     frozen vocabulary `computeTaskTruncationRatio` and `findUngroundedAbsenceDimensions`
 *     depend on.
 *   - AC-AEP-4: `buildAssessPrompt` (v5) and `buildAssessPromptV6` project the identical
 *     evidence shape for the same input task (when the plan declares no `extra.ac_scope`
 *     restriction, so v6's "under judgment" set equals v5's full declared set).
 *
 * @spec_ref AC-AEP-1, AC-AEP-2, AC-AEP-3, AC-AEP-4
 */

import { describe, it, expect } from "vitest";
import { buildAssessPrompt, buildAssessPromptV6, type AssessBudgets } from "../../../src/ai/assess-template.js";
import { makeDoc } from "../../fixtures/assess-golden/doc-builder.js";
import type { PlanBundle, DocRecord } from "@lore/core";

const BUDGETS: AssessBudgets = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };

const PLAN_ID = "01AEPTESTPLAN000000000001";
const SPEC_ID = "01AEPTESTSPEC000000000001";
const TASK_ID = "01AEPTESTTASK000000000001";

/** A spec declaring exactly one structured AC — the shared fixture for every test below. */
function makeSpecWithOneAc(): DocRecord {
  return makeDoc({
    id: SPEC_ID,
    slug: "spec-aep-fixture",
    type: "spec",
    title: "AEP Fixture Spec",
    content: "Spec body (unused when structured ACs are declared).",
    extra: {
      spec_kind: "tech",
      acceptance_criteria: [
        {
          id: "AC-Y-1",
          statement: "The widget renders without throwing.",
          verify: { mode: "script", oracle: "test", command: "bun test widget.test.ts" },
        },
      ],
    },
  });
}

function makePlan(extra: Record<string, unknown> = {}): DocRecord {
  return makeDoc({
    id: PLAN_ID,
    slug: "plan-aep-fixture",
    type: "plan",
    title: "AEP Fixture Plan",
    content: "Plan goals.",
    parent_id: SPEC_ID,
    extra,
  });
}

function makeTask(content: string, verificationEvidence: unknown[]): DocRecord {
  return makeDoc({
    id: TASK_ID,
    slug: "task-aep-fixture",
    type: "task",
    title: "AEP Fixture Task",
    content,
    parent_id: PLAN_ID,
    extra: { plan_id: PLAN_ID, verification_evidence: verificationEvidence },
  });
}

/** Mirrors the OLD (pre-projection) per-row format, for demonstrating what it WOULD have
 * rendered — used only to prove a fixture is a genuine "previously overflowed" case
 * (AC-AEP-2), never to assert against the new production code. */
function legacyRenderRow(e: {
  oracle: string;
  command: string;
  result: string;
  recorded_by: string;
  output_tail?: string;
}): string {
  return (
    `  [1] oracle=${e.oracle} command="${e.command}" result=${e.result} recorder=${e.recorded_by}` +
    (e.output_tail ? `\n      output_tail: ${e.output_tail.slice(0, 500)}` : "")
  );
}

// ─── AC-AEP-1: per-row projection shape ────────────────────────────────────

describe("AC-AEP-1: renderTaskEvidence projects (oracle, ac_ref, result, command, tail_bytes)", () => {
  it("HAPPY: a row whose ac_ref is under judgment carries oracle/ac_ref/result/command/tail_bytes AND the full clipped tail", () => {
    const bundle: PlanBundle = {
      plan: makePlan(),
      spec: makeSpecWithOneAc(),
      tasks: [
        makeTask("Task content.", [
          {
            oracle: "test",
            command: "bun test widget.test.ts",
            result: "pass",
            recorded_at: "2026-01-01T00:00:00.000Z",
            recorded_by: "alice",
            ac_ref: "AC-Y-1",
            output_tail: "abc",
          },
        ]),
      ],
    };
    const result = buildAssessPrompt(bundle, undefined, BUDGETS);
    expect(result.prompt).toContain("oracle=test");
    expect(result.prompt).toContain("ac_ref=AC-Y-1");
    expect(result.prompt).toContain("result=pass");
    expect(result.prompt).toContain('command="bun test widget.test.ts"');
    expect(result.prompt).toContain("tail_bytes=3");
    expect(result.prompt).toContain("output_tail: abc");
  });

  it("BOUNDARY: a row with NO output_tail field renders tail_bytes=0 — the field is never omitted (AC-AEP-1)", () => {
    const bundle: PlanBundle = {
      plan: makePlan(),
      spec: makeSpecWithOneAc(),
      tasks: [
        makeTask("Task content.", [
          {
            oracle: "test",
            command: "bun test widget.test.ts",
            result: "fail",
            recorded_at: "2026-01-01T00:00:00.000Z",
            recorded_by: "alice",
            ac_ref: "AC-Y-1",
            // output_tail intentionally absent
          },
        ]),
      ],
    };
    const result = buildAssessPrompt(bundle, undefined, BUDGETS);
    expect(result.prompt).toContain("tail_bytes=0");
    expect(result.prompt).not.toContain("output_tail:");
  });

  it("BOUNDARY: a row with an EMPTY-STRING output_tail also renders tail_bytes=0, not a distinct state (AC-AEP-1)", () => {
    const bundle: PlanBundle = {
      plan: makePlan(),
      spec: makeSpecWithOneAc(),
      tasks: [
        makeTask("Task content.", [
          {
            oracle: "test",
            command: "bun test widget.test.ts",
            result: "pass",
            recorded_at: "2026-01-01T00:00:00.000Z",
            recorded_by: "alice",
            ac_ref: "AC-Y-1",
            output_tail: "",
          },
        ]),
      ],
    };
    const result = buildAssessPrompt(bundle, undefined, BUDGETS);
    expect(result.prompt).toContain("tail_bytes=0");
    expect(result.prompt).not.toContain("output_tail:");
  });

  it("BOUNDARY: tail_bytes counts UTF-8 bytes, not JS string length, for multi-byte content (AC-AEP-1)", () => {
    const multiByteTail = "错误：测试失败"; // each CJK char is 3 UTF-8 bytes
    const expectedBytes = Buffer.byteLength(multiByteTail, "utf8");
    expect(expectedBytes).not.toBe(multiByteTail.length); // sanity: byte count != char count
    const bundle: PlanBundle = {
      plan: makePlan(),
      spec: makeSpecWithOneAc(),
      tasks: [
        makeTask("Task content.", [
          {
            oracle: "test",
            command: "bun test widget.test.ts",
            result: "fail",
            recorded_at: "2026-01-01T00:00:00.000Z",
            recorded_by: "alice",
            ac_ref: "AC-Y-1",
            output_tail: multiByteTail,
          },
        ]),
      ],
    };
    const result = buildAssessPrompt(bundle, undefined, BUDGETS);
    expect(result.prompt).toContain(`tail_bytes=${expectedBytes}`);
  });

  it("STATE: a row whose ac_ref is NOT under judgment shows tail_bytes but SUPPRESSES the full tail text (AC-AEP-1)", () => {
    const bundle: PlanBundle = {
      plan: makePlan(),
      spec: makeSpecWithOneAc(),
      tasks: [
        makeTask("Task content.", [
          {
            oracle: "test",
            command: "bun test in-scope.test.ts",
            result: "pass",
            recorded_at: "2026-01-01T00:00:00.000Z",
            recorded_by: "alice",
            ac_ref: "AC-Y-1", // declared — under judgment
            output_tail: "in-scope tail content",
          },
          {
            oracle: "tsc",
            command: "bun run typecheck",
            result: "pass",
            recorded_at: "2026-01-01T00:00:00.000Z",
            recorded_by: "alice",
            ac_ref: "AC-NOT-DECLARED", // not declared — NOT under judgment
            output_tail: "out-of-scope tail content that must not leak",
          },
        ]),
      ],
    };
    const result = buildAssessPrompt(bundle, undefined, BUDGETS);
    expect(result.prompt).toContain("ac_ref=AC-Y-1");
    expect(result.prompt).toContain("output_tail: in-scope tail content");
    expect(result.prompt).toContain("ac_ref=AC-NOT-DECLARED");
    expect(result.prompt).toContain(`tail_bytes=${Buffer.byteLength("out-of-scope tail content that must not leak", "utf8")}`);
    expect(result.prompt).not.toContain("output_tail: out-of-scope tail content that must not leak");
  });

  it("NEGATIVE: malformed verification_evidence (not an array) degrades to '(no evidence recorded)', not a crash", () => {
    const bundle: PlanBundle = {
      plan: makePlan(),
      spec: makeSpecWithOneAc(),
      tasks: [
        makeDoc({
          id: TASK_ID,
          slug: "task-aep-malformed",
          type: "task",
          title: "Malformed Evidence Task",
          content: "Task content.",
          parent_id: PLAN_ID,
          extra: { plan_id: PLAN_ID, verification_evidence: "not-an-array" },
        }),
      ],
    };
    expect(() => buildAssessPrompt(bundle, undefined, BUDGETS)).not.toThrow();
    const result = buildAssessPrompt(bundle, undefined, BUDGETS);
    expect(result.prompt).toContain("(no evidence recorded)");
  });

  it("ERROR: one schema-invalid entry fails the WHOLE array closed, degrading to '(no evidence recorded)'", () => {
    const bundle: PlanBundle = {
      plan: makePlan(),
      spec: makeSpecWithOneAc(),
      tasks: [
        makeTask("Task content.", [
          {
            oracle: "not-a-real-oracle-kind",
            command: "bun test widget.test.ts",
            result: "pass",
            recorded_at: "2026-01-01T00:00:00.000Z",
            recorded_by: "alice",
          },
        ]),
      ],
    };
    const result = buildAssessPrompt(bundle, undefined, BUDGETS);
    expect(result.prompt).toContain("(no evidence recorded)");
  });

  it("REGRESSION: the retired 'recorder=' field no longer appears anywhere in the rendered prompt", () => {
    const bundle: PlanBundle = {
      plan: makePlan(),
      spec: makeSpecWithOneAc(),
      tasks: [
        makeTask("Task content.", [
          {
            oracle: "test",
            command: "bun test widget.test.ts",
            result: "pass",
            recorded_at: "2026-01-01T00:00:00.000Z",
            recorded_by: "alice",
            ac_ref: "AC-Y-1",
            output_tail: "some tail",
          },
        ]),
      ],
    };
    const result = buildAssessPrompt(bundle, undefined, BUDGETS);
    expect(result.prompt).not.toContain("recorder=");
  });
});

// ─── AC-AEP-2: heavily-evidenced task fits under budget post-projection ────

describe("AC-AEP-2: a 10-evidence-row task that would have overflowed pre-projection now fits under budget", () => {
  /** 10 rows: 2 point at the declared AC (full tail shown), 8 carry no ac_ref (compact). */
  function buildTenRowEvidence(): unknown[] {
    const tail = "x".repeat(450);
    const rows: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      rows.push({
        oracle: "test",
        command: `bun test widget.test.ts -t "case ${i}"`,
        result: "pass",
        recorded_at: "2026-01-01T00:00:00.000Z",
        recorded_by: "alice",
        ac_ref: "AC-Y-1",
        output_tail: tail,
      });
    }
    for (let i = 0; i < 8; i++) {
      rows.push({
        oracle: "test",
        command: `bun test other-${i}.test.ts`,
        result: "pass",
        recorded_at: "2026-01-01T00:00:00.000Z",
        recorded_by: "alice",
        output_tail: tail,
      });
    }
    return rows;
  }

  it("CONTROL: the OLD (unprojected) full-tail rendering of this exact fixture WOULD have exceeded max_task_chars", () => {
    const content = "Task body describing the verification steps for this change.";
    const rows = buildTenRowEvidence() as Array<{
      oracle: string;
      command: string;
      result: string;
      recorded_by: string;
      output_tail?: string;
    }>;
    const legacyEvidenceText = rows.map((r) => legacyRenderRow(r)).join("\n");
    const legacyCombinedLength = `${content}\nEvidence:\n${legacyEvidenceText}`.length;
    expect(legacyCombinedLength).toBeGreaterThan(BUDGETS.max_task_chars);
  });

  it("HAPPY: the NEW projected rendering of the SAME fixture fits comfortably within max_task_chars", () => {
    const content = "Task body describing the verification steps for this change.";
    const bundle: PlanBundle = {
      plan: makePlan(),
      spec: makeSpecWithOneAc(),
      tasks: [makeTask(content, buildTenRowEvidence())],
    };
    const result = buildAssessPrompt(bundle, undefined, BUDGETS);

    // reason: task.content ALONE still gates truncateSection/truncated[] (AC-067-5 — this
    // fixture's content is small so that flag was never in question either way); the
    // load-bearing claim here is the SIZE of the actual rendered block the judge receives.
    const tasksSectionMatch = result.prompt.match(/## Tasks and Evidence\n([\s\S]*?)\n\n## Diff\n/);
    expect(tasksSectionMatch).not.toBeNull();
    const renderedTaskBlock = tasksSectionMatch![1]!;
    expect(renderedTaskBlock.length).toBeLessThanOrEqual(BUDGETS.max_task_chars);

    expect(result.truncated).not.toContain(`task:${bundle.tasks[0]!.slug}`);
    // sanity: the evidence facts (row count signal) are still visible in the prompt
    expect(result.prompt).toContain("tail_bytes=450");
  });
});

// ─── AC-AEP-3: frozen truncated[] vocabulary regression guard ──────────────

describe("AC-AEP-3: REGRESSION GUARD — a still-overflowing task block emits byte-identical 'task:<slug>'", () => {
  it("REGRESSION: truncated[] contains the EXACT string task:<slug>, no variant spacing/casing", () => {
    const bundle: PlanBundle = {
      plan: makePlan(),
      spec: makeSpecWithOneAc(),
      tasks: [makeTask("z".repeat(6000), [])], // content alone exceeds max_task_chars=4000
    };
    const result = buildAssessPrompt(bundle, undefined, BUDGETS);
    const slug = bundle.tasks[0]!.slug;

    // byte-identity check — not "starts with task:", not a substring match
    expect(result.truncated.some((s) => s === `task:${slug}`)).toBe(true);
    expect(result.truncated.some((s) => s === `task: ${slug}`)).toBe(false);
    expect(result.truncated.some((s) => s === `Task:${slug}`)).toBe(false);
    expect(result.truncated.some((s) => s === `TASK:${slug}`)).toBe(false);
  });

  it("REGRESSION: v6 (buildAssessPromptV6) emits the SAME byte-identical vocabulary", () => {
    const bundle: PlanBundle = {
      plan: makePlan(),
      spec: makeSpecWithOneAc(),
      tasks: [makeTask("z".repeat(6000), [])],
    };
    const result = buildAssessPromptV6(bundle, undefined, BUDGETS);
    const slug = bundle.tasks[0]!.slug;
    expect(result.truncated.some((s) => s === `task:${slug}`)).toBe(true);
  });
});

// ─── AC-AEP-4: v5 / v6 agreement ───────────────────────────────────────────

describe("AC-AEP-4: buildAssessPrompt (v5) and buildAssessPromptV6 project the identical evidence shape", () => {
  it("HAPPY: both builders render the exact same per-row projected line for the same input task", () => {
    const bundle: PlanBundle = {
      // no extra.ac_scope declared on the plan — v6's scoped subset equals v5's full set
      plan: makePlan(),
      spec: makeSpecWithOneAc(),
      tasks: [
        makeTask("Task content.", [
          {
            oracle: "test",
            command: "bun test widget.test.ts",
            result: "pass",
            recorded_at: "2026-01-01T00:00:00.000Z",
            recorded_by: "alice",
            ac_ref: "AC-Y-1",
            output_tail: "agreement check tail",
          },
          {
            oracle: "tsc",
            command: "bun run typecheck",
            result: "fail",
            recorded_at: "2026-01-01T00:00:00.000Z",
            recorded_by: "alice",
            // no ac_ref — out of scope in both builders
            output_tail: "must not appear in either prompt",
          },
        ]),
      ],
    };

    const v5 = buildAssessPrompt(bundle, undefined, BUDGETS);
    const v6 = buildAssessPromptV6(bundle, undefined, BUDGETS);

    const expectedInScopeLine =
      'oracle=test ac_ref=AC-Y-1 result=pass command="bun test widget.test.ts" tail_bytes=20';
    const expectedOutOfScopeLine =
      'oracle=tsc ac_ref=(none) result=fail command="bun run typecheck" tail_bytes=' +
      Buffer.byteLength("must not appear in either prompt", "utf8");

    expect(v5.prompt).toContain(expectedInScopeLine);
    expect(v6.prompt).toContain(expectedInScopeLine);
    expect(v5.prompt).toContain(expectedOutOfScopeLine);
    expect(v6.prompt).toContain(expectedOutOfScopeLine);
    expect(v5.prompt).toContain("output_tail: agreement check tail");
    expect(v6.prompt).toContain("output_tail: agreement check tail");
    expect(v5.prompt).not.toContain("output_tail: must not appear in either prompt");
    expect(v6.prompt).not.toContain("output_tail: must not appear in either prompt");
  });

  it("CONTROL: v6's plan-scope restriction (extra.ac_scope) does NOT change v5's behaviour (different 'under judgment' sets by design)", () => {
    const bundle: PlanBundle = {
      // v6 scopes OUT AC-Y-1 entirely via an ac_scope that names a different (nonexistent) id —
      // v5 has no such concept and always uses the full declared set.
      plan: makePlan({ ac_scope: ["AC-OTHER-DECLARED"] }),
      spec: makeDoc({
        id: SPEC_ID,
        slug: "spec-aep-fixture-scoped",
        type: "spec",
        title: "AEP Fixture Spec (multi-AC)",
        content: "Spec body.",
        extra: {
          spec_kind: "tech",
          acceptance_criteria: [
            {
              id: "AC-Y-1",
              statement: "The widget renders without throwing.",
              verify: { mode: "script", oracle: "test", command: "bun test widget.test.ts" },
            },
            {
              id: "AC-OTHER-DECLARED",
              statement: "A second, unrelated declared criterion.",
              verify: { mode: "script", oracle: "test", command: "bun test other.test.ts" },
            },
          ],
        },
      }),
      tasks: [
        makeTask("Task content.", [
          {
            oracle: "test",
            command: "bun test widget.test.ts",
            result: "pass",
            recorded_at: "2026-01-01T00:00:00.000Z",
            recorded_by: "alice",
            ac_ref: "AC-Y-1",
            output_tail: "scope divergence tail",
          },
        ]),
      ],
    };

    const v5 = buildAssessPrompt(bundle, undefined, BUDGETS);
    const v6 = buildAssessPromptV6(bundle, undefined, BUDGETS);

    // v5: AC-Y-1 is in its (unscoped) full declared set — full tail shown
    expect(v5.prompt).toContain("output_tail: scope divergence tail");
    // v6: the plan's ac_scope names ONLY AC-OTHER-DECLARED — AC-Y-1 is out of judgment for v6
    expect(v6.prompt).not.toContain("output_tail: scope divergence tail");
    expect(v6.prompt).toContain(`tail_bytes=${Buffer.byteLength("scope divergence tail", "utf8")}`);
  });
});

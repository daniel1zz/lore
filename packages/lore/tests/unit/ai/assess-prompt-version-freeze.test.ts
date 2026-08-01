/**
 * Tests for the T5 registry re-key in `assess-template.ts`
 * (SPEC-lore-assess-project-evidence-rows-instead-of-embedding-the T5):
 *
 * T3 changed `renderTaskEvidence`, which is SHARED by `buildAssessPrompt` (v5) and the
 * v6/v7 builder, while `ASSESS_PROMPT_VERSION` stayed `6` — so an assessment stamped
 * `prompt_version: 6` rendered differently before and after T3 landed (a639485). The fix
 * PARAMETERIZES the shared builder core (`assembleFactsBasedAssessPrompt`) over an
 * injectable evidence renderer instead of forking it: `ASSESS_TEMPLATES[6]` now binds the
 * FROZEN pre-projection renderer and `ASSESS_TEMPLATES[7]` binds the active projected
 * renderer, becoming `ASSESS_PROMPT_VERSION`.
 *
 * Spec-first expectations:
 *   - AC-AEP-9: `ASSESS_PROMPT_VERSION` is `7`, and `getAssessTemplate(6)` still renders a
 *     task's evidence rows in the PRE-projection shape — byte-identical to the v6 output
 *     captured BEFORE the projection landed (pinned as a LITERAL string captured from
 *     `git show a639485^:packages/lore/src/ai/assess-template.ts`, never derived by calling
 *     the frozen renderer and comparing it to itself — that would be a test that cannot
 *     fail).
 *   - AC-AEP-10: `getAssessTemplate(7)` renders the projected `(oracle, ac_ref, result,
 *     command, tail_bytes)` shape, and the renderer is injected into the shared builder
 *     rather than duplicated — proven structurally by showing the two registry entries'
 *     prompts are IDENTICAL outside the per-row evidence lines (same facts section, same
 *     rubric, same output instruction — one builder body, not a forked twin).
 *
 * @spec_ref AC-AEP-9, AC-AEP-10
 */

import { describe, it, expect } from "vitest";
import {
  ASSESS_PROMPT_VERSION,
  ASSESS_TEMPLATES,
  getAssessTemplate,
  buildAssessPromptV7,
  type AssessBudgets,
} from "../../../src/ai/assess-template.js";
import { makeDoc } from "../../fixtures/assess-golden/doc-builder.js";
import type { PlanBundle, DocRecord } from "@lore/core";

const BUDGETS: AssessBudgets = { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 };

const PLAN_ID = "01APVFTESTPLAN00000000001";
const SPEC_ID = "01APVFTESTSPEC00000000001";
const TASK_ID = "01APVFTESTTASK00000000001";

function makeSpecWithOneAc(): DocRecord {
  return makeDoc({
    id: SPEC_ID,
    slug: "spec-apvf-fixture",
    type: "spec",
    title: "APVF Fixture Spec",
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

function makePlan(): DocRecord {
  return makeDoc({
    id: PLAN_ID,
    slug: "plan-apvf-fixture",
    type: "plan",
    title: "APVF Fixture Plan",
    content: "Plan goals.",
    parent_id: SPEC_ID,
  });
}

function makeTask(verificationEvidence: unknown[]): DocRecord {
  return makeDoc({
    id: TASK_ID,
    slug: "task-apvf-fixture",
    type: "task",
    title: "APVF Fixture Task",
    content: "Task content.",
    parent_id: PLAN_ID,
    extra: { plan_id: PLAN_ID, verification_evidence: verificationEvidence },
  });
}

function makeBundle(verificationEvidence: unknown[]): PlanBundle {
  return { plan: makePlan(), spec: makeSpecWithOneAc(), tasks: [makeTask(verificationEvidence)] };
}

/** Strips per-row evidence lines (`  [N] ...` and `      output_tail: ...`) from a rendered
 * prompt, leaving the shared skeleton (role, materials headers, facts, rubric, output
 * instruction) — used to prove the frozen and active builders share ONE core body rather
 * than two independently-maintained copies (AC-AEP-10). */
function stripEvidenceRows(prompt: string): string {
  return prompt
    .split("\n")
    .filter((line) => !/^ {2}\[\d+\]/.test(line) && !/^ {6}output_tail:/.test(line))
    .join("\n");
}

// ─── AC-AEP-9: getAssessTemplate(6) stays frozen at the PRE-projection shape ───

describe("AC-AEP-9: ASSESS_PROMPT_VERSION is 7 and getAssessTemplate(6) renders the frozen pre-projection shape", () => {
  it("STATE: ASSESS_PROMPT_VERSION is 7, the active registry entry", () => {
    expect(ASSESS_PROMPT_VERSION).toBe(7);
    expect(ASSESS_TEMPLATES[ASSESS_PROMPT_VERSION]).toBeDefined();
  });

  it("HAPPY: getAssessTemplate(6) renders a row byte-identical to the LITERAL pre-projection output captured from a639485^ (never derived by calling the frozen renderer and comparing it to itself)", () => {
    const templateResult = getAssessTemplate(6);
    expect(templateResult.ok).toBe(true);
    if (!templateResult.ok) return;

    const bundle = makeBundle([
      {
        oracle: "test",
        command: "bun test widget.test.ts",
        result: "pass",
        recorded_at: "2026-01-01T00:00:00.000Z",
        recorded_by: "alice",
        ac_ref: "AC-Y-1",
        output_tail: "legacy tail text",
      },
    ]);

    const { prompt } = templateResult.value(bundle, undefined, BUDGETS);

    // reason: LITERAL string captured verbatim from `git show a639485^:packages/lore/src/ai/
    // assess-template.ts`'s renderTaskEvidence — the pre-D1 format (oracle/command/result/
    // recorder + unconditional 500-char tail clip). This is a fixed string, not a call
    // through the production renderer, so it CAN fail if the frozen entry ever drifts.
    const expectedFrozenLine =
      '  [1] oracle=test command="bun test widget.test.ts" result=pass recorder=alice\n' +
      "      output_tail: legacy tail text";
    expect(prompt).toContain(expectedFrozenLine);

    // reason: the frozen shape has NO concept of ac_ref/tail_bytes — their presence would
    // mean the "frozen" entry silently started tracking whatever renderTaskEvidence (the
    // active renderer) does today, defeating the whole point of the freeze.
    expect(prompt).not.toContain("ac_ref=");
    expect(prompt).not.toContain("tail_bytes=");
  });

  it("BOUNDARY: an ABSENT output_tail renders the frozen line with NO output_tail suffix at all (unlike the active v7 shape, which always shows tail_bytes=0)", () => {
    const templateResult = getAssessTemplate(6);
    expect(templateResult.ok).toBe(true);
    if (!templateResult.ok) return;

    const bundle = makeBundle([
      {
        oracle: "tsc",
        command: "bun run typecheck",
        result: "fail",
        recorded_at: "2026-01-01T00:00:00.000Z",
        recorded_by: "bob",
        // no ac_ref, no output_tail — the pre-D1 shape never rendered a tail suffix in this case
      },
    ]);

    const { prompt } = templateResult.value(bundle, undefined, BUDGETS);

    const expectedFrozenLine = '  [1] oracle=tsc command="bun run typecheck" result=fail recorder=bob';
    expect(prompt).toContain(expectedFrozenLine);
    expect(prompt).not.toContain("output_tail:");
    expect(prompt).not.toContain("tail_bytes=");
  });

  it("NEGATIVE: malformed verification_evidence (fails schema) renders \"(no evidence recorded)\" for the frozen entry, same fallback as before D1", () => {
    const templateResult = getAssessTemplate(6);
    expect(templateResult.ok).toBe(true);
    if (!templateResult.ok) return;

    // reason: missing required `oracle`/`result`/`command` fields fails evidenceEntrySchema.
    const bundle = makeBundle([{ nonsense: true }]);
    const { prompt } = templateResult.value(bundle, undefined, BUDGETS);
    expect(prompt).toContain("(no evidence recorded)");
  });
});

// ─── AC-AEP-10: getAssessTemplate(7) is the projected shape, sharing ONE builder body ───

describe("AC-AEP-10: getAssessTemplate(7) renders the projected shape via the shared (not duplicated) builder core", () => {
  it("HAPPY: getAssessTemplate(7) renders the (oracle, ac_ref, result, command, tail_bytes) projected shape", () => {
    const templateResult = getAssessTemplate(7);
    expect(templateResult.ok).toBe(true);
    if (!templateResult.ok) return;

    const bundle = makeBundle([
      {
        oracle: "test",
        command: "bun test widget.test.ts",
        result: "pass",
        recorded_at: "2026-01-01T00:00:00.000Z",
        recorded_by: "alice",
        ac_ref: "AC-Y-1",
        output_tail: "active tail text",
      },
    ]);

    const { prompt } = templateResult.value(bundle, undefined, BUDGETS);

    expect(prompt).toContain(
      'oracle=test ac_ref=AC-Y-1 result=pass command="bun test widget.test.ts" tail_bytes=' +
        Buffer.byteLength("active tail text", "utf8"),
    );
    expect(prompt).toContain("output_tail: active tail text");
    // reason: the projected shape never emits the OLD "recorder=" field.
    expect(prompt).not.toContain("recorder=");
  });

  it("STATE: getAssessTemplate(7) resolves to the SAME function reference as ASSESS_TEMPLATES[7] and buildAssessPromptV7 — the exported active-version alias, not a re-derivation", () => {
    const templateResult = getAssessTemplate(7);
    expect(templateResult.ok).toBe(true);
    if (!templateResult.ok) return;
    expect(templateResult.value).toBe(ASSESS_TEMPLATES[7]);
    expect(templateResult.value).toBe(buildAssessPromptV7);
  });

  it("REGRESSION for D2/AC-AEP-3: getAssessTemplate(7) still emits the frozen `task:<slug>` truncated[] vocabulary when the task block overflows budget", () => {
    const templateResult = getAssessTemplate(7);
    expect(templateResult.ok).toBe(true);
    if (!templateResult.ok) return;

    const tinyBudgets: AssessBudgets = { ...BUDGETS, max_task_chars: 5 };
    const bundle = makeBundle([]);
    const { truncated } = templateResult.value(bundle, undefined, tinyBudgets);
    expect(truncated).toContain("task:task-apvf-fixture");
  });

  it("CONTROL: ASSESS_TEMPLATES[6] and ASSESS_TEMPLATES[7] are DISTINCT function references — the frozen entry is not merely a relabeled active entry", () => {
    expect(ASSESS_TEMPLATES[6]).not.toBe(ASSESS_TEMPLATES[7]);
  });

  it("HAPPY: the frozen (6) and active (7) prompts are IDENTICAL outside the per-row evidence lines — one shared builder body, not a duplicated twin", () => {
    const frozenResult = getAssessTemplate(6);
    const activeResult = getAssessTemplate(7);
    expect(frozenResult.ok).toBe(true);
    expect(activeResult.ok).toBe(true);
    if (!frozenResult.ok || !activeResult.ok) return;

    const bundle = makeBundle([
      {
        oracle: "test",
        command: "bun test widget.test.ts",
        result: "pass",
        recorded_at: "2026-01-01T00:00:00.000Z",
        recorded_by: "alice",
        ac_ref: "AC-Y-1",
        output_tail: "shared-core probe tail",
      },
    ]);

    const frozenPrompt = frozenResult.value(bundle, undefined, BUDGETS).prompt;
    const activePrompt = activeResult.value(bundle, undefined, BUDGETS).prompt;

    // reason: a genuinely forked builder would drift on ANY unrelated prompt text edit —
    // stripping ONLY the evidence-row lines and finding the remainder byte-identical is
    // direct structural evidence the two entries share one core body (AC-AEP-10).
    expect(stripEvidenceRows(frozenPrompt)).toBe(stripEvidenceRows(activePrompt));
    // sanity: the prompts themselves are NOT identical (the evidence rows do differ) —
    // otherwise the strip-and-compare above would be vacuous.
    expect(frozenPrompt).not.toBe(activePrompt);
  });
});

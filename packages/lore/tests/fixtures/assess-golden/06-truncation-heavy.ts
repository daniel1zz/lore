/**
 * Golden fixture: truncation-heavy — plan/spec/task content and the attached diff all
 * exceed typical `ai.assess.*` character budgets, forcing `buildAssessPromptV6` to
 * truncate every section and emit a diff Truncation Manifest (bugfix F3). Probes
 * whether truncation-heavy runs still land on a defensible label rather than
 * collapsing to "not_met" purely because most of the materials were cut.
 */

import { makeDoc } from "./doc-builder.js";
import type { AssessGoldenFixture } from "./types.js";

const PLAN_ID = "01FIXTURE0006TRUNCPLAN000006";
const SPEC_ID = "01FIXTURE0006TRUNCSPEC000006";
const TASK_ID = "01FIXTURE0006TRUNCTASK000006";

/** Repeats a filler paragraph well past any of ai.assess.*'s default char budgets. */
function longFiller(label: string, repeats: number): string {
  return Array.from(
    { length: repeats },
    (_, i) => `${label} paragraph ${i + 1}: lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
  ).join("\n");
}

/** A synthetic multi-file diff, large enough to exceed max_diff_chars and trip the manifest. */
function buildLargeDiff(): string {
  const files = ["src/feature-a.ts", "src/feature-a.test.ts", "src/feature-b.ts", "src/feature-b.test.ts", "docs/notes.md"];
  return files
    .map(
      (f) =>
        `diff --git a/${f} b/${f}\n` +
        `index 0000001..0000002 100644\n` +
        `--- a/${f}\n` +
        `+++ b/${f}\n` +
        Array.from({ length: 400 }, (_, i) => `+line ${i} of ${f} — filler content to blow the diff budget`).join(
          "\n",
        ) +
        "\n",
    )
    .join("\n");
}

export const truncationHeavyFixture: AssessGoldenFixture = {
  name: "truncation-heavy",
  description: "Plan/spec/task content and diff all exceed budget, forcing truncation — expect 'partial'.",
  expectedLabel: "partial",
  diffText: buildLargeDiff(),
  bundle: {
    plan: makeDoc({
      id: PLAN_ID,
      slug: "plan-truncation-heavy",
      type: "plan",
      title: "Large migration with a sprawling plan doc",
      content: longFiller("Plan", 500),
      parent_id: SPEC_ID,
      extra: { ac_scope: ["AC-TRUNC-1"] },
    }),
    spec: makeDoc({
      id: SPEC_ID,
      slug: "spec-truncation-heavy",
      type: "spec",
      title: "Large migration spec",
      content: longFiller("Spec", 500),
      extra: {
        spec_kind: "tech",
        acceptance_criteria: [
          {
            id: "AC-TRUNC-1",
            statement: "The migration completes without data loss on the staging snapshot.",
            verify: { mode: "script", oracle: "e2e", command: "bunx playwright test migration.spec.ts" },
          },
        ],
      },
    }),
    tasks: [
      makeDoc({
        id: TASK_ID,
        slug: "task-truncation-heavy-run-migration",
        type: "task",
        title: "Run the migration against staging",
        content: longFiller("Task", 500),
        parent_id: PLAN_ID,
        extra: {
          plan_id: PLAN_ID,
          verification_evidence: [
            {
              oracle: "e2e",
              command: "bunx playwright test migration.spec.ts",
              result: "pass",
              recorded_at: "2026-01-01T00:00:00.000Z",
              recorded_by: "golden-fixture",
              ac_ref: "AC-TRUNC-1",
              output_tail: longFiller("Output", 50).slice(0, 4000),
            },
          ],
        },
      }),
    ],
  },
};

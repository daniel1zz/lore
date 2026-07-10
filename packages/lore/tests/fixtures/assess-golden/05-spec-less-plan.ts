/**
 * Golden fixture: spec-less plan — the plan hangs directly off a PRD (no spec parent),
 * so there is no declared-AC table to score against; the judge falls back to the
 * plan's own stated goals. Probes `computeAssessmentFacts`'s `scope: undefined`
 * degrade path (AC-ADF-10) and the verbatim-goals prompt fallback.
 */

import { makeDoc } from "./doc-builder.js";
import type { AssessGoldenFixture } from "./types.js";

const PLAN_ID = "01FIXTURE0005SPECLESSPLAN0005";
const TASK_ID = "01FIXTURE0005SPECLESSTASK0005";

export const specLessPlanFixture: AssessGoldenFixture = {
  name: "spec-less-plan",
  description: "Plan has no spec parent (no declared ACs at all) — expect 'partial'.",
  expectedLabel: "partial",
  bundle: {
    plan: makeDoc({
      id: PLAN_ID,
      slug: "plan-spec-less-cleanup",
      type: "plan",
      title: "Clean up dead feature-flag code",
      content:
        "Remove the three feature flags that have been at 100% rollout for over 6 months, " +
        "and delete their now-dead branches.",
      // reason: no parent_id at all (or a PRD parent, not modeled here) — the point is
      // `bundle.spec` stays undefined either way.
      parent_id: null,
    }),
    tasks: [
      makeDoc({
        id: TASK_ID,
        slug: "task-spec-less-remove-flags",
        type: "task",
        title: "Remove dead feature flags",
        content: "Removed two of the three flags; the third has a lingering caller in the mobile client.",
        parent_id: PLAN_ID,
        extra: {
          plan_id: PLAN_ID,
          verification_evidence: [
            {
              oracle: "test",
              command: "bun run test",
              result: "pass",
              recorded_at: "2026-01-01T00:00:00.000Z",
              recorded_by: "golden-fixture",
            },
          ],
        },
      }),
    ],
  },
};

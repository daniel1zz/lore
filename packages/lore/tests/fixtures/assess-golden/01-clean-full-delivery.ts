/**
 * Golden fixture: clean full delivery — every declared AC has passing evidence, no
 * scope drift, a linked knowledge doc. Probes the "everything went right" baseline —
 * a judge that can't reach "met" here has a systematic under-scoring bug, not a
 * legitimate finding.
 */

import { makeDoc } from "./doc-builder.js";
import type { AssessGoldenFixture } from "./types.js";

const PLAN_ID = "01FIXTURE0001CLEANPLAN000001";
const SPEC_ID = "01FIXTURE0001CLEANSPEC000001";
const TASK_ID = "01FIXTURE0001CLEANTASK000001";

export const cleanFullDeliveryFixture: AssessGoldenFixture = {
  name: "clean-full-delivery",
  description: "Every declared AC has passing evidence, no scope drift — expect 'met'.",
  expectedLabel: "met",
  bundle: {
    plan: makeDoc({
      id: PLAN_ID,
      slug: "plan-clean-full-delivery",
      type: "plan",
      title: "Ship the widget export button",
      content: "Add an export button to the widget toolbar and wire it to the CSV exporter.",
      parent_id: SPEC_ID,
      extra: { ac_scope: ["AC-CLEAN-1", "AC-CLEAN-2"] },
    }),
    spec: makeDoc({
      id: SPEC_ID,
      slug: "spec-clean-full-delivery",
      type: "spec",
      title: "Widget export button",
      content: "The widget toolbar gains an export button that downloads the current view as CSV.",
      extra: {
        spec_kind: "feature",
        acceptance_criteria: [
          {
            id: "AC-CLEAN-1",
            statement: "Clicking Export downloads a CSV of the current widget view.",
            verify: { mode: "script", oracle: "test", command: "bunx vitest run export-button.test.ts" },
          },
          {
            id: "AC-CLEAN-2",
            statement: "The export button is keyboard-accessible (Tab + Enter).",
            verify: { mode: "script", oracle: "e2e", command: "bunx playwright test export-a11y.spec.ts" },
          },
        ],
      },
    }),
    tasks: [
      makeDoc({
        id: TASK_ID,
        slug: "task-clean-implement-export-button",
        type: "task",
        title: "Implement export button + CSV wiring",
        content: "Wire the toolbar button to the existing CSV exporter service.",
        parent_id: PLAN_ID,
        extra: {
          plan_id: PLAN_ID,
          verification_evidence: [
            {
              oracle: "test",
              command: "bunx vitest run export-button.test.ts",
              result: "pass",
              recorded_at: "2026-01-01T00:00:00.000Z",
              recorded_by: "golden-fixture",
              ac_ref: "AC-CLEAN-1",
            },
            {
              oracle: "e2e",
              command: "bunx playwright test export-a11y.spec.ts",
              result: "pass",
              recorded_at: "2026-01-01T00:00:00.000Z",
              recorded_by: "golden-fixture",
              ac_ref: "AC-CLEAN-2",
            },
          ],
        },
      }),
    ],
    knowledge_links: [
      { slug: "knowledge-retro-clean-full-delivery", sub_type: "retro", title: "Retro: widget export button" },
    ],
  },
};

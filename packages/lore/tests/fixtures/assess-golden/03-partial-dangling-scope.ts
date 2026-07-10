/**
 * Golden fixture: partial delivery with a dangling scope id — one of two declared ACs
 * has passing evidence, the other has none, and the plan's `extra.ac_scope` claims a
 * THIRD id the spec no longer declares (`facts.scope.dangling`). Probes mid-range
 * scoring plus the scope-drift facts path (SPEC-040 D1).
 */

import { makeDoc } from "./doc-builder.js";
import type { AssessGoldenFixture } from "./types.js";

const PLAN_ID = "01FIXTURE0003PARTIALPLAN00003";
const SPEC_ID = "01FIXTURE0003PARTIALSPEC00003";
const TASK_ID = "01FIXTURE0003PARTIALTASK00003";

export const partialDanglingScopeFixture: AssessGoldenFixture = {
  name: "partial-dangling-scope",
  description: "One of two ACs evidenced, plus a dangling ac_scope id — expect 'partial'.",
  expectedLabel: "partial",
  bundle: {
    plan: makeDoc({
      id: PLAN_ID,
      slug: "plan-partial-dangling-scope",
      type: "plan",
      title: "Add CSV import validation",
      content: "Validate uploaded CSV files before import; reject malformed rows with a report.",
      parent_id: SPEC_ID,
      // reason: AC-PART-3 is claimed in scope but the spec below never declares it —
      // this is the dangling-id case computeAssessmentFacts.scope.dangling surfaces.
      extra: { ac_scope: ["AC-PART-1", "AC-PART-2", "AC-PART-3"] },
    }),
    spec: makeDoc({
      id: SPEC_ID,
      slug: "spec-partial-dangling-scope",
      type: "spec",
      title: "CSV import validation",
      content: "CSV import validates rows and reports malformed ones without aborting the whole import.",
      extra: {
        spec_kind: "feature",
        acceptance_criteria: [
          {
            id: "AC-PART-1",
            statement: "Malformed rows are reported with their line number.",
            verify: { mode: "script", oracle: "test", command: "bunx vitest run csv-validation.test.ts" },
          },
          {
            id: "AC-PART-2",
            statement: "Valid rows still import when other rows in the same file are malformed.",
            verify: { mode: "script", oracle: "test", command: "bunx vitest run csv-partial-import.test.ts" },
          },
        ],
      },
    }),
    tasks: [
      makeDoc({
        id: TASK_ID,
        slug: "task-partial-implement-csv-validation",
        type: "task",
        title: "Implement CSV row validation + reporting",
        content: "Row validator implemented; partial-import path not yet verified.",
        parent_id: PLAN_ID,
        extra: {
          plan_id: PLAN_ID,
          verification_evidence: [
            {
              oracle: "test",
              command: "bunx vitest run csv-validation.test.ts",
              result: "pass",
              recorded_at: "2026-01-01T00:00:00.000Z",
              recorded_by: "golden-fixture",
              ac_ref: "AC-PART-1",
            },
          ],
        },
      }),
    ],
  },
};

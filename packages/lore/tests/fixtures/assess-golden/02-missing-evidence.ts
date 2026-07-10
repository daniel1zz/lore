/**
 * Golden fixture: missing evidence — two declared ACs, zero evidence recorded on the
 * plan's single task. Probes the "nothing was actually verified" floor — a judge that
 * reaches "met" here has a systematic over-scoring bug (hallucinating unearned trust).
 */

import { makeDoc } from "./doc-builder.js";
import type { AssessGoldenFixture } from "./types.js";

const PLAN_ID = "01FIXTURE0002MISSINGPLAN00002";
const SPEC_ID = "01FIXTURE0002MISSINGSPEC00002";
const TASK_ID = "01FIXTURE0002MISSINGTASK00002";

export const missingEvidenceFixture: AssessGoldenFixture = {
  name: "missing-evidence",
  description: "Two declared ACs, zero evidence recorded anywhere — expect 'not_met'.",
  expectedLabel: "not_met",
  bundle: {
    plan: makeDoc({
      id: PLAN_ID,
      slug: "plan-missing-evidence",
      type: "plan",
      title: "Add rate limiting to the ingest endpoint",
      content: "Add a token-bucket rate limiter in front of the ingest endpoint.",
      parent_id: SPEC_ID,
      extra: { ac_scope: ["AC-MISS-1", "AC-MISS-2"] },
    }),
    spec: makeDoc({
      id: SPEC_ID,
      slug: "spec-missing-evidence",
      type: "spec",
      title: "Ingest endpoint rate limiting",
      content: "The ingest endpoint rejects requests beyond a configured per-key rate.",
      extra: {
        spec_kind: "feature",
        acceptance_criteria: [
          {
            id: "AC-MISS-1",
            statement: "Requests beyond the configured rate receive HTTP 429.",
            verify: { mode: "script", oracle: "test", command: "bunx vitest run rate-limit.test.ts" },
          },
          {
            id: "AC-MISS-2",
            statement: "The rate limit is configurable per API key.",
            verify: { mode: "script", oracle: "test", command: "bunx vitest run rate-limit-config.test.ts" },
          },
        ],
      },
    }),
    tasks: [
      makeDoc({
        id: TASK_ID,
        slug: "task-missing-implement-rate-limiter",
        type: "task",
        title: "Implement token-bucket rate limiter",
        content: "Add the rate limiter middleware. (No verification run yet.)",
        parent_id: PLAN_ID,
        extra: {
          plan_id: PLAN_ID,
          // reason: deliberately empty — this fixture probes the zero-evidence floor.
          verification_evidence: [],
        },
      }),
    ],
  },
};

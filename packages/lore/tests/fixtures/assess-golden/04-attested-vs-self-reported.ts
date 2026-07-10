/**
 * Golden fixture: attested-vs-self-reported contrast — one declared AC is backed by
 * runner-attested evidence (`lore verify`, SPEC-039), the other by self-reported
 * evidence only (`lore evidence`). Both pass, so overall delivery is still "met" — but
 * this fixture exists to probe whether a judge (and the coverage-cell rendering it
 * reads) correctly distinguishes trust level without penalizing self-reported evidence
 * outright.
 */

import { makeDoc } from "./doc-builder.js";
import type { AssessGoldenFixture } from "./types.js";

const PLAN_ID = "01FIXTURE0004ATTESTPLAN00004";
const SPEC_ID = "01FIXTURE0004ATTESTSPEC00004";
const TASK_ID = "01FIXTURE0004ATTESTTASK00004";

export const attestedVsSelfReportedFixture: AssessGoldenFixture = {
  name: "attested-vs-self-reported",
  description: "One AC attested (lore verify), one self-reported (lore evidence) — expect 'met'.",
  expectedLabel: "met",
  bundle: {
    plan: makeDoc({
      id: PLAN_ID,
      slug: "plan-attested-vs-self-reported",
      type: "plan",
      title: "Harden the login rate limiter",
      content: "Tighten the login endpoint's rate limiter and add a manual smoke-test checklist.",
      parent_id: SPEC_ID,
      extra: { ac_scope: ["AC-ATT-1", "AC-ATT-2"] },
    }),
    spec: makeDoc({
      id: SPEC_ID,
      slug: "spec-attested-vs-self-reported",
      type: "spec",
      title: "Login rate limiter hardening",
      content: "The login endpoint's rate limiter is tightened and covered by an automated test plus a manual check.",
      extra: {
        spec_kind: "feature",
        acceptance_criteria: [
          {
            id: "AC-ATT-1",
            statement: "Automated test asserts the tightened rate-limit threshold.",
            verify: { mode: "script", oracle: "test", command: "bunx vitest run login-rate-limit.test.ts" },
          },
          {
            id: "AC-ATT-2",
            statement: "Manual smoke test confirms the login UI still works under the new limit.",
            verify: { mode: "human", note: "Log in 3 times rapidly and confirm the 4th is blocked with a clear message." },
          },
        ],
      },
    }),
    tasks: [
      makeDoc({
        id: TASK_ID,
        slug: "task-attested-tighten-rate-limiter",
        type: "task",
        title: "Tighten rate limiter + run smoke checklist",
        content: "Threshold lowered; automated test run via the trusted runner, manual checklist completed by hand.",
        parent_id: PLAN_ID,
        extra: {
          plan_id: PLAN_ID,
          verification_evidence: [
            {
              oracle: "test",
              command: "bunx vitest run login-rate-limit.test.ts",
              result: "pass",
              recorded_at: "2026-01-01T00:00:00.000Z",
              recorded_by: "lore-cli",
              ac_ref: "AC-ATT-1",
              attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 842, timed_out: false },
            },
            {
              oracle: "manual",
              command: "manual smoke checklist",
              result: "pass",
              recorded_at: "2026-01-01T00:00:00.000Z",
              recorded_by: "golden-fixture",
              ac_ref: "AC-ATT-2",
            },
          ],
        },
      }),
    ],
  },
};

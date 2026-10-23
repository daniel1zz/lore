---
id: KN-076
type: knowledge
role: knowledge
title: "Assessment: Implementation — SPEC-076 distribution integration + asset update convergence (2026-07-25)"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-10-23
tags: []
parent: PLAN-040
links:
  - {id: PLAN-040, type: informs}
---
# Assessment: met (86/100)

Scope: plan `01KYBJ277RX4YXQZR183Y68P2M`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-076-1 | 92 | plan-update.ts source visible in diff: digest short-circuit returns before any probe call (zero-sha-comparison pin), closed five-state union, probe-throw→STORE_ERROR. RED (15 failing) → GREEN (15 pass) attested by main-orchestrator. | 01KYBJ6APDRVG0A8YXKDTJPVWE (attested vitest 15 pass), 01KYBJ67FNEZTSNWE0Q396Y88X (T3 impl), 01KYBJ692X1JNNBHMVAA3B83P0 (T3r RED) |
| AC-076-2 | 88 | Attested bun test output names H1 (fresh converge → exit 0, empty buckets, cache status=sync) and N1 (mutated file → exit 3, exactly that path under files.diverged), plus a mutex negative. setup-check.ts itself is unseen (truncated). | 01KYBJ6APDRVG0A8YXKDTJPVWE (attested, output_tail names H1/N1), 01KYBJ689YMFFETFJP1934T73V (T4 impl) |
| AC-076-3 | 87 | Attested output shows H1 (user-modified managed file survives plain --yes byte-unchanged + literal repair command) and H2 (--json/stdout parity). The --force-diverged restore+backup leg is asserted in the AC and covered by AC-076-10's e2e but its own tail is truncated. | 01KYBJ6APDRVG0A8YXKDTJPVWE (attested), 01KYBJ68PRPCNQYA0PN7HVD5CY (T5 converge hardening) |
| AC-076-4 | 85 | Attested tail names golden forms (a) and (b); form (c) — the user-authored case where 'bytes outside markers byte-identical' actually has data at stake (R3) — is cut off mid-line, so the highest-risk leg is inferred, not seen. | 01KYBJ6APDRVG0A8YXKDTJPVWE (attested; tail truncated before form (c)), 01KYBJ69W4NRP2ENDF2SPY44W1 (T6 marker migration) |
| AC-076-5 | 90 | merge-settings.ts diff shows the orphan rule (path-substring match ∧ not in loreEntries), prunedCount as an additive result field, and opt-in hooksPathPrefix preserving pre-076 behavior. 5 vitest cases pass, attested. | 01KYBJ6APDRVG0A8YXKDTJPVWE (attested 5 pass), 01KYBJ69F95MF3T9G14FWMV4P4 (T7 impl) |
| AC-076-6 | 88 | Schema half visible in setup-manifest.ts diff (additive-optional binary_version/installed_at/assets_digest + ownership enum). Attested tail names H1 stamping match against the running binary's embedded values and H2 ownership; ISO8601 parse leg not shown in tail. | 01KYBJ6APDRVG0A8YXKDTJPVWE (attested 3 pass), 01KYBJ66NJH4E7RFNDF3ZN6PQN (T2 schema) |
| AC-076-7 | 86 | 13 vitest cases pass attested, incl. a REAL detached-subprocess R2 oracle and the <100ms non-blocking pin. The tail shown covers BOUNDARY cases; the sync/stale byte-count and LORE_SETUP_NO_CHECK zero-spawn legs are claimed in ACs but not visible in the tail. | 01KYBJ6APDRVG0A8YXKDTJPVWE (attested 13 pass), 01KYBPG73Z233Y0K6BSVHQECE0 (T8b knob wiring) |
| AC-076-8 | 90 | Attested tail explicitly names the 7→5 prune removing the 2 OLDEST by timestamp name plus the at-or-below-keep boundary; RED evidence recorded the pre-impl length 7 failure, so the test is known to discriminate. | 01KYBJ6APDRVG0A8YXKDTJPVWE (attested), 01KYBJ672BYVKJR8E59PX7Q3PS (T7r RED confirmed length 7) |
| AC-076-9 | 90 | Attested build oracle prints OK with 292 files and a concrete tree_digest. R1 (generation-before-compile ordering) is claimed via T1's `bun run build` evidence but build.ts is truncated, so the ordering assertion itself is unseen. | 01KYBJ6APDRVG0A8YXKDTJPVWE (attested --check OK), 01KYBJ668WZAKN5XW3V6A4VMFE (T1) |
| AC-076-10 | 90 | Compiled-binary e2e attested: fresh converge → sync exit 0, mutation → exit 3 with exactly that path under diverged. T9 reports 5 pass / 28 expect() calls against a throwaway --claude-dir; the force-diverged-restore leg's tail is cut but is a declared scenario. | 01KYBJ6APDRVG0A8YXKDTJPVWE (attested e2e), 01KYBJ6A9A27QRWZ0D6FE9JAP3 (T9, 5 pass/28 expects) |

## Gaps

- The diff bundles an entire SPEC-077 feature (dashboard /execution page, four panels, GET /api/phase-status route, ready-route claim_ttl_minutes enrichment, api.ts client changes) alongside SPEC-076. None of the plan's 12 tasks, ACs, or Decisions Log entries mention it, so it lands unreviewed against this plan's exit criteria.
- classifyEntry returns `diverged` whenever diskSha !== manifestSha, including the case where the installed manifest simply has no entry for the path but the disk bytes already equal the embedded sha. A manifest loss or a newly-added embedded path present on disk therefore reports diverged instead of sync, blocking overwrite behind --force-diverged.
- UpdatePlan.markerRewrites is documented as always empty and T6 implemented CLAUDE.md marker migration in setup-project-flow.ts instead. The pure planner's contract advertises a bucket that no code populates, leaving the converge path's marker handling outside the five-state plan.
- Orphan pruning uses `command.includes(hooksPathPrefix)`. Any foreign settings.json hook whose command string happens to contain the lore hooks-directory path (a wrapper, a logging shim, a comment-bearing command) is pruned and counted, contradicting the 'non-lore entries byte-identical' half of the AC. No visible NEGATIVE case covers that shape.
- Invariant I4 (--check writes only the cache; manifest and target-file mtimes unchanged) is declared as a T4 AC but no attested evidence entry shows the mtime-invariance assertion running. The attested setup-check tail names only exit codes, JSON buckets, and cache status.
- attested_evidence_ratio 0.23: only the T10 close-out entries are runner-attested. T5's evidence [4] concatenates multiple commands plus prose counts into one `command` field, and T3r/T7r record result=pass for exit-1 runs — both patterns make evidence non-replayable at face value.

## Recommendations

- Require the assess diff range to be scoped to the plan's own commits, or explicitly declare co-landed sibling-spec work (here SPEC-077) in the Decisions Log with a pointer to its own plan and ACs before close-out.
- Add a plan-update scenario for 'disk sha equals embedded sha but installed manifest has no entry for the path' and pin the intended state (sync vs diverged) in the RED test file.
- Either wire markerRewrites population into planUpdate (T6 follow-up) or delete the field from UpdatePlan and the Downstream Handoff contract.
- Specify lore-owned hook identification for pruning as a path-boundary/filename-set match rather than substring containment, and add a foreign-command NEGATIVE oracle to AC-076-5.
- Enforce an evidence schema: one command per entry, mandatory output_tail, and result mirroring the actual exit code (RED runs recorded as result=fail with an expected-red marker).

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 94820ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:assets/hooks/session-start-resume.mjs, diff:assets/project/CLAUDE.md.template, diff:packages/dashboard/CLAUDE.md, diff:packages/dashboard/src/lib/api.ts, diff:packages/dashboard/tests/component/ActivePlansPanel.test.tsx, diff:packages/dashboard/tests/component/AnchorConflictsPanel.test.tsx, diff:packages/dashboard/tests/component/DocDetail.test.tsx, diff:packages/dashboard/tests/component/ExecutionPage.test.tsx, diff:packages/dashboard/tests/component/PhaseProgressPanel.test.tsx, diff:packages/dashboard/tests/component/PlanExecution.test.tsx, diff:packages/dashboard/tests/component/ReadyTaskList.test.tsx, diff:packages/dashboard/tests/component/SessionsPanel.test.tsx, diff:packages/dashboard/tests/e2e/execution.pw.ts, diff:packages/dashboard/tests/e2e/seed-execution-fixture.ts, diff:packages/dashboard/tests/unit/lib/api.test.ts, diff:packages/dashboard/tests/unit/lib/use-route-telemetry.test.ts, diff:packages/lore/src/adapters/cli/commands/setup.ts, diff:packages/lore/src/adapters/cli/setup-check.ts, diff:packages/lore/src/adapters/real-asset-source.ts, diff:packages/lore/src/adapters/real-setup-fs.ts, diff:packages/lore/src/flows/setup-project-flow.ts, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/src/service/phase-workflow-service.ts, diff:packages/lore/src/service/setup-service.ts, diff:packages/lore/tests/e2e/setup-freshness-cycle.bun.test.ts, diff:packages/lore/tests/http/phase-status.bun.test.ts, diff:packages/lore/tests/integration/setup-backup-prune.bun.test.ts, diff:packages/lore/tests/integration/setup-check.bun.test.ts, diff:packages/lore/tests/integration/setup-converge-diverged.bun.test.ts, diff:packages/lore/tests/integration/setup-manifest-fields.bun.test.ts, diff:packages/lore/tests/integration/setup-user-once-marker.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/ready-route.bun.test.ts, diff:packages/lore/tests/unit/adapters/http/routes.test.ts, diff:packages/lore/tests/unit/adapters/real-asset-source-ownership.test.ts, diff:packages/lore/tests/unit/adapters/setup-render-next-steps.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/build/embed-assets-manifest.test.ts, diff:packages/lore/tests/unit/core/merge-settings-prune.test.ts, diff:packages/lore/tests/unit/core/plan-update.test.ts, diff:packages/lore/tests/unit/core/setup-manifest-ownership.test.ts, diff:packages/lore/tests/unit/flows/setup-project-claudemd.test.ts, diff:packages/lore/tests/unit/hooks/session-start-freshness.test.ts, diff:scripts/build.ts, diff:scripts/embed-assets-manifest.d.mts, diff:scripts/embed-assets-manifest.mjs

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.78 | evidence | All 10 spec ACs have attested passing runs incl. a compiled-binary e2e; visible core source (plan-update, merge-settings, manifest schema) matches the spec's design. Minor classification edge unresol… |
| evidence_integrity | 76 | 0.72 | evidence | Every AC has ≥1 attested run with real output tails, and RED→GREEN pairs prove discrimination. But ratio 0.23, several tails absent/truncated, one multi-command evidence entry, RED runs marked pass. |
| scope_fidelity | 55 | 0.85 | evidence | Substantial SPEC-077 dashboard + phase-status HTTP work appears in the landed diff with no task, AC, or Decisions Log entry in this SPEC-076 plan. Setup-domain work itself stayed on its declared anch… |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | The diff bundles an entire SPEC-077 feature (dashboard /execution page, four panels, GET /api/phase-status route, ready-route claim_ttl_minutes enrichment, api.ts client changes) alongside SPEC-076. None of the plan's 12 tasks, ACs, or Decisions Log entries mention it, so it lands unreviewed against this plan's exit criteria. |
| outcome | minor | AC-076-1 | classifyEntry returns `diverged` whenever diskSha !== manifestSha, including the case where the installed manifest simply has no entry for the path but the disk bytes already equal the embedded sha. A manifest loss or a newly-added embedded path present on disk therefore reports diverged instead of sync, blocking overwrite behind --force-diverged. |
| outcome | minor | AC-076-4 | UpdatePlan.markerRewrites is documented as always empty and T6 implemented CLAUDE.md marker migration in setup-project-flow.ts instead. The pure planner's contract advertises a bucket that no code populates, leaving the converge path's marker handling outside the five-state plan. |
| outcome | minor | AC-076-5 | Orphan pruning uses `command.includes(hooksPathPrefix)`. Any foreign settings.json hook whose command string happens to contain the lore hooks-directory path (a wrapper, a logging shim, a comment-bearing command) is pruned and counted, contradicting the 'non-lore entries byte-identical' half of the AC. No visible NEGATIVE case covers that shape. |
| evidence_integrity | minor | AC-076-2 | Invariant I4 (--check writes only the cache; manifest and target-file mtimes unchanged) is declared as a T4 AC but no attested evidence entry shows the mtime-invariance assertion running. The attested setup-check tail names only exit codes, JSON buckets, and cache status. |
| evidence_integrity | minor | — | attested_evidence_ratio 0.23: only the T10 close-out entries are runner-attested. T5's evidence [4] concatenates multiple commands plus prose counts into one `command` field, and T3r/T7r record result=pass for exit-1 runs — both patterns make evidence non-replayable at face value. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require the assess diff range to be scoped to the plan's own commits, or explicitly declare co-landed sibling-spec work (here SPEC-077) in the Decisions Log with a pointer to its own plan and ACs before close-out. | A third of the reviewed diff belongs to a different spec, so this plan's exit criteria implicitly bless unreviewed code. |
| plan | Add a plan-update scenario for 'disk sha equals embedded sha but installed manifest has no entry for the path' and pin the intended state (sync vs diverged) in the RED test file. | Current code silently routes byte-correct files to diverged, which gates them behind --force-diverged. |
| plan | Either wire markerRewrites population into planUpdate (T6 follow-up) or delete the field from UpdatePlan and the Downstream Handoff contract. | An always-empty action bucket in a five-state planner misleads future service-layer consumers. |
| spec | Specify lore-owned hook identification for pruning as a path-boundary/filename-set match rather than substring containment, and add a foreign-command NEGATIVE oracle to AC-076-5. | AC-076-5 promises non-lore entries stay byte-identical; substring matching cannot guarantee that. |
| process | Enforce an evidence schema: one command per entry, mandatory output_tail, and result mirroring the actual exit code (RED runs recorded as result=fail with an expected-red marker). | Several entries here are not replayable and one inverts its exit code, weakening the trail despite green ACs. |

## Unverifiable Materials

- packages/lore/src/adapters/cli/setup-check.ts, service/setup-service.ts, adapters/real-asset-source.ts, generated/assets-manifest.ts, scripts/embed-assets-manifest.mjs, scripts/build.ts, assets/hooks/session-start-resume.mjs: Truncated from the diff; --check zero-write behavior, manifest stamping, build ordering (R1), and hook Phase F fail-open are judged only from attested test output.
- All 30 test files (plan-update.test.ts, setup-check/converge-diverged/user-once-marker/manifest-fields/backup-prune bun tests, session-start-freshness.test.ts, e2e cycle): Omitted; assertion strength and whether the tests would actually fail on regression are inferred from RED-phase records and output tails only.
- T10 close-out oracles beyond the 10 AC commands (bun run typecheck, full both-runner suite, lore verify --yes, lore status --check-drift, lore assess --diff verdict): Declared as T10 ACs but no evidence entries for typecheck, full-suite, status, or assess appear in the task's 10 recorded entries.

## Facts Summary

- AC coverage: 10 declared criteria
- Task evidence: 13 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.23

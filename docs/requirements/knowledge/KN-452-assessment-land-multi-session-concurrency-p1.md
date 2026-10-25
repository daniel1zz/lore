---
id: KN-452
type: knowledge
role: knowledge
title: "Assessment: Land multi-session concurrency P1: queryable ownership of worktrees, branches and sessions (2026-08-13)"
status: archived
priority: medium
created: 2026-08-13
updated: 2026-10-23
tags: []
parent: PLAN-129
links:
  - {id: PLAN-129, type: informs}
---
# Assessment: partially_met (78/100)

Scope: plan `01KZV0A0KC19BJD13WPZ88N00P`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-OWN-1 | 82 | Red-then-green attested (5 pass), plus remediation closing the two real defects: claim-derived discovery set and the unfalsifiable sum-equals-total check, now fed by listLocalBranches. Whether the LIVE command passes the enumeration (4th param) is asserted only in a truncated test file. | task-thread-real-local-branch-enumeration-from-the-git-port (expected-fail then 2 attested passes), task-lore-territory-s-discovery-set-is-claim-derived-so-an (found the drop defect) |
| AC-OWN-2 | 88 | Diff shows auto-capture inside TaskWorkflowService.claim (explicit --branch wins, unmeasured leaves field absent), and evidence is expected-fail then 3 attested passes naming the live claim() call site, incl. the unmeasured-not-unowned case. | task-bind-ownership-a-claim-records-its-branch-commits-carry (ev[1] red, ev[7]/[10]/[13] pass) |
| AC-OWN-3 | 88 | Red evidence shows the pre-change always-empty branches array failing the assertion; 3 attested passes drive SessionService.bootstrap and cover the detached-HEAD empty case. Live call site, not a schema-only claim. | task-bind-ownership-a-claim-records-its-branch-commits-carry (ev[2] red, ev[8]/[11]/[14] pass) |
| AC-OWN-4 | 68 | Gen-3 tightening is documented pre-dispatch and bind+unbind now pass through TaskWorkflowService (5 attested). But the oracle only ever builds default-hooksPath repos; this repo's own core.hooksPath makes the hook inert, and the 'skip loud' half of that fix is unverifiable here. | task-wire-unbindclaimsessionfortrailer-into-lore-release-the (red then attested pass, live call sites), task-the-lore-session-trailer-is-inert-whenever-core-hookspath (inertness under this repo's hooksPath) |
| AC-OWN-5 | 72 | 4 attested passes and a command-level `lore session list --json` oracle added on remediation. But liveness rests on a tmpdir heartbeat recording process.ppid, not the orchestrator pid on TaskClaim; a peer that never ran the command is always 'unmeasured'. Coverage is real but narrower than the stat… | task-ac-own-5-s-oracle-exercises-only-the-pure-verdict-function (pure-only oracle found, command oracle added) |
| AC-REPLAY-1 | 80 | One attested fail is honest and correct (count fact unreachable), resolved by adding countUnmergedCommits rather than weakening the AC; 6 attested passes and the stale test title/comment were rewritten. Assets + manifest changes are present but unseen. | task-add-a-per-branch-unmerged-commit-count-to-gitport-and (red preserved, then pass), task-prove-sufficiency-replay-the-2026-08-11-diagnosis-through (attested fail retained in trail) |

## Gaps

- ensureSessionTrailerHookInstalled in packages/lore/src/adapters/real-git-port.ts returns ok("skipped-unsafe-hooks-path") whenever core.hooksPath resolves outside the git dir — this repo's own configuration — and bindClaimSessionForTrailer discards that status entirely, so the trailer silently no-ops in production while the AC is attested green. The oracle passes only because it creates default-hooksPath repos.
- Liveness is backed by a tmpdir sidecar (packages/lore/src/adapters/session-heartbeat-port.ts) written only by packages/lore/src/adapters/cli/commands/session.ts, and it records process.ppid rather than the orchestrator pid. A peer session that never ran `lore session list|show` is always "unmeasured", so the AC's "each liveness verdict" holds only for self-registered sessions.
- The original sum-equals-total assertion could not fail by construction: the discovered total in packages/lore/src/adapters/cli/territory-partition.ts was derived from the same claim-derived set as the partition. Remediation added local-branch enumeration, but whether packages/lore/src/adapters/cli/commands/territory.ts actually supplies it to partitionTerritory is asserted only in a truncated test file.
- attested_evidence_ratio is 0.63 — over a third of evidence rows are self-reported rather than trusted-runner attested, across nine tasks.
- The change compresses unrelated service-doc lines (AcService, DriftCheckService, done() floors, context two-zone) in packages/lore/src/service/CLAUDE.md with no AC requiring it; plausibly forced by the byte-ceiling lint, but the eviction is undeclared in the plan.

## Recommendations

- Require every capability-flavoured AC to name the production call-site file in file_anchors alongside the capability file, and to assert the call site in its oracle.
- Extend AC-OWN-4's oracle with a repo configured with core.hooksPath outside the git dir, asserting either a working trailer or a loud surface warning.
- Schedule pid + process start time onto TaskClaim (P2 lease work) so peer liveness stops depending on the peer having invoked lore session itself.
- When an AC is tightened mid-plan, keep the pre-dispatch record as the standard, and require the assessment pass that found the gap to be linked from the AC row.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 114252ms
- Retried: false
- Truncated sections: task:task-wire-unbindclaimsessionfortrailer-into-lore-release-the, diff:.lore/export-index.json, diff:packages/lore/tests/unit/adapters/cli/lore-session-trailer.bun.test.ts, diff:packages/lore/tests/unit/service/active-sessions-branches.bun.test.ts, diff:packages/lore/tests/unit/service/claim-branch-binding.bun.test.ts, diff:.lore/export-index.json, diff:packages/lore/src/service/session-service.ts, diff:packages/lore/tests/unit/adapters/cli/territory-partition.bun.test.ts, diff:packages/lore/tests/unit/service/session-liveness-probe.bun.test.ts, diff:.lore/export-index.json, diff:assets/agents/lore-implementer.md, diff:assets/skills/lore-autopilot/SKILL.md, diff:packages/lore/src/adapters/cli/territory-partition.ts, diff:packages/lore/src/adapters/real-git-port.ts, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/src/service/seat-service.ts, diff:packages/lore/tests/integration/real-git-port.test.ts, diff:packages/lore/tests/integration/territory-replay.bun.test.ts, diff:packages/lore/tests/unit/adapters/cli/territory-partition.bun.test.ts, diff:packages/lore/src/adapters/cli/commands/session.ts, diff:packages/lore/tests/integration/territory-replay.bun.test.ts, diff:packages/lore/tests/unit/service/session-liveness-probe.bun.test.ts, diff:.lore/export-index.json, diff:packages/lore/src/adapters/real-git-port.ts, diff:packages/lore/tests/unit/adapters/cli/lore-session-trailer.bun.test.ts, diff:packages/lore/src/adapters/cli/territory-partition.ts, diff:packages/lore/tests/unit/adapters/cli/territory-partition.bun.test.ts, diff:.lore/export-index.json, diff:packages/lore/src/adapters/cli/commands/territory.ts, diff:packages/lore/src/adapters/cli/territory-partition.ts, diff:packages/lore/src/adapters/real-git-port.ts, diff:packages/lore/tests/unit/adapters/cli/territory-partition.bun.test.ts, diff:.lore/export-index.json, diff:packages/lore/src/adapters/real-git-port.ts, diff:packages/lore/src/service/task-workflow-service.ts, diff:packages/lore/tests/unit/adapters/cli/lore-session-trailer.bun.test.ts
- Reasoning clipped for: AC-OWN-5

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 80 | 0.7 | evidence | All six ACs green with red-first trails and live call sites; two capabilities (trailer under this repo's hooksPath, peer liveness) ship materially narrower than their statements read. |
| evidence_integrity | 72 | 0.75 | evidence | Reds preserved, gen-3 tightening documented before dispatch, failures not papered over. Offset: 0.63 attested ratio and four ACs that stayed green over unwired production paths. |
| scope_fidelity | 78 | 0.65 | evidence | Work stays inside P1; deviations (tmpdir heartbeat instead of TaskClaim pid, service-doc eviction, adapter-import exception) are disclosed with rationale rather than silent. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-OWN-4 | ensureSessionTrailerHookInstalled in packages/lore/src/adapters/real-git-port.ts returns ok("skipped-unsafe-hooks-path") whenever core.hooksPath resolves outside the git dir — this repo's own configuration — and bindClaimSessionForTrailer discards that status entirely, so the trailer silently no-ops in production while the AC is attested green. The oracle passes only because it creates default-hooksPath repos. |
| outcome | major | AC-OWN-5 | Liveness is backed by a tmpdir sidecar (packages/lore/src/adapters/session-heartbeat-port.ts) written only by packages/lore/src/adapters/cli/commands/session.ts, and it records process.ppid rather than the orchestrator pid. A peer session that never ran `lore session list\|show` is always "unmeasured", so the AC's "each liveness verdict" holds only for self-registered sessions. |
| evidence_integrity | major | AC-OWN-1 | The original sum-equals-total assertion could not fail by construction: the discovered total in packages/lore/src/adapters/cli/territory-partition.ts was derived from the same claim-derived set as the partition. Remediation added local-branch enumeration, but whether packages/lore/src/adapters/cli/commands/territory.ts actually supplies it to partitionTerritory is asserted only in a truncated test file. |
| evidence_integrity | minor | — | attested_evidence_ratio is 0.63 — over a third of evidence rows are self-reported rather than trusted-runner attested, across nine tasks. |
| scope_fidelity | minor | — | The change compresses unrelated service-doc lines (AcService, DriftCheckService, done() floors, context two-zone) in packages/lore/src/service/CLAUDE.md with no AC requiring it; plausibly forced by the byte-ceiling lint, but the eviction is undeclared in the plan. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| spec | Require every capability-flavoured AC to name the production call-site file in file_anchors alongside the capability file, and to assert the call site in its oracle. | Four wiring gaps on this plan share one cause: capability and its only production caller landed in different acceptance units. |
| spec | Extend AC-OWN-4's oracle with a repo configured with core.hooksPath outside the git dir, asserting either a working trailer or a loud surface warning. | The current oracle never drives the configuration this repo ships, so it certifies a no-op. |
| plan | Schedule pid + process start time onto TaskClaim (P2 lease work) so peer liveness stops depending on the peer having invoked lore session itself. | The tmpdir heartbeat is a disclosed workaround forced by anchor scoping, not the intended mechanism. |
| process | When an AC is tightened mid-plan, keep the pre-dispatch record as the standard, and require the assessment pass that found the gap to be linked from the AC row. | The gen-2→3 re-baseline record is the strongest integrity artifact here; make it routine rather than exceptional. |

## Unverifiable Materials

- packages/lore/src/adapters/real-git-port.ts final content (hooksPath skip disclosure, unbindClaimSessionForTrailer, listLocalBranches, countUnmergedCommits): Listed in the truncation manifest; only the earlier bind-only hunk is shown, so the loud-skip remediation cannot be confirmed.
- packages/lore/tests/unit/adapters/cli/territory-partition.bun.test.ts and tests/integration/territory-replay.bun.test.ts: Omitted; live-call-site assertions for localBranches threading and the four replay facts are visible only as test-title tails.
- assets/ merge-protocol change and generated/assets-manifest.ts regeneration: Omitted from the diff; AC-REPLAY-1's consumer-facing requirement is inferred from the manifest listing alone.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 6
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 9 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.63

---
id: KN-157
type: knowledge
role: knowledge
title: "Assessment: SPEC-046 Distribution P0+P1 — asset SSOT + local safe installer (2026-07-16)"
status: archived
priority: medium
created: 2026-07-16
updated: 2026-10-23
tags: []
parent: PLAN-033
links:
  - {id: PLAN-033, type: informs}
---
# Assessment: partially_met (63/100)

Scope: plan `01KXMYYX5CYYMMD7V1D5872BGE`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-046-A | 90 | Attested test pass: setup-pure.test.ts 31/31 green covering setup-manifest schema, planInstall, mergeSettings (malformed→err), register-mcp builder. Pure modules present in diff and match six-dimension claim. | task-skill-implement-lore-core-pure-setup-modules-six-dimension |
| AC-046-B | 89 | Attested pass: setup-service.test.ts 15/15 green; task documents dedicated I1-I5 tests + fault injection + I6 guard. Service impl not shown (truncated) but oracle is attested. | task-skill-implement-setupservice-lifecycle-invariant-tests-i1-i |
| AC-046-C | 87 | Attested pass: project-setup-service.test.ts 9/9 green; scaffold + hooks + core.hooksPath in throwaway git repo. Service wrapper shown in diff; flow truncated but oracle attested. | task-skill-implement-projectsetupservice-setup-project-flow-test |
| AC-046-D | 87 | Attested pass: assets-ssot.test.ts 45/45 green; conformance over assets/ tree incl. governance standalone parse + private-marker negative-grep. Asset files truncated but present per manifest. | task-skill-test-assets-ssot-conformance-test-ac-046-d |
| AC-046-E | 48 | Unstable: 2 attested FAILs vs 1 pass. Both failing runs show '1 error' despite 3934 tests passing — a persistent non-test error. Exit criterion requires reliably-green regression; oracle is flaky/failing, not GREEN. | task-skill-manual-owner-sandbox-smoke-install-re-run-uninstall-a (evidence [5][6]=fail, [7]=pass) |
| AC-046-F | 20 | Human reversibility/integration gate never executed: 0 pass 0 fail, task status=draft. Attached evidence re-runs unit/regression oracles, not the install→re-run-skipped→uninstall-restore smoke. The core acceptance gate is unverified. | task-skill-manual-owner-sandbox-smoke-install-re-run-uninstall-a |

## Gaps

- Full regression oracle (bun run typecheck && bun run test) failed in 2 of 3 attested runs, each reporting '1 error' alongside 3934 passing tests. Exit criteria demand reliably-green regression; current state is flaky/failing.
- The human reversibility/integration acceptance gate (install → correct receipt → re-run all-skipped → uninstall restores byte-identically, I3) was never executed: 0 pass / 0 fail, task in draft. This is the only end-to-end proof of the safe-installer's core promise.
- attested_evidence_ratio is 0.30; most implementation tasks carry self-reported (non-attested) oracle records, and several production/test files are truncated, so quality rests on attested oracle passes rather than reviewed impl.

## Recommendations

- Block AC-046-E closure until typecheck+test runs deterministically green; investigate the recurring '1 error' (likely an unhandled worker/env error) rather than accepting a single passing run among failures.
- Require the owner to run and attest the AC-046-F mktemp sandbox smoke, capturing the receipt and the uninstall byte-restore diff, before marking the plan met.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 56584ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:assets/agents/lore-explorer.md, diff:assets/agents/lore-implementer.md, diff:assets/agents/lore-planner.md, diff:assets/agents/lore-reviewer.md, diff:assets/governance/corpus-workflow.md, diff:assets/hooks/lore-gate-g1-spec-create.sh, diff:assets/hooks/lore-gate-g2-spec-promote.sh, diff:assets/hooks/lore-gate-g3-plan-promote.sh, diff:assets/hooks/lore-gate-g4-task-claim.sh, diff:assets/hooks/pre-subagent-gate.mjs, diff:assets/hooks/session-start-resume.mjs, diff:assets/hooks/stop-doc-sync.mjs, diff:assets/hooks/subagent-context.mjs, diff:assets/project/g1-spec-create.sh, diff:assets/project/g2-spec-promote.sh, diff:assets/project/g3-plan-promote.sh, diff:assets/project/g4-task-claim.sh, diff:assets/project/lore.tree.yaml.template, diff:assets/project/pre-push, diff:assets/skills/lore-autopilot/SKILL.md, diff:assets/skills/lore-doctor/SKILL.md, diff:assets/skills/lore-kickoff/SKILL.md, diff:assets/skills/lore-session/SKILL.md, diff:assets/skills/lore-session/references/knowledge-types.md, diff:assets/skills/lore/SKILL.md, diff:packages/lore/src/adapters/real-asset-source.ts, diff:packages/lore/src/adapters/real-mcp-registrar.ts, diff:packages/lore/src/adapters/real-setup-fs.ts, diff:packages/lore/src/flows/init-corpus.ts, diff:packages/lore/src/flows/setup-project-flow.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/lore/src/service/setup-service.ts, diff:packages/lore/tests/integration/cli/setup.test.ts, diff:packages/lore/tests/unit/adapters/real-setup-ports.test.ts, diff:packages/lore/tests/unit/adapters/setup-args.test.ts, diff:packages/lore/tests/unit/adapters/setup-render.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/core/setup-pure.test.ts, diff:packages/lore/tests/unit/flows/init-corpus.bun.test.ts, diff:packages/lore/tests/unit/service/project-setup-service.test.ts, diff:packages/lore/tests/unit/service/setup-service.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 65 | 0.72 | evidence | A–D strongly evidenced (attested passes); but E regression flaky (2/3 fail, '1 error') and F end-to-end reversibility gate never run. |
| evidence_integrity | 62 | 0.7 | evidence | Honest fail records present (good), but 0.30 attested ratio, mostly self-reported task evidence, and the F human gate has no execution record. |
| scope_fidelity | 84 | 0.68 | evidence | Diff stays within assets/ + setup module scope per plan; no unexplained drift observed. Several impl files truncated, limiting full verification. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-046-E | Full regression oracle (bun run typecheck && bun run test) failed in 2 of 3 attested runs, each reporting '1 error' alongside 3934 passing tests. Exit criteria demand reliably-green regression; current state is flaky/failing. |
| outcome | major | AC-046-F | The human reversibility/integration acceptance gate (install → correct receipt → re-run all-skipped → uninstall restores byte-identically, I3) was never executed: 0 pass / 0 fail, task in draft. This is the only end-to-end proof of the safe-installer's core promise. |
| evidence_integrity | minor | — | attested_evidence_ratio is 0.30; most implementation tasks carry self-reported (non-attested) oracle records, and several production/test files are truncated, so quality rests on attested oracle passes rather than reviewed impl. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Block AC-046-E closure until typecheck+test runs deterministically green; investigate the recurring '1 error' (likely an unhandled worker/env error) rather than accepting a single passing run among failures. | R1 (config-corruption) mitigation depends on a trustworthy green regression. |
| process | Require the owner to run and attest the AC-046-F mktemp sandbox smoke, capturing the receipt and the uninstall byte-restore diff, before marking the plan met. | I3 byte-identical restore has no automated end-to-end proof; only F exercises it. |

## Unverifiable Materials

- setup-service.ts, real-setup-fs.ts, real-mcp-registrar.ts, real-asset-source.ts, setup-project-flow.ts: Truncated from diff; only their attested oracle results are visible, not the implementation.
- AC-046-F execution record: Human oracle never run (0 pass / 0 fail); no receipt or restore artifact provided to verify reversibility.

## Facts Summary

- AC coverage: 6 declared criteria
- Task evidence: 10 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.30

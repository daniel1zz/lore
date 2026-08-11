---
id: KN-391
type: knowledge
role: knowledge
title: "Assessment: Implementation — project CLAUDE.md content contract (interface-first) (2026-07-27)"
status: draft
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-116
links:
  - {id: PLAN-116, type: informs}
---
# Assessment: met (83/100)

Scope: plan `01KYH2A452MHT2KRS1XQKDT43Y`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CMC-1 | 82 | Attested pass on the exact AC path (claude-md-check.test.ts, 6 tests). But the statement demands ceiling-1/ceiling+1 for BOTH metrics per BOTH roles (8 boundary cases) plus multibyte/disabled/empty; 6 total cases suggests roles may not both be boundary-covered. Test body unseen. | 01KYH2DESX8X07GHS2HQBW8R4R (attested vitest run, 6 tests) |
| AC-CMC-2 | 91 | Attested compiled-binary e2e pass; byte-identity and trailing-newline cases visible in output_tail. Diff confirms a topic registry with claude-md → assets/governance/claude-md-contract.md and exit 2 on >1 distinct topic. Multi-topic case itself not visible in the shown tail. | 01KYH2DESX8X07GHS2HQBW8R4R (governance-claude-md-compiled.bun.test.ts attested) |
| AC-CMC-3 | 85 | Attested integration pass on the exact AC path; visible case names cover the fixture-sanity and over-ceiling trip. The enabled:false and no-.lore fail-open cases are declared in the RED task but not visible in the recorded tail; hook file itself unseen. | 01KYH2DESX8X07GHS2HQBW8R4R (pre-push-claude-md-trip.bun.test.ts attested) |
| AC-CMC-4 | 92 | Attested compound run: parity suite 9/9 green AND embed-assets-manifest --check printed OK (293 files, tree_digest). Diff corroborates manifest-relevant asset registration (RETIRED_FROM_INSTALL_PATHS, DECLARED_FILES additions). | 01KYH2DESX8X07GHS2HQBW8R4R (parity + manifest --check exit 0) |
| AC-CMC-5 | 89 | Attested pass, 12/12 on the exact AC path; impl task tail records the lore-less fallback sentence and template size (1536B <2KB). Asset files themselves unseen, so command-literal/taxonomy-deletion assertions rest on the suite alone. | 01KYH2DESX8X07GHS2HQBW8R4R (init-context-contract.test.ts attested) |

## Gaps

- packages/core/src/archive-candidates.ts (301 new lines), packages/lore/src/adapters/cli/commands/archive.ts, the schemas.ts draft→archived transition widening, and session.ts archive_candidates plumbing all cite spec-lifecycle-archival-plan-close-cascade-deterministic — a different spec. No task in this plan covers them, and no note explains their presence in the reviewed range.
- The five module-CLAUDE.md compression tasks each declare four AC bullets (byte/line ceiling, status --check-claude-md JSON absence of own path, verbatim corpus snapshot, invariant preservation) but record exactly one manual `wc -c` entry with no output_tail. Byte counts, snapshot fidelity, and lint-clean status are asserted, not shown.
- AC-CMC-1 requires ceiling-1 and ceiling+1 fixtures for BOTH max_lines and max_bytes per role, plus a multibyte fixture. The suite reports 6 cases and the RED task lists 5 scenarios covering only root max_lines and module max_bytes at the boundary — module max_lines and root max_bytes boundaries appear unenumerated.
- CLOSE evidence [6] `bun run test`, [7] and [8] (two byte-identical `PATH=$PWD/dist:$PATH bash hooks/pre-push` entries) carry no output_tail, so the plan's 'full suite green on main' and 'git push succeeds through the four-check chain' exit criteria rest on unaudited self-report.
- Plan Exit Criteria name `lore status --check-drift` exit 0, `lore anchor add` code-anchor declaration, distribution domain-doc sync, and `lore assess` triage. Only the UAT item is corroborated (1 linked uat knowledge doc); the other four have no evidence entry in the record.

## Recommendations

- Derive the assess/review diff range strictly from the plan's first task commit and exclude commits attributable to other specs, or annotate cross-spec commits in the plan's Decisions Log when they must ride along.
- For docs-remediation tasks, require one evidence entry per AC bullet (wc output, status --check-claude-md --json filtered result, snapshot retrieval) with output_tail captured, rather than a single bare manual command.
- Add the missing AC-CMC-1 boundary fixtures (root max_bytes ±1, module max_lines ±1) so the executed case count visibly satisfies the AC's 'BOTH metrics per role' wording.
- Have the close-out runner attest and capture output_tail for the full-suite and push-chain runs, and reject duplicate identical evidence entries for the same command.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 69071ms
- Retried: false
- Truncated sections: diff:.lore/audit-anchor.json, diff:CHANGELOG.md, diff:CLAUDE.md, diff:assets/governance/claude-md-contract.md, diff:assets/governance/corpus-workflow.md, diff:assets/project/CLAUDE.md.template, diff:assets/project/pre-push, diff:assets/skills/lore-init-context/SKILL.md, diff:hooks/pre-push, diff:packages/core/tests/config-context.test.ts, diff:packages/core/tests/unit/archive-candidates.test.ts, diff:packages/dashboard/CLAUDE.md, diff:packages/lore/src/adapters/cli/CLAUDE.md, diff:packages/lore/src/adapters/cli/commands/status.ts, diff:packages/lore/src/adapters/mcp/CLAUDE.md, diff:packages/lore/src/generated/assets-manifest.ts, diff:packages/lore/src/service/CLAUDE.md, diff:packages/lore/src/service/audit-service.ts, diff:packages/lore/src/service/claude-md-check.ts, diff:packages/lore/src/service/corpus-service.ts, diff:packages/lore/src/service/session-service.ts, diff:packages/lore/tests/e2e/bootstrap-injection-compiled.bun.test.ts, diff:packages/lore/tests/e2e/governance-claude-md-compiled.bun.test.ts, diff:packages/lore/tests/integration/archive-sweep-cli.bun.test.ts, diff:packages/lore/tests/integration/plan-close-cascade.bun.test.ts, diff:packages/lore/tests/integration/pre-push-claude-md-trip.bun.test.ts, diff:packages/lore/tests/integration/status-claude-md.test.ts, diff:packages/lore/tests/unit/assets/init-context-contract.test.ts, diff:packages/lore/tests/unit/assets/pre-push-parity.test.ts, diff:packages/lore/tests/unit/service/claude-md-check.test.ts, diff:packages/lore/tests/unit/service/session-registry.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 89 | 0.8 | evidence | All 5 script ACs attested pass on their exact declared paths; diff corroborates config SSOT, topic registry, probe, and asset registration. Minor doubt on AC-CMC-1 boundary breadth. |
| evidence_integrity | 68 | 0.75 | evidence | Attested runs exist for all 5 ACs, but ratio is 0.15; 5 remediation tasks carry manual-only, output-less evidence, and three CLOSE entries have no tail. Exit-criteria items unrecorded. |
| scope_fidelity | 58 | 0.7 | evidence | Diff contains a whole undeclared archival feature plus 5 unplanned compression tasks. Compression is justified as contract remediation; archival is not traceable to any task here. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | — | packages/core/src/archive-candidates.ts (301 new lines), packages/lore/src/adapters/cli/commands/archive.ts, the schemas.ts draft→archived transition widening, and session.ts archive_candidates plumbing all cite spec-lifecycle-archival-plan-close-cascade-deterministic — a different spec. No task in this plan covers them, and no note explains their presence in the reviewed range. |
| evidence_integrity | major | — | The five module-CLAUDE.md compression tasks each declare four AC bullets (byte/line ceiling, status --check-claude-md JSON absence of own path, verbatim corpus snapshot, invariant preservation) but record exactly one manual `wc -c` entry with no output_tail. Byte counts, snapshot fidelity, and lint-clean status are asserted, not shown. |
| outcome | minor | AC-CMC-1 | AC-CMC-1 requires ceiling-1 and ceiling+1 fixtures for BOTH max_lines and max_bytes per role, plus a multibyte fixture. The suite reports 6 cases and the RED task lists 5 scenarios covering only root max_lines and module max_bytes at the boundary — module max_lines and root max_bytes boundaries appear unenumerated. |
| evidence_integrity | minor | — | CLOSE evidence [6] `bun run test`, [7] and [8] (two byte-identical `PATH=$PWD/dist:$PATH bash hooks/pre-push` entries) carry no output_tail, so the plan's 'full suite green on main' and 'git push succeeds through the four-check chain' exit criteria rest on unaudited self-report. |
| evidence_integrity | minor | — | Plan Exit Criteria name `lore status --check-drift` exit 0, `lore anchor add` code-anchor declaration, distribution domain-doc sync, and `lore assess` triage. Only the UAT item is corroborated (1 linked uat knowledge doc); the other four have no evidence entry in the record. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Derive the assess/review diff range strictly from the plan's first task commit and exclude commits attributable to other specs, or annotate cross-spec commits in the plan's Decisions Log when they must ride along. | A concurrent lifecycle-archival landing is currently indistinguishable from this plan's own scope drift. |
| plan | For docs-remediation tasks, require one evidence entry per AC bullet (wc output, status --check-claude-md --json filtered result, snapshot retrieval) with output_tail captured, rather than a single bare manual command. | Five tasks currently assert four checks each on one output-less manual record. |
| plan | Add the missing AC-CMC-1 boundary fixtures (root max_bytes ±1, module max_lines ±1) so the executed case count visibly satisfies the AC's 'BOTH metrics per role' wording. | 6 executed cases vs ~8 enumerated boundary cases leaves per-role coverage unproven. |
| process | Have the close-out runner attest and capture output_tail for the full-suite and push-chain runs, and reject duplicate identical evidence entries for the same command. | Exit criteria are the plan's strongest claims and currently carry the weakest records. |

## Unverifiable Materials

- packages/lore/tests/unit/service/claude-md-check.test.ts: Omitted from the diff; per-role boundary coverage for AC-CMC-1 judged only from the 6-test count and the RED task's 5-scenario list.
- hooks/pre-push and assets/project/pre-push: Omitted; the check-step content, fail-open preamble, and repair pointer are inferred from the parity suite result rather than read.
- assets/governance/claude-md-contract.md, CLAUDE.md.template, lore-init-context SKILL.md: Omitted; contract prose, no-numbers rule, pointer line, and taxonomy deletion rest entirely on the two asset suites.
- packages/lore/src/service/claude-md-check.ts and commands/status.ts: Omitted; the pure-lint measurement logic and the pre-loadLoreApp short-circuit (Invariant 2) could not be inspected directly.
- Provenance of the lifecycle-archival changes in the diff: No commit metadata is shown, so concurrent-session contamination versus in-plan scope drift cannot be distinguished.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 19 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.15

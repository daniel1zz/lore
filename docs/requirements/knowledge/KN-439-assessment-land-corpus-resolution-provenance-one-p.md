---
id: KN-439
type: knowledge
role: knowledge
title: "Assessment: Land corpus-resolution provenance: one pure resolver, one boundary detector, and a foreign-write guard keyed on declared intent (2026-08-12)"
status: archived
priority: medium
created: 2026-08-12
updated: 2026-10-23
tags: []
parent: PLAN-128
links:
  - {id: PLAN-128, type: informs}
---
# Assessment: met (84/100)

Scope: plan `01KZSVHABK7ZFMP7S3F1TPFKF3`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-CP-1 | 90 | Attested pass (18 tests) plus visible module: packages/core/src/corpus-provenance.ts is genuinely builtin-free, pure, and implements all four outcome rows exactly as the decision table states. Red-first expected-fail row present. Purity-census internals unseen. | 01KZSVJGXB99RWST3SKHVVFVH6 (attested pass, 18 tests; expected-fail row [1]) |
| AC-CP-2 | 86 | Attested pass; diff confirms relocation to corpus-resolution.ts, re-export from utils.ts preserving import sites, header claims rewritten, and wrappers ≤3 lines with the verbatim NO_DB_MESSAGE. Loud-message baseline equality and six-call-site checker queries not directly visible. | 01KZSVK0R3Y0ZYRRHADE8M35X8 (attested pass with AST/checker test names in tail) |
| AC-CP-3 | 84 | Two attested passes; tail shows cells 1/2a present with the ALLOWED-lands and REFUSED assertions. Guard module itself is truncated, so exit-4 / token literal and mktemp-outside-REPO_ROOT assertions are taken from evidence rather than reviewed. | 01KZSVKEREMB0VAX4VS2TBWAEM (two attested passes; expected-fail row [1]) |
| AC-CP-4 | 85 | Attested pass after a documented expected-fail; diff shows the seventh .strict() sub-predicate and resolveForeignCorpusWriteGateEnabled with default-ON polarity. The seven-key set and shared keyed-dispatch retrieval are asserted only inside the unseen test. | 01KZSVK0YRCYE6DWMDS7BE2B6Y (expected-fail then attested pass; config.ts diff visible) |
| AC-CP-5 | 80 | Attested pass, 7 tests. Both the MCP tools.ts change and the adapter test are truncated, so the typed spy asserting exactly-one invocation with provenance EXACTLY null and the cross-surface token equality are unverified from materials. | 01KZSVKF0A967MBQB8PHZAJ3K0 (attested pass, 7 tests; expected-fail row [1]) |

## Gaps

- The MCP adapter change (packages/lore/src/adapters/mcp/tools.ts) and its test are both truncated, so AC-CP-5's core claims — the typed spy asserting the predicate ran exactly once with provenance EXACTLY null, and token equality against the CLI string — are accepted purely from an attested pass tail showing 7 tests, with no reviewable mechanism.
- packages/lore/src/service/foreign-corpus-write-guard.ts is truncated. AC-CP-3's pinned oracle values (exit code EXACTLY 4, literal token gate:corpus-write:foreign-provenance) and lease-derived intent read from taskClaimSchema.worktree cannot be confirmed against source; only the CorpusService call sites and loader wiring are visible.
- packages/core/src/corpus-provenance.ts's isWithin rejects every candidate when root is '/' (degrades to startsWith("//")). The consumer packages/lore/src/adapters/cli/corpus-resolution.ts documents this and works around it via highestNonRootAncestor instead of the shared pure resolver handling the root boundary, leaving a latent trap for the next caller.
- packages/lore/src/adapters/cli/loader.ts calls resolveCorpus(process.cwd()) a second time after findLoreDbPath() already performed the identical resolution, adding two more git spawnSync probes (show-toplevel plus the common-dir pair) to every CLI invocation. Documented as deliberate, but it is a per-command cost with no measured bound in the evidence.
- packages/lore/src/service/corpus-service.ts exempts allowHandoff/allowUat creates from the guard. This exemption is reasoned inline but is not among the spec's named exemptions (only the HTTP null-provenance one is), and no AC cell asserts it, so it is an unfalsified carve-out in the refusal surface.
- Two of the three AC-CP-2 evidence rows carry ac_ref=(none), including a pass row whose command echo differs (unquoted) from the AC's declared verify command; only the third row binds to AC-CP-2. Attested ratio across the bundle is 0.46.

## Recommendations

- Add an AC row (or extend AC-CP-3) covering the allowHandoff/allowUat create exemption in packages/lore/src/service/corpus-service.ts so the carve-out is asserted rather than only commented.
- Move root-boundary handling into resolveCorpusProvenance's isWithin so callerTreeRoot='/' behaves sanely, and delete the highestNonRootAncestor workaround in the CLI adapter.
- Require ac_ref on every evidence row whose command is an AC verify script; reject rows whose command text diverges from the declared verify string.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 152078ms
- Retried: true
- Truncated sections: diff:packages/core/tests/corpus-provenance-resolver.test.ts, diff:packages/lore/tests/unit/adapters/corpus-resolver-collapse.test.ts, diff:packages/lore/tests/e2e/foreign-corpus-write-default.bun.test.ts, diff:packages/lore/src/service/foreign-corpus-write-guard.ts, diff:packages/lore/tests/e2e/foreign-corpus-write-guard.bun.test.ts, diff:packages/lore/src/adapters/mcp/tools.ts, diff:packages/lore/tests/unit/adapters/foreign-corpus-write-adapters.test.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 86 | 0.72 | evidence | All five ACs attested green; visible diff matches the plan's two phases — pure resolver, collapse+relocation, config sub-predicate, service guard, adapter wiring. |
| evidence_integrity | 82 | 0.7 | evidence | Every AC has runner-attested passes and each task carries a prior expected-fail row, so red-first is real; ratio 0.46 and two AC-CP-2 rows lack ac_ref. |
| scope_fidelity | 84 | 0.68 | evidence | Changes track D1-D6. Extras beyond the stated scope: handoff/UAT exemptions in corpus-service create, and a CLAUDE.md eviction, both documented inline. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-CP-5 | The MCP adapter change (packages/lore/src/adapters/mcp/tools.ts) and its test are both truncated, so AC-CP-5's core claims — the typed spy asserting the predicate ran exactly once with provenance EXACTLY null, and token equality against the CLI string — are accepted purely from an attested pass tail showing 7 tests, with no reviewable mechanism. |
| outcome | major | AC-CP-3 | packages/lore/src/service/foreign-corpus-write-guard.ts is truncated. AC-CP-3's pinned oracle values (exit code EXACTLY 4, literal token gate:corpus-write:foreign-provenance) and lease-derived intent read from taskClaimSchema.worktree cannot be confirmed against source; only the CorpusService call sites and loader wiring are visible. |
| outcome | minor | AC-CP-1 | packages/core/src/corpus-provenance.ts's isWithin rejects every candidate when root is '/' (degrades to startsWith("//")). The consumer packages/lore/src/adapters/cli/corpus-resolution.ts documents this and works around it via highestNonRootAncestor instead of the shared pure resolver handling the root boundary, leaving a latent trap for the next caller. |
| outcome | minor | AC-CP-2 | packages/lore/src/adapters/cli/loader.ts calls resolveCorpus(process.cwd()) a second time after findLoreDbPath() already performed the identical resolution, adding two more git spawnSync probes (show-toplevel plus the common-dir pair) to every CLI invocation. Documented as deliberate, but it is a per-command cost with no measured bound in the evidence. |
| scope_fidelity | minor | AC-CP-3 | packages/lore/src/service/corpus-service.ts exempts allowHandoff/allowUat creates from the guard. This exemption is reasoned inline but is not among the spec's named exemptions (only the HTTP null-provenance one is), and no AC cell asserts it, so it is an unfalsified carve-out in the refusal surface. |
| evidence_integrity | minor | AC-CP-2 | Two of the three AC-CP-2 evidence rows carry ac_ref=(none), including a pass row whose command echo differs (unquoted) from the AC's declared verify command; only the third row binds to AC-CP-2. Attested ratio across the bundle is 0.46. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add an AC row (or extend AC-CP-3) covering the allowHandoff/allowUat create exemption in packages/lore/src/service/corpus-service.ts so the carve-out is asserted rather than only commented. | An unasserted exemption in a refusal surface is the same false-oracle class the spec rejects for HTTP. |
| spec | Move root-boundary handling into resolveCorpusProvenance's isWithin so callerTreeRoot='/' behaves sanely, and delete the highestNonRootAncestor workaround in the CLI adapter. | The pure resolver is the shared surface; a documented trap there will be re-hit by MCP/HTTP callers. |
| process | Require ac_ref on every evidence row whose command is an AC verify script; reject rows whose command text diverges from the declared verify string. | Unbound pass rows weaken traceability even when the underlying run is attested. |

## Unverifiable Materials

- packages/lore/src/service/foreign-corpus-write-guard.ts: Omitted by the truncation manifest; exit-4 and token-literal behaviour taken from evidence tails.
- packages/lore/src/adapters/mcp/tools.ts: Omitted; MCP caller_cwd provenance derivation and token reuse not reviewable.
- All five test files for AC-CP-1..5: Omitted; purity census walk, checker queries, mktemp-outside-REPO_ROOT, seven-key set and typed spy asserted only in evidence tails.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 6
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 5 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.46

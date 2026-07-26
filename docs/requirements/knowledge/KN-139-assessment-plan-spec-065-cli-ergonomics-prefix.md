---
id: KN-139
type: knowledge
role: knowledge
title: "Assessment: Plan — SPEC-065 CLI ergonomics: prefix resolution + single-pass task validation (2026-07-23)"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: PLAN-054
links:
  - {id: PLAN-054, type: informs}
  - {id: KN-107, type: supersedes}
---
# Assessment: met (88/100)

Scope: plan `01KY6RYNRC1KQXHRMC15STFWNQ`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-065-1 | 90 | 3 attested + 1 self-reported pass. Diff shows resolveDoc calls store.findByIdPrefix after exact miss and resolves a single candidate; test asserts a unique 10-char prefix resolves. 'get and approve succeed' is covered by construction (both route through resolveDoc), not by literal command tests. | 01KY6RZDRTBTE63SBW6HY8KVGA (attested vitest -t AC-065-1 pass; resolve.ts + all 3 store impls in diff) |
| AC-065-2 | 87 | Attested pass; test asserts VALIDATION_ERROR whose message contains every candidate's full ID and slug — matches diff's candidateLines. Exit 4 itself relies on the pre-existing exitCode mapping (VALIDATION_ERROR→4) and is not directly exercised in any attested run. | 01KY6RZDRTBTE63SBW6HY8KVGA (attested vitest -t AC-065-2 pass; ambiguity branch in resolve.ts) |
| AC-065-3 | 90 | Attested pass; test asserts DOC_NOT_FOUND with a suggestions[] diagnostic containing '26' and the input length, matching diff's FULL_ULID_LENGTH diagnostic. Boundary cases (5-char floor, full-26-char miss, hyphenated slug) also covered in the same suite (self-reported full run). | 01KY6RZDRTBTE63SBW6HY8KVGA (attested vitest -t AC-065-3 pass) |
| AC-065-4 | 90 | Attested pass (2 tests matched -t filter). Test renders through the real formatTable pipeline and asserts every doc's slug appears; diff adds PendingDoc.slug (always present) and the Slug column via pending-render.ts, wired verbatim into commands/pending.ts. | 01KY6RZG5NRZ36GVX4DANGX9CW (attested vitest -t AC-065-4 pass; review-service.ts + pending-render.ts in diff) |
| AC-065-5 | 85 | Attested pass on the pure inferTaskParentId unit; diff shows create.ts passes its result as parent_id. End-to-end create (cli-create.bun.test.ts) is only self-reported. Edge: an empty-string --parent passes validation but yields parent_id "" instead of the plan id (check/infer inconsistency). | 01KY6RZK0VVZJGCRZBZ61Y7CGR (attested vitest -t AC-065-5 pass; wiring visible in create.ts diff) |
| AC-065-6 | 85 | Attested pass on the message-formatting units: both flags named in one string, single 'Error:' prefix, stable order. The actual process.exit(2) path is visible in the diff but only exercised by self-reported bun tests — no attested run asserts the exit code itself. | 01KY6RZK0VVZJGCRZBZ61Y7CGR (attested vitest -t AC-065-6 pass; exit(2) wiring in create.ts diff) |
| AC-065-7 | 88 | Attested pass; resolveDocId tested against InMemoryStore with a 12-char prefix. MCP inheritance is argued by construction (single shared resolver) and supported by the diff — plausible but not demonstrated with an actual MCP-surface test. | 01KY6RZDRTBTE63SBW6HY8KVGA (attested vitest -t AC-065-7 pass) |

## Gaps

- Empty-string --parent inconsistency: checkTaskCreateRequiredFlags treats "" as absent (passes validation when --plan-id present), but inferTaskParentId returns "" because it only checks !== undefined — the task gets parent_id "" instead of the inferred plan id.
- The AC requires exit 2; attested evidence only proves the pure formatting/check functions. The process.exit(2) path and exit-4 VALIDATION_ERROR mapping are exercised solely by self-reported bun test / prior mapping, never in an attested run.
- Attested runs each execute 1-2 tests with 12-13 skipped; the comprehensive runs (full resolve-prefix suite, typecheck, sqlite/turso store bun tests) are self-reported with no output captured, so the regression story rests on unverified records (attested ratio 0.58).

## Recommendations

- Require attestation (captured output) for at least one full-suite run and the typecheck per task, not only the per-AC -t filtered runs.
- Add a follow-up fix normalizing empty/whitespace-only --parent to undefined before inferTaskParentId, plus a test for `--parent "" --plan-id X`.
- For exit-code-bearing ACs, require the verify command to assert the actual process exit code (bun-level CLI test) rather than only the mapped error code.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 68260ms
- Retried: false
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 90 | 0.85 | evidence | All 7 ACs pass with attested runs; diff implements prefix resolution in all 3 stores + resolve.ts, slug column, and single-pass validation exactly as planned. Only a minor empty-string edge case. |
| evidence_integrity | 78 | 0.8 | evidence | Attested runs are narrow -t filters (1-2 tests each); full suites, typecheck, and process-exit bun tests are self-reported (ratio 0.58). What is attested matches the diff's tests. |
| scope_fidelity | 93 | 0.85 | evidence | Diff maps cleanly to D1-D4: store method, resolve.ts, pending slug, create-task validation, plus CLAUDE.md docs and one mechanical test-delegate fix. No unexplained drift. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-065-5 | Empty-string --parent inconsistency: checkTaskCreateRequiredFlags treats "" as absent (passes validation when --plan-id present), but inferTaskParentId returns "" because it only checks !== undefined — the task gets parent_id "" instead of the inferred plan id. |
| evidence_integrity | minor | AC-065-6 | The AC requires exit 2; attested evidence only proves the pure formatting/check functions. The process.exit(2) path and exit-4 VALIDATION_ERROR mapping are exercised solely by self-reported bun test / prior mapping, never in an attested run. |
| evidence_integrity | minor | — | Attested runs each execute 1-2 tests with 12-13 skipped; the comprehensive runs (full resolve-prefix suite, typecheck, sqlite/turso store bun tests) are self-reported with no output captured, so the regression story rests on unverified records (attested ratio 0.58). |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require attestation (captured output) for at least one full-suite run and the typecheck per task, not only the per-AC -t filtered runs. | The broad regression evidence is currently all self-reported; attesting it would raise the 0.58 ratio and close the largest integrity gap. |
| plan | Add a follow-up fix normalizing empty/whitespace-only --parent to undefined before inferTaskParentId, plus a test for `--parent "" --plan-id X`. | Closes the check/infer inconsistency that can persist parent_id "" — the one behavioral edge the current tests miss. |
| spec | For exit-code-bearing ACs, require the verify command to assert the actual process exit code (bun-level CLI test) rather than only the mapped error code. | AC-065-2/6 state exit codes 4/2, but the script oracles verify error codes and message text only. |

## Unverifiable Materials

- Self-reported evidence: full resolve-prefix/pending/create-task suites, bun run typecheck, cli-create.bun.test.ts, sqlite/turso store bun tests: Recorded as pass by agent:spec-065-cli-ergonomics with no output_tail; cannot confirm they ran or passed.

## Facts Summary

- AC coverage: 7 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.58

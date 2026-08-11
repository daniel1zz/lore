---
id: KN-408
type: knowledge
role: knowledge
title: "SPEC-084 autopilot retro — fixture blindness twice, resolve() duplicate, D7 repair path"
status: approved
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PLAN-120
links:
  - {id: PLAN-120, type: relates-to}
---
Three byproduct discoveries from the SPEC-084 autopilot run (2026-07-27), each with root cause + mechanization:

1. FIXTURE BLINDNESS (twice in one plan). (a) T6's backfill implemented dense created_at renumbering instead of declared-number claims; the AC-084-4 fixture (two docs colliding on SPEC-1) was INDISTINGUISHABLE between the two algorithms — dense-from-1 and claim-preserve emit identical output on dense-from-1 fixtures. Caught only by the LIVE dry-run report (94-kept expectation violated: all 106 moved). (b) T2's retry_exhaustion case assumed externally-forceable UNIQUE collisions, but any row visible to the index is visible to the MAX read — exhaustion-by-pre-insertion is structurally unobservable single-connection; repinned at the shared retry seam (allocateWithBoundedRetry + injected always-colliding attempt). LESSON/RULE: a fixture must contain at least one case whose expected output DIFFERS between the implemented algorithm and its most plausible wrong sibling (algorithm-discriminating case); dense/gap-free fixtures cannot discriminate numbering algorithms — always include a gapped case.

2. DUPLICATE RESOLVER DRIFT. CorpusService carried a public resolve() duplicating resolve.ts::resolveDoc since pre-SPEC-065; it silently lacked BOTH the SPEC-065 id-prefix fallback (explains handoff-29 observation #5: lore get <10-char-prefix> failed twice) and the SPEC-084 ordinal-ref step. Caught by T7's compiled-binary e2e (lore get ADR-1 -> DOC_NOT_FOUND while slug worked). Fixed by delegation (ULID regex divergence promoted into the shared SSOT). LESSON: resolver logic is SSOT-critical — grep for sibling implementations (this.resolve vs resolveDoc) whenever extending resolution semantics; compiled-binary e2e is the only oracle that exercises the CLI's actual resolution path.

3. D7 INTERNAL REPAIR PATH. First apply-path used ascending-dense-feed over MAX+1 allocation — apply==dry-run only by density luck (diverges at first gap, e.g. unclaimed 52). Root fix: assignOrdinalForRepair (targeted UPDATE, UNIQUE index still sole authority, refuses different existing ordinal, idempotent same-value) — apply reproduces dry-run BY CONSTRUCTION. SPEC-084 D7 ('repair migration uses an internal store path') anticipated exactly this.

Execution record: live repair approved via AskUserQuestion, applied 2026-07-27: 106 numbered docs, 94 kept / 12 changed, 164 writes, idempotency re-run 0 writes, endgame 80=bootstrap-injection / 81=PRD-as-outline / 82=audit-hardening-2, 101 file renames executed, export-index converged. Full assess: knowledge-assessment-implementation-spec-084-corpus-allocated.

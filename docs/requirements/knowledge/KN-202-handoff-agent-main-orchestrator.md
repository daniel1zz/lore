---
id: KN-202
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-03
updated: 2026-08-04
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 7 next steps = 14 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

- packages/lore/src/service/task-workflow-service.ts
- packages/lore/src/service/phase-workflow-service.ts
- packages/lore/src/service/verify-runner-service.ts
- packages/lore/src/service/session-service.ts
- packages/lore/src/adapters/cli/commands/list.ts
- packages/lore/src/service/phase-migration-service.ts
- scripts/check-plan-membership-sites.ts
- packages/lore/tests/integration/gate-p2-cross-tier.bun.test.ts
- packages/lore/tests/integration/adhoc-claim-and-feed.bun.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Wave 2 closed 3/3 on clean main d8a3e53. AUTHORITATIVE full suite after a single post-merge rebuild: vitest 460 files/8174 passed, bun 170 files/1799 pass/0 fail, typecheck 0, six check:* guards 0 — all exit codes measured without a pipe | 100 |
| KD2 | KD2 IS CLOSED, not merely patched: the SAME full suite re-run under env -u CLAUDE_CODE_SESSION_ID -u CLAUDE_SESSION_ID is DIGIT-IDENTICAL (vitest 460/8174, bun 1799/0). Full-suite verdicts on this machine are no longer machine-conditional | 100 |
| KD3 | NS2 was an UNDERCOUNT: task-workflow-service.ts is declared by FOUR Tier-1 tasks, not two. capture-source is now archived; evidence-ac-adhoc, mistyped-anchor and ac-scope-red-first still share it and MUST stay serial | 100 |
| KD4 | SELF-REFUTED: I suspected --capture should write attestation (it already has all four fields). Reading task-workflow-service.ts:118-121 shows it is a deliberate boundary — --capture proves an exit code for a CALLER-CHOSEN command; attestation proves SPEC-039 command provenance. Do NOT collapse them | 95 |
| KD5 | lore get's human render omits extra.issue_report entirely, so a reporter's measured refutation is invisible to a spec author reading the doc the documented way. It made me author a 5.6KB spec on a wrong mechanism; filed as its own task | 100 |
| KD6 | lore done's attestation refusal calls capture_source:runner rows SELF-REPORTED, sending the reader to the wrong field (cost me two investigation rounds). Filed, scoped to WORDING ONLY — the predicate is correct | 95 |
| KD7 | git branch --merged cannot distinguish 'work merged' from 'zero commits': it listed a still-running agent's worktree as merged while its HEAD sat on old main. Always verify by commit, never by --merged | 100 |

## Failing Oracle

(none)

## Next Steps

- NS1: Three specs are dispatch-ready and their anchors are pairwise disjoint — corpus-workflow-injection (assets/ + manifest), gate-bypass asymmetry (gate-enforcer.ts + commands/gate.ts), uat-record doc-type (uat-service.ts + commands/uat.ts). They can go as one 3-way concurrent wave
- NS2: gate-bypass and uat-record each carry a REQUIRED design decision (A/B options written into the spec); the implementer must state the choice and its reasoning in the JSDoc, not pick by convenience
- NS3: Wave 3 serial chain on task-workflow-service.ts: evidence-ac-on-adhoc-task, a-mistyped-task-file-anchor, ac-scope-red-first-unarmed, plus the newly filed done-refusal-wording task — four tasks, ONE file, never concurrent
- NS4: session-service.ts is now FREE (plan-member 12/13 archived), so active_sessions-scoping can run concurrently with the chain above
- NS5: Two new Tier-1 tasks filed this wave: task-lore-get-s-default-render-silently-omits-structured-extra and task-lore-done-s-attestation-refusal-calls-a-capture-source
- NS6: task-the-resume-coverage-verb-accepts-a-reason-after-deferred now carries a SECOND measured reproduction plus a correction: its Required #2 is already satisfied, only Required #1 (accept a reason after done) remains open
- NS7: NS6 unchanged and re-measured this session: root CLAUDE.md sits at 24513/24576 bytes and 207/220 lines. ADR D1's standing lesson still cannot land without an eviction


---

## ⛔ CORRECTION appended 2026-08-04 by agent:main-orchestrator

**The wave-3 serial chain listed in this ticket named a RETRACTED task.**

`task-lore-evidence-ac-accepts-an-ac-ref-on-an-ad-hoc-task-that` was invalidated 2026-08-01
(superseded by `task-check-ac-ref-integrity-re-implements-governing-spec`) and its body opens with
`⛔ RETRACTED — DO NOT IMPLEMENT`. It must NOT be implemented. The serial chain on
`task-workflow-service.ts` is therefore THREE tasks, not four:

1. `task-a-mistyped-task-file-anchor-is-stored-and-consulted`
2. `task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed`
3. `task-lore-done-s-attestation-refusal-calls-a-capture-source`

**Why the error was possible, and why it was not a lapse of care**: the enumeration was done with
`lore list --type task --json`, and that payload presents the retracted task exactly like a live
one — status `draft`, no validity field, no badge. Measured the same day: `lore list` does not
exclude invalidated docs on EITHER surface, and `--include-invalid` is silently inert (604 rows
either way, identical slug sets). The only surface where invalidation is observable is a human
`lore get`. Filed as `task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in` (high).

**Consequence for anyone consuming this ticket**: the "open task" counts quoted in this session
(35 -> 32 -> 31) are UPPER BOUNDS, not exact — they were derived from that same unfiltered payload
and may include further retracted docs. Re-derive them after the filtering defect is fixed; do not
treat them as measured truth.

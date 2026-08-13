---
id: KN-071
type: knowledge
role: knowledge
title: "Retro — SPEC-078 dual-wave autopilot: contract-SSOT held, evidence-display gaps drove the score"
status: approved
priority: medium
created: 2026-07-25
updated: 2026-07-26
tags: []
parent: PLAN-038
---
## What worked
- Interface-First dual-wave (strategy B): T3 contract layer (schema + mount types) merged before both waves; ZERO client/server shape drift reached T11's contract oracle — the SPEC-077 lesson (contract oracle over prose pins) held. 13 tasks, 6 concurrent implementers, all worktrees merged clean, no anchor conflict fired.
- TDD pairing (T4/T6 RED before T5/T7) pinned factory surfaces precisely enough that GREEN implementers needed zero test edits.
- T2 empirical spike (deleted-underneath corpus THROWS SQLITE_IOERR_VNODE fast, never hangs) killed the watchdog speculation cheaply — but see gap 2.
- T11 as contract oracle caught a LIVE regression the unit layers missed: D1's machine-auth re-point had broken the e2e harness bootstrap (per-corpus key mint → whole write suite 401) — exactly the consumer/end-to-end audit class the CLAUDE.md standing lessons predict.

## What to carry forward
1. Anti-vacuous AC commands: multi-project playwright specs self-skip (exit 0) without --config — AC commands were repaired in-corpus (ac rm --force + re-add, same ids) the moment T11 disclosed it. Lesson: an AC command must fail loud when its environment precondition is absent, self-skip = vacuous pass.
2. Flaky empirical pins are weak retirement evidence: the liveness test failed 2× under suite load; an H-risk retired on a non-deterministic oracle is only provisionally retired (tracked: task-stabilize-deleted-corpus-liveness-…).
3. Evidence output_tail (4000 cap) hides multi-clause AC sub-assertions from the assessor — matched-count discipline proved execution, but assessment confidence pays the price. Candidate lore enhancement: preserve the full test-name list in evidence.
4. Mid-flight repair tasks (T13) must fold into plan totals/exit criteria AT INSERTION, not post-assess.
5. check-tree vs SPEC-069 adhoc channel is a standing contract contradiction arming the pre-push gate permanently (tracked: task-tree-check-contract-…).

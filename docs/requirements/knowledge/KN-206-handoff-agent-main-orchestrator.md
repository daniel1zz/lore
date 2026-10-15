---
id: KN-206
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-03
updated: 2026-10-10
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

- package.json
- scripts/check-ordinal-write-sites.mjs
- scripts/check-ordinal-write-sites.d.mts
- scripts/check-plan-membership-sites.ts
- scripts/tests/check-ordinal-write-sites.test.ts
- scripts/tests/check-no-timer-retry.test.ts
- scripts/tests/check-ac-ref-integrity.test.ts
- scripts/tests/check-plan-membership-sites.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Non-convergence is not backlog growth: open held 20-35 for 16 days, median open age 2 days, only 4/34 admit being an Nth instance. Driver: 101/596 tasks (17%) and 16/34 open (47%) are defects IN the verification machinery; its share of new findings rose 0/19 (07-23) to 8/10 (08-03) | 95 |
| KD2 | RETRACTED: attributing the ordinal family's zero-new-instances to its guard. That script has 0 tests and 0 invokers. Audit of all 5 static checkers: only check-no-nul-bytes and check-test-budgets were ARMED (real-tree main() assertion in the suite); no CI exists, pre-push runs zero check:* scripts | 95 |
| KD3 | A test-level KNOWN_OPEN_SITES ledger asserted by EXACT SET EQUALITY is not an allowlist: the oracle still exits 3 and prints the site; a 12th site fails the suite and fixing the listed one ALSO fails it, so the ledger retires with the defect. Precedent: check-test-budgets' debt ledger | 90 |
| KD4 | Hand-authored enumeration tables are unverified data. The eight-site sweep listed session-service.ts:766 as bootstrap's active-plan listing, but :766 is computeReadinessPointer; bootstrap's own :251 was never converted. Nine sites closed against an uncheckable list — that is the family root | 95 |
| KD5 | ORCHESTRATOR ERROR, the trap this corpus catalogues: my grep for an exported main missed 'export async function main', so 2 of 3 premise rows in a dispatch bundle were wrong. The implementer re-measured instead of inheriting them — bundle premises must be stated as re-runnable measurements | 95 |
| KD6 | bun run test:changed transitively runs bun run build when selection includes a binary consumer, so 'do not rebuild while an agent is live' and 'run test:changed' are mutually unsatisfiable in one bundle. Only the worktree's dist was written, so no hot-swap — but the conflict is structural | 90 |
| KD7 | Session net effect measured, not inferred: open tasks 34 -> 35 (created 3, archived 2). Two mechanisms landed and one real defect was found by enumeration, but the backlog did NOT shrink | 100 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1 task-phaseworkflowservice-claim-captures-no-session-id-so-every stays the highest-value open item: critical, shipped channel, and ADR D4 names it non-exemptable regardless of its 3-member family size
- NS2: Fix task-the-eleventh-plan-member-site-found-by-enumeration: session-service.ts:251 plus its .has() sibling :284, retire the KNOWN_OPEN_SITES ledger row (set-equality makes it mandatory), and update plan-membership.ts's stale JSDoc to name bun run check:plan-member-sites
- NS3: ADR D5 is OPEN and is the only thing that can terminate the loop: lore has no external termination criterion, so 'no mechanism gap findable by inspection' stays unbounded. D1-D4 only slow growth. Product decision, not engineering
- NS4: File the test:changed/build mutual-unsatisfiability as its own defect — no task exists for it yet
- NS5: root CLAUDE.md has 127 bytes / 13 lines headroom (24449/24576). ADR D1's standing lesson cannot land without evicting a line per the mechanized-eviction rule; the ADR is its sole SSOT today
- NS6: Still deferred with reasons in this session's RESUME_DISPOSITION block: NS2 NS3 NS4 NS5 NS6 NS7 NS9 NS10 and KD4. NS4's defect was measured live a THIRD time this session (a vitest -t filter matched zero tests and exited 0)
- NS7: Baseline, exit codes measured WITHOUT a pipe on clean main a29e006 after one post-agent rebuild: BUILD 0, TYPECHECK 0, TEST 0 (vitest 453 files/8048 passed/4 skipped, bun 1767 pass/0 fail); five check:* guards exit 0, check:plan-member-sites exits 3 BY DESIGN

---
id: KN-247
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 6 next steps = 12 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Ticket fully closed. 8 ad-hoc tasks + 13 legacy tasks archived, 3 plans closed, 4 archived plans recovered from 0.00 attestation, V3/V4/V5 cleared, eviction policy landed as an accepted ADR@high | — |
| KD2 | NS5's premise was FALSE and I had repeated it: the 13 ready tasks all carried evidence with latest=pass — done-but-never-archived, not unfinished. 13/13 matches the incident already in CLAUDE.md. Verified implementations were in main before archiving, then done x13@high | — |
| KD3 | The new task-create ac_scope gate is dogfooded live: a plan task without --ac-scope is refused exit 4 gate:task-create:ac-scope-required, while an --adhoc task succeeds (D3 not-applicable, never exempt)@high | — |
| KD4 | Closing contrast proves the mechanism: the two legacy plans needed typed pipeline-unreachable exemptions, while the new plan — ac_scope declared from the start — closed with NO exemption and 8 runner-attested ACs@high | — |
| KD5 | The (path,line) ledger broke a SECOND time the same day, again from a pure insertion in a file another agent owned. Two occurrences in one session make it a design fault, not bad luck. Fix is recorded and NOT built: key rows on a test-title fingerprint@high | — |
| KD6 | A subagent stopped mid-verification with 'waiting for the monitor' as its last words — zero evidence rows, claim unreleased, 4 files beyond its anchors unexplained. SendMessage recovery worked: it returned 8 honest rows including a fail it refused to reclassify@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: OPEN, foreign: scripts/check-test-budgets reports 1 new unledgered violation at packages/lore/tests/unit/adapters/cli-ac-set.test.ts:84 (6 spawns), introduced by the concurrent session's 90fdc7e 'lore ac set'. Deliberately NOT fixed by me — their file, their debt, and the red is the ledger oracle working. It is the sole vitest failure at 75fa7cb
- NS2: FLAKY, do not chase: packages/lore/tests/unit/hooks/session-start-freshness.test.ts has a wall-clock assertion (expected 132.9 to be less than 100) that fails only under full-suite load; 13/13 green when run alone. If it recurs, raise or remove the timing assertion rather than the code
- NS3: Follow-up named by the ac_ref implementer and NOT done: VerifyRunnerService.verifyAdhocTask still passes recordAcRef:false, so the runner-attested path does not yet stamp ac_ref even though lore evidence --ac now can. Distinct decision, touches that class's own assertions
- NS4: lore ac has add/list/rm but NO update verb, and rm is refused once evidence references the id — a declared AC statement is therefore unfixable in place (hit this on AC-TB-1; only the prose could be corrected). NOTE the concurrent session appears to be building exactly this as 'lore ac set' — check before filing
- NS5: Recommended and NOT built, from the -t retro: assert executed-test-count >= 1 after any filtered AC command at the lore verify layer, where false-oracle vectors 1-4 already live
- NS6: CLAUDE.md eviction sweep is filed as task-sweep-the-claude-md-standing-lessons-layer-against-the: apply the accepted ADR once, naming the enforcing mechanism per evicted line AND demonstrating it fires. Root file still at 5 bytes free; zero bytes were added this session

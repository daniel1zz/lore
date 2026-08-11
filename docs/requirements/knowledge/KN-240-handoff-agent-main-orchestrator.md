---
id: KN-240
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

SCOPE: 5 decisions + 5 next steps = 10 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

- CLAUDE.md
- packages/lore/src/service/verify-runner-service.ts
- packages/lore/tests/integration/cli/verify.test.ts
- scripts/test-budget-ledger.json

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Ticket 56 fully closed: all 12 items dispositioned, NS3 and NS6 landed+archived. 3 of its 6 NS premises were already stale at read time (NS1 fixed, NS4 built, NS5 built TWICE over before the ticket was written) — verifying beat building@high | — |
| KD2 | CLAUDE.md mechanized-eviction sweep landed: 4 lessons evicted each with an executed demonstration, 15 kept as measured-unmechanized. Headroom 5 -> 540 bytes. Decision table in knowledge-mechanized-eviction-sweep-of-the-claude-md-standing@high | — |
| KD3 | The sweep surfaced a NEW false-oracle face and it is now IN CLAUDE.md, not evicted: lore evidence accepts an UNFILTERED multi-file --result pass with no proof any file ran. It closes only missing-file and zero-match--t@high | — |
| KD4 | ac_ref flip verified end-to-end, not self-reported: a fresh dist/lore ran lore verify on the ad-hoc task and the corpus rows carry ac_ref with runner lore-cli. Merge-verify then caught a THIRD pinning site the anchor list missed@high | — |
| KD5 | Final full suite at 438976b is red on 2 cases ONLY: the known session-start wall-clock flake (116ms and 133ms vs <100ms), 13/13 green when run alone. No regression from this session@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: FOUR open unclaimed adhoc tasks filed this session, none started: task-test-changed-cannot-see-the-whole-integration-cli-tier-the (high), task-key-test-budget-ledger-rows-on-a-test-title-fingerprint (high), task-session-start-freshness-boundary-cases-assert-a-wall-clock, task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1
- NS2: The two high tasks are both defects in DETERMINISTIC ORACLES and both bit this session: test:changed let a real regression through, the (path,line) ledger broke a THIRD time in 24h. Fix the predicate shapes, never add a file to a list
- NS3: The new sixth false-oracle face has NO task yet — decide whether lore evidence should demand an --output-tail for multi-file test commands too, or whether that is correctly left to lore verify. It is a design call, not a bug
- NS4: Orphan branch worktree-agent-ada3640f23484b4b5 carries 1 unmerged commit (regen embedded assets manifest, a bun run build byproduct). Disposition it — do not delete without checking whether main needs the regen
- NS5: Two worktrees at f9794e5 (agent-a8b503d152050b5ad, agent-ae2e10a8a97767a47) belong to ANOTHER live session. Do not remove them. That session also landed a1f31e5/bd898fa on main mid-run

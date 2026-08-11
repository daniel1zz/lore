---
id: KN-264
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 5 decisions + 6 next steps = 11 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | 3 tasks landed+archived at main e1bd0b1: plan-close now DENIES an evidence-bearing scope-undeclared close (AC-PCI-17..21); lore evidence refuses a -t-filtered pass with no runner summary (AC-061-11..17); lore plan exempt-attestation gives the gate-read exemption fields a writer (AC-069-8..14)@high | — |
| KD2 | Full suite green TWICE on clean low-load main: vitest 415 files/7105 passed, bun 1660 pass/0 fail. Both runs exit 0@high | — |
| KD3 | Both implementers reported the same 2 bun suites as pre-existing failures; BOTH wrong. One built a base worktree with a base-built binary to prove it. Their controls shared the load confounder. Isolated: 4 pass 0 fail, harness self-reports CONCLUSIVE 50/50@high | — |
| KD4 | grep in the agent shell is a ugrep --ignore-files wrapper whose blind spot does NOT match git check-ignore (tracked, non-ignored, 1095-line file returns nothing, exit 1). Any conclusion resting on ABSENCE must be re-run as /usr/bin/grep@high | — |
| KD5 | Ad-hoc tasks can carry neither attested evidence nor an --ac ref (lore evidence --ac exits 4: Expected a plan document, got type prd). Spec AC coverage therefore reads as uncovered for all ad-hoc work@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: NS5 recovery is the top open item and is UNSTARTED: the four plans archived at attested_evidence_ratio 0.00 still need lore verify <plan> --ac <id> per evidence-bearing task before anyone treats them as verified
- NS2: 4 HIGH tasks unstarted: task-spec-first-require-ac-scope-at-task-creation-so-the-runner, task-land-the-baseline-ledger-policy-for-check-test-budgets-55, task-meets-floor-renders-pass-while-the-declared-scope-conjunct, task-archive-sweep-gate-disable-is-silently-inert-a-wholesale
- NS3: UNREMEDIATED V3/V4/V5 (deliberately out of this session's scope): lore review the IC spec's current version (re-promoted via set --status approved, skipping the judgment gate); VS spec still pins 'all three refusal paths' while four ship; AC-TB-1 still asserts a false repo state
- NS4: 3 new tasks filed this session, all unstarted: task-the-ad-hoc-task-channel-has-no-attested-evidence-path-lore (CRITICAL), task-lore-evidence-s-oracle-file-precheck-resolves-against-the (HIGH), task-lore-status-check-claude-md-reports-a-saturated-file-as (HIGH)
- NS5: plan-implementation-context-verb-family-two-zone-claude-md (15 tasks, 73 evidence rows, zero ac_scope) and plan-implementation-lifecycle-archival-cascade-sweep-surfacing are now BLOCKED at close by the new gate. Escape now exists: lore plan exempt-attestation. Do NOT retro-declare ac_scope to clear it
- NS6: CLAUDE.md is at 24571/24576 bytes — the standing-lessons layer is CLOSED. Two lessons from this session live only as corpus knowledge docs. Resolve the eviction policy before the next lesson is found

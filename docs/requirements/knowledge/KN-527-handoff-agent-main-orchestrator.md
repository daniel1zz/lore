---
id: KN-527
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-24
updated: 2026-10-10
tags: []
parent: PLAN-138
---
# Handoff — agent:main-orchestrator

SCOPE: 5 decisions + 4 next steps = 9 items to account for

## Plan

plan-land-the-github-intake-defect-channel-runner-cap-removal

## Task Refs

(none)

## Modified Files

- scripts/tests/spec-mirror-export.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | SUPPLEMENT to knowledge-handoff-agent-main-orchestrator-120 — read that ticket FIRST; it disposes ticket 117's KD1 and NS1 in full. This one adds only what was measured after it was written. | 99 |
| KD2 | main final state: 4 failed / 9338 passed / 546 files, down from 25 failed / 7 files. typecheck EXIT=0 for the first time in this plan's history. All 4 remaining failures are in the two mirror test files and NONE is a code defect. | 95 |
| KD3 | Root cause of 3: corpus growth crossed hard-coded constants. runLore's maxBuffer is 20MB, the payload 22.26MB. A/B: 20MB gives status=null+ENOBUFS, 64MB gives status=0. Two drift-checks time out at 30s after passing at 28298/27931ms. knowledge-corpus-growth-crossed-three-hard-coded-thresholds-in | 96 |
| KD4 | The fix is NOT a bigger buffer: the test needs id+slug = 56106 bytes but pulls whole DocRecords = 20727213 bytes, 370x more, and the corpus only grows. Options: field projection on lore list, paging via the existing --limit/--offset, or a dedicated id/slug surface. | 93 |
| KD5 | spawnSync reports buffer overflow as status=null + error.code=ENOBUFS; runLore's 'result.status ?? 1' turns that into a fake exit 1 and discards result.error — the repo's own banned silent-fallback, inside the helper whose comment cites the anti-truncation discipline. | 97 |

## Failing Oracle

(none)

## Next Steps

- NS1: Fix the 3 threshold failures at the ROOT, not by raising constants: stop the oracle from requesting data it never reads. Field projection on lore list is the smallest change that also shrinks the two 30s drift-check runs, since each --check shells out to lore list per type over 1646 files.
- NS2: Fix runLore's error swallowing regardless of the buffer decision: surface result.error instead of 'result.status ?? 1'. Until then any spawnSync-based helper here can report an infrastructure failure as a command exit code with empty stderr.
- NS3: Audit the other spawnSync call sites for the same two defects — a hard-coded maxBuffer that corpus growth will cross, and a 'status ?? N' that hides result.error. This one was found by accident; nothing scans for it.
- NS4: The 4th failure is the mirror content-parity one from knowledge-the-mirror-content-parity-oracle-is-structurally and needs the DESIGN decision named in ticket 120. It is independent of the three above: parity decays on concurrency, these decay on volume.

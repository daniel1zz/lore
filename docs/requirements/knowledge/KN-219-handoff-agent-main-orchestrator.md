---
id: KN-219
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-10-10
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

- packages/lore/src/service/task-workflow-service.ts
- scripts/changed-tests.ts
- packages/lore/src/adapters/cli/evidence-precheck.ts
- CLAUDE.md

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | All three NS1 tasks landed, merge-verified with discriminating checks, archived. Full-suite verdict TAKEN on clean tree at 154c1bd: vitest 434 files/7635 pass green; bun 1737 pass / 1 FAIL. That failure is NOT a regression from these merges@high | — |
| KD2 | The attested-pass gate refused its OWN task — the strongest liveness proof available. Rebuilt BEFORE closing so the gate applied to its author; ~/.local/bin/lore symlinks to dist/lore, so build arms it for every concurrent session@high | — |
| KD3 | Two implementer reports were wrong, caught only by re-measuring: the rule-(d) marker matches 3 files not 2 (its own new test self-classifies), and the retroactive blocked count is 2 not 3. Both were true when taken — asserting a snapshot as current is the failure@high | — |
| KD4 | The bun failure is a FALSE RED with a mechanism, not a flake to retry: deleteBackingFiles unlinks an OPEN SQLite file, a POSIX no-op for an existing fd. Observed fail,pass,pass in isolation. Filed as task-provenance-writes-io-error-s-four-cases-inject-i-o-faults@high | — |
| KD5 | CLAUDE.md is AT CAPACITY: root 24544/24576 bytes, 206/220 lines (already over the contract 200-line target), service module 42 bytes free. Three budget negotiations were needed to land this slice's doc-sync@high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: task-provenance-writes-io-error-s-four-cases-inject-i-o-faults filed, unimplemented — all 4 call sites share the broken technique; only one lost the coin flip. Oracle floor is 20 consecutive green runs, not one
- NS2: task-short-id-rendering-truncates-ulids-to-8-chars-a-1024ms filed, unimplemented (ticket 63 NS5, widened by measurement: 1024ms window, 9 sites, 3 commands, no shared formatter)
- NS3: task-session-start-freshness-boundary-cases-assert-a-wall-clock: NEW DATA — 13/13 green inside THIS full suite at load 3-5, vs red at load 8-14 in ticket 63. Does NOT close it (a wall-clock budget still cannot assert an ORDERING invariant); it brackets the trigger to load 5-8
- NS4: Next slice needing CLAUDE.md space must move a whole standing lesson into the corpus and leave a pointer — do NOT raise the ceiling numbers. The two easy wins were already spent this session
- NS5: Two open adhoc tasks are exempted in writing from the attested-pass floor via the audited hatch (task-ac-ic-1-harness..., task-lore-setup-de-hook...); grounds in knowledge-arming-the-attested-pass-floor-the-gate-refused-its

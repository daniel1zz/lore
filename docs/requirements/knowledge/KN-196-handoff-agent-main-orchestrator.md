---
id: KN-196
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-06
updated: 2026-08-06
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 5 next steps = 12 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

- CLAUDE.md
- packages/lore/src/adapters/cli/CLAUDE.md
- packages/lore/src/adapters/cli/commands/get.ts
- packages/lore/src/adapters/cli/get-render.ts
- packages/lore/src/adapters/cli/commands/list.ts
- packages/lore/src/service/validity-service.ts
- packages/lore/src/service/anchor-resolution.ts
- packages/lore/src/service/task-workflow-service.ts
- packages/core/src/file-anchors.ts
- packages/core/src/issue-report.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Wave 4 closed 5/5 (3 concurrent + 2 serial). Two authoritative verdicts on clean trees at 156c055 and 074df1cd; volumes rose each time: vitest 461/8215 -> 470/8388, bun 1807 -> 1825, 0 fail. Three pre-push corpus gates hand-run at 074df1cd, all exit 0. No remote configured, nothing pushed | 100 |
| KD2 | CORRECTION to KD3: this session did NOT reproduce the SELF-REPORTED misdirection. All 5 tasks' rows are capture_source:self-report, none runner, because my bundles mandated --output-tail-file not --capture. The old wording was ACCURATE for them. I inferred runner instead of checking | 100 |
| KD3 | Every adhoc task declaring an EMPTY ac_scope is now doubly constrained: lore verify --task exits 4 (no spec resolvable) AND the no-new-tests floor is armed for it (d6b3ca49 keys on the declaration's presence). Needs a red row AND --override-attestation. The normal path now, not an exception | 100 |
| KD4 | The over-matching lesson bit me 4x, twice after writing it up: grep -c counts LINES; an 8-char ULID prefix collides since ULIDs are TIME-ORDERED (01KYYB5HZS vs 01KYYB5HT1); a full-ULID grep hits the marker quoted in the doc documenting it. Assert by ID must mean FULL id vs PARSED id field | 100 |
| KD5 | A fix landing on ONE consumer of a shared seam repeated twice this week: the get extra fix left renderDocMarkdown lossy for feed+gate packs; the list validity fix left feed/status/tree ungated. Both filed. Grep the seam's consumer count before accepting a defect fix | 95 |
| KD6 | A nested search agent inherits its parent's cwd and holds a WRITABLE git index over the parent's in-flight tree — one committed a peer's uncommitted files under misleading messages. Parent recovered via reset --soft, verified at merge. Never dispatch nested while holding uncommitted work | 90 |
| KD7 | I produced a false EXIT=0 myself by piping lore done through fold\|head. The no-pipe exit-code rule applies to DISPLAY commands too, not only oracles: a piped exit status silently turned a real exit 4 into an apparent success inside my own report | 100 |

## Failing Oracle

(none)

## Next Steps

- NS1: Two defects filed here are the SAME consumer-not-seam family and could share one wave (anchors disjoint): task-validity-landed-on-lore-list-only-the-dispatch-surface (CRITICAL) and task-the-shared-renderdocmarkdown-seam-still-drops-structured (high)
- NS2: task-a-module-claude-md-at-its-byte-ceiling-silently-relocates (high) is a PREREQUISITE now: service/CLAUDE.md sits at 16374/16384 (10 bytes) and already forced a service-layer module's docs into core/cli/mcp; grep -c anchor-resolution service/CLAUDE.md returns 0
- NS3: 25 open LIVE tasks, now derivable straight from lore list --json (validity filter merged) — the manual per-doc census is obsolete. 26 with --include-invalid, 1 invalidated. Cross-check: 27 live at census - 5 archived + 3 filed = 25
- NS4: dashboard-command.bun.test.ts's browser-opener control is ADJUDICATED an environment flake, not a regression: passes in isolation and in the full 172-file bun suite with a fresh binary; fails only under ~524-file cross-runner test:changed load. Do NOT chase it
- NS5: The governed-by branch is the one named validity residual needing a service signature change (listGovernedBy returns summaries, not full records). Scoped INSIDE the critical task above, not separate

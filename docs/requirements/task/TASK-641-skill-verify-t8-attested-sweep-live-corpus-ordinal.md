---
id: TASK-641
type: task
role: plan
title: "[Skill:verify] T8 attested sweep + LIVE corpus ordinal repair + docs closure"
status: archived
priority: high
phase: "Phase 3: Verification + live repair"
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PLAN-120
plan: PLAN-120
---
Estimate: M
Approach: main-checkout verification + LIVE repair execution by the orchestrator (no code anchors; LORE_ACTOR=agent:main-orchestrator on every lore call). Order: full sweep FIRST, live repair LAST (never run --apply before every oracle is green).
Source: SPEC-084 Rollout 5-6 + plan Exit Criteria
Dimensions: D-FUNC, D-CODE
Scope-Alt: none — final gate
Covers: AC-084-6 (attested), plus attested sweep of AC-084-1..5

AC:
- `bun run build` → `node scripts/embed-assets-manifest.mjs --check` exit 0; `bun run typecheck` exit 0; `bun run test` both runners green on main (un-piped exit codes).
- `lore verify <this-plan>` → attested evidence for ALL 6 ACs, zero inconclusive.
- **Live repair — HARD M2 GATE (overrides unattended mode)**: copy `.lore/` → `dist/lore migrate ordinals` dry-run against the COPY (SPEC-056 live-copy precedent) → surface the FULL mapping report → ⛔ **the live `--apply` is an autopilot M2 escalation: it MUST NOT run until the user explicitly selects approval via AskUserQuestion presenting the mapping report** (a consequential shared-scope corpus rewrite; unattended governance explicitly does not cover it — plan Decisions Log). The user's recorded answer is the gate artifact; evidence output_tail quotes it. After approval: dry-run then `--apply` on the LIVE corpus in one sitting (R5).
- Post-conditions (named oracles, un-piped exit codes): duplicate check `sqlite3 .lore/lore.db "SELECT type,ordinal,COUNT(*) c FROM docs WHERE ordinal IS NOT NULL GROUP BY type,ordinal HAVING c>1"` → empty; `lore get SPEC-80`→bootstrap-injection / `SPEC-81`→PRD-as-outline / `SPEC-82`→audit-hardening-2; title purity `lore list --type spec --json | grep -cE '"title": "(SPEC|ADR)-[0-9]'` → 0; `lore status --check-tree --check-drift` exit 0.
- `lore anchor add spec-084...` for: packages/core/src/ordinal.ts, packages/lore/src/store/sqlite-store.ts, packages/lore/src/service/ordinal-migration-service.ts, packages/lore/src/service/corpus-service.ts → `lore status --check-drift` exit 0.
- Closure with named oracles: CLAUDE.md SPEC-084 as-built entry (verify: `grep -c "SPEC-084" CLAUDE.md` ≥ 1 post-commit); collision knowledge doc superseded (verify: `lore get knowledge-spec-080-triple-numbering-collision-resolution` renders the SPEC-043 invalidation banner naming the migration as successor); `lore handoff --plan <this-plan>` (verify: handoff slug printed and quoted in the final report).

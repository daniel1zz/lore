---
id: KN-064
type: knowledge
role: knowledge
title: "SPEC-072 autopilot execution retro: reverse-import oracle gap, exempt-field surface gap, ratio design tension"
status: approved
priority: medium
created: 2026-07-24
updated: 2026-07-26
tags: [retro, spec-072, autopilot, attestation, dogfood]
parent: PLAN-045
links:
  - {id: PLAN-045, type: relates-to}
---
## Overview

Execution retro for plan-spec-072-upstream-issue-reporting-report-issue (6 tasks + 2 closure fixes, autopilot, 2026-07-24). All 13 spec ACs attested pass; full dual-runner suite green (vitest 309 files / 5570 tests; bun 1017 pass); drift oracle 0. Estimation: Phase 1 est 2 / actual ~1 agent-session; Phase 2 est 5 / actual 3 sessions (T2∥T4 parallel wave paid off); Phase 3 est 5 / actual 2 sessions + 2 orchestrator fixes. Risk register: R1 (auto-migration) mitigated by design (readonly probe, AC-072-12 attested); R2 (bun:sqlite vitest leak) TRIGGERED — see finding 1; R3 (stale dist) never triggered (build-first discipline held); R4 not triggered.

## Findings (each with root cause + mechanization fix)

1. **R2 materialized exactly as registered, but past the scoped-oracle net.** T5's static import of report-issue-wiring in mcp/tools.ts dragged bun:sqlite into the vitest graph; T5's scoped oracles (typecheck/build/2 suites) did not include the one vitest file that imports tools.ts, so it surfaced only at the orchestrator's post-merge run. Root cause: dispatch bundles enumerate scoped oracles by the task's OWN files, not by its reverse-import consumers. Mechanization candidate: dispatch bundle generation should include "vitest files importing any anchor-touched module" (a one-level reverse-import scan) in the scoped oracle list. Fix applied: lazy dynamic import in the tool handler (CLI-loader isolation precedent), commit on main.
2. **SPEC-065 unique-ID-prefix resolution returned "Document not found" for a valid 10-char prefix** (`lore get 01KY95QVH7` immediately after creating the doc whose id displays as that exact prefix). Not investigated to root cause mid-flight (worked around via `lore list --json`). Needs a reproduction pass against `resolveDoc`/`findByIdPrefix` — candidate causes: prefix path not wired on `get`, or case/length edge. If real, this re-opens the SPEC-065 P0-2 dogfood finding it was built to fix.
3. **`attestation_exempt` has NO authoring surface** (gate-read field, SPEC-069 plan-close floor): `lore set` has no `--extra`, no dedicated verb exists; the only path is a hand-written service-layer script (used here, read-modify-write preserving extra). This is the standing-lesson class "a gate demanding a field no surface can author — fails SILENT" caught live. Also discovered: the exemption is PLAN-level (short-circuits the whole floor); task-level `attestation_exempt` fields are inert (two such inert-but-truthful fields now sit on T1/T2 of this plan — harmless, documented here). Mechanization: `lore plan exempt-attestation <plan> --reason "..."` (or a `lore set --extra-merge k=v` general verb) + docs.
4. **Attestation min_ratio (0.5) is structurally unreachable for evidence-rich plans**: append-only history means every self-reported implementer oracle run permanently depresses the ratio; a plan where all 13 ACs carry attested passes still failed the floor at 0.35 because implementers dutifully recorded 30 self-reported entries. The metric punishes exactly the behavior the workflow demands. Mechanization candidate: compute the ratio over ACs-with-attested-coverage (attested-ACs / script-ACs) rather than over raw evidence entries — that measures the thing the floor is FOR (SPEC-069 intent: no plan closes on self-reports alone) without penalizing evidence richness.
5. **AC wording vs empirical reality, twice** — (a) AC-072-4/12's "-shm byte-identical" is unsatisfiable: ANY WAL connection (incl. readonly) rewrites -shm reader-bookkeeping bytes (T4 verified empirically with a throwaway probe script); amended to db+-wal bytes + -shm size. (b) AC-072-1's "absent from ready --adhoc until approved" contradicted SPEC-069 D2's shipped visibility-first readyAdhoc; resolved by a narrow review-gate filter on `extra.issue_report` drafts (PRD §20 F3 is the user-approved boundary; self-authored ad-hoc visibility unchanged). Lesson: ACs asserting byte-level or cross-spec behavior deserve a pre-implementation empirical probe — cheap now, contradiction-discovery-in-e2e later.
6. **plan-close status-machine friction**: draft tasks cannot archive directly (draft→approved→active→archived chain required, 3 writes per task × 6 tasks by the orchestrator). Either an orchestrator-facing `lore task done <task>` sugar or draft→archived legality for evidence-bearing released tasks is worth a design pass.

## What worked

Interface-first decomposition delivered real parallelism (T2∥T4, disjoint anchors, zero claim conflicts); SPEC-070 feed packs made bundles cheap and fresh; failure-first discipline in T1/T2 caught a vacuous-test risk (T1's red-check via barrel-strip); the T6 boundary rule ("found a product bug → STOP, report, don't fix") produced a clean reconciliation loop instead of scope creep; every merge was exit-code-gated and no worktree orphans remain.

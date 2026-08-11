---
id: PLAN-103
type: plan
role: plan
title: "Implementation — issue closure loop (resolves edge, computed resolution, agent-reachable surfaces)"
status: archived
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: SPEC-109
phases:
  - {name: "P1 foundation"}
  - {name: "P2 surfaces"}
  - {name: "P3 closure"}
---
## Goal

Implement `spec-issue-closure-loop-computed-resolution-agent-reachable` (§20 F6): a typed `resolves` edge, a computed resolution, an agent-reachable `lore issues` surface, a deterministic `--check-issues` detector, and a consumer-side `--list` that reports the defect's real state instead of the raw doc status.

Terminal proof of the whole loop: close `task-no-init-setup-path-provisions-feedback-upstream-lore` (the first real defect fixed through this loop, still reported as `draft` to babyai today) using the new mechanism — not by hand.

## Phases

**P1 — foundation** (serial; everything else depends on it)
Schema + computation. `resolves` in `linkTypeSchema`, write-time validation that a `resolves` target is an issue task, and the pure `computeIssueResolution` function. Ships AC-ICL-1, AC-ICL-2.

**P2 — surfaces** (3-way parallel; anchors are disjoint by construction)
- CLI verbs `lore issue resolve` + `lore issues` (share `adapters/cli/index.ts` registration, so they are ONE task — splitting them would collide on that anchor). AC-ICL-3/4/5.
- `lore status --check-issues` + the `feedback.stale_after_days` config key. AC-ICL-6.
- Consumer-side `report-issue --list` joins on computed resolution. AC-ICL-7.

**P3 — closure** (serial, after P2)
End-to-end on the real shape (AC-ICL-8), then apply the mechanism to the 9 live open reports: link the shipped fix for the escalated one, and let `--check-issues` prove the rest are correctly reported as open.

## Anchor discipline

`adapters/cli/index.ts` is touched only by the P2 CLI-verbs task. `issue-report-service.ts` is touched by P1 (computation) and P2's consumer-list task — P2's task claims it only after P1 releases, which the phase ordering already enforces. Every implementer runs with a distinct `LORE_ACTOR=agent:<branch>` and claims from inside its own worktree.

## Test discipline

Inherited from §20 and the spec: twin throwaway corpora (`mkdtemp` + `lore init` × 2) for every cross-corpus path, `.bun.test.ts` for anything touching `SQLiteStore`, vitest for pure computation. Never write to this repo's own `.lore/`. Red-before-green on every AC. Six-dimension coverage. After any filtered run, assert the matched test-file count — a partial path match exits 0 silently.

## Delivered scope reconciliation (2026-07-29, post-assess)

The plan shipped 11 ACs, not the 8 it was decomposed against. Three were added mid-flight, each on a MEASURED finding rather than a scope guess — recording them here so the declared and delivered scope match at close:

- **AC-ICL-9 (dashboard)** — added during P2 planning. The §20 F5 Issues page read raw doc status; fixing only the CLI would have left the human triage surface reproducing the exact proxy failure the spec removes.
- **AC-ICL-10 (`closed` state)** — added after `lore issues` shipped and was run against the real corpus: `task-spec-069-adhoc-tasks-are-unclaimable`, fixed and archived four days earlier, was listed as `open` while `--resolved` was empty. An edge-only resolution model misreports its entire pre-mechanism back-catalogue.
- **AC-ICL-11 (review-rejected state)** — added after D6 merged and turned `issue-report-cross-corpus.bun.test.ts:687` red. `ReviewService.reject` never moves a doc off `draft` (SPEC-005), so a review-rejected report was computing `open` while carrying a rejection reason — a self-contradicting row.

Two further deviations, both deliberate:

- **`migration-012`** — P1's ACs passed at a store-free layer while the SQLite `links.link_type` CHECK constraint still rejected `"resolves"`, so the deliverable was dead on the real path. Fixed inside P2; captured as `knowledge-retro-a-green-ac-over-a-store-free-layer-let-a-schema`.
- **Live-corpus closure moved from the P3 implementer to the orchestrator** — it writes the team's real `.lore/`, which no test-bearing agent should ever touch. Recorded as `manual` evidence on the P3 task with the before/after detector output.

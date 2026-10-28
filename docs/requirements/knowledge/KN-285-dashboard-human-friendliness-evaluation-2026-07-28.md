---
id: KN-285
type: knowledge
role: knowledge
title: "Dashboard human-friendliness evaluation 2026-07-28 — six direction verdicts (persona anchor, triage-before-UI, execution-page demotion, cockpit home, packaging prerequisite, read-views demotion)"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-31
tags: [dashboard, grill-review, product-direction]
parent: SPEC-274
links:
  - {id: KN-297, type: relates-to}
  - {id: SPEC-274, type: informs}
  - {id: SPEC-105, type: informs}
---
# Dashboard human-friendliness evaluation 2026-07-28 — six direction verdicts from a /grill-me session

## Context

A /grill-me session evaluated whether the current `@lore/dashboard` actually delivers "human-friendly visual management" for Lore. Every branch was grounded in live evidence (route inventory, pending-queue composition via `lore pending --json`, bootstrap state, CLI capability probes), and the user resolved each branch explicitly. This session is a dashboard-scoped complement to the same-day product-direction grill (`knowledge-grill-review-2026-07-28-seven-product-direction`); where the branches overlapped (review triage), this session independently converged on that doc's decision 4 (tiered review) rather than minting a new policy.

## Evidence anchors (as of 2026-07-28)

- Dashboard surface inventory: home (resolved PRD), search, tree, library, doc detail (edit / history / links / evidence / audit), pending (TriageQueue + AdjudicationBar + keyboard flow), execution (ActivePlansPanel / SessionsPanel / ReadyTaskList / PhaseProgressPanel / AnchorConflictsPanel), issues, settings, multi-project `p.$name.*` mirrors. Write surface: create / edit / status transitions / link / restore / delete / approve / reject.
- Adjudication reality: 29 pending docs, ~100% `created_by: system` execution-exhaust (assessment / retro / session-review); human adjudication is not happening on ANY surface (CLI or dashboard). The bottleneck is queue signal-to-noise, not UI polish.
- Execution-page reality: claims exist only inside dispatch windows — bootstrap shows `my_claims: []`, `active_sessions: []` with 12 ready tasks; the execution page renders empty states most of the time. Live agent activity lives in Claude Code sessions, invisible to the corpus by design.
- Cockpit data source already exists: `lore audit --since/--actor/--limit --json` is a global activity stream; what's missing is an HTTP endpoint + UI, not a data model.
- Delivery: dashboard runs ONLY as a two-process vite-dev topology; production build / embedding into `lore serve` are explicitly deferred in `packages/dashboard/CLAUDE.md` Out-of-scope.
- Read reality: humans let AI proxy corpus queries (`lore search/get` executed inside Claude sessions); direct human browsing of search/tree/library is rare.

## Verdicts (user-resolved)

1. **Persona anchor**: the human's primary dashboard job is adjudicator/supervisor — NOT knowledge consumer, NOT author. All dashboard evaluation weights follow from this: adjudication throughput + situational awareness first.
2. **Review triage precedes UI work**: the adjudication loop is dead because the queue composition is wrong, not because the workbench UI is bad. Fix is policy: decision-dense types (prd/spec/adr) require human review; execution-exhaust knowledge (assessment/retro/handoff/session-review) auto-approves; research/reference/ideation get lightweight batch confirmation. This converges with and defers to `knowledge-grill-review-2026-07-28-seven-product-direction` decision 4 (tiered review) and its sibling design note on ledger fast-track. No queue UI investment until the queue is ≤3 docs/day worth reading.
3. **Execution page demoted**: corpus progress granularity (plan/phase/task, evidence landed, who claimed what) is the accepted monitoring boundary — Lore is a memory SSOT, not a process monitor. Live session-level monitoring belongs to Claude Code's own surfaces. The execution page is a narrow-window local-value surface, not a core one.
4. **Home becomes a situational cockpit**: replace the resolved-PRD home with (a) decisions awaiting me (short after triage), (b) 24–48h activity stream backed by the existing `lore audit` query, (c) health signals (drift / stale / archive candidates). The PRD moves to its own entry point. Rationale: the returning human's first question is always "what happened while I was away, where am I needed".
5. **Packaging defer overturned — prerequisite, ordered BEFORE the cockpit**: `lore dashboard` must serve built static assets from `lore serve` in one command (still local-only). A cockpit gated behind a two-process dev-mode launch never forms a check-in habit; per the distribution-first ADR, an improvement without a delivery surface does not exist.
6. **Read views demoted to adjudication context**: search/tree/library are attachments to the adjudication workbench, not an independent retrieval destination — AI proxying is the primary human query channel. No standalone read-surface investment.

## Landing path (deferred to follow-up sessions)

- PRD update first (/lore-product): dashboard persona anchor + cockpit positioning + packaging promotion are product-direction changes.
- Then /lore-design specs: (a) dashboard cockpit + static packaging (this session's verdicts 4+5); (b) tiered review policy — likely already carried by the tiered-review thread from the sibling grill session; check before authoring a duplicate spec.
- Execution page and read views: no work planned; their demotion is recorded here so future "improve the execution page" impulses re-read this verdict first.

## Count correction (2026-07-31, agent:main-orchestrator)

The title and H1 read "five direction verdicts" while `## Verdicts (user-resolved)`
enumerates SIX, and the title's parenthetical named only four of them. An
independent review judgment rejected the document on this mismatch alone while
calling the substance strong.

Corrected to **six**, and the parenthetical completed from this document's own
verdict list — no verdict was added, removed, or reworded. The count that was
wrong is this document's count of its own contents; nothing downstream changed.

For the record, because the number is genuinely ambiguous across documents: the
parent spec records **five** owner decisions from this round (D4-D8). That is not
this document's count. Verdict 2 (tiered review triage) has no parent
D-counterpart because it defers to `knowledge-grill-review-2026-07-28-seven-product-direction`
decision 4 instead of minting a duplicate policy. Six here, five there, and both
are correct for what they are counting.

---
id: KN-297
type: knowledge
role: knowledge
title: "Grill review 2026-07-28 — seven product-direction decisions from evidence-first self-review"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-31
tags: []
parent: PRD-001
---
## Context

A /grill-me session interrogated the current state of Lore branch-by-branch (positioning → gate economics → read/write ratio → review workflow → concurrency mechanics → distribution). Every question was grounded in live evidence pulled during the session, not memory. User resolved each branch explicitly.

## Evidence anchors (as of 2026-07-28)

- Corpus: 804 docs — task 388 / knowledge 204 / spec 110 / plan 86 / ADR 15 / PRD 1; archived 475; DB 66MB.
- Gate observability gap: `gate_skipped` (bypass/config-disabled) IS audited (SPEC-080 G4), but gate DENIES are persisted nowhere; telemetry not enabled on our own corpus. Benefit/friction ratio of the core mechanism is unmeasurable.
- Review reality: last 40 approve actions in audit are ALL `agent:main-orchestrator` — writer-side self-certification; zero human/independent approvals. Pending queue (28 docs) is young (≤1 day) and 100% system-generated.
- Actor discipline: resolveActor OS-fallback emits a once-per-process warning only; anchor-overlap gate effectiveness still rests on prose discipline (export LORE_ACTOR per dispatch).
- Generalization samples already exist: guyin corpus (155 docs, full type chain incl. 96 tasks, active today) and babyai corpus (429 docs, doc layer heavily used — 30 PRD / 94 spec / 43 ADR — but ZERO tasks: execution loop unadopted). Both were never systematically reviewed as adoption evidence.

## Decisions

1. **Positioning**: dual identity — dogfood-to-product. Promotion gate = a second own-project runs the full corpus loop. Distribution/auth/sync investment FROZEN until the cross-corpus retro (decision 7) concludes.
2. **Trace-first principle** (user-stated, supersedes memory-based debate): before judging any "is Lore working" question, instrument. Data over recollection.
3. **Trace layer**: new `trace` table in lore.db, separate from the tamper-evident audit chain, default ON. Covers reads (get / search query+hits+follow-up gets / feed / context_bundle / MCP reads), gate DENY events (deny goes to trace stream, NOT audit — audit stays pure write-events), dimensions actor+surface+session. Aggregation view `lore trace stats` (read/write ratio, deny false-positive proxy via retry-success gap, never-firing predicates). Retention pruning included. Deploy to all three corpora (lore/guyin/babyai) for ×3 data.
4. **Tiered review**: execution-exhaust docs (task/assessment/retro/handoff) auto-approve — review ceremony removed; durable types (spec / ADR / feed-pack knowledge) require writer≠approver via independent fresh-context reviewer agent; human retains spot-checks on ADR/spec. Approve events traced.
5. **Actor auto-derivation**: when no explicit identity and cwd is inside a linked git worktree, default actor = `agent:<branch>` instead of OS username; OS fallback restricted to main checkout. Kills the "everyone falls to the same OS username → anchor gate never fires" failure class deterministically. Explicit LORE_ACTOR/--by still wins.
6. **Gate deny statistics** (folds into 3): denies persisted with checkpoint + failed predicate + actor + subsequent same-checkpoint retry outcome.
7. **Cross-corpus generalization retro BEFORE any promotion**: guyin = formal promotion-gate sample (audit full-chain health: gate hits, evidence quality, handoff consumption); babyai's zero-task shape investigated as adoption-friction signal (why did the execution loop not get adopted?); the 30-PRD anomaly examined. Findings feed back as Lore improvements. Distribution stays frozen until this retro lands.

## Next candidates (not yet planned)

- Spec for the trace table + `lore trace stats` (decisions 3+6).
- Spec for tiered review (decision 4).
- Spec for worktree actor auto-derivation (decision 5).
- The cross-corpus retro itself (decision 7) — highest information value, zero code required; arguably first.

---
id: KN-431
type: knowledge
role: knowledge
title: "Evicted from the service module doc: ReviewService's judgment gate, and the two different byte floors that let an anchored doc pass the guard while reddening the suite"
status: archived
priority: medium
created: 2026-08-11
updated: 2026-10-10
tags: []
parent: PRD-001
---
# Overview

Evicted verbatim from `packages/lore/src/service/CLAUDE.md`'s Key Invariants on
2026-08-11. That doc is one of the FOUR "anchored module docs" whose byte budget is
enforced twice, at two DIFFERENT thresholds, and this session hit the gap between them:

- `lore status --check-claude-md` (and the `claude-md-guard.sh` hook an agent sees
  interactively) uses the **eviction floor, 0.97** of `module.max_bytes` → 15893 bytes.
- `packages/lore/tests/unit/service/claude-md-eviction-floor.test.ts` asserts these four
  docs clear the **advisory band, 0.9** → 14746 bytes, with the recorded rationale that
  "a doc parked between warn and evict is one edit from blocking, and that is the state
  this task found four docs in".

⇒ **The interactive guard is LOOSER than the test that gates the suite.** This doc sat at
14723 bytes at session start — 23 bytes of runway. Three factual corrections took it to
15645: the guard reported "within budget (0 findings)" at every step, and the suite went
red. Recorded here because the eviction that fixed it is this document's reason for
existing, and because the next agent to edit an anchored module doc needs the 0.9 number,
not the 0.9x-looking one the guard prints.

⛔ Nothing below is historical. It is a LIVE invariant of `ReviewService`.

# The block, verbatim

**`ReviewService.approve` is judgment-gated for durable types** (SPEC-103 M2) — types in
`workflow.review.judgment_required_types` (default spec+adr) need a ReviewJudgment for the
CURRENT version; worst-decision-wins (reject > escalate > approve); unlock = version bump
+ fresh approve-judgment, or the audited `--override-judgment`. ⛔ That list scopes
`reject`/missing-judgment/provenance-collision ONLY: one `escalate` blocks EVERY type once
the list is non-empty. ⛔ For an ungated type the question is "is ANY current-version
decision an `escalate`?", never "is the WORST one?" — the service narrows the decision
VECTOR it passes, never the predicate's verdict; gated types keep the FULL vector
(anti-lottery). A judgment whose judge tuple equals `extra.ai_provenance` does not count.
SSOT: `spec-an-escalate-blocks-approval-for-every-doc-type-and-the`.

# Measured consequence of worst-decision-wins, 2026-08-11

The AI judge returned **reject / approve / escalate across three runs of the SAME
unchanged ADR version**. Under worst-decision-wins a single flaky `reject` locks that
version until a content edit bumps it. The escalate run's findings were substantively
correct and worth acting on — the disagreement was in the VERDICT, not the analysis. ⛔ So
a gating decision rests on a non-deterministic oracle, and the documented unlock path
("edit the doc, get a fresh judgment") is indistinguishable from editing a doc to dodge a
legitimate reject. Full context: `knowledge-fifteen-findings-from-fixing-a-consumer-defect-list` §D6.

# Related

- `packages/lore/src/service/CLAUDE.md` — carries the one-line pointer here.
- Sibling eviction from the CLI adapter doc, same session:
  `knowledge-evicted-from-the-cli-adapter-module-doc-the-gate-feed`.

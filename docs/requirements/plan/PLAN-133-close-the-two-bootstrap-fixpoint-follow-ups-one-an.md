---
id: PLAN-133
type: plan
role: plan
title: "Close the two bootstrap-fixpoint follow-ups: one anchored predicate in production, and a fixture-forced red for the anchor-value assertion"
status: deprecated
priority: high
created: 2026-08-21
updated: 2026-10-10
tags: []
parent: SPEC-134
phases:
  - {name: "two-follow-ups", description: "AC-BFI-14 and AC-BFI-15. Disjoint anchors, concurrent. Falsifier declaration is the orchestrator's post-merge step."}
---
# Goal

Close the two follow-ups handoff 109 left open on the bootstrap-fixpoint-integrity spec. Both
are instances of one pattern: a mechanism that WORKS but whose correctness rests on something
no oracle observes.

| # | AC | What is unobserved today |
|---|---|---|
| 1 | `AC-BFI-14` | The ratchet's independent witness and the checker it witnesses each hand-write "a spec is anchored iff `extra.code_anchors` is a non-empty array". Measured 2026-08-21: there are THREE such copies, and the third (`countArmedSpecs` in `packages/lore/src/flows/drift-flow.ts`) feeds the PUBLISHED `code_anchor_specs` field of `lore status --json`. Nothing binds any of them. |
| 2 | `AC-BFI-15` | `AC-BFI-13` passes and is attested, but its RED was never run — forcing it would mean repointing a live anchor in the team's own corpus. It is carried as declared, unmeasured debt. |

⛔ AC-BFI-14 deliberately does NOT collapse the witness into the shared predicate. Handoff
109 NS2 proposed "export the predicate from a shared module both import"; taken literally
that reintroduces the circularity `AC-BFI-10` exists to close — one regression would corrupt
subject and witness together. The design here separates the two concerns: the two PRODUCTION
copies become one, and the witness stays independent but is pinned by a differential
boundary-case table. Recorded so the deviation from the handoff is visible, not silent.

⛔ Why item 2 matters beyond one criterion: measured corpus-wide 2026-08-21
(`knowledge-the-falsifier-mechanism-is-shipped-but-inert-a` F3), 279 `expected-fail` evidence
rows exist and exactly 2 carry an attestation block. "A red is recorded" and "the oracle was
machine-proven to discriminate" differ by 138x. This plan closes that gap for one criterion
by construction rather than by restating the discipline.

# Phases

One phase, two tasks, disjoint file anchors so they run concurrently.

# ⛔ Falsifier declarations are the ORCHESTRATOR's step, not the implementer's

`lore ac set` demotes this spec to `draft` and hard-blocks every descendant claim. With two
tasks live under one spec, an implementer declaring a falsifier would freeze its sibling's
claim mid-flight. So:

- Implementers RUN their reds and record `expected-fail` evidence themselves, in-worktree, at
  the moment the oracle is red. That is not delegable — a red transcribed afterwards is not
  evidence.
- Implementers do NOT run `lore ac set`. The orchestrator declares the `--falsifier-*` set
  after both tasks merge, and runs `lore verify --falsify` WHILE THIS PLAN IS STILL LIVE.
- ⛔ That ordering is load-bearing, not tidiness: `lore verify --falsify` needs the plan
  positional and a live claim, so a falsifier declared after this plan archives can never be
  re-run (`knowledge-the-falsifier-mechanism-is-shipped-but-inert-a` F2 — all 8 existing
  declarations in this corpus are already unrunnable for exactly this reason).

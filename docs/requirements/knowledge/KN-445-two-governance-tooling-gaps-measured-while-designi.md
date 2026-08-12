---
id: KN-445
type: knowledge
role: knowledge
title: "Two governance-tooling gaps measured while designing the concurrency mechanism: three of four gates have no feeding source, and the coverage hook accepts a reason only on deferral"
status: approved
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
links:
  - {id: KN-169, type: relates-to}
  - {id: KN-426, type: relates-to}
---
## Overview

Two governance-tooling gaps measured while designing the multi-session
concurrency mechanism on 2026-08-12, plus one question this session could not
answer and is recording as open rather than assuming.

Both gaps share a shape: a governance surface that renders identically whether or
not the thing it describes exists. That is the same defect family as
`knowledge-four-governance-tooling-gaps-measured-while-resuming` — an outcome the
tool presents the same way in the sound and unsound cases.

## GAP-1 — Three of the four deterministic gates have no feeding source

Measured directly:

```
$ for c in spec-create spec-promote plan-promote task-claim; do lore feed "$c"; done

spec-create   -> [source: knowledge-write-spec-rules-gate-feeding-source, trust: team-authored]
spec-promote  -> no approved governing skill for spec-promote
plan-promote  -> no approved governing skill for plan-promote
task-claim    -> no approved governing skill for task-claim
```

The documented workflow says to pull governance before producing an artifact:
"产出 artifact 前：`lore feed <checkpoint>` — 主动 PULL，别等 gate 拒了才看". For
three of the four checkpoints there is nothing to pull. The FEED half of the loop
is implemented for 25% of the gates it is written to cover.

Why this is a mechanism defect and not a documentation defect: the instruction to
feed is followed correctly and returns a message that reads like a normal,
successful answer about the state of the world. An agent that dutifully feeds
`task-claim` receives a sentence and proceeds, having learned nothing, with no
signal that it learned nothing. Compare the `spec-create` output, which returns
the actual rules. The two outcomes are not distinguishable as "governed" versus
"ungoverned" without knowing in advance that one of them should have had content.

Fix shape: either author the three missing feeding sources, or make an absent
source a LOUD result — a distinct exit code and a message that says the checkpoint
is ungoverned, rather than prose that reads like an ordinary reply.

## GAP-2 — The handoff coverage hook accepts a reason only on the deferral token

`stop-handoff-coverage.mjs` (and its shipped twin under `assets/hooks/`) accepts
exactly two disposition tokens per resume-ticket item:

- `deferred:<reason>` — free text after the colon is accepted and preserved
- `done` — any suffix is rejected

Measured: three items dispositioned as `done — <the measured finding>` were
rejected by the parser and had to be re-emitted as bare `done`.

The asymmetry inverts the value of what it records. A deferral's reason is
usually "blocked, will do later"; a completion's reason is often the actual
finding — in this session, `KD3: done` was the disposition of a handoff assertion
that had been measured FALSE, and the evidence for that reversal is exactly what
the bare token cannot carry. The format penalises the higher-information case,
pushing findings out of the machine-readable layer and into prose that no
consumer parses.

Fix shape: accept `done:<reason>` symmetrically. The parser change is small; the
reason it matters is that the coverage floor exists to make dispositions
auditable, and an unreasoned `done` is auditable only as a count.

## Open, not assumed — does the deny path have content when the feeding source is absent?

The gate contract is "exit 4 plus a feeding pack". GAP-1 shows three checkpoints
have no feeding source on the PULL path. Whether their DENY path is likewise
empty was not measured this session: triggering a genuine `task-claim` refusal
requires constructing an anchor overlap across two sessions in a throwaway corpus,
which was out of scope while an implementer held the checkout.

This is recorded as an open question rather than an inference. If the deny path is
also empty, the "exit 4 + feeding pack" contract is real for exactly one of four
gates, and every other refusal is a bare rejection the agent must guess its way
out of — which would make it a considerably more serious finding than GAP-1 alone.

Whoever measures it should construct the overlap rather than reason about the
code path, and should record the exact refusal payload.

## Provenance

Both gaps were found while doing other work, not by an audit. GAP-2 was found by
being blocked by the hook; GAP-1 was found by feeding a checkpoint out of habit
and reading the reply carefully instead of skimming it. Neither would have
surfaced from reading the code, because in both cases the code does exactly what
it was written to do.

---
id: KN-268
type: knowledge
role: knowledge
title: "Four assessments converged on a missing capability that shipped — the gap was the dispatch bundle, not the tool"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
# Four assessments converged on a "missing" capability that shipped months ago — the gap was the dispatch bundle, not the tool

## What happened

Four independent `lore assess` judgments in one session — SL (AC-SL-7's negative
control), R2 (AC-R2-1), ESC (the red baseline), D5 (a task whose core act was inverting
a passing test) — each raised the same `evidence_integrity` finding: **a task bound to
RED-first produced no record of the red.** Every trail was green-only.

Four converging judgments is this repo's build-it-now signal, and a knowledge doc
proposing the mechanization ("an evidence row whose expected result is `fail`") was
already drafted into three of those assessments.

Then the standing rule fired: *escalation ≠ build — a twice-recommended mechanization
triggers a VERIFICATION pass first, not a build pass; check whether the underlying tool
already enforces the invariant.* It refuted the proposal outright.

## Measured

```
lore evidence --help
  --result (required)    Outcome: pass | fail | expected-fail
```

`expected-fail` is not an accident of the enum — it is purpose-built for this case,
delivered by `task-m1-evidence-result-vocabulary-expected-fail-ac-wh-1` under the name
"evidence RED vocabulary", and the CLI renders it with a dedicated `⚑R` marker distinct
from both pass and inconclusive (`adapters/cli/utils.ts`). The corpus already holds
**146 `result=fail` rows out of 3067**, and the bun suite exercises the path
(`Recorded test evidence (fail) on task-oracle-precheck-test-task`).

The capability shipped. Nothing needed building.

## The actual root cause — mine, and one layer up

Every dispatch bundle in this session said, in some wording:

> RED FIRST. Every new assertion must be demonstrated failing … **Capture that red output.**

"Capture" is the defect. It named an artifact with no destination. Four implementers did
exactly as told: each measured a genuine red (one even built a mutation probe and a
discrimination probe unprompted), reported it in its final message, and none recorded it
with `--result expected-fail` — because the bundle never said to. The reds landed in
subagent transcripts, which are discarded.

So four assessments correctly detected an absence, correctly located it in the corpus,
and I mis-attributed it to the tool because the tool is where a missing record *looks*
like it should live.

**Bundle wording that closes it** — the destination, not just the act:

> RED FIRST. Show each new assertion failing before the fix, and record that failure in
> the corpus: `lore evidence <task> --oracle test --command "<exact cmd>" --result
> expected-fail --ac <AC-ID>`. A red that exists only in your final message is not
> recorded; your transcript is discarded.

## The generalisable lesson

**A converging chorus of independent findings raises confidence in the SYMPTOM, not in
the diagnosis.** Four judges agreeing that "the red is not in the corpus" was correct and
well-evidenced. Their shared implied cause — "so lore cannot record it" — was never
measured by any of them, and it was wrong. Convergence felt like proof and functioned as
anchoring.

Concretely, what the verification pass cost and saved: one `--help` invocation, against a
corpus claim asserting that lore lacks a feature it ships. That claim had already been
written into three assessment documents before the check ran; all three now carry an
inline correction rather than a deletion, so the near-miss stays legible.

Second-order note worth keeping: the reason this was cheap to catch is that the assess
findings named a CAPABILITY ("an evidence row whose result is fail") rather than a
behaviour. A capability claim is one `--help` away from being falsified. When a finding
is phrased as "X cannot be done", check before agreeing.

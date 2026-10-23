---
id: KN-633
type: knowledge
role: knowledge
title: "Corpus-only control on both review-branch probes: baseline leads by 1.0 and 1.5"
status: archived
priority: medium
created: 2026-10-09
updated: 2026-10-23
tags: []
parent: PLAN-177
---
Corpus-only control on both review probes (owner choice A after attempt 2), 2026-10-09. Same questions, same fixed scoring rules, separate grader per probe. The control reader saw 401 live prd/spec/adr/knowledge docs exported read-only, excluding baseline docs, every doc whose slug names probe/pilot/baseline/assessment/handoff, handoff/assessment/uat knowledge, and anything created on 2026-10-09; BR ids masked as `BR-?`. No code, no `lore`.

| Probe | Baseline reader (spec+execution+review branches) | Corpus-only reader | Delta | Confident-wrong (baseline / corpus) |
|---|---|---|---|---|
| Attempt-1 probe (`knowledge-review-branch-frozen-probe-set-10-questions-for-the`) | 8.5 | 7.0 | +1.5 | 0 / 0 |
| Re-probe (`knowledge-review-branch-frozen-re-probe-set-10-questions`) | 7.5 | 6.5 | +1.0 | 0 / 0 |

## Observations
- The baseline beats the corpus on both probes; PRD kill/revisit criterion (2) is NOT triggered by this evidence (it names the corpus-only reader as the bar to beat).
- Error kinds differ. Corpus-only wrong answers come from stale or conflicting documents (an older spec allowing what a newer note forbids; a design draft naming the wrong stored identity; an inferred version row on reject; "identical save probably stays approved"). Baseline losses are absences of fine detail (badge text, audit identity, flag combinations) plus one ambiguous rule (BR-265, the AI-default question).
- The corpus-only reader marked 2/10 and 1/10 answers `sure`; the baseline reader 7/10 and 7/10 — with 0 confident-wrong on both sides. The baseline lets a reader commit correctly far more often.
- Neither reader reaches the absolute 9/10 bar on probes that require >= 4 prose-vs-code discriminators written by an author hunting code-level edge cases. Across baseline probes so far: v3 8/10, review 8.5 and 7.5.
- Graders flagged two borderline scores (baseline re-probe Q5 0 vs 0.5; corpus attempt-1 probe Q5 0 vs 0.5); taking the lenient reading on both sides leaves the deltas at +1.0 and +1.0.

## Limits
n = 2 probes x 10 questions on one branch; graders are LLM agents; the corpus export filter is a judgment call (excluding today's docs also excludes nothing about review, since the review branch is the only review-specific doc created today).

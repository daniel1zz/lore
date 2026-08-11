---
id: KN-239
type: knowledge
role: knowledge
title: "An LLM judge returned escalate and approve on the identical document version, and D5 turns either outcome into a hard approval block"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: SPEC-121, type: relates-to}
---
## What was measured

Seven `lore review --ai` runs against one spec (`spec-report-issue-has-no-specified-concurrency-contract-ac-072`) on 2026-08-01, while discharging its D7 gap:

| run | doc_version | decision | confidence |
|---|---|---|---|
| 1 | 28 | approve | 0.72 |
| 2 | 32 | approve | 0.72 |
| 3 | **35** | **escalate** | 0.72 |
| 4 | **35** | **approve** | 0.72 |
| 5 | 36 | escalate | 0.72 |
| 6 | 38 | escalate | 0.62 |
| 7 | 40 | approve | 0.76 |

**Runs 3 and 4 are the datum**: same document, same version, same judge, opposite verdicts. Not a text change, not a version bump — the judge is non-deterministic on identical input.

## Why that is more than a curiosity

`spec-an-escalate-blocks-approval-for-every-doc-type-and-the` **D5** (amendment 2026-07-31) hardens the rule that an `escalate` PRESENT blocks approval — deliberately, even when a `reject` accompanies it, and regardless of `workflow.review.judgment_required_types`. The gate reads the set of judgments at the CURRENT version, so a later `approve` at that same version does not supersede an earlier `escalate`.

Combined with run-3-vs-run-4, that means: **one flaky escalate permanently blocks the version.** Measured — `lore approve` was denied at v35 quoting run 3's blocking questions, while run 4's `approve` with `blocking_questions: []` sat in the corpus at the same version.

The denial names the recovery: work the blocking questions, "answering them edits the doc, bumping its version, so a fresh judgment is required anyway". When the escalate was substantive that is exactly right. When the escalate was a coin flip, the only sanctioned escape is **editing the document to clear a stale verdict** — the "author a doc to clear a gate" anti-pattern CLAUDE.md warns about, arrived at from the opposite direction.

The deeper point: D5 launders an ADVISORY signal into a HARD gate. The corpus rule is that an AI judge is never a gate; D5 makes one judge output block a deterministic transition. That is defensible when the judge asserts an outstanding human decision — but it inherits the judge's variance, and nothing in the current design distinguishes "a human really must decide" from "the sampler wobbled".

**Not filed as a defect to fix blindly.** Two candidate directions, neither obviously right: (a) let the newest judgment at a version supersede older ones, which weakens D5's whole point (an operator could re-roll until it passes — strictly worse); (b) require N consecutive escalates, or treat a same-version approve-after-escalate as needing explicit human dismissal rather than a doc edit. Direction (b) preserves the human-decision intent without rewarding re-rolls. Decide with evidence on how often the flip actually happens, not from this single pair.

## The other finding: the truncation window is a systematic bias, not noise

Every judgment carried `truncated: true`. Runs 5, 6 and 7 differed almost entirely in WHERE content sat relative to the truncation point:

- D7 was originally appended as the LAST section of the body. Runs 5 and 6 both asked, as a BLOCKING question, "Where is D7 declared? It is not in the Design Decisions section" — and run 6 said so explicitly: "the document body beyond Contract Details was not shown to me".
- No amount of prose answered it, because the answer was outside the window. Moving a D7 summary bullet INTO `## Design Decisions`, beside D1–D6, cleared it: run 7 returned `approve` 0.76 with zero blocking questions.

So: **load-bearing decisions must sit inside the judge's visible window, or the judge will manufacture recurring phantom blocking questions about them** — and under D5 each of those phantoms is a hard approval block. Section ORDER in a spec is therefore load-bearing governance, not formatting.

## What the judge earned

Worth stating plainly, because the non-determinism finding could be misread as "the judge is noise". Across these runs it caught four real defects the deterministic checks all passed:

1. An unquantified threshold I had just introduced ("exceeding the declared exclusion cap" with no cap value declared anywhere).
2. A pass condition undefined in the interval between the readable-run floor and the target sample size.
3. A **second, stale copy** of the acceptance criteria in the document body — five criteria where six were declared, with pre-D7 wording, i.e. two AC lists encoding different pass conditions for the same ids.
4. `AC-IC-3` asserting only "zero matches" while D3's MUST about path existence had no criterion behind it.

Findings 1 and 2 were mine, introduced in the same session that fixed the original gap — an advisory judge reading my own fresh text caught what I could not. The pattern to keep: after authoring a contract change, run the judge on it before promoting, and treat its quantifiability advisories as work rather than commentary.

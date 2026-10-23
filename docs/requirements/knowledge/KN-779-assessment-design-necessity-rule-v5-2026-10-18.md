---
id: KN-779
type: knowledge
role: knowledge
title: "Assessment: Design-necessity rule v5 (2026-10-18)"
status: archived
priority: medium
created: 2026-10-18
updated: 2026-10-23
tags: []
parent: PLAN-210
links:
  - {id: PLAN-210, type: informs}
---
# Assessment: partially_met (74/100)

Scope: plan `01M57F6HPPWY47XN0HP3H057D9`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-DN5-1 | 87 | Attested pass: 22/22 v5 tests. The diff sets v5 as current and its rule has i-iv, a-d and the classify-first order. The v4 builder is unchanged in the diff. But the v4 frozen snapshot was added in this same change, so the claim it predates v5 cannot be checked. | 01M57F6TXW3V149M8N67DYYTB3 (evidence [7] attested AC command pass; [2] worktree pass; [5] v2/standard/v5 suite pass) |
| AC-DN5-3 | 88 | Attested pass: 9/9 integration tests. They cover a locked spec with --correction (stays approved, one version, Correction summary), no --correction (exit 4, record-edit), live, other-spec and unknown ids (exit 4, id named), bounds and a regression. An expected-fail then pass shows a real red/green … | 01M57F6VK865MWMPAXQ9Q8Z3AT (evidence [1] expected-fail, [2] and [4] pass, [3] tsc) |
| AC-DN5-2 | 48 | Manual and self-reported only. The tail shows both patch-shaped runs rejected on design_necessity, but it prints prompt=None, so v5 use is not confirmed. Both end-state runs are cut off. Seam and transitional-bridge naming are not visible. The corrected fixture labels its items with the prompt's ow… | 01M57F6TXW3V149M8N67DYYTB3 (evidence [6] manual, tail 1029 bytes) |

## Gaps

- The manual evidence prints prompt=None for the judge runs and the tail omits both end-state runs. Nothing shown proves v5 was used, or that the end-state fixture drew no design_necessity finding in two runs.
- packages/lore/tests/fixtures/design-necessity/end-state-spec.md now labels its items with the v5 non-finding class names. A pass may reflect the fixture echoing the prompt's wording rather than the judge telling end-state designs from patch-shaped ones.
- packages/lore/tests/fixtures/design-necessity/review-prompt-v4-frozen.json is added in the same change that adds v5. Byte-identity of v4 rests on the builder being unchanged in the diff, not on a snapshot that predates the change.

## Recommendations

- For human/manual AC evidence on judge behaviour, record the full transcripts (decision, prompt_version, every reasons entry) for every required run, not a byte-limited tail.
- Add a held-out end-state fixture that justifies its items in its own words, not in the prompt's class names, as a second AC-DN5-2 control.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 41556ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-DN5-3, AC-DN5-2

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 78 | 0.7 | evidence | DN5-1 and DN5-3 code and tests deliver their ACs. The real-judge behaviour (AC-DN5-2) is only partly shown. |
| evidence_integrity | 65 | 0.65 | evidence | Script ACs have attested red/green runs. AC-DN5-2 rests on a truncated self-reported manual tail that shows prompt=None and no end-state runs. |
| scope_fidelity | 86 | 0.7 | evidence | Changes stay within the two tasks. The edits to existing tests are needed for the version bump. No new scanner or ledger; ledger entries are only removed. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| evidence_integrity | major | AC-DN5-2 | The manual evidence prints prompt=None for the judge runs and the tail omits both end-state runs. Nothing shown proves v5 was used, or that the end-state fixture drew no design_necessity finding in two runs. |
| outcome | minor | AC-DN5-2 | packages/lore/tests/fixtures/design-necessity/end-state-spec.md now labels its items with the v5 non-finding class names. A pass may reflect the fixture echoing the prompt's wording rather than the judge telling end-state designs from patch-shaped ones. |
| evidence_integrity | minor | AC-DN5-1 | packages/lore/tests/fixtures/design-necessity/review-prompt-v4-frozen.json is added in the same change that adds v5. Byte-identity of v4 rests on the builder being unchanged in the diff, not on a snapshot that predates the change. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | For human/manual AC evidence on judge behaviour, record the full transcripts (decision, prompt_version, every reasons entry) for every required run, not a byte-limited tail. | A truncated tail hid the end-state results and showed prompt=None. |
| spec | Add a held-out end-state fixture that justifies its items in its own words, not in the prompt's class names, as a second AC-DN5-2 control. | This guards against a prompt that only recognizes its own wording. |

## Unverifiable Materials

- Full AC-DN5-2 judge transcripts (end-state runs 1-2, prompt_version): Evidence tail is truncated at 1029 bytes and prints prompt=None.
- Merged scripts/ac-oracle-not-built-ledger.json: Only the two per-branch diffs from the same base are shown.
- resolveLockExit / exit-code mapping source: Not in the diff. Exit 4 and the record-edit wording are verified only through tests.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 2
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 3 declared criteria
- Task evidence: 2 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.73

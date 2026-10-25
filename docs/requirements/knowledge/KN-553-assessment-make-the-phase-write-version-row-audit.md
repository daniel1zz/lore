---
id: KN-553
type: knowledge
role: knowledge
title: "Assessment: Make the phase-write version-row / audit-entry pairing oracle-enforced (2026-08-25)"
status: archived
priority: medium
created: 2026-08-25
updated: 2026-10-23
tags: []
parent: PLAN-144
links:
  - {id: PLAN-144, type: informs}
---
# Assessment: partially_met (62/100)

Scope: plan `01M0SWJECFFT7AWA7ZP37G1HW2`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-PHASEVER-1 | 30 | Declared on spec and in scope (plan sets no ac_scope), but zero oracle runs recorded — 0 pass / 0 fail. The plan's single task targets only AC-PHASEVER-4 and the doc-parity suite is untouched by this diff, so nothing here evidences it. | 01M0SWK6BP682JPNTYBSN6YPXP (task evidence all ac_ref=AC-PHASEVER-4 or none) |
| AC-PHASEVER-2 | 30 | 0 pass / 0 fail recorded. No evidence row carries this ac_ref and the diff adds no rename/rm lifecycle assertions in the doc-parity suite. Unverifiable from these materials. | 01M0SWK6BP682JPNTYBSN6YPXP (no ac_ref=AC-PHASEVER-2 evidence) |
| AC-PHASEVER-3 | 30 | 0 pass / 0 fail. No header sweep, ADR-citation, or repo-wide grep run is recorded. The new suite splits the banned phrases so it does not break (d), but that is compliance, not coverage of (c)/(d)/(e). | 01M0SWK6BP682JPNTYBSN6YPXP (no ac_ref=AC-PHASEVER-3 evidence) |
| AC-PHASEVER-4 | 93 | 2 attested passes plus an attested expected-fail from the severed-shape probe. Suite pins --json readers (clean, misses, chain.clean/checked), asserts exactly-+1 chain growth, watermark non-vacuity, STATE readback, and two in-run tampers proving discrimination. | 01M0SWK6BP682JPNTYBSN6YPXP (evidence [1] expected-fail, [2]/[3] pass, 24 tests passed, exit 0) |

## Gaps

- AC-PHASEVER-1 is declared on the spec, not scoped out by the plan, and has 0 pass / 0 fail. No evidence row references it and packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts is untouched by this diff, so CLAUDE.md doc parity and the live phase-add lifecycle measurement are unevidenced in this bundle.
- AC-PHASEVER-2 has 0 pass / 0 fail. The rename/rm two-conjunct measurement, its same-run set --content green control, and the depth-1 accepted-ADR reachability check are all unevidenced here; packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts received no changes.
- AC-PHASEVER-3 has 0 pass / 0 fail. Nothing in this bundle shows the header sweep on packages/lore/src/service/phase-service.ts and packages/lore/src/service/ac-service.ts, the ADR-slug citation counts, or the repo-wide banned-phrase grep returning 0 files.
- The expected-fail row [1] carries ac_ref=(none) and no visible output_tail, so the claimed red magnitude (clean:false, exit 4, 3 misses) asserted in the header of packages/lore/tests/integration/phase-write-audit-pairing.test.ts cannot be confirmed from these materials.
- The task required confirming via git diff that the only tracked change is the new test file after reverting the probe. That check is represented only by in-suite structural greps on packages/lore/src/service/phase-service.ts; no diff/status oracle row is recorded.

## Recommendations

- Either declare extra.ac_scope = [AC-PHASEVER-4] on this plan, or carry forward the prior plan's recorded runs for AC-PHASEVER-1/2/3 into this bundle.
- Require expected-fail evidence rows to carry an ac_ref and a retained output_tail showing the failing assertion text.
- Add a tracked-tree cleanliness oracle (git status/diff --stat) as an evidence row when a task's method requires a transient out-of-tree probe.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 97629ms
- Retried: true
- Truncated sections: (none)

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 72 | 0.8 | evidence | AC-PHASEVER-4 is fully delivered with a demonstrated red and in-run tamper controls; the other three declared ACs have no runs in this bundle. |
| evidence_integrity | 85 | 0.75 | evidence | 3/3 attested, ratio 1.00, including the required expected-fail. Deduction: the red row lacks ac_ref and output_tail, so its magnitude is unverifiable here. |
| scope_fidelity | 95 | 0.85 | evidence | Diff adds exactly the one permitted file; no change to phase-service.ts or the sibling parity suite, matching the task's hard file anchor. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-PHASEVER-1 | AC-PHASEVER-1 is declared on the spec, not scoped out by the plan, and has 0 pass / 0 fail. No evidence row references it and packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts is untouched by this diff, so CLAUDE.md doc parity and the live phase-add lifecycle measurement are unevidenced in this bundle. |
| outcome | major | AC-PHASEVER-2 | AC-PHASEVER-2 has 0 pass / 0 fail. The rename/rm two-conjunct measurement, its same-run set --content green control, and the depth-1 accepted-ADR reachability check are all unevidenced here; packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts received no changes. |
| outcome | major | AC-PHASEVER-3 | AC-PHASEVER-3 has 0 pass / 0 fail. Nothing in this bundle shows the header sweep on packages/lore/src/service/phase-service.ts and packages/lore/src/service/ac-service.ts, the ADR-slug citation counts, or the repo-wide banned-phrase grep returning 0 files. |
| evidence_integrity | minor | AC-PHASEVER-4 | The expected-fail row [1] carries ac_ref=(none) and no visible output_tail, so the claimed red magnitude (clean:false, exit 4, 3 misses) asserted in the header of packages/lore/tests/integration/phase-write-audit-pairing.test.ts cannot be confirmed from these materials. |
| evidence_integrity | minor | AC-PHASEVER-4 | The task required confirming via git diff that the only tracked change is the new test file after reverting the probe. That check is represented only by in-suite structural greps on packages/lore/src/service/phase-service.ts; no diff/status oracle row is recorded. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Either declare extra.ac_scope = [AC-PHASEVER-4] on this plan, or carry forward the prior plan's recorded runs for AC-PHASEVER-1/2/3 into this bundle. | Three declared ACs currently read as 0-coverage, which understates the delivered work and hides whether they were ever re-measured. |
| process | Require expected-fail evidence rows to carry an ac_ref and a retained output_tail showing the failing assertion text. | A red recorded without its output is only marginally stronger than the prose red this plan was opened to eliminate. |
| process | Add a tracked-tree cleanliness oracle (git status/diff --stat) as an evidence row when a task's method requires a transient out-of-tree probe. | Step 4 of the task is a real obligation but currently leaves no machine-checkable trace. |

## Unverifiable Materials

- Output tail of evidence row [1] (the expected-fail probe run): tail_bytes=4268 recorded but no content shown in the materials, so the failure mode and miss count cannot be confirmed.
- Oracle runs for AC-PHASEVER-1, AC-PHASEVER-2, AC-PHASEVER-3: No evidence rows with those ac_refs appear in the bundle; coverage table reports 0 pass / 0 fail for each.
- Current contents of packages/lore/src/service/phase-service.ts and ac-service.ts: Not included in the diff or materials; the suite's structural assertions about them can only be taken from the recorded pass.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 6
- Unverifiable (confirmed absent — finding withdrawn): 0
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Facts Summary

- AC coverage: 4 declared criteria
- Task evidence: 1 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00

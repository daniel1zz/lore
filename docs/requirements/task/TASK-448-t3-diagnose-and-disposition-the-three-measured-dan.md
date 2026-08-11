---
id: TASK-448
type: task
role: plan
title: "T3 — diagnose and disposition the three measured dangling ac_ref"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-085
plan: PLAN-085
---
## Task

Diagnose and disposition the three dangling `ac_ref` measured on 2026-08-01, so
AC-ACS-7's positive half (detector exits 0 on the repo corpus) becomes true.

| task holding the evidence row | dangling `ac_ref` |
|---|---|
| `task-t2-framing-line-emitted-binary-side-hook-demoted-to` | `AC-CP-3` |
| `task-t4-payload-wide-feed-governance-rule-manifest-regeneration` | `AC-CP-5` |
| `task-t5-compiled-e2e-suite-proving-every-surface-from-a` | `AC-CP-7` |

All three name criteria of `spec-context-provenance-injected-corpus-global-state-and-a`,
which today declares AC-CP-1, 2, 4, 6, 9, 10, 11.

## Spec Reference

`spec-lore-ac-set-in-place-edit-of-a-declared-acceptance` §D7, "Retroactive policy".
Read it in full — it constrains the answer far more than it may first appear.

## The constraint that decides the shape of this work

`extra.verification_evidence` is **append-only** (SPEC-025). You may not rewrite or
delete any `ac_ref`. So there are exactly two honest dispositions per ref:

1. **Lost in an `rm`+`add` cycle, not retired** → re-declare the criterion under its
   original id (use the `lore ac set` / `lore ac add` verbs from T1). The historical
   evidence assertion becomes resolvable and true again.
2. **Genuinely retired or merged into another criterion** → record an auditable
   exemption row via T2's ledger channel (id, spec, date, reason, what the evidence
   asserted).

⛔ **Guessing between them is forbidden.** The disposition MUST cite the spec version
in which each id disappeared — `lore log spec-context-provenance-injected-corpus-global-state-and-a`
shows paired `(removed …)` / `(added …)` entries; use `lore diff <spec> --from N --to M`
to find the version where each of 3 / 5 / 7 left without returning, and read what the
neighbouring criteria said at that moment to judge whether the content was merged
elsewhere.

⛔ **Never synthesise a criterion to satisfy the detector.** An exemption stays
auditable forever; a criterion authored to clear an oracle is afterwards
indistinguishable from a real one. If the evidence is ambiguous, option 2 with an
honest "could not determine, preserved for audit" reason is the correct answer — not
a plausible-looking re-declaration.

## Acceptance Criteria

Consumes AC-ACS-7 (does not own it — T2 owns the detector). Completion condition:
`bun scripts/check-ac-ref-integrity.ts` exits 0 against the repo corpus, with every
one of the three refs dispositioned by path (1) or (2) and the reasoning recorded.

## Depends on

T1 (the writer verb) and T2 (the detector + ledger). Do not start before both merge.

## Verification discipline

Run the detector BEFORE your changes and record the red output; run it after and
record the green. A green-only record cannot distinguish "fixed it" from "the detector
never looked at these rows".

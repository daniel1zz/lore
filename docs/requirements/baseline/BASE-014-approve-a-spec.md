---
id: BASE-014
type: baseline
role: intent
title: "Approve a spec"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-12
tags: []
parent: BASE-064
links:
  - {id: SPEC-032, type: supersedes}
  - {id: SPEC-097, type: supersedes}
---
## Approve a spec

> A spec is admitted as the approved contract for its work.

Scope: the **spec-specific** admission conditions (including that a spec cites at least one live rule, BR-1007), and the two limits on editing a spec directly that keep what approval judged meaningful: the kind values a spec may carry (the kind decides which conditions apply, BR-246) and the criteria a direct edit may not touch (BR-247). The review judgment, reviewer rules and status transitions in general belong to the review branch's approval leaf (see Q1).

### Behaviour

**Command.** A reviewer approves a spec, or an author sets a draft or in-review spec's status to approved.

**Constraint.** Enough criteria for the spec's kind (BR-72, BR-73); every person-decided criterion measurably worded, and every AI-judged criterion measurably worded in its statement or its judging rubric (BR-74); every check kind the spec's kind requires covered by at least one check-decided criterion (BR-75). Then, once those pass, at least one criterion must cite a live business rule or architecture standard rule; otherwise approval is refused with exit code 4, the refusal names `lore ac cite`, and nothing is written (BR-1007). The citation condition applies to every spec kind, cannot be switched off, and holds on both routes into approved: setting the status to approved runs the review approval path itself, where the check sits (review-service.ts `enforceApprovalGate`; BR-1071). Other document types are unaffected.

**Event.** `SpecApproved`.

### Terms used here

- **Minimum criteria count**: the fewest criteria a spec of a given kind must have before it may be approved.
- **Required check kinds**: per spec kind, the check kinds that at least one check-decided criterion must cover before approval.

### Boundary notes

- Review approval first requires an independent review judgment for the spec's current version; only after that are the conditions of this leaf applied. Setting the status directly is the same approval and requires the same judgment (BR-1071; Q2 resolved).
- Approval looks at citations only through BR-1007: one criterion citing a live rule is enough, and other criteria's citations are not checked here (BR-84). Each citation is checked when its criterion is written, by the citation gate on Cite a baseline rule, which in this repository enforces on every branch; criteria written before the gate and never changed since reach approval ungated. Because the citation condition needs a criterion, a domain-overview spec (minimum criteria count 0) can no longer be approved with no criteria.
- Withdrawing a spec's only citing criterion after approval leaves it approved (BR-81); the citation condition is checked only on a move into approved (BR-79).
- BR-1007 moved here from review, "Approve a document", on 2026-10-10; that leaf's BR-286 now points to this leaf for every spec condition.
- A refused approval lists every unmet count, wording and check-kind condition together; the citation refusal comes alone, after those pass (BR-78).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Minimum criteria count per spec kind | New project: 1 for every kind. This repository: feature 1, tech 1, design 1, domain overview 0 | project settings maintainer | 2026-10-07 |
| Required check kinds per spec kind | New project: none. This repository: feature needs a test check, tech needs a test check, design needs an end-to-end check, domain overview none | project settings maintainer | 2026-10-07 |
| Whether the approval check runs at all | on (new project and this repository); each skip is recorded | project settings maintainer | 2026-10-07 |
| Whether its wording part runs | on | project settings maintainer | 2026-10-07 |
| Whether its check-kind-coverage part runs | on | project settings maintainer | 2026-10-07 |

### Depends on

- Declare an acceptance criterion: the wording rule re-applied at approval.
- Declare, revise and withdraw criteria and declare a code anchor: which later changes an approval survives.
- review (not yet written): review judgment, transitions, who may approve.
- corpus (not yet written): body or title revision returns an approved document to draft.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Does this leaf belong here, or are its rules a section of the review branch's approval leaf? A gate belongs inside the leaf it constrains and this gate constrains only spec approval, but two leaves share one event. | undecided | product (owner) |
| Q2 | Resolved 2026-10-12 by `spec-approval-and-plan-closure-go-through-the-same-checks-on` D1: the direct route stays and runs the review approval path, so it needs the same judgment (BR-1071; issue 65 fixed). | resolved | product, engineering |
| Q3 | Changing an approved spec's kind is not re-judged. A spec can be approved as a lenient kind and reclassified as a stricter one. Should a kind change return it to draft? | undecided | product |
| Q4 | Approval certifies the criteria as they stood at that moment. Later additions and withdrawals and changes to the per-kind settings are not re-judged, so a reader of an approved spec cannot tell whether it would pass approval today. Should approval carry the state it judged? | undecided | product |



Q5 (where the citation condition is checked) was closed on 2026-10-10: the citation gate checks a criterion when it is created, declared or revised, not at approval (BR-84; Cite a baseline rule). The number is not reused.

#### Downgraded in pilot v2 — no falsifying acceptance criterion yet

Each rule below matches the code as read on 2026-10-08, but no live check-decided criterion would fail if it were false, so it is held at unconfirmed until one exists (method v2, `adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Was | Open question |
|---|---|---|
| BR-74 | observed | Is it intended that an AI-judged criterion with a vague statement passes approval on the strength of a measurable rubric alone, and that a project can switch the wording check off? |
| BR-78 | observed | Rewritten 2026-10-10: the citation refusal (BR-1007) comes alone, after the other conditions pass. Should one refused approval list every unmet condition, the citation condition included, in a single message? |
| BR-79 | observed | Is setting an already-approved spec to approved again meant to skip every approval condition? |
| BR-80 | observed | Is an approved spec meant to stay approved when its kind changes to one whose minimum or required check kinds it no longer meets? |
| BR-84 | observed | Rewritten 2026-10-10 to match the code after BR-1007 was built. Is it intended that only one live citation is required at approval and the other criteria's citations are left to the citation gate? |


**Held at unconfirmed after the 2026-10-09 citation audit:** BR-72, BR-73, BR-76, BR-77, BR-81. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?


**BR-83 held at unconfirmed after the post-arming fidelity sample (AC-BLS2-14, 2026-10-09):** its only citation was judged unfaithful. Open question: which criterion, with a test that fails if the rule is false, should establish it?

BR-74 was reworded on 2026-10-10 to match the code (an AI-judged criterion may carry its threshold in the rubric); its status reason is the pilot v2 row above.

**Held at unconfirmed, never cited:** BR-246 and BR-247 match the code but no criterion cites them. Open question: which criterion, with a test that fails if the rule is false, should establish each?

**BR-82 retired (2026-10-12):** it described the suspected defect of issue 65 (a direct status change skipping the judgment); superseded by BR-1071 on "Approve a document" when `spec-approval-and-plan-closure-go-through-the-same-checks-on` landed.

**BR-81 narrowed (2026-10-10):** it no longer restates the corpus branch's rule that a body or title revision returns an approved document to draft, nor the kind change that BR-80 owns.

**BR-1007 held at established (2026-10-10):** cited by AC-BLS3B-2 (check-decided, `packages/lore/tests/integration/cli/spec-approve-requires-citation.bun.test.ts`), which has attested passes since merge ab6eb38f. That was the condition recorded for it on "Approve a document" before the move.

---
id: BASE-015
type: baseline
role: intent
title: "Approve a document"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-12
tags: []
parent: BASE-004
links:
  - {id: SPEC-002, type: supersedes}
  - {id: SPEC-005, type: supersedes}
  - {id: SPEC-022, type: supersedes}
  - {id: SPEC-033, type: supersedes}
  - {id: SPEC-037, type: supersedes}
---
## Approve a document

> A reviewer admits a draft or in-review document as approved, after the judgments the project requires.

Scope: the generic approval of any document type. The spec-specific admission conditions are the leaf "Approve a spec" (specification); the plan conditions are in "Plan the work" (execution). This leaf runs them in the right order and owns everything else.

### Behaviour

**Command.** A reviewer approves a draft or in-review document, optionally naming a judgment to override or declaring that no judgment exists, and optionally adding a note on how the approval relates to the judgment. On the dashboard, the page of an in-review document shows a summary of its evidence beside the approve and reject actions, and a task, spec or plan page has an evidence tab with each record and, for a spec, each criterion's coverage; the review queue offers the same actions without evidence (BR-991).

**Constraint.** Only draft or in-review. For the judged types, an independent judgment of the current version is needed and the worst verdict wins; for every type, an escalation blocks. The two audited overrides are the only way past this judgment step: naming a judgment gets past a reject and also past an escalation, for any type (BR-283, BR-969); declaring that no judgment exists works only for a document never judged (BR-285). Neither override skips the type's own conditions, which apply next (BR-286). For a spec those conditions include that at least one criterion cites a live rule; that condition is held on "Approve a spec" (BR-1007). Setting a document's status to approved is this same approval: it runs exactly these checks and gives the same verdict, exit code and refusal, it is recorded as an approval in both the version history and the audit trail, and a call that also changes another field is refused with exit code 4 and writes nothing (BR-1071, `spec-approval-and-plan-closure-go-through-the-same-checks-on` D1, D4). The two overrides stay on the approve action only.

**Event.** `DocApproved` (for a spec also `SpecApproved`, owned by the spec leaf).

### Terms used here

- **Judged types**, **independent judgment**, **worst verdict wins**, **escalation**, **blocking question**, **override**, **calibration record**: defined in the branch glossary.

### Boundary notes

- The judgment is made by the judge leaf; this leaf only reads it.
- The spec conditions are the spec leaf's (minimum criteria, measurable wording, check kinds). They apply on both roads into approved, and so does the judgment requirement: the direct status road in "Submit a document for review" runs this leaf's checks (BR-1071; for unjudged types see BR-281). BR-311, which said that road skipped the judgment, was retired on 2026-10-12, superseded by BR-1071 (issue 65 fixed).
- The spec citation condition (BR-1007) is held on "Approve a spec" (specification), with the other spec conditions; it moved there on 2026-10-10 (Q7 closed). This leaf adds no condition of its own to a type's conditions (BR-286).
- Setting an approved document back to draft is not an approval matter; see BR-310.
- BR-991 describes the dashboard screen where a person decides, and that screen offers both approve and reject. It is held here because product requirement R-8 (P0), on what the approver sees, was migrated to it. The rules of a rejection itself stay in "Reject a document". The evidence shown is recorded by execution; this leaf only decides where it is shown.
- Issue 64 (a reject verdict not stopping approval of a plan) is not a defect: Q1 records the decision, and BR-281 states the designed behaviour. The parent's list of known suspected defects still names issue 64; that entry is out of date and belongs to the parent to remove.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Document types that need an independent judgment | spec and decision record (new project and this repository) | project settings maintainer | 2026-10-09 |
| Whether the requirement and the escalation block run at all | on; an empty list switches both off for every type | project settings maintainer | 2026-10-09 |

### Depends on

- Judge a document: the judgments read here.
- Approve a spec (specification, BR-72 to BR-84): the spec conditions.
- Plan the work (execution, BR-103 to BR-108): the plan conditions.
- Submit a document for review: the direct status road into approved, which runs this leaf's checks (BR-1071).
- execution, "Record evidence": the evidence the dashboard shows beside the decision.
- corpus (Read a document, Delete a document): reading a document, deletion, concurrent-edit arbitration.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Resolved 2026-10-09: reject verdicts and missing judgments not stopping approval of unjudged types (plans included) is the accepted design of `adr-an-escalate-gates-every-doc-type-a-reject-stays-scoped-to`, locked by AC-ESC-2 and AC-ESC-7; the set of judged types is project configuration. Issue 64 was filed in error. | resolved | orchestrator (owner-delegated) |
| Q2 | The overrides exist on the command line only; the agent tool route and the web route cannot use them. Intended? | undecided | product |
| Q3 | Nothing compares the approver with the author. Should the author, or the AI that wrote the document, be refused as approver? | undecided | product (owner) |
| Q4 | Approving or rejecting a deleted document succeeds (issue 70). | unconfirmed | engineering |
| Q5 | Naming a judgment to override also gets past an escalation, for every type (BR-969). The code calls this a designed, audited escape, but no criterion checks it. Is an escalation meant to be overridable by name? | unconfirmed | product, engineering |
| Q6 | The review queue and a draft document's status action let a person approve or reject without the evidence summary, which appears only on an in-review document's page (BR-991). Should every place that approves or rejects show the evidence? | undecided | product |
| Q7 | Closed 2026-10-10: BR-1007 (a spec needs a citing criterion to be approved) moved to "Approve a spec". | closed | specification branch maintainer |

#### Rules held at established and the criterion that holds each

| Rule | Criterion that would fail if it were false |
|---|---|
| BR-277 | AC-TIER-4 |
| BR-278 | AC-TIER-5 |
| BR-279 | AC-TIER-6 |
| BR-280 | AC-ESC-1, AC-ESC-4, AC-ESC-9 (each without an override) |
| BR-281 | AC-ESC-2, AC-ESC-7 |
| BR-282 | AC-TIER-7, AC-ESC-3 |
| BR-283 | AC-TIER-5 (overriding a reject) |
| BR-285 | AC-TIER-9 |
| BR-1071 | AC-AP-1, AC-AP-2 (`spec-approval-and-plan-closure-go-through-the-same-checks-on`) |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-969 on 2026-10-10, BR-991 on 2026-10-10 at commit 70f2785d), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-275 | unconfirmed | established | Should approving an already approved document be a quiet no-op instead of a refusal? |
| BR-276 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-284 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-286 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-287 | unconfirmed | established | Is the residual window, where the undo itself fails, acceptable? |
| BR-288 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-289 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-290 | unconfirmed | established | Should a deleted document be refused as not found, as judging does (Q4, issue 70)? |
| BR-291 | undecided | established once Q3 is decided | Should the author, or the AI that wrote the document, be refused as approver (Q3)? |
| BR-315 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-969 | unconfirmed | established | Is an escalation meant to be overridable by naming a judgment (Q5)? |
| BR-991 | unconfirmed | established | Q6: should every place that approves or rejects show the evidence? No criterion cites it yet; read from packages/dashboard/src/components/AdjudicationBar.tsx, DocDetail.tsx:689-693 and the evidence panels. |

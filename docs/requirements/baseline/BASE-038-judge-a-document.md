---
id: BASE-038
type: baseline
role: intent
title: "Judge a document"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-11
tags: []
parent: BASE-004
links:
  - {id: SPEC-034, type: supersedes}
  - {id: SPEC-094, type: supersedes}
---
## Judge a document

> A reviewer, author or agent gets an independent verdict on one version of a document, or on every document in the queue.

Scope: the judgment of a document for approval. Probing a document for staleness is a different mode of the same command and belongs to hygiene. The sweep that approves existing ledger records is another mode and belongs to autonomy.

### Behaviour

**Command.** A reviewer, author or agent asks for a judgment of one document, or of the whole review queue.

**Constraint.** Five mechanical checks run first; any failure decides reject without AI. Otherwise an AI judge returns approve, reject or escalate with a confidence, reasons and, for an escalation, blocking questions. AI is always needed. The verdict must be well-formed; an unreadable answer gets one retry and then fails the request with nothing recorded. The judge reads a bounded part of the body; the document's structured parts (its rules, glossary and dependencies, or for a plan its parent spec's criteria) are shown to it separately (BR-960, BR-269). A rule's examples and the node's declared commands are not shown yet (issue 114).

**Event.** `DocJudged` (an audit entry, and a judgment stored against the version judged).

### Terms used here

- **Judgment**, **verdict**, **mechanical check**, **judge**, **escalation**, **blocking question**, **cut judgment**, **advisory note**: defined in the branch glossary.

### Boundary notes

- A judgment changes nothing about the document; only the approval leaf reads it (BR-277, BR-278, BR-280).
- The queue that batch judging works through is the waiting list of the list leaf (BR-301); tasks, ledger records and invalid documents are not in it.
- Whether a human who approves or rejects agreed with the judgment is recorded by those leaves (BR-288, BR-296).
- The body limits below apply to the prose body only. The structured parts have their own, larger limit; entries past it are counted in a line the judge sees, so a missing entry is never read as absent (BR-269, BR-960). Issue 40 (a plan's parent criteria not shown) is what BR-960 fixed; issue 34 (the body cut) is still open.
- What happens when a deleted document is approved or rejected belongs to those leaves (issue 70); this leaf covers only judging one (BR-272).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| How much of the document body the judge reads | 12,000 characters | project settings maintainer | 2026-10-09 |
| How much of the parent's body the judge reads | 8,000 characters | project settings maintainer | 2026-10-09 |
| How much of each structured list (rules, glossary, dependencies, criteria) the judge reads | 60,000 characters per list, fixed in the product | nobody (fixed) | 2026-10-10 |
| Whether AI may be used on a calling surface | on (new project and this repository) | project settings maintainer | 2026-10-09 |

### Depends on

- List documents awaiting review: the queue that batch judging works through.
- Approve a document: the only reader of a verdict.
- corpus (Read a document, Link two documents, Delete a document): reading a document and its parent, its links and its deletion.
- hygiene (Probe documents for staleness): the staleness mode of the same command.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A fix to a document that does not change its version (for example adding its missing parent) leaves a mechanical reject binding on that version, because the worst verdict of a version wins (issue 41). Should the mechanical checks be re-run, or the fix bump the version? | unconfirmed | engineering |
| Q2 | The judge's confidence is, in practice, one of two values (issue 9). Should the number carry meaning, or be dropped? | undecided | product |
| Q3 | The agent tool route has its own copy of the judging steps. Do the two copies stay identical? | unconfirmed | engineering |


#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-960 on 2026-10-10), but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-261 | unconfirmed | established | Should the evidence check apply to a task that is still being worked on, given tasks are kept out of the default queue? |
| BR-262 | unconfirmed | established | Is a failed mechanical check meant to be final for the version, even after the defect is fixed by a change that leaves the version unchanged (issue 41)? |
| BR-263 | unconfirmed | established | Should confidence stay part of the verdict when it carries almost no information (issue 9)? |
| BR-264 | unconfirmed | established | Should a failed AI call fall back to the mechanical result alone, so a document with passing checks is not left without any answer? |
| BR-265 | unconfirmed | established | Is the refusal when AI is switched off for a surface meant to hold on the agent tool route as well as the command line? |
| BR-266 | unconfirmed | established | Should several judgments of one version be allowed to accumulate, given the worst one then decides every approval? |
| BR-267 | undecided | undecided | Is judging an already approved document meant to be allowed, since it can only add a judgment nobody will read? |
| BR-269 | unconfirmed | established | Should a judgment on a cut body be allowed to approve at all (issue 34)? |
| BR-271 | unconfirmed | established | Should the request fail when some documents failed, so a script notices partial failure? |
| BR-272 | unconfirmed | established | Is "not found" the intended answer when someone asks to judge a deleted document, or should the judgment name the deletion? |
| BR-273 | unconfirmed | established | Should an unreadable layout file stop judging, or be reported while the other four checks still run? |
| BR-274 | undecided | undecided | Should a script be able to tell a reject or escalate verdict from an approve by the result of the request alone? |
| BR-317 | unconfirmed | established | No question about intent: the usage refusal is meant. It is held until a check-decided criterion would fail if the refusal stopped. |
| BR-960 | unconfirmed | established | No question about intent: added on 2026-10-10 (issue 107). It is held until its criterion AC-RJI-1 is recorded as passing, and while rule examples and declared commands are not shown (issue 114). |

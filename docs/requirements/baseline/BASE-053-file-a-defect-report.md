---
id: BASE-053
type: baseline
role: intent
title: "File a defect report"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-002
links:
  - {id: SPEC-099, type: supersedes}
  - {id: SPEC-115, type: supersedes}
---
## File a defect report

> A person or agent of a project that uses lore sends a defect report to the GitHub repository the project chose, and gets a task for it in their own corpus that can be claimed at once.

Scope: filing from the command line, and what the agent tool route shares with it. The listing switch of the same command is the leaf "List defect reports".

### Behaviour

**Command.** A reporter files a title, a description, the expected and the actual behaviour, optionally a command that reproduces it, a severity, a category and tags.

**Constraint.** The project's shared settings must name a destination (the lore project's own intake or a named GitHub repository); the retired form is refused. Severity and category are required for GitHub and only order and group reports. The reporting corpus must have a root requirements document, whose name is published. The reporter's identity is reduced before it is published. A filing already made from this corpus under the same title is not repeated.

**Event.** `DefectFiled` (a GitHub issue opening with the filing field block, an intent and an outcome in the filing log, and an ad-hoc task in this corpus with one version row and a creation audit entry).

### Terms used here

- **Defect report**, **filing destination**, **vendor intake**, **retired form**, **filing field block**, **filing log**, **severity**, **category**: defined in the branch glossary.

### Boundary notes

- The task created here is the same kind adoption creates (BR-525); a report filed here is already ingested, so adopting its issue later reports the existing task (BR-526).
- Listing the reports this command filed is the list leaf (BR-505).
- Who the actor is comes from the session branch; only what is published about it is ruled here (BR-502).
- **The agent tool route** goes through the same filing steps, so this leaf's rules apply to it with three differences: it takes no tags and has no listing switch; the actor must always be named by the caller; and every refusal that the command line ends with an exit code (BR-489 to BR-493, BR-497, BR-504) comes back as a tool error carrying the same message instead.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Filing destination | none (must be chosen) | project settings maintainer | 2026-10-09 |
| Vendor intake address | the lore project's GitHub repository, shipped in the binary | lore maintainers (new release) | 2026-10-09 |
| Longest category | 48 characters | lore maintainers | 2026-10-09 |
| Possible duplicates shown | at most 5 | lore maintainers | 2026-10-09 |

### Depends on

- List defect reports: where filed reports are seen.
- session branch: resolving who the actor is.
- execution, "Claim a task": claiming the task this creates.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A retry is recognised by title alone, so a different report under a used title is never filed. Should the match include the other fields, or the filing key be shown to the reporter? (suspected defect, issue #97) | undecided | product |
| Q2 | When the corpus has several requirements documents, the first one listed is published as the root. Which one is meant? | undecided | product |
| Q3 | The criterion meant to pin the triage-label refusals (AC-DC-7) names a test file that no longer exists. Re-point or retire it? | unconfirmed | engineering |
| Q4 | Exit codes 8, 9 and 10 for GitHub failures are pinned by no criterion. Should one be added? | unconfirmed | engineering |
| Q5 | An unreadable filing log silently turns repeat recognition off, so a repeat can create a second issue. Should an unreadable filing log stop the filing, or at least be reported? (suspected defect, issue #97) | undecided | product |
| Q6 | BR-494, BR-497 and BR-498 each lost their only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim, or its named test would not fail if the rule were false (BR-497 and BR-498 in the 2026-10-09 citation audit, BR-494 in the post-remediation sample with seed 20261010). Which criterion, with a test that fails if the rule is false, should establish each? | unconfirmed | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09, but no live check-decided criterion would fail if it were false, or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). "Held at" is the confidence the rule carries now. "Would be" is the level it moves to once a check-decided criterion that fails if the rule is false confirms the code reading: established when no question about intent is open, undecided while the owner still has to answer the open question named in the row.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-489 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-491 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-492 | unconfirmed | established | Q3. |
| BR-493 | unconfirmed | undecided | Q2. |
| BR-494 | unconfirmed | established | Q6. |
| BR-497 | unconfirmed | established | Q6. |
| BR-498 | unconfirmed | established | Q6. |
| BR-499 | unconfirmed | undecided | Q1. |
| BR-500 | unconfirmed | undecided | Q5. |
| BR-501 | unconfirmed | established | No question about intent; waiting for a check-decided criterion that fails if this is false. |
| BR-504 | unconfirmed | established | Q4. |

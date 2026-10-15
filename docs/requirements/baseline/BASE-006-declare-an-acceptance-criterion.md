---
id: BASE-006
type: baseline
role: intent
title: "Declare an acceptance criterion"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-12
tags: []
parent: BASE-064
---
## Declare an acceptance criterion

> An author declares one acceptance criterion on a spec.

### Behaviour

**Command.** An author declares a criterion on a spec: an id, a statement, a way of being decided (by a check, by AI judgment, or by a person) and that way's details (check kind and exact command; rubric; or an optional note). Optionally it names requirement items it covers, baseline rules it cites, and, for a check-decided criterion, a falsifier (the declared change that must make its check fail; see Declare a falsifier). For a check that names a test file not written yet, the author may give a reason (BR-21).

**Constraint.** The id has the right shape and is unique within the spec (BR-16); size limits hold (BR-17); a person-decided or AI-judged criterion is measurably worded (BR-18, BR-96); a check that names a test file either finds the file or carries a stated reason why it does not exist yet (BR-21); the command of a check-decided criterion has no unquoted shell pipe, except under check kind 'other', where it is accepted with a warning naming the pipe; otherwise it is refused with exit code 4 and nothing is written (BR-1078, `spec-evidence-labels-and-reds-are-honest` D7); and the criterion passes the citation gate described in Cite a baseline rule (BR-257, BR-959). In this repository the gate enforces on every branch, so a criterion declared without a live citation is refused there unless it holds an unexpired exemption.

**Event.** `AcceptanceCriterionDeclared`. The declaration adds one entry to the spec's version history (BR-26), and the spec's status does not change (BR-25).

### Terms used here

- **Abstract quality word**: a word claiming a quality with no measurable meaning on its own, from a fixed product list. English: fast, slow, clean, simple, robust, modern, elegant, intuitive, seamless, scalable, performant, efficient, secure, quick, snappy, lightweight, user-friendly, good, better, best, optimal, nice, high-quality (also written "high quality"). Chinese: 快, 简洁, 优雅, 现代化, 高质量, 健壮, 好用, 高效, 流畅. An English word is matched as a whole word, so "fast" is not found inside "faster", "breakfast" or "fast-track". The list changes only with a product release.
- **Measurable anchor**: any digit, a comparison sign, a percentile marker such as P95, or a unit such as ms, s, MB, KB, GB, px, % or req/s. Its presence anywhere in the text counts, even if unrelated to the abstract word (BR-96).
- **Verification mode**: how a criterion is decided: by check, by AI judgment, or by a person.
- **Pending missing-test declaration**: a check-decided criterion that named a test file that did not yet exist, declared with a stated reason. It counts as pending until the file exists.

### Boundary notes

- The wording check at declaration cannot be switched off. Only the backstop copies inside the creation and approval checks can.
- The missing-test check (BR-21) is made by the declare and revise commands, which exist on the command-line route only. Criteria supplied inline when a spec is created, on any route, are not checked for missing test files. This is the deliberate route exception the parent branch names.
- A generic document edit on any route cannot add, drop, reword or reorder criteria; it is refused unless it passes the stored criteria back unchanged (BR-247, owned by Approve a spec / corpus).
- Revising a criterion is a different leaf; wording is not re-checked there (see Revise an acceptance criterion).
- What the citation gate checks, its modes, its arming and exemptions belong to Cite a baseline rule. This leaf only notes that a declaration passes through it.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Whether the wording check runs as part of the creation and approval checks | on | project settings maintainer | 2026-10-07 |
| Citation gate mode and armed branches (this repository) | enforce, all 12 branches armed | project settings maintainer | 2026-10-10 |

### Depends on

- Create a spec (BR-8): declaring assumes the spec exists.
- Cite a baseline rule: the citation gate every declaration passes through.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | A criterion must now cite at least one live baseline rule where the citation gate enforces (BR-257). Does citing replace requirement items, or do the two keep sitting side by side as they do today? | undecided | product (owner) |
| Q2 | A check-decided criterion is never checked for wording (BR-19). "The UI is fast", checked by a command that always succeeds, is accepted and will pass. Is a check that cannot fail acceptable at declaration, or is the falsifier meant to catch it? A falsifier is optional today. | undecided | product |
| Q4 | A criterion can be declared on an archived spec and the declaration succeeds; no rule records this, because it is a suspected defect. Filed as issue 30 (open). Should a terminal spec refuse new criteria? | defect | engineering, product |
| Q5 | A criterion id is unique only within its spec (BR-23), so a bare id such as AC-OX-6 quoted in a handoff resolves to nothing. Should ids be unique project-wide, or always quoted with their spec? | undecided | product |
| Q6 | A detail that belongs to another mode (a falsifier or command on a person-decided criterion) is silently discarded when declaring, but refused when revising (BR-24). Filed as issue 29 for the falsifier; the same was observed for a check command given to a person-decided criterion. | defect | engineering |

Q3 (a generic edit could replace the whole criteria list) was closed on 2026-10-10: such an edit is now refused (BR-247). The number is not reused.

#### Downgraded in pilot v2 — no falsifying acceptance criterion yet

Each rule below matches the code as read on 2026-10-08, but no live check-decided criterion would fail if it were false, so it is held at unconfirmed until one exists (method v2, `adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Was | Open question |
|---|---|---|
| BR-22 | observed | Should naming a requirement item that does not exist be accepted silently when declaring a criterion, or warned/refused? |
| BR-23 | observed | Is it intended that two specs may each declare the same criterion id (e.g. AC-OK-1), given that bare ids in handoffs then become ambiguous? |
| BR-27 | observed | When two sessions add criteria to the same spec at once, must the second be refused as stale (never merged), and is a lost declaration ever acceptable? |

**Held at unconfirmed after the 2026-10-09 citation audit:** BR-15, BR-18, BR-19, BR-25, BR-26. Each lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?

**Held at unconfirmed, never cited:** BR-16, BR-17, BR-24, BR-96. Each matches the code, but no acceptance criterion cites it, so nothing proves it. BR-24 also describes a suspected defect (Q6). Open question: which criterion, with a test that fails if the rule is false, should establish it?

**BR-21 stays observed:** it is cited by AC-061-20, AC-061-21, AC-OX-4 and AC-OX-9, which assert that declaring and revising refuse a check naming a missing test path unless a non-empty reason is given.

**BR-28 retired:** it described the citation gate as a future target ("today citation is optional"). The gate is built and enforces; its behaviour is stated by BR-257 and BR-959 on Cite a baseline rule. BR-28 was retired in the change-set migration (`spec-a-spec-carries-its-rule-changes-the-baseline-takes-them`).

---
id: BASE-061
type: baseline
role: intent
title: "Sample citation fidelity"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-081
---
## Sample citation fidelity

> An owner measures how many of the corpus's (criterion, cited rule) pairs really hold: whether each criterion states its rule's main claim and its named test would fail if the rule were false. The same command can instead measure how many of the leaves' non-business site exclusions really carry no business outcome.

### Behaviour

**Command.** Someone asks for a sample of a given size, with a seed, optionally with two judges per pair (BR-963, BR-965). With the exclusions option, a seeded sample of the leaves' site exclusions marked non-business is judged instead of citations (BR-967).

**Constraint.** For citations: the sample is drawn from every live citation of a live rule, and the same corpus, size and seed always give the same pairs; a size larger than the pool is refused with outcome code 2 (BR-963). Rule and criterion text reach the judge only inside a delimiter that includes a random nonce, as data; a judge answer that cannot be read as a verdict for every pair, or that names a pair not in the sample, ends the run with outcome code 6 and stores no record (BR-964). Verdicts never change a rule, a citation or a confidence (BR-964). With the exclusions option, nothing in any site map changes (BR-967).

**Event.** One fidelity record is stored. For citations it holds the seed, the size, the pool size, every verdict (faithful or not faithful, with a reason) and the faithful share (BR-963). With two judges, each pair is judged twice; agreeing verdicts stand, and each disagreement is listed and counted as not faithful unless a third, adjudicating verdict says faithful (BR-965). The record lists every rule cited by more than the configured share of citing criteria as a probable catch-all (BR-965). With the exclusions option the record stores the share of exclusions judged wrong (BR-967).

### Terms used here

- **Faithful pair**, **catch-all rule**, **site map**, **citing criterion**: defined in the branch glossary.

### Boundary notes

- Citing and exempting belong to specification ("Cite a baseline rule"). This leaf only measures; acting on a verdict (removing a citation, lowering a confidence, remapping a site) is done through those actions and "Account for a refusal site".
- Rule ids are issued across the whole tree, so this leaf's ids are not consecutive: BR-966 belongs to the session branch's "Resume a session".

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Share of citing criteria above which a rule is listed as a probable catch-all | 5% | project settings | 2026-10-10 |

### Depends on

- specification, "Cite a baseline rule": the citations sampled.
- Account for a refusal site: the non-business site exclusions sampled with the exclusions option.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | The rules state determinism, the oversize refusal, the delimited judge input and the outcome-code-6 failure only for citation samples. Do they hold the same way with the exclusions option, and does that record also store the seed, size, pool size and each verdict? | unconfirmed | engineering |
| Q2 | Is the probable catch-all list part of every citation record, or only of a two-judge run? BR-965 states it in the same rule as the two-judge mode. | unconfirmed | engineering |

#### Rules held below established

Unlike the rest of this branch, whose rules were read from the code at commit a248efe0, the four rules here (BR-963, BR-964, BR-965, BR-967) state the intended behaviour of a command that is still being built. Their enforcement is marked guaranteed because the product itself is meant to make each one hold; it is not yet a statement about built code. "Held at" is the confidence the rule carries now; "Would be" is the level it moves to once a check-decided criterion that fails if the rule is false confirms it against the built command.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-963 | unconfirmed | established | Q1 (how far it reaches the exclusions option). |
| BR-964 | unconfirmed | established | Q1. |
| BR-965 | unconfirmed | established | Q2. |
| BR-967 | unconfirmed | established | Q1. |

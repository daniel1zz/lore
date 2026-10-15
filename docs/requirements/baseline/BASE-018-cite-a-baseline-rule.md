---
id: BASE-018
type: baseline
role: intent
title: "Cite a baseline rule"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-12
tags: []
parent: BASE-064
---
## Cite a baseline rule

> An author cites a baseline rule from an acceptance criterion, and the citation gate decides whether the criterion may be written.

Citation is the link that makes a spec an implementation of the product baseline: a criterion says which business rule it helps to prove, and the rule's verification state is later computed from the evidence of the criteria that cite it. Every write that adds or revises a criterion passes through the citation gate. Where the gate enforces, a criterion that cites no live rule is refused; where it only reports, the write goes ahead and the would-be refusal is recorded.

### Behaviour

**Command.** An author names a spec, one of its criteria and one or more baseline rule ids, and cites them (or removes them). A citation can also be supplied while declaring or revising the criterion, or inline when a spec is created. Separately, a person or agent may grant one criterion an exemption with a reason, their name as grantor and an expiry date (BR-971). The project settings maintainer adopts the gate: one adoption action sets its mode (report or enforce) and arms or disarms branches (BR-987).

**Constraint.** The document is a spec, or the request is refused naming the kind it found (BR-241); the criterion exists on the spec (BR-91); at least one id is named (BR-242). Each id is a business rule (BR-n) or an architecture standard rule (AS-n), and a criterion holds at most ten distinct citations; naming the same id twice keeps one citation (BR-85, BR-89). Citing a debt entry (AD-n) is refused with outcome code 4 on every write, whatever the gate's mode, and nothing is written: debt ids are named only in a standard's current exceptions (BR-980). Then the citation gate applies to every criterion the write adds or revises (the AD-n refusal above is separate from the gate and holds in every mode); a criterion the write leaves untouched is never checked, so criteria written before the gate are not affected until they are next changed.
- Where the gate **enforces** and the spec's branch is armed (BR-970), the criterion must cite at least one rule and every rule it cites must be live. A criterion that cites nothing is refused unless it holds an unexpired exemption (BR-257, BR-959). A citation of a missing, deprecated or retired rule is refused whatever exemption the criterion holds (BR-86, BR-959). The refusal writes nothing and names up to five candidate rules, a ready-to-run citation line and the exemptions still available (BR-257).
- Where the gate **enforces** but the spec's branch is not armed, the gate refuses nothing and keeps no would-refuse record; a missing, deprecated or retired rule is stored with a warning and counted (BR-86, BR-258).
- Where the gate only **reports**, or is **off**, the gate refuses nothing: a missing, deprecated or retired rule is stored with a warning and counted (BR-86). In report mode one would-refuse record is kept for each criterion the gate would have refused, whether or not the spec's branch is armed: arming matters only in enforce mode (BR-258).

**Event.** `AcceptanceCriterionCited` (or `AcceptanceCriterionUncited` on removal). The change leaves a version entry and an audit record naming the ids and any warnings (BR-87). A refusal leaves no event, no version entry and no change. A report-mode write also leaves its would-refuse records in the audit log. A granted exemption is stored as an exemption record naming the spec, the criterion, the reason, the grantor and the expiry; that record is its only trace, with no version entry on the spec and no audit entry (BR-971). An adoption that changes the gate setting leaves one audit row naming the actor and the old and new settings; one that changes nothing leaves none (BR-987).

### Terms used here

- **Citation**: a baseline rule id (BR-n or AS-n) stored on a criterion.
- **Live rule**: a rule whose lifecycle is live, that is, neither deprecated nor retired.
- **Dangling citation**: a citation of an id that names no rule in any baseline leaf.
- **Inactive citation**: a citation of a rule that is deprecated or retired.
- **Citation gate**: the check every added or revised criterion passes through on every route that can write criteria. It has three modes, set in the project settings: **off** (the gate refuses nothing and keeps no would-refuse record; a dangling or inactive citation still gets a warning and is counted, BR-86), **report** (the gate refuses nothing, would-be refusals recorded on every branch) and **enforce** (refusals on armed branches; on an unarmed branch nothing is refused or recorded).
- **Gate setting**: the project's choice of mode and its list of armed branches. With no setting, the mode is off in a project with no baseline documents and report in a project that has them; an unknown mode is refused (BR-259).
- **Spec's branch**: the baseline branch whose rules most of the spec's existing criteria cite (ties go to the alphabetically first branch). A new spec is placed by the criteria it is created with. A spec citing no rule under any branch is **unplaced** (BR-970).
- **Armed branch**: a branch listed in the gate setting. In enforce mode only a spec on an armed branch is refused; an unplaced spec counts as armed only when every branch is armed (BR-970).
- **Exemption**: a time-limited permission, with a reason and a named grantor, for one criterion to cite nothing. It is active until its expiry; an expired exemption admits nothing. Active exemptions are capped at one tenth of all criteria in the project, rounded down, and a criterion holds at most one active exemption (BR-971).
- **Adoption**: the one action that changes the gate setting and records it in the audit log. The status check reports the mode as **audited** when it equals the last adopted mode, **unaudited** when it was set or edited by hand, and **default** when no mode is set (BR-987).
- **Would-refuse record**: an audit entry kept in report mode for each criterion the gate would have refused, naming the criterion and why.

### Boundary notes

- Rule ids, their lifecycle and their computed verification state belong to the product-baseline branch. This leaf owns the act of citing and the citation gate.
- Removing a citation goes through the same gate as adding one. Where the gate enforces, removing a criterion's last citation is refused unless the criterion holds an unexpired exemption; that is what the exemption is for (BR-959). Removing a citation the criterion does not hold leaves the criterion unchanged, so the gate does not check it and it succeeds in every mode (BR-90).
- When two sessions change the same spec's criteria at once, citation changes follow the same rule as declaring: the session whose starting version is no longer current is refused, and nothing is merged or lost (BR-243).
- Withdrawing a criterion is not gated: the criterion and its citations go away together (BR-92).
- When an existing spec's criteria change, the liveness of each cited rule is checked again inside the same write, so a rule retired at that moment cannot slip through (BR-260). Criteria supplied inline when a spec is first created are checked only before the write; one that loses that race is stored and shows up as an inactive citation.
- The corpus status report counts criteria with and without citations, dangling citations and inactive citations whenever baseline documents exist or any criterion cites a rule, and shows a warning line when the dangling or inactive count is not zero (BR-94). A corpus with neither shows exactly what it showed before baselines existed.
- When baseline documents exist, declaring a criterion without any citation prints a one-line hint pointing at the cite action (BR-93).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Citation gate mode (this repository) | enforce | project settings maintainer, through the adoption action | 2026-10-10 |
| Armed branches (this repository) | all 12 branches | project settings maintainer, through the adoption action | 2026-10-10 |
| Citation gate mode with no setting | off without baseline documents, report with them | product release | 2026-10-10 |
| Cap on active exemptions | one tenth of all criteria, rounded down | product release | 2026-10-10 |
| Candidate rules named in a refusal | at most 5 | product release | 2026-10-10 |

### Depends on

- product-baseline branch: what makes a rule live, deprecated or retired. This is a dependency on the branch as a whole, not on one rule, so it does not appear among the rule dependencies (BR-25, BR-38).
- Declare an acceptance criterion: a citation supplied while declaring leaves an approved spec approved (BR-25).
- Revise an acceptance criterion: a citation supplied while revising returns an approved spec to draft (BR-38).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q2 | Citing leaves an approved spec approved (BR-87), as adding a criterion does, so approval does not certify the citation set. Is that acceptable now that citation is enforced? | undecided | product |
| Q3 | Removing a citation that is not there succeeds and tells the author nothing; only the version entry and audit record show it happened (BR-90). Should the command say "nothing removed"? | undecided | product |
| Q4 | A criterion id is unique only within its spec, so evidence for a bare id that exists in two specs cannot be attributed to a rule; it is counted as ambiguous instead. Related to declare question 5. | undecided | product |
| Q5 | Granting an exemption leaves no audit entry, although the grantor and the cap matter for governance (BR-971). Should a grant be audited like an adoption? | undecided | product |

#### Downgraded in pilot v2 — no falsifying acceptance criterion yet

Each rule below matches the code as read on 2026-10-08, but no live check-decided criterion would fail if it were false, so it is held at unconfirmed until one exists (method v2, `adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Was | Open question |
|---|---|---|
| BR-90 | observed | Should removing a citation the criterion does not hold leave the spec's history untouched, or is one extra history entry acceptable? |
| BR-92 | observed | When a criterion is reworded, must its citations always survive, and when withdrawn, must they vanish with no residue anywhere? |

**Held at unconfirmed after the 2026-10-09 citation audit:** BR-85 (rewritten on 2026-10-10 to admit AS-n ids), BR-88, BR-89, BR-91, BR-93, BR-259. Each of these rules lost its only citation when an independent fidelity judge found the citing criterion does not assert the rule's main claim or its named test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). Open question: which criterion, with a test that fails if the rule is false, should establish it?

**BR-94 held at unconfirmed after the post-remediation fidelity sample (2026-10-09):** its only citation was judged unfaithful (seed 20261010 sample). Open question: which criterion, with a test that fails if the rule is false, should establish it?

**BR-86 lowered to unconfirmed (2026-10-10):** its statement now covers both gate outcomes. Its only citing criterion, AC-BLS1-6, proves the report-only half (stored with a warning and counted) but not the refusal under enforce. Open question: which criterion, with a test that fails if enforce stops refusing a missing, deprecated or retired citation, should establish it?

**Held at unconfirmed, no recorded falsifier:** BR-241, BR-242, BR-243, BR-258, and BR-970 and BR-971 (added 2026-10-10 to state what the gate's branch placement and exemption grant already do) match the code but no criterion with a failing test establishes them; open question: which criterion, with a test that fails if the rule is false, should establish each? BR-959 is new (2026-10-10) and is being established by AC-BLS2-19. BR-980 (AS-n citable, AD-n refused) is cited by AC-BLS3-2 and BR-987 (audited adoption) by AC-BLS3-8, both from slice 3a; each is held until its criterion carries a runner-recorded pass.

**BR-95 deprecated:** it described the gate as not yet built. BR-257, BR-258, BR-259 and BR-959 state the gate as it now works.

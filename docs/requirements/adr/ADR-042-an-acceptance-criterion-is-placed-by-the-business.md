---
id: ADR-042
type: adr
role: decision
title: "An acceptance criterion is placed by the business outcome it can falsify: an ordered three-question procedure"
status: approved
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
links:
  - {id: ADR-041, type: relates-to}
  - {id: PLAN-173, type: informs}
---
# ADR: An acceptance criterion is placed by the business outcome it can falsify — an ordered three-question procedure

## Status
Decision status accepted; document approval via `lore approve` under delegation from the project owner (repository owner daniel1zz, session 6b85319e: "后面全自动" / "直接当前Session继续"). Refines `adr-the-product-is-a-baseline-tree-specs-are-implementations`, which left the boundary between branches to judgment.

## Context
The v1 specification-branch pilot measured placement agreement between two independent mappers at 43/85 (49.4% disagreement; kill line 30%). Disagreements: out-of-branch vs no-rule 14, rule vs out-of-branch 24, rule vs rule 4. Causes: branch-boundary ambiguity 14, missing rule 14, mapper misread 13, rule granularity 1 (42 in total, matching the 42 disagreements; per `knowledge-pilot-d3-specification-branch-ac-mapping-adjudication`). The decisive observation: one mapper placed by TOPIC (a revision AC goes to the revision rule even when it tests the command-line layer), the other separated the rule from its implementation. Earlier measurements A1, A4, A5 landed at 50-66% agreement for the same reason. The missing artefact is a written procedure, not more careful agents (`knowledge-pilot-assessment-baseline-slice-1-specification`).

## Decision
Every mapper answers three questions IN ORDER and stops at the first that decides.

### Q1 — Business outcome or technical property?
An AC is **ARCH** (it belongs to the architecture tree, which is independent of the business tree) when what it asserts could change without changing any outcome a user or agent can observe at the product surface. Observable outcomes are exactly: whether an input is accepted or refused (and the stated reason/exit code an agent acts on), what document state results (status, fields, versions, links, evidence rows), and which facts are reported back.

ARCH examples: module or file layout, exported symbols, schema/migration mechanics, storage engine behaviour, output layout/formatting/ordering where the same facts are shown, performance and resource bounds, test or build infrastructure, refactor equivalence, internal error-type plumbing.

Test to apply: "If I rewrote the program to produce the same accepted/refused decisions, the same resulting state and the same reported facts, could this AC turn red?" Yes → ARCH. No → continue.

**Mixed ACs (amended after pilot v2, see below)**: when an AC asserts both an observable outcome and a technical property, its MAIN assertion decides — the clause its title/first sentence states and that most of its oracle checks. A secondary technical clause does not make it ARCH; a secondary business clause does not pull an ARCH AC into a business branch. Record the other clause as a note.

### Q2 — Which branch owns that outcome?
The owner is the branch of the **object whose state transition the decision accepts, refuses or produces** — the grammatical object of the decision, not the command used, not the topic, and not the objects merely consulted.

| Object whose state changes | Branch |
|---|---|
| a spec, its acceptance criteria (declare/revise/withdraw/wording/verify mode/falsifier/cite), its code anchors, a spec's approval when the deciding condition is a property only specs have | specification |
| a plan, phase, task, claim, evidence row, verification run, attestation, task archival | execution |
| any document generically: create/edit/link/search/version/invalidate, regardless of type | corpus |
| a review judgment; approve/reject/status transitions where the deciding condition is not type-specific | review |
| a baseline node, rule, rule state, glossary | product-baseline |
| a session, seat, handoff, resume ticket | session |
| drift, staleness and health findings, repairs | hygiene |
| trust calibration, automatic review/approval | autonomy |
| a defect report and its resolution | issue-loop |
| installed project assets, setup, upgrade | distribution |
| shared/replicated corpus state | sync |
| what an agent is shown: bundles, fragments, feeds, bootstrap | context |

Tie-breaks, applied in this order:
1. **Specific beats generic**: if the deciding condition is a property only one document type has (e.g. a spec's criteria count), the owner is that type's branch, even though the transition (approval) is generic.
2. **Refused/produced beats consulted**: when two objects are involved (e.g. task archival refused because the spec's criterion has no evidence), the owner is the object whose transition is refused or produced (the task → execution), not the object read to decide.

3. **Configuration of a feature belongs with the feature** (amended after pilot v2): a project setting, its accepted keys and its retired keys are owned by the branch of the behaviour they configure (e.g. defect-report transport keys → issue-loop); only installing or upgrading the project files themselves is distribution.

If the owner is not specification → label **BRANCH:<name>**. Otherwise → continue.

### Q3 — Which specification rule does it falsify?
Cite rule R when: if the product violated R, this AC's oracle would turn red. Primary = the rule on the leaf whose action matches the action that triggers the AC (create / declare / revise / withdraw / approve / anchor / falsifier / cite); other falsified rules are listed as secondary. When two rules on the same leaf are both falsified, primary = the rule the AC's title or first clause is about (amended after pilot v2). If no rule qualifies → **GAP** with a one-line draft rule. A rule that is merely on the same topic does not qualify.

## Measurement contract (pre-registered for pilot v2, AC-BLS1-12)
- Labels per AC: one primary from {BR-<n>, BRANCH:<name>, ARCH, GAP}, plus optional secondaries.
- **Kill-line metric** (comparable with v1): primary labels collapsed to {BR-<n>, OUT, GAP} where OUT = any BRANCH:<name> or ARCH. Two mappers disagree on an AC iff the collapsed primaries differ. Disagreement rate = disagreements / sample size; bar <= 30%.
- **Secondary metric** (reported, no bar): agreement at full granularity, i.e. the exact branch name or ARCH.
- Mappers receive only: this ADR, the baseline root and specification-branch documents, and the frozen sample `knowledge-pilot-v2-frozen-ac-sample-70-acs-seed-20261008-for`. They do not see each other's output.

## Consequences
- Placement becomes reproducible to the extent the three questions are; the pilot v2 agreement measures exactly that.
- Q1 moves command-line behaviour (exit codes, refusal reasons) into the business tree only when an agent acts on it; layout and formatting go to the architecture tree. This is the line the v1 "topic" mapper did not draw.
- Q2's object table is the first written contract of what each of the twelve branches owns; it must be updated whenever a branch is added or split.
- What refuses a violation: nothing yet — placement stays advisory until slice 2's citation gate. Counted as NOT ENFORCED.



## Amendment log
- 2026-10-08, after pilot v2 measurement (`knowledge-pilot-v2-placement-1-4-kill-line-disagreement-12-9`): added the mixed-AC main-assertion rule to Q1 (6 of 9 full-granularity disagreements), tie-break 3 for configuration (2 of 9), and the same-leaf tie-break to Q3 (1 of 9). No measured number is changed by this amendment; it applies to placements made after it.

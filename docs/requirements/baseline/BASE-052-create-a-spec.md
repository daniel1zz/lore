---
id: BASE-052
type: baseline
role: intent
title: "Create a spec"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-10
tags: []
parent: BASE-064
links:
  - {id: SPEC-032, type: supersedes}
---
## Create a spec

> An author creates a spec. A spec has no parent document: it belongs to the business and architecture trees only through the rules its criteria cite.

### Behaviour

**Command.** An author (person or agent) creates a spec: title, body, optionally a kind, optionally initial acceptance criteria and code anchors. No parent is given (BR-1).

**Constraint.**
- No parent: a request that names a parent, or a later attempt to file the spec under a document by a parent link, is refused with outcome code 4, the message names criterion citations as the way a spec relates to the trees, and nothing is written (BR-2).
- The title is not empty (BR-230) and does not begin with a spec or decision number such as `SPEC-99` or `ADR-7`; the number is allocated at creation, so the author writes the bare title. A lowercase prefix, or a number that is not at the start of the title, is accepted (BR-231).
- The kind is feature, tech, design or domain overview; a spec created without a kind is a feature spec (BR-3).
- The body has a section skeleton: at least one second-level heading anywhere in the body (BR-4).
- Acceptance criteria supplied at creation have the shape a later declaration requires, a valid unique id for each and at most fifty in all (BR-232), and, when the measurable-wording check is on, each meets it; an AI-judged criterion with a measurable rubric is exempt; one failing criterion refuses the whole creation (BR-5).
- Code anchors supplied at creation are refused on the same rules as anchors declared later, but are stored exactly as written: a leading current-folder prefix is not stripped and duplicates are not merged (BR-11).
- When the creation check refuses, it names every unmet condition, not only the first, and quotes the rule text the spec is held to (BR-6).

**Event.** `SpecCreated`, in draft (BR-8). Every spec except a domain overview receives the next spec number and keeps it for life; a domain overview receives none (BR-9). Two specs created at the same moment never share a number; the one that loses the race takes the next free number (BR-10).

**Reclassification.** A domain overview reclassified as another kind receives the next spec number at that moment (BR-12). A numbered spec reclassified as a domain overview keeps its number (BR-13).

### Terms used here

- **Section skeleton**: at least one second-level section heading in the body. A first-level or third-level heading alone does not count. This is the only thing checked about the body's structure; nothing checks which sections exist.
- **Spec number**: a permanent sequential number among specs, shown as the spec's short human id (for example SPEC-12). It is separate from the readable name, which can be edited.
- **Spec kind**: feature, tech, design or domain overview. A domain overview is a narrative overview of a product area and carries no implementation contract.
- **Citation**: a business rule (BR-n) or architecture standard rule (AS-n) that one of the spec's criteria says it helps prove. Citations are the only relation between a spec and the trees, many to many.

### Boundary notes

- Order of refusals: the shape checks run first. A request that names a parent and a request with an unknown kind are refused on its shape, before the creation check runs (BR-7); the author sees the skeleton and wording refusals only once those are fixed. There is no "missing parent" refusal: a spec never has one.
- Approval, not creation, requires a citation: a new spec may be created with no criteria at all. The condition that a spec cites at least one live rule before it may be approved belongs to the leaf "Approve a spec".
- A spec created through the command line cannot carry initial acceptance criteria; those arrive only through the service-level routes (agent tool server, web service). Criteria are normally declared after creation.
- The gate can be switched off per project; every skip is recorded.
- Landed, read 2026-10-11: a spec takes no parent in code — `CorpusService._createImpl` refuses a spec request that names a parent with VALIDATION_ERROR on `parent_id` (exit 4) before anything is resolved or written (`packages/lore/src/service/corpus-service.ts`, the `isParentlessType` check). Criterion AC-BLS3B-1 (spec-baseline-slice-3b-specs-belong-to-the-trees-through, `spec-parent-contract.bun.test.ts`) cites BR-1 and BR-2 and has attested passes, so both are established. BR-14 (filing a spec under a baseline leaf) and BR-229 (an unfindable parent) are retired by owner decision D5: a spec has no parent to place or to find, and the parent lookup is never reached for a spec.
- Code read for the title rules: `packages/core/src/schemas.ts:609` (empty title) and `packages/core/src/ordinal.ts:268` (`^(SPEC|ADR)-\d+\b`, case-sensitive, anchored at the start), applied at creation by `schemas.ts:642` and on a title edit by `packages/lore/src/service/corpus-service.ts:2154`. Criteria cap: `packages/core/src/acceptance.ts:310`.

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Whether the creation check runs for a project | on (default for a new project and in this repository) | project settings maintainer, each skip recorded | 2026-10-07 |
| Whether the measurable-wording part of the creation check runs | on | project settings maintainer | 2026-10-07 |
| Most acceptance criteria supplied at creation | 50 (built in) | code change only | 2026-10-10 |

### Depends on

- Declare an acceptance criterion: criteria supplied at creation use the same shape and measurable-wording rules.
- Declare a code anchor: anchors supplied at creation use the same anchor rules.
- Cite a baseline rule: the only way a spec relates to the business and architecture trees.
- corpus (not yet written): generic document creation, readable names and version history.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Closed 2026-10-10 by owner decision D5 (ADR-041 decision 5): a spec has no parent and relates to the trees only through citations (BR-1, BR-2). A spec that fits no leaf is no longer a placement problem; it must cite at least one live rule to be approved. | answered | product (owner) |
| Q2 | The creation check only looks for some second-level heading. A one-line body with a heading passes. Should a spec kind require particular sections? | undecided | product |
| Q3 | Criteria supplied at creation are checked for measurable wording but not for named test files existing; that check applies only on the command-line declare route. Intended? | undecided | product |
| Q4 | A domain overview reclassified as another kind receives a number then, and keeps it if reclassified back. Is a number meant to be permanent once allocated, even for a spec that is again numberless by kind? | unconfirmed | product |

### Rules held at established

| Rule | Why |
|---|---|
| BR-1, BR-2 | Cited by AC-BLS3B-1, a live check-decided criterion with attested passes whose test (`spec-parent-contract.bun.test.ts`) fails if a spec could be created with or filed under a parent. |
| BR-9 | Cited by a live check-decided criterion whose test fails if the rule is false. |

### Rules held below established

Every live rule of this leaf other than BR-1, BR-2 and BR-9 is held at unconfirmed. No live rule is undecided or observed.

| Rule | Was | Why it is not established | What would establish it |
|---|---|---|---|
| BR-3, BR-4, BR-6, BR-8, BR-10 | cited | 2026-10-09 citation audit: the only citing criterion did not assert the rule's main claim, or its test would not fail if the rule were false (plan-baseline-fast-mode-migration-of-the-remaining-9-branches, R1). | A criterion with a test that fails if the rule is false. |
| BR-5 | observed | Pilot v2 downgrade: no falsifying criterion. Question: at creation, should every initial person- or AI-decided criterion be held to the wording rule unconditionally, or may a project switch it off and may a measurable AI rubric excuse a vague statement? | A falsifying criterion once the question is answered. |
| BR-7 | observed | Pilot v2 downgrade. Question: is it intended that an author with a bad kind (or a parent) and a missing section skeleton sees only the first refusal? | A falsifying criterion once the question is answered. |
| BR-11 | cited | Post-remediation fidelity sample (seed 20261010): its only citation was judged unfaithful. | A criterion with a test that fails if the rule is false. |
| BR-12 | established | Pilot v2 downgrade: only the store primitive is tested (`packages/lore/tests/unit/store/ordinal-allocation-cases.ts:116`), not the service wiring. | A criterion that drives reclassification through the service. |
| BR-13 | observed | Pilot v2 downgrade; Q4. | A falsifying criterion once Q4 is answered. |
| BR-230, BR-231, BR-232 | new 2026-10-10 | Read in code (see Boundary notes) but no citing criterion yet. | A criterion with a test that fails if the rule is false. |

Method: v2, `adr-an-acceptance-criterion-is-placed-by-the-business-outcome` — a rule is established only when a live check-decided criterion would fail if the rule were false.

---
id: BASE-142
type: baseline
role: intent
title: "Baseline Root"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-10
tags: []
parent: PRD-001
---
## LORE

Lore is an AI-native shared knowledge and memory platform for small, AI-first teams: a few people and several AI agents who need one place where requirements, designs, decisions, plans, execution evidence and lessons live as typed, linked, reviewed documents instead of scattered notes. It is delivered as one command-line program over a shared service layer, with other front ends (agent tool server, web service, dashboard) added on the same service. The corpus of documents is the project's single source of context; files in the repository and dashboards are projections of it, never the other way round.

This tree is the **product baseline** of Lore: the durable, business-level description of what the product does, written as small numbered rules that last longer than any one piece of work. Specs are implementations of rules in this tree; an acceptance criterion in a spec cites the rule it helps to prove. Rules are permanent: a rule id is never reissued, and a rule that stops being true is deprecated or retired, never deleted.

### How to read the tree

- **Root** (this node): what the product is, and the twelve branches.
- **Branch**: one area of the business, with its own vocabulary (glossary), a Boundary section that says what is inside and outside it, and a table of its children.
- **Leaf**: one business action, written as Command, Constraint, Event. A leaf holds the rules for that action. Rules carry a confidence: established (verified and clearly intended), observed (the product does this today, intent not confirmed), undecided (the owner has not decided) or unconfirmed (a suspected defect or unchecked fact).

### The twelve branches

The set of branches was approved by the owner, and every branch is populated with leaves and rules. The one-line scopes below are summaries; each branch's own Boundary section is the authority on what it holds, and where a summary and a Boundary differ, the Boundary wins.

| Branch | Business area |
|---|---|
| corpus | Creating, revising, linking, invalidating, deleting and finding documents; history and restore; export and import; keeping writes in this checkout's own corpus |
| review | Judging one document or the review queue, approval and rejection, the documents awaiting review, status moves among draft, in review and approved |
| product-baseline | The baseline tree itself: nodes, glossary, rules and their lifecycle, rule states, site maps and the completeness measurement, citation fidelity, product requirements and the requirements outline |
| specification-and-acceptance | Specs, acceptance criteria, falsifiers, code anchors, citing baseline rules from a criterion, the spec-specific approval conditions |
| execution | Plans and their approval, tasks, readiness, claims, evidence, the trusted verification run, attested results, archiving a task, closing a plan |
| session | The session-start snapshot, handoffs, resuming work and its accounting duty, plan seats, session liveness |
| hygiene | The health checks of the status command, the archive sweep, staleness probes, the audit trail, corpus usage |
| autonomy | Checkpoint mechanics and feeding (the governing rules before writing, task-start and phase-start packs), plan assessments, calibration statistics, acceptance verdicts, evaluation scenarios, the ledger fast-track |
| issue-loop | Defect reports from consuming projects: filing, listing, adopting and resolving them |
| distribution | Initialising a project corpus, installing and uninstalling the agent integration, scaffolding workflow files, the freshness check, governance topics, launching the dashboard |
| sync | The sync settings, pushing and pulling, the HTTP server and who may call it, agent keys |
| context | The project memory file, the lore rules files, fragments and the start-of-session injection, project pointers, the context bundle |

### Conventions that hold for every branch

- Rules are written in business language: no file names, function names, command flags, environment variable names or configuration keys inside a rule statement.
- Each rule has one to three short concrete examples.
- A rule says who enforces it: the product always (guaranteed), the product plus written instructions (both), or written instructions only (prompt-only).
- Facts that may change with a project's settings are recorded under "Current values" in the leaf, with the date they were read, not inside the rule.

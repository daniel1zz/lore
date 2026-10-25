---
id: KN-604
type: knowledge
role: knowledge
title: "Slice 3a: 28 PRD requirements migrated to baseline rules and 12 outline entries mapped to branches"
status: archived
priority: medium
created: 2026-10-10
updated: 2026-10-23
tags: []
---
Slice 3a, AC-BLS3-10 record (2026-10-10). The root PRD prd-lore-internal-first-ai-team-knowledge-platform keeps strategy; its 28 R-## requirements now carry `migrated_to` (written with `lore requirement migrate`), and requirement coverage is computed from live script-mode criteria citing that rule (BR-983).

## Requirements -> baseline rules (28/28 migrated)

| Req | Prio | Rule | Kind | Note |
|---|---|---|---|---|
| R-1 | P0 | BR-684 | existing | BR-684 refuses a new requirement whose statement has an abstract quality word and no measurable token (exit 4, nothing written); BR-685 is the project-level off |
| R-2 | P1 | BR-988 | new | No live rule covers editing settings from the dashboard (DSDB only covers launching). Implemented: packages/lore/src/adapters/http/config-routes.ts, packages/co |
| R-3 | P1 | BR-989 | new | No live rule. Implemented as restart_required in packages/lore/src/service/config-service.ts. Same proposed leaf as R-2. |
| R-4 | P0 | BR-494 | existing | Closest live rule for 'an agent files a structured defect report' (BR-494 creates the issue, BR-495 the draft ad-hoc task, BR-489 refuses with no destination).  |
| R-5 | P0 | BR-490 | existing | All five failure paths in R-5 (root-PRD mismatch, schema version, sync upstream, 11th open report, upstream gate denial) exist only for the retired local-corpus |
| R-6 | P1 | BR-990 | new | No live rule covers dashboard triage; ILST rules are command-line listing only. Implemented: packages/dashboard/src/routes/issues.tsx, packages/lore/src/adapter |
| R-7 | P1 | BR-589 | existing | BR-589: with an upstream destination configured a refused pre-flight check adds one reporting hint line, nothing otherwise, exit code unchanged. The internal-er |
| R-8 | P0 | BR-991 | new | APRV rules cover the approval decision only, not what the approver sees. Dashboard behaviour, implemented in packages/dashboard. |
| R-9 | P1 | BR-992 | new | PEND rules cover the command-line list only. Implemented: packages/dashboard/src/lib/use-triage-keyboard.ts. |
| R-10 | P1 | BR-993 | new | HUSE covers the usage report and retention but not dashboard page records. Implemented: POST /api/dashboard/telemetry/route-view in packages/lore/src/adapters/h |
| R-11 | P0 | BR-994 | new | BR-868 states only that registered projects are mounted and their state printed; the three-way classification, duplicate refusal, byte-identity and all-error st |
| R-12 | P0 | BR-995 | new | No live rule. Implemented: packages/lore/src/adapters/http/index.ts (404 'Unregistered project'). |
| R-13 | P0 | BR-996 | new | BR-946/BR-947 cover browser-only writes and attribution for one corpus; multi-project equivalence and the visible project label are unruled. |
| R-14 | P1 | BR-997 | new | BR-943 (401 without credentials) and BR-859 (loopback only) cover parts; single sign-in across projects and global sign-out are unruled. |
| R-15 | P1 | BR-998 | new | No live rule pins the registry-less shape. |
| R-16 | P1 | BR-999 | new | No live rule. The single query-key factory in R-16 is an implementation check and belongs in architecture standards, not the business rule. |
| R-17 | P1 | BR-1000 | new | No live rule. |
| R-18 | P1 | BR-901 | existing | BR-901 routes each fragment by audience and mode (static main -> rules files, dynamic main -> session start, helper fragments -> that helper's start); BR-903/BR |
| R-19 | P0 | BR-613 | existing | BR-613: a node is one of root, branch or leaf; BR-612 placement at any depth; BR-624 rules live only on leaves. The branch children/ubiquitous-language tables a |
| R-20 | P0 | BR-623 | existing | BR-623 states the rule shape (statement, confidence, enforcement, 1-3 examples). Drift: the rule allows confidence 'observed' and a 500-char statement, R-20 say |
| R-21 | P0 | BR-625 | existing | BR-625: no id issued twice, also under concurrent sessions, never reissued after deprecation, retirement or leaf deletion. R-21's '8 or more writers' figure is  |
| R-22 | P0 | BR-257 | existing | BR-257 refuses adding/revising a criterion that cites no live rule where the gate enforces; BR-86 covers missing/deprecated/retired ids; BR-258 the report-only  |
| R-23 | P0 | BR-979 | existing | BR-979 defines the architecture tree (root, sections, module cards, standards, debt registry) with AS-n / AD-n ids from the shared registry; BR-980 makes AS-n c |
| R-24 | P0 | BR-982 | existing | BR-982: the tree starts at the baseline root when one exists, the strategy document shown only when named. BR-981 does the same for session start. 'Every PRD-ro |
| R-25 | P0 | BR-971 | existing | BR-971 caps unexpired exemptions at one tenth of all criteria. The '100% cite-or-exempt before enforcing in this repo' and 'owner settles mapping disagreements' |
| R-26 | P0 | BR-986 | existing | BR-986: project setup records the citation gate mode as report when none is set and installs the baseline skill and node templates; BR-258 report mode refuses n |
| R-27 | P0 | BR-665 | existing | BR-665: state computed on request, never stored (contradicted / stale / verified / unknown). R-27 names the fourth state 'unverified', the rule says 'unknown'.  |
| R-28 | P0 | BR-677 | existing | BR-677 finds rules by spec or by anchored file; BR-966 tells a resuming session which cited rules changed since the claim. The 'within a stated token budget' pa |

Stale requirement text (owner follow-up, not a mapping error): R-4, R-5 (and R-6's adhoc wording) describe the retired local-corpus defect channel; their rules state the current GitHub-intake behaviour (BR-494, BR-490). The PRD text of these three should be rewritten in a strategy edit.

Coverage after migration (`lore status --check-requirements`, exit 3): 8 P0 uncovered — R-4, R-8, R-11, R-12, R-13, R-19, R-20, R-25 — their rules have no live script-mode citing criterion yet. This is honest baseline backlog (13 new dashboard rules have no tests citing them), not a defect of the migration.

## Outline entries -> branches (12/12)

| Outline key | Title | Target | Reason |
|---|---|---|---|
| autonomous-feedback-loop-ai-review-data-driven-self-optimization | Autonomous Feedback Loop (AI review, data-driven self-optimi | baseline-autonomy | Assess, gate check, ledger, feed, calibration, acceptance verdict and eval leaves carry this domain. |
| session-layer-multi-session-collaboration-context-continuity | Session Layer (multi-session collaboration & context continu | baseline-session | Start, resume, hand off, seats and who-is-working leaves. |
| memory-hygiene-knowledge-trustworthiness-over-time | Memory Hygiene (knowledge trustworthiness over time) | baseline-hygiene | Staleness probe, drift, tree check, archive sweep and audit leaves. Invalidation itself sits in baseline-corpus (DCIV). |
| distribution-adoption-phased-spike-gated-one-step-install | Distribution & Adoption (phased, spike-gated one-step instal | baseline-distribution | Init, install, uninstall, freshness check and project scaffold leaves. |
| phase-execution-model-plan-phase-checklist-supersedes-fine-grained-task-pre-decomposition | Phase Execution Model (plan → phase → checklist) | baseline-execution | Plan, task, claim, evidence, verify, archive and close leaves. |
| extension-hooks-system-direction-pointer-only-no-commitment | Extension Hooks System (direction pointer only) | architecture: target-state | Technical direction with no commitment and no shipped behaviour; no baseline leaf can hold it. |
| upstream-issue-feedback-loop-consumer-reported-defects-corpus | Upstream Issue Feedback Loop (consumer-reported defects → co | baseline-issue-loop | File, list, resolve, adopt and label-check leaves. The outline's 'into the upstream corpus' wording describes the retired channel. |
| dashboard-console-admin-console-evolution-adjudication-workbench-first | Dashboard Console (adjudication cockpit re-centered) | architecture: current-state | Dashboard is a delivery surface (module card). Its user-visible behaviours are proposed as rules on the leaves they serve (R-6, R-8, R-9, R-10); launch is basel |
| dashboard-multi-project-single-instance-switcher-over-the-machine-s-registered-corpora | Dashboard Multi-Project (single-instance switcher) | architecture: current-state | Dashboard module card. Behaviour rules proposed on DSDB and SYSV (R-11 to R-17). |
| provenance | Provenance (version changelog) | none | Append-only changelog of product rounds: history, not current product shape. Per-doc history is lore log; nothing to carry in either tree. |
| output-contract-document-taxonomy | Output Contract & Document Taxonomy | baseline-corpus | Document types and their creation rules live in baseline-corpus (DCCR); the spec-kind and stage-to-output gate parts spread into baseline-specification-and-acce |
| product-baseline | Product Baseline & Architecture Trees (the product's current | baseline-product-baseline | The BASE branch is this domain itself. |

Outline write verbs are retired (BR-985); `lore outline list` still reads these 12 entries.

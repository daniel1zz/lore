---
id: BASE-078
type: baseline
role: intent
title: "Architecture: target state"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-095
links:
  - {id: SPEC-098, type: supersedes}
---
# Target state

Where lore's structure is heading. Each item names the decision that commits it; uncommitted directions are labelled as such.

## Target architecture

- **Two trees define the product** (`adr-the-product-is-a-baseline-tree-specs-are-implementations`): the business baseline tree and this architecture tree; specs are implementations related to both through AC citations (BR-n / AS-n), with no single tree parent.
- **Spec parent contract** moves from "spec.parent_id must be the PRD" to citation-computed relations (baseline slice 3b; see debt registry).
- **Every write path gated identically**: one service-layer seam for every gate and every claim-scoped write guard, so CLI, MCP and HTTP cannot diverge (see standards on gates; open exceptions in the debt registry).
- **Completeness oracles that cannot go silent**: the site census and fidelity judge either see the whole relevant code or say what they did not see (debt entries for #112, #117, #118, #58).
- **Distribution-first** (`adr-distribution-first-every-improvement-names-its-consumer`): every improvement ships through `assets/` + the embedded manifest or binary-side output.

## Migration roadmap

1. Slice 3a: architecture tree, baseline-root navigation, requirements to rules, outline retirement, adoption distribution.
2. Slice 3b: spec parent contract + migration of the live specs off the single-PRD parent.
3. Close each AD entry through its issue; a standard's Current Exceptions shrink as entries resolve. New or enlarged debt is forbidden.

## Extension hooks (direction pointer only, no commitment)

Source: `spec-domain-overview-extension-hooks-system-direction-pointer-only-no-commitment` (owner, 2026-07-19). Direction: generalise the proven internal seams — `checkpointRegistry`/`GateEnforcer` for blocking predicates and telemetry for observation — into a first-class event/hook system. Deliberately not designed: no consumer exists yet, so no event catalogue, handler semantics or API is committed.

The owner-direction record for this pointer is the target-state section itself; `spec-domain-overview-extension-hooks-system-direction-pointer-only-no-commitment` is superseded by it.

## Dashboard staged candidates (admission-gated, not committed)

Source: the dashboard console and multi-project overviews, superseded by `baseline-module-card-dashboard`. Each candidate re-admits only when its trigger fires; anything without its trigger fired stays out of every landing spec.

- **Situational cockpit home** (owner decision D5, 2026-07-28): Home becomes a cockpit of decisions awaiting the human, an activity stream over the existing audit query, and read-only health signals. Ships only after tiered-review triage has landed and the human-review slice is verifiably at most 3 docs per day, so it never debuts pointing at a noise queue. Needs a bounded read-only activity-stream HTTP route.
- **Execution-verb writes** (claim, release, evidence buttons): need an explicit owner reversal of the CLI-only consensus and route telemetry showing at least 3 execution-route sessions per week for 4 consecutive weeks.
- **Calibration/attestation trust panel and read-only share mode**: admitted after the adjudication workbench is in use; share mode needs a redaction pass before any external exposure.
- **Corpus DAG graph view**: admitted on demand shown by route telemetry.
- **Cross-project aggregation views** and **in-UI registry add/remove**: aggregation needs at least 2 distinct projects visited per week for 4 consecutive weeks; registry editing needs at least 2 recorded registry-edit friction reports.
- **Kill criterion** (provisional, one-person baseline): 4 consecutive weeks of route telemetry after packaging with fewer than 3 dashboard sessions per week freezes candidate admission pending an owner re-decision, and the review must consult per-route data first. The same checkpoint is the mandatory re-review of the read-view demotion.

---
id: PLAN-248
type: plan
role: plan
title: "Decision records on writes"
status: archived
priority: medium
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: SPEC-258
phases:
  - {name: "S", description: "Schema and storage"}
  - {name: "W", description: "Write-time refusal and weight tables"}
  - {name: "M", description: "Milestone re-check and outcome links"}
---
# Decision records on writes

## Goal

Land spec-a-decision-carrying-write-records-its-decision-on-its (implements adr-an-agent-s-decision-between-milestones-is-a-record-gates).

## Tasks

Order: T1 → T2 → T2b → T3 → T5, and T1 → T4 → T4b → T5. T2 and T4 can run in parallel, and so can T2b and T4.

- T1 (S): core schemas and exports (owns packages/core/src/index.ts for the whole plan); store migration (041, renumbered at integrate if taken) adding versions.decision; write path; `lore log` display. AC-DR-1, AC-DR-3.
- T2 (W): `service/decision-gate.ts` (the shared refusal, file premise quoting and pinning) wired into `CorpusService.set`, MCP `lore_set` / `lore_bulk` set, and the baseline verbs. AC-DR-2, AC-DR-6.
- T2b (W): the gate on `rule set`, `rule add`, `rule propose`, and the criterion writes; MCP `lore_rule_set` / `lore_rule_add`. AC-DR-4, AC-DR-5.
- T3 (W): weight tables and score validation. AC-DR-10.
- T4 (M): deterministic milestone re-check. AC-DR-7.
- T4b (M): judged checks and re-run of citing criteria. AC-DR-8.
- T5 (M): `lore decision trace` / `lore decision rates`. AC-DR-9.

## After landing (main agent)

1. After T1 lands: `lore integrate` runs `lore migrate schema` on the live corpus; confirm with `lore get` and `lore log` that the corpus reads, before dispatching T2 and T4.
2. lore verify each task; lore done each.
3. lore rule apply the spec; update the prose of `baseline-revise-a-business-rule` (boundary note on citing criteria, open question Q2) and `baseline-assess-a-plan-s-outcome` to the new rules; review and approve.
4. Create the two weight tables (kinds "rule revision" and "document revision") with `lore weights set`; review and approve.
5. lore assess the plan.

## Decisions Log

- 2026-10-27 owner: decision fields only on non-draft targets; draft-spec rule proposals and human-party writes exempt (ADR corrections).
- 2026-10-27 AI: version-row column, service-layer gate, confidence order, decision selection by plan targets plus claim windows, line-quoted file premises, judged checks at the milestone, computed gates, command-fixed weight table kind (spec D1-D9).
- 2026-10-27 bundle review: 5 blockers and 12 should-fix items applied in one pass.

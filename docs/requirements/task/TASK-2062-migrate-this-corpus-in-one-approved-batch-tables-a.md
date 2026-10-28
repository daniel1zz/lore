---
id: TASK-2062
type: task
role: plan
title: "Migrate this corpus in one approved batch (tables and children lists), then verify and close"
status: draft
priority: medium
phase: "P5 Corpus migration and close"
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-261
plan: PLAN-261
links:
  - {id: TASK-2072, type: blocks}
---
Covers: none as a product criterion (one-time migration; its self-checks are evidence on this task and are deleted with the script)
Steps (user decision D18: one batch, one approval, no unreviewed machine write):
1. bun run build. Write scripts/migrations/baseline-generated-parts.ts: it reads every live baseline body (91 with Current values tables, 20 parents with written children lists on 2026-10-26), maps each table row to a governed id or 'drop: <reason>' (adding any missing GOVERNED_VALUES entry, each wrapping the product's own resolver or constant), holds the whole transform itself (nothing migration-specific ships), exits 1 naming any unaccounted row, and writes one changes.json; it prints every row whose written value differs from the value in effect.
1b. One-time self-checks, recorded as captured evidence on THIS task (deleted with the script): on a fixture corpus, (i) a node carrying both a 2-row table and, as a parent, a children table yields ONE entry with both removed and 2 bindings in its patch; (ii) while that batch is staged but not approved the node shows its written table and holds 0 bindings, and after approval it shows the generated values and no table.
2. lore batch stage --file changes.json (from the shared checkout). Report the batch slug and the printed wrong-today rows to the user; the person reviews the one diff set and approves it once (no agent runs lore review or approve). If any node changed meanwhile the approval refuses (exit 5): re-run the script and re-stage.
3. After approval: lore status --check-baseline exits 0; the script in --check mode reports 0 tables and 0 written children lists; then delete the script and its self-check in a commit and land it.
4. File each wrong-today row as an issue with lore report-issue --mechanism/--end-state, one root cause each.
5. lore verify plan-baseline-current-values-bound-to-their-source-409; lore rule apply spec-baseline-current-values-are-bound-to-their-source-and (BR-1430..1432 live); lore anchor add the spec governed-values.ts#GOVERNED_VALUES and baseline-generated-parts.ts#renderCurrentValues; lore assess.

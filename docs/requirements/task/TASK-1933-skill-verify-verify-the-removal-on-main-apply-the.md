---
id: TASK-1933
type: task
role: plan
title: "[Skill:verify] Verify the removal on main, apply the rule change set, remove this machine's registration"
status: approved
priority: high
phase: "Phase 4: Verify and close"
created: 2026-10-27
updated: 2026-10-28
tags: []
parent: PLAN-246
plan: PLAN-246
---
Estimate: M
Approach: main agent on main after all tasks landed: `bun run build`; `bun run test` (full suite, oracle lock); `lore verify plan-remove-the-lore-mcp-server` (AC-RMCP-1…6 attested); `lore rule apply spec-remove-the-lore-mcp-server` (needs an attested pass of every AC-RMCP criterion citing a changed rule); re-verify the other criteria citing changed rules still hold (`lore rule show <id>` → Cited by; BR-815 is also cited by AC-046-SG3, AC-060-8, AC-CP-11, AC-RC-8, AC-RC-13) with `lore verify <owning-plan> --ac <id>`; fresh-consumer check: `mkdtemp` HOME + project, `dist/lore setup`, assert no `claude mcp` call and no mcp manifest entry; `bun run mirror:export` + `bun run check:spec-mirror`; `lore context refresh` + `bun run check:memory-files`; `lore anchor add spec-remove-the-lore-mcp-server <impl paths>` (set.ts#…, setup-service.ts, distribution-hooks.ts, index.ts); after `lore rule apply` and T8/T8b: `python3 /private/tmp/claude-501/-Users-apple-Projects-zz-lore/300df8b4-ece2-4b46-a8ae-56c3ea32681f/scratchpad/t10_check_leaf_bodies.py` (spec D8 corpus end-state check, reading every baseline doc through `lore get` — the exported mirror missed 2 leaves on 2026-10-28; after rule apply it must report no matching rule statement either; record with `lore evidence --oracle other --capture`); `lore status --check-tree --check-drift`; then remove this machine's registration `claude mcp remove -s user lore` (user decision) and confirm `claude mcp list` has no lore; message lore-81 "MCP deletion landed on main <sha>".
Source: plan Exit Criteria.
Dimensions: D-FUNC, D-CORPUS
Scope-Alt: none
Covers: AC-RMCP-1, AC-RMCP-2, AC-RMCP-3, AC-RMCP-4, AC-RMCP-5, AC-RMCP-6, AC-RMCP-7, AC-RMCP-8 (attestation on main)

AC:
- `bun run test` exits 0 on main; `lore verify plan-remove-the-lore-mcp-server` reports 8/8 pass (AC-RMCP-1…8).
- `lore rule changes spec-remove-the-lore-mcp-server` shows the change set applied.
- Machine-state check (real `claude` binary, user decision; evidence = captured stdout via `lore evidence --oracle manual`): `claude mcp list` output has no line starting with `lore:`.
- `lore status --check-tree --check-drift` exits 0.
- The spec-D8 corpus check (t10_check_leaf_bodies.py, over every baseline doc via lore get) reports no body or rule-statement line naming the lore MCP route except BR-569 while spec-defect-clusters-round-2-part-a-sessions-seats-setup-init's corrected change is unlanded (evidence captured).

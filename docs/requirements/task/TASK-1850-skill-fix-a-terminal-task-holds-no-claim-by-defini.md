---
id: TASK-1850
type: task
role: plan
title: "[Skill:fix] A terminal task holds no claim by definition; claim and lore gate share one gate-context builder"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Gate false-deny, reproduced twice on 2026-10-19: `lore claim task-skill-docs-root-claude-md-and-shipped-agent-text-describe` refused exit 4 `gate:task-claim:anchor-overlap`, naming as the fresh conflicting claim the ARCHIVED task task-skill-implement-shipped-close-rule-a-lesson-is-finished (its `data.doc.extra.claim` still set, marked `orphaned_dirty`); while `lore gate task-claim --task <same>` printed `gate: pass`. Governing rules: SPEC-042 D5 (anchor-overlap claim gate), BR-1040 (claim conflicts judged per run).

Causes (file:line from a read-only diagnosis):
1. A terminal task still counts as holding a claim: `lore done`'s archive walk writes only status (task-workflow-service.ts:3933-3960); `endRunClaims` (:3369-3398) marks claims on terminal tasks too (here `orphaned_dirty` because the shared checkout had an untracked file); `isClaimStaleForRun` (packages/core/src/task-workflow.ts:991) keeps an orphaned_dirty claim fresh while its worktree is dirty; `buildAnchorGateContext` (checkpoint-registry.ts:2611-2657) reads `extractClaim(sibling)` regardless of status; ad-hoc siblings are every ad-hoc task in any status (`findAdhocSiblingTasks`, task-workflow-service.ts:5191-5195).
2. Two gate-context builders: the real claim wraps `buildAnchorGateContext` in `applyEffectiveSiblingStaleness` (task-workflow-service.ts:1036, :5124, :5134); `lore gate task-claim` (`runTaskClaimGate`, gate.ts:1014-1027) calls the builder directly, so its verdict differs. The "parity" comments at gate.ts:942, :1002 (and likely the phase gate :1107) are false.

End state:
- D1 One definition: a task holds a claim iff its status is not terminal (terminal = no outgoing transition in core's lifecycle, the same authority the dashboard badge uses via `getAllowedTransitions`) AND it carries `extra.claim`. This lives in ONE core predicate (`claimHeldBy(task)` or similar) used by every reader of sibling claims (gate context, endRunClaims selection, ready/territory reporting if they read claims). A terminal task's stored `extra.claim` stays as history; it is simply not a held claim by definition, so existing archived rows need no migration and no backstop.
- D2 One gate-context builder: a single function performs sibling selection plus run-aware staleness and is called by both the real claim (task and phase) and `lore gate task-claim` / phase gate. Delete the separate wrapping so parity holds by construction; make the gate.ts parity comments true or remove them.
- Not chosen: a `continue` for terminal siblings inside the builder only (a second definition of "holds a claim"); clearing claims on done plus a data migration (rewrites history, and a migration is transitional).

Oracle (red first on current code, then green): `packages/lore/tests/unit/service/claim-gate-terminal-and-parity.bun.test.ts` (or the existing runner pattern), throwaway corpus: ad-hoc task A archived with a claim from another run marked orphaned_dirty on a dirty temp worktree, anchor `x/a.md`; ad-hoc task B anchor `x/`. Assert `claim(B)` ok; and for a set of sibling states (terminal-with-claim, live fresh foreign claim, live orphaned_dirty on dirty worktree, live stale) the `lore gate task-claim` verdict equals the real claim verdict. Record with `lore evidence <task> --oracle test --result pass --capture --command "<exact command>"`, tsc via `--oracle tsc --capture --result pass --command "bun run typecheck"`.

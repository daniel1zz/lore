---
id: TASK-675
type: task
role: plan
title: "Update the four comments that recorded the diffSource wiring gap, now that AC-JV-5 closed it"
status: draft
priority: medium
phase: "assess-verify"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-123
plan: PLAN-123
---
# Objective

Close AC-JV-6. Four comments in `packages/lore/src/service/ai-provider-service.ts` truthfully recorded the `diffSource` wiring gap; AC-JV-5 closed that gap on 2026-08-11, so all four are now **false assertions shipping in the codebase**:

- `:87` — `opts.diffSource` is currently supplied by NO production caller
- `:89` — so every live `lore assess` run today …
- `:1193` — pass its already-resolved `diffSource` local through here. Until then this stays …
- `:1199` — no production caller supplies it yet

The live call sites are `packages/lore/src/adapters/cli/commands/assess.ts` and `packages/lore/src/adapters/mcp/tools.ts` (both merged, both attested by AC-JV-5).

# Acceptance

**AC-JV-6** — `lore get 01KZR7GP6C`. ⛔ The replacement text must be **mechanically checkable** (name the two call sites), never a bare "fixed" claim, and the oracle asserts each stale phrase is ABSENT.

# Why this is a separate task at all

⛔ Second instance in one session of the standing lesson that fixing a gap and updating the comment recording it are ONE acceptance unit. Both times the anchor set covered the implementation site and not the comment site, so the implementer was structurally limited to flagging it. That is an anchor-design defect, not an execution failure — do not repeat it here: this task's anchors deliberately include the comment file itself.

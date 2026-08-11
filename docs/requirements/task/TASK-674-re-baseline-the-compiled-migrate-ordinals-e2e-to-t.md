---
id: TASK-674
type: task
role: plan
title: "Re-baseline the compiled migrate-ordinals e2e to the padded human_id form that commit 63164c20 left behind"
status: draft
priority: medium
phase: "readonly"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-125
plan: PLAN-125
---
# Objective

Close AC-MIS-7. **This is a LIVE RED on main**, verified by the orchestrator on 2026-08-11 after a fresh `bun run build`:

```
cd packages/lore && bun test tests/e2e/migrate-ordinals-compiled.bun.test.ts
→ exit 1, 3 pass / 2 fail
   expect(index.mappings[specA.id]?.human_id).toBe(brandedHumanId("SPEC-1"))
```

Commit `63164c20` replaced the unpadded `formatDocDisplayId` composition with the padded `formatMirrorHumanId` one and re-baselined `migrate-ordinals.bun.test.ts` — but not this compiled sibling, which still pins `SPEC-1`.

# ⛔ Do not resolve it the wrong way

Do NOT revert the padded composition. AC-MIS-1, AC-MIS-2 and AC-MIS-4 are all attested against it, and the round-trip idempotency AC depends on it. The pins are what is stale, not the code.

# Note on why this task exists

⛔ Third instance in one session of an anchor set covering one test file and not its sibling. AC-MIS-4's anchors named the unit test only, so the compiled tier was invisible to it. Not an execution failure — an anchor-design defect.

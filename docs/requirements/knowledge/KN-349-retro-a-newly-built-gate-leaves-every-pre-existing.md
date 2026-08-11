---
id: KN-349
type: knowledge
role: knowledge
title: "Retro: a newly-built gate leaves every pre-existing doc in permanent violation (plan-terminality sweep 2026-07-29)"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: [dogfood, gate, retroactive, tree-check]
parent: PLAN-111
---
# Retro: a newly-built gate leaves every pre-existing doc in permanent violation — plan-terminality sweep, 2026-07-29

## What happened

The plan-close/plan-terminality mechanism shipped 2026-07-28 (`plan-implementation-plan-closure-must-be-loud`). Its detector immediately reported **8 tree drifts in this corpus at landing**: 2 orphans + 6 plans whose child tasks were all terminal but which had never been closed, so their plan-close gate had never evaluated them. None belonged to the shipping session.

Closing all six this session produced a clean split:

- **4 closed on the first attempt** — their evidence and outline state already satisfied every predicate.
- **2 were denied (exit 4)** and needed retroactive repair before they could close:
  - `ATTESTATION_FLOOR_NOT_MET` — the attested-evidence ratio predicate did not exist when these plans executed, so their tasks carry self-reported-only evidence. Repair: `lore verify <plan> --task <t>` per zero-attested task (spec-080 needed SIX passes to move the ratio 0.29 → above 0.5; workflow-hardening needed one).
  - `ASSESSMENT_STALE` — repaired by re-running `lore assess`.
  - `PRD_OUTLINE_NOT_SYNCED` — repaired by `lore outline exempt`.

## The generalizable lesson

**A new deterministic gate does not only constrain future writes — it retroactively invalidates every pre-existing doc that never passed through it.** The predicate is evaluated at close time against data authored under the old rules, so the entire back-catalog lands in violation the moment the detector arms. Building the gate is therefore only half the work; the other half is a one-time sweep with an explicit retroactive policy, and it must be budgeted in the same slice — not discovered by the next session via a failing `hooks/pre-push`.

Corollary on **which repair path is honest**: `PRD_OUTLINE_NOT_SYNCED`'s execution window is `[earliest task-claim, close-write now)` — open-ended at the close edge — so writing a domain doc NOW does satisfy the predicate; exemption is not mechanically forced. It was still the right call here, because a domain narrative authored solely to clear a gate on already-shipped work is ceremony, which is the exact failure mode C4 exists to prevent. **Prefer the exemption with a written reason over synthesizing the artifact the predicate looks for** — an exemption is auditable, a ceremonial doc is indistinguishable from a real one afterwards.

## Open observation — NOT a diagnosed defect

`lore status --check-tree` reported `orphan: knowledge has no parent but is not a root type` for `knowledge-session-process-review-2026-07-28-grill-to-shipped`, a doc whose `parent_id` is populated (`01KYKVAA…` → `knowledge-grill-review-2026-07-28-seven-product-direction`, itself a `knowledge` doc in `draft`). Re-checking later in the same session, the orphan count had dropped to 0 with no action taken against that doc — only unrelated plan closures and a `lore link` on the OTHER orphan happened in between.

Evidence boundary: `parent_id` was confirmed populated both before and after. What was NOT established is why the predicate read it as absent, whether the trigger is the parent being a `knowledge` (possibly not a legal parent type in `lore.tree.yaml`, though the message says "has no parent", not "wrong parent type"), the parent's `draft` status, or a `parent_id` ↔ link-table divergence that a cascade write happened to reconcile. **Root cause undetermined — do not cite this as a known bug; it is a lead to reproduce.**

Meta-note on why this is a knowledge doc and not a filed issue: `lore report-issue` requires `feedback.upstream`, which no init/setup path provisions, so it is unusable out-of-box. That defect is now under repair as `spec-out-of-box-reporting-channel-report-issue-self-provisions`. This is the second consecutive session in which a suspected lore defect had to be written down instead of filed.

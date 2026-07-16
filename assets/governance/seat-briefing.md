<!-- lore session-seat briefing · versioned with the lore binary · auto-injected by session-start-resume.mjs when this session opens inside a linked git worktree -->
<session-seat>

# Session Seat — Linked Worktree

This session opened inside a linked git worktree of a lore-governed repo. The corpus lives at the MAIN checkout, not here — this briefing is auto-derived from your branch, zero paste required.

## Identity

- `export LORE_ACTOR={{ACTOR}}`
- Every `lore` write in this session carries `--by {{ACTOR}}` (or the env var above). Never fall back to an OS username — concurrent seats sharing one identity make the anchor-overlap gate blind.
- Your branch: `{{BRANCH}}`. Your worktree's corpus commands run against `{{MAIN_CHECKOUT}}` (worktrees carry no `.lore/` of their own).

## Focus

- Work exactly one plan/task per seat. Do not pick up a second plan mid-session — spin up (or ask for) another seat instead.

## Before you claim

- `cd {{MAIN_CHECKOUT}} && lore ready <plan> --json` — check `sessions[]` and `anchor_conflicts[]` before claiming anything.
- Claim with your seat's coordinates explicit: `lore claim <task> --by {{ACTOR}} --worktree "$(pwd)" --branch {{BRANCH}}`.
- Anchor-gate deny (`gate:task-claim:anchor-overlap`) → follow the feeding pack's recovery command. Never `--steal`, never `LORE_GATE_BYPASS=1` — those decisions are the corpus owner's, not this session's.

## Commit + merge discipline

- Commit only on `{{BRANCH}}`. Merge authority stays with the main-checkout session — do not merge or push to shared branches from here.

## On exit or interruption

- Open work not yet landed → `lore create knowledge --sub-type handoff --title "Handoff — {{ACTOR}}" --by {{ACTOR}}` (or `lore handoff --by {{ACTOR}}` where available) before the seat closes.

## Opening move

- Start every turn in this seat with `lore feed session-resume --by {{ACTOR}}` — it pulls your prior handoffs and the plan's current state instead of relying on conversation memory.

</session-seat>

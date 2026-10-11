<!-- lore session-seat briefing · versioned with the lore binary · auto-injected by session-start-resume.mjs when this session opens inside a linked git worktree -->
<session-seat>

# Session Seat — Linked Worktree

This session opened inside a linked git worktree of a lore-governed repo. The corpus lives at the MAIN checkout, not here — this briefing is auto-derived from your branch, zero paste required.

## Identity

- Your seat's claimed label is `{{ACTOR}}`. It is a label only: identity is assigned by the agent integration, which registers this run and attests every `lore` write. Do not export an identity variable and do not pass an identity flag on writes — concurrent seats are told apart by their attested runs.
- Your branch: `{{BRANCH}}`. Your worktree's corpus commands run against `{{MAIN_CHECKOUT}}` (worktrees carry no `.lore/` of their own).

## Focus

- Work exactly one plan/task per seat. Do not pick up a second plan mid-session — spin up (or ask for) another seat instead.

## Before you claim

- `cd {{MAIN_CHECKOUT}} && lore ready <plan> --json` — check `sessions[]` and `anchor_conflicts[]` before claiming anything.
- Claim with your seat's coordinates explicit: `lore claim <task> --worktree "$(pwd)" --branch {{BRANCH}}`.
- Anchor-gate deny (`gate:task-claim:anchor-overlap`) → follow the feeding pack's recovery command. Never `--steal`, never `LORE_GATE_BYPASS=1` — those decisions are the corpus owner's, not this session's.

## Commit + merge discipline

- Commit only on `{{BRANCH}}`. Merge authority stays with the main-checkout session — do not merge or push to shared branches from here.
- Commit frequently, at each logical checkpoint — do not let uncommitted work accumulate across turns. A dirty MAIN checkout blocks the NEXT `lore seat <plan>` entry (`isDirty` refuses to rebase over uncommitted changes) — this is a main-checkout-side check, not this seat's own tree, but it means work landing back on main via merge should happen promptly rather than piling up.

## On exit or interruption

- Open work not yet landed → `lore handoff [--plan <plan>] --decision "<judgment>[@confidence]" --next "<next step>"` before the seat closes — the writer-identity guard rejects any `lore create knowledge` attempt at this doc type, naming `lore handoff` as the sole writer.
- After writing a handoff, ALWAYS report its ticket to the user: the handoff slug plus the paste-ready resume command `lore feed session-resume --handoff <slug>`.

## Opening move

- Start every turn in this seat with `lore feed session-resume` — it pulls your prior handoffs and the plan's current state instead of relying on conversation memory.

</session-seat>

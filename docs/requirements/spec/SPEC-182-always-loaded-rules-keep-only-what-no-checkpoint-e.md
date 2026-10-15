---
id: SPEC-182
type: spec
role: spec
title: "Always-loaded rules keep only what no checkpoint enforces; six backstopped rules move into the skills of the activity they govern"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: [rules, skills, fragments]
---
# Spec: Always-loaded rules keep only what no checkpoint enforces; six backstopped rules move into the skills of the activity they govern

Governing decision: `adr-rule-delivery-tiers-gate-hook-skill-and-optimistic` §1 corollary — a rule may move from always-loaded to a skill (L3) only if a checkpoint mechanically refuses its violation. Audit: `knowledge-delivery-tier-audit-of-every-always-loaded-lore-rule`.

## Overview/Goal

Every consumer session loads the shipped project rules (17,396 chars rendered, `lore fragments check --json`). The audit found six rules whose violation is already refused by a checkpoint, so the always-loaded copy only repeats what the refusal (with its feeding pack) teaches at the moment it matters. Owner decision 2026-10-15: move exactly these six; do not move any rule without a backstop; do not build path-scoped rules (not emittable today, and their candidates are not rules files).

| Rule (shipped fragment) | Backstop | Moves to |
|---|---|---|
| Resume-ticket item accounting, RESUME_DISPOSITION (corpus-workflow-1-feed) | stop-handoff-coverage Stop hook | assets/skills/lore-plan (resume mode) |
| Living vs record, locked-record exits (corpus-workflow-2-produce) | record-edit checkpoint (`record-lock-service.ts`) | assets/skills/lore-design |
| Claim from inside the worktree with explicit --worktree (corpus-workflow-3-execute) | task-claim / phase-claim gate | assets/skills/lore-autopilot |
| COMMIT BEFORE YOU ATTEST (corpus-workflow-3-execute) | evidence/release dirty-worktree refusal (`task-workflow-service.ts:284-296`) | assets/agents/lore-implementer.md |
| Re-check the upstream is claimable before each dispatch (worktree-dispatch) | UPSTREAM_NOT_APPROVED claim refusal | assets/skills/lore-autopilot |
| Anchor file mutex (worktree-dispatch) | anchor-overlap claim refusal | assets/skills/lore-autopilot |

## Scope

- Remove each bullet from its `assets/context/*.md` fragment and add it, unshortened, to the target file (moved, not rewritten). The lore-autopilot copy of the two dispatch rules adds `` !`lore ready <plan> --json` `` guidance only if the skill already takes a plan argument; otherwise text only.
- Regenerate the assets manifest; `lore fragments check` stays exit 0.
- Out of scope: the 41 rules with no backstop (they stay always-loaded; future checkpoint work), user-layer fragments (the user's own), path-scoped rules.

## Acceptance Criteria

Declared with `lore ac add` (AC-RT-*).


## Acceptance Criteria (structured)

- [·] [script] AC-RT-1: None of the six moved rules' distinctive phrases occurs anywhere under assets/context; each occurs in its target (lore-plan, lore-design SKILL.md, lore-implementer agent, lore-autopilot SKILL.md); and the unbacked control rule 'Measure every oracle's exit code WITHOUT a pipe' is still in corpus-workflow-3-execute.md.
  script: other — cd /Users/apple/Projects/zz/lore;f=0;A=assets;c(){ grep -qF -- "$1" "$2"||{ echo "missing $2: $1";f=1;};};for p in RESUME_DISPOSITION "Living vs record:" "identity is assigned by the agent integration" "COMMIT BEFORE YOU ATTEST" "upstream governance docs are claimable" "File mutex: tasks declare";do grep -rqF -- "$p" $A/context&&{ echo "in context: $p";f=1;};done;grep -rqF RESUME_DISPOSITION $A/skills/lore-plan||{ echo "missing lore-plan";f=1;};c "Living vs record" $A/skills/lore-design/SKILL.md;c "COMMIT BEFORE YOU ATTEST" $A/agents/lore-implementer.md;for p in "identity is assigned by the agent integration" "upstream governance docs are claimable" "File mutex: tasks declare";do c "$p" $A/skills/lore-autopilot/SKILL.md;done;c "exit code WITHOUT a pipe" $A/context/corpus-workflow-3-execute.md;[ $f -eq 0 ]&&echo "AC-RT-1 PASS: six backstopped rules moved from assets/context to skill/agent homes; unbacked control stays"

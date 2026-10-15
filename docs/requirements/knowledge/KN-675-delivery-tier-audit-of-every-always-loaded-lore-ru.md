---
id: KN-675
type: knowledge
role: knowledge
title: "Delivery-tier audit of every always-loaded lore rule: 6 backstopped rules can move to skills, 41 have no mechanism"
status: draft
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: [governance, rules, skills]
parent: PRD-001
links:
  - {id: ADR-047, type: relates-to}
---
# Research: delivery-tier audit of every always-loaded lore rule (2026-10-15)

Applies adr-rule-delivery-tiers-gate-hook-skill-and-optimistic to the always-loaded rule set. Read-only audit by a lore-explorer agent; backstop claims carry file:line, unverified ones are recorded as none. Measured: rules:project 17,396 chars rendered (`lore fragments check --json`), rules:user 5,872 chars of body.

## Findings
1. **Only ~3.8k chars (6 shipped rules) have a mechanical backstop strong enough to move to a skill (L3):**
   - corpus-workflow-1-feed: RESUME_DISPOSITION accounting — backstop `assets/hooks/stop-handoff-coverage.mjs:133-167`.
   - corpus-workflow-2-produce: living vs record / locked records — backstop `packages/lore/src/service/record-lock-service.ts:61` (record-edit checkpoint), `ac-service.ts:20-22`.
   - corpus-workflow-3-execute: claim inside the worktree with explicit --worktree — backstop claim gate (`gate-enforcer.ts:661` ANCHOR_OVERLAP, `task-workflow-service.ts:293-296`, `gate-predicates.ts:286`).
   - corpus-workflow-3-execute: COMMIT BEFORE YOU ATTEST — backstop `task-workflow-service.ts:284-296`.
   - worktree-dispatch: re-check upstream claimable per dispatch — backstop `gate-predicates.ts:286`.
   - worktree-dispatch: anchor file mutex — backstop `gate-enforcer.ts:661`.
   Partially backstopped (~1k): red-first (lore done red-first floor), evidence tails / verify-over-capture (`evidence-capture.ts:441`, `task-workflow-service.ts:1180`), handoff writer (`create.ts:109-113`).
2. **41 rules have no mechanism at all** (prose only). They stay always-loaded; each is a candidate for a new checkpoint, not a move. Groups: most execute/worktree/close operating discipline (no-pipe exit codes, don't discard lore output, merge protocol, branch sweep after merge, retry limit, scoped-oracle floor, cache bypass, done ownership), all user-09 behaviour rules, ac-design oracle rules (simplest-false-green, re-baseline record, read-before-set, capability+wiring unit), project test conventions (no writes to the live corpus, runner split), dispatch-bundle shape.
3. **`paths:` path-scoped rules cannot be emitted today:** `FragmentFrontmatterSchema` is `.strict()` (`packages/core/src/context-fragments.ts:65`, refused at `discover.ts:76-79`) and `renderRulesFile` writes no frontmatter (`section.ts:73-86`). The two candidates (project-no-write-live-corpus, project-test-runner-split) are subagent-start fragments, not rules files, so path scoping would not apply to them anyway.
4. **Skill fragments keep `` !`cmd` `` verbatim** (`section.ts:55-79`, `render.ts:67-68`), so a skill can carry live state.

## Consequence
Spec C is scoped to the 6 backstopped rules. The 41 unbacked rules are the input for future checkpoint work, prioritised by how often their violation was measured in retros.

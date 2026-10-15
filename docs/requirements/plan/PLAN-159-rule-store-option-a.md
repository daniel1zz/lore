---
id: PLAN-159
type: plan
role: plan
title: "Rule store option A"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: SPEC-169
phases:
  - {name: "W1"}
  - {name: "W2"}
  - {name: "W3"}
  - {name: "W4a"}
  - {name: "W4b"}
  - {name: "W5"}
  - {name: "close"}
---
## Goal

Land `spec-rule-store-git-tracked-fragment-selection-on-demand-skill` (option A of `knowledge-rule-store-a-selectable-fragment-catalog-composed-per`).

## W0 probes (done by the main agent, 2026-10-12, before dispatch)

- (a) PASS: a SKILL.md with a `<!-- lore:managed ... -->` fingerprint line right after the frontmatter parses. Its `description` appears in the session's skill listing, which is what description triggering reads, and the skill loads. The fingerprint line is delivered as part of the body, which does no harm.
- (b) PASS: a new `~/.claude/skills/lore-probe-rs/` (the parent dir already existed) was invocable in the SAME session, without a restart. It was then announced in the skill listing.
- (c) PASS: a PreToolUse hook on Edit that exits 0 with `hookSpecificOutput.additionalContext` reached the model. Nonce ZK41-ADDCTX was observed. A newly created `.claude/settings.local.json` was hot-loaded. The probe files were removed afterwards.

## Waves

Anchors are disjoint within a wave, and the task-claim gate refuses an overlapping concurrent claim. Every changed symbol's importers were censused, and every hit falls inside some task's anchors. The census table is in the 'Anchors and census' section below. `contextConfigSchema` (15 importers) is deliberately NOT changed.

| Wave | Task | ACs |
|---|---|---|
| W1 | T1 core fragment format and outlets | AC-RS-1 |
| W2 | T2 routing | AC-RS-2, AC-RS-11 |
| W2 | T3 skill file shape and caps | (unit part of AC-RS-5) |
| W2 | T4 duplicate detector | AC-RS-4 |
| W2 | T5 selection model + shared user-config-dir resolver | AC-RS-3 |
| W3 | T6 check/render flow | (unit part of AC-RS-8) |
| W3 | T7 refresh writes and prunes skills | AC-RS-5 |
| W3 | T8 selection flow (CAS) | AC-RS-6 |
| W4a | T9 fragments adapter (uses the T5 resolver) | AC-RS-8 |
| W4a | T11 status --check-fragments (builds its OWN duplicate fixture; does not depend on T9's) | AC-RS-9 |
| W4a | T12 hook messages | AC-RS-12 |
| W4b | T10 context verbs (uses the T5 resolver; after T9 merges) | AC-RS-7, AC-RS-10, AC-RS-15 |
| W5 | T13 migration: shipped fragments, agent-rules trim, this repo's selection | AC-RS-13 |
| close | human step | AC-RS-14 |

## Promoted fragments: delivery, audience and byte budget

| Fragment | Delivery | Audience | Source |
|---|---|---|---|
| lore-ac-design | rules (static) | main | user-04 lines 9-13 and 15 |
| lore-evidence-attestation | rules (static) | main, subagent:lore-implementer, subagent:tester | user-05 lines 10-11, dated history dropped |
| lore-dispatch-bundle | rules (static) | main | user-15 lines 8-9 (these two lines are DELETED from user-15 by the human step, so they are not duplicated) |
| lore-worktree-dispatch | rules (static) | main | user-17 lines 9, 10, 12, 13, 15, 16 and 18 |

Budget for AC-RS-14:

- The ceiling is 33,818 B. Today's main-session total is 39,441 B.
- The human step removes about 13,300 B: user-03/04/05/06 render as 10,878 B, user-02 moving to a skill frees 2,167 B, and user-16 lines 12-13 free about 300 B.
- That leaves about 26,100 B before additions, so ALL main-session additions together MUST stay at or under 7,000 B rendered. That covers three things:
  - the four promoted fragments;
  - the scoped-oracles project fragment gaining the `main` audience (measured 1,060 B today);
  - user-03 line 4 moved into corpus-workflow-close (about 210 B).
- So the four promoted fragments get at most about 5,700 B together. T13 measures every addition and reports it against this budget.

## User-layer migration table (HUMAN step, `~/.config/lore/context/`)

| Fragment | Action |
|---|---|
| user-02 | Add `delivery: skill` and a description. |
| user-03 | Delete. Its line 4 moves to the shipped corpus-workflow-close in T13. |
| user-04, user-05 | Delete; they are promoted (D3). |
| user-06 | Delete. The `#Symbol` clause becomes a D4 issue. |
| user-07 | Already reduced to two lines on 2026-10-11; keep. |
| user-09 | Keep. |
| user-15 | Delete lines 8-9 (promoted). Keep lines 10-19 until the dispatch hooks are registered at user scope (user decision). |
| user-16 | Delete lines 12-13; stop-doc-sync already prints them. |
| user-17 | Keep only line 8 (machine `baseRef`). |
| `.bak-*` files | Remove. |

Then run `lore context refresh --scope user && lore fragments check`, then AC-RS-14.

## Anchors and census

Every task declares its `file_anchors`; `lore tree plan-rule-store-option-a` shows them.

Consumer census command: `grep -rlw <sym> packages/*/src packages/*/tests scripts | wc -l`. Hits:

| Symbol | Hits |
|---|---|
| FragmentFrontmatterSchema | 4 |
| OUTLET_IDS | 2 |
| OutletId | 7 |
| resolveContextConfig | 7 |
| selectFragments | 4 |
| checkOverrides | 4 |
| renderOutlet | 3 |
| renderRulesFile | 4 |
| isLoreRulesFileName | 3 |
| runFragmentsCheck | 3 |
| runFragmentsRender | 4 |
| buildFlowDeps | 2 |
| runContextRefresh | 10 |
| contextConfigSchema | 15 (unchanged) |

Every hit falls inside T1-T13's anchors. Two of them, `claude-md-budget.ts` (T7) and `config.ts` (T1), are comment-only hits.

AC-RS-14 needs the HUMAN user-layer migration. The ONLY canonical list is the 'User-layer migration table' section above; follow it row by row.

## Close

1. Full suites on main against the 15-failure vitest baseline.
2. Run every script AC on merged main.
3. Retire BR-890, BR-895, BR-901, BR-903 and BR-916.
4. `lore anchor add` the spec's implementation and test-file code anchors (task file_anchors already exist).
5. File the D4 issues (tool quirks still documented in prose).
6. `lore assess` once AC-RS-14 passes.

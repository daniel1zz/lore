---
id: SPEC-207
type: spec
role: spec
title: "Baseline coverage cannot silently regress: one-program census and a complete-coverage integrate floor"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
links:
  - {id: TASK-1839, type: relates-to}
---
# Spec: Baseline coverage cannot silently regress — one-program census and a complete-coverage integrate floor

## Overview/Goal

On 2026-10-18 `lore baseline coverage baseline-root` reached complete=true (123/123 leaves ok). By the next morning merges by other sessions had added 84 census sites (autonomy decide/override/calibration, invocation) reached by almost every command through app wiring, plus 8 runnable commands no leaf declares (decide, autonomy show/set/regenerable add/regenerable rm/verify-pushed-heads, stash prune, integrate); root coverage was back to 0/124 ok (2913 leaf×site pairs). Nothing refused those merges. Owner choice 2026-10-19: build the mechanism that makes this unable to recur (task-design-a-merge-that-adds-an-unmapped-census-site-is).

End state: main always has complete baseline coverage. A merge into main is refused at the integrate floor when the merged code leaves any (leaf, site) pair unaccounted or any runnable command declared by no leaf; the refusal names each pair or command and the exact fix. There is no allowlist, no deferral and no comparison against a base: whoever adds a refusal site or a command accounts for it in the same change. Amends SPEC-157 C1/C2 (census, coverage).

Measured on main (Plan agent, 2026-10-19): the census builds one TypeScript program per command (128 commands: 358 s in-process; root coverage 6-10 min), too slow for a merge check. One shared program with dependency-injection resolution scoped to each command's import closure: 10-12 s for all 128 commands, keys byte-identical for 128/128; a shared program WITHOUT scoping changes 113/128 commands, so scoping is required. Checking only the files in a diff would have missed 70% of the regression (1642 of 2328 newly reached pairs were in unchanged files, reached through new wiring), so the check runs on the whole merged tree.

## Scope

In:
- Census: a many-entry census in the binary that builds one program and scopes import-closure-dependent resolution (error types, call sites of injected members, object members by name) to each command's own closure, with output identical to the per-command census. `lore baseline coverage` and `lore baseline sites` use it; root coverage completes in well under a minute.
- Command declaration: `lore baseline coverage` of the root also reports every runnable command in the CLI registry declared by no leaf, and is not complete while one exists.
- Integrate floor: the floor of `lore integrate` runs root coverage on the merged tree against the corpus it runs with, and refuses the integration (floor_failed, main unchanged) unless coverage is complete. The check is a `check:*` step the floor collects, not a corpus-dependent exclusion.
- Refusal text names, per unaccounted pair, the site key, the commands reaching it, the leaf, and the exact `lore baseline map <leaf> --site '<key>' --rule BR-n | --non-business "<reason>"`; per undeclared command, `lore baseline map <leaf> --command '<cmd>'`; when an already-mapped key in the same file with the same error code disappeared, it is named as a probable rename with `--remove-site '<old>'`.

Out:
- Census blind spots (depth limit, dynamic dispatch) are unchanged; dynamic sites remain pairs that need accounting.

## Rollout order (one plan, no transitional code)
1. Many-entry census (AC-BCR-1).
2. Repair: account for every current pair and declare every current command (the restoration plan's repair round), so root coverage is complete on main.
3. Wire the complete-coverage check into the integrate floor (AC-BCR-2..5) in the same plan, immediately after 2 lands; the plan does not close before it is wired.

## Acceptance Criteria

Declared with `lore ac add` as AC-BCR-1..6. AC-BCR-2..5 cite BR-1248 (the merge-refusal rule this spec proposes) and BR-660; AC-BCR-1 and AC-BCR-6 cite BR-659.

- AC-BCR-1: the many-entry census returns, for every entry point of a fixture workspace that uses injected dependencies and for the real commands claim, done, verify, approve and baseline map, exactly the keys the per-command census returns; a shared program without closure scoping is shown to differ on the fixture.
- AC-BCR-2: root coverage of a corpus where one pair was fixed and another added (total unchanged) is not complete and exits 1 naming the new pair and its map command.
- AC-BCR-3: a change only to file X that makes an existing site in unchanged file Y reachable from more commands leaves coverage incomplete, exit 1, listing each newly affected leaf.
- AC-BCR-4: a runnable subcommand declared by no leaf leaves root coverage incomplete, exit 1, naming the command and the declare command.
- AC-BCR-6: root coverage of the real tree finishes within 120 seconds (exit 0 or 1, never a census error); this is what makes the integrate-floor check affordable.
- AC-BCR-5: lore integrate of a branch whose merged tree leaves one unaccounted pair ends floor_failed naming the pair, main unchanged; the same branch with the pair mapped integrates.


## Acceptance Criteria (structured)

- [⚑] [script] AC-BCR-1: The many-entry census returns, for every entry point of a fixture workspace that uses injected dependencies and for the real commands claim, done, verify, approve and baseline map, exactly the site keys the per-command census returns; a shared program without import-closure scoping is shown to differ on the fixture
  script: test — bunx --bun vitest run packages/lore/tests/unit/service/site-census-many.test.ts && echo 'AC-BCR-1 PASS: many-entry census equals per-command census'
  other_command=2
- [⊖] [script] AC-BCR-2: Root coverage of a corpus where one unaccounted pair was fixed and another added (total unchanged) is not complete: lore baseline coverage exits exactly 1 naming the new pair and the map command for its leaf
  script: test — bunx --bun vitest run packages/lore/tests/unit/service/coverage-swap-not-complete.test.ts && echo 'AC-BCR-2 PASS: a count-preserving swap is still incomplete'
- [⊖] [script] AC-BCR-3: A change only to file X that makes an existing site in unchanged file Y reachable from more commands leaves root coverage incomplete: exit exactly 1, listing each newly affected leaf
  script: test — bunx --bun vitest run packages/lore/tests/unit/service/coverage-rewire-not-complete.test.ts && echo 'AC-BCR-3 PASS: a newly reached site is a gap on every affected leaf'
- [⚑] [script] AC-BCR-4: A runnable subcommand declared by no leaf leaves root coverage incomplete: lore baseline coverage of the root exits exactly 1 naming the command and the lore baseline map --command fix
  script: test — bunx --bun vitest run packages/lore/tests/unit/service/coverage-undeclared-command.test.ts && echo 'AC-BCR-4 PASS: an undeclared command makes root coverage incomplete'
- [⊖] [script] AC-BCR-5: lore integrate of a branch whose merged tree leaves one unaccounted pair ends floor_failed naming the pair and main is unchanged; the same branch with that pair mapped integrates
  script: test — bunx --bun vitest run packages/lore/tests/integration/integrate-complete-coverage.test.ts && echo 'AC-BCR-5 PASS: integrate floor requires complete coverage'
- [⚑] [script] AC-BCR-6: Root coverage of the real lore tree (all declared commands of all leaves) finishes within 120 seconds on the development machine and ends with exit 0 or 1, never a census error
  script: other — s=$(date +%s); bun run packages/lore/src/index.ts baseline coverage baseline-root > /dev/null 2>&1; rc=$?; e=$(($(date +%s)-s)); echo "root coverage rc=$rc seconds=$e"; [ $rc -le 1 ] && [ $e -le 120 ] && echo 'AC-BCR-6 PASS: root coverage within 120 s'

## Code anchors

- packages/lore/src/service/site-census.ts
- scripts/check-baseline-coverage-ratchet.ts

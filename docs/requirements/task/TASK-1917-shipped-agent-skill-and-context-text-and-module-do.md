---
id: TASK-1917
type: task
role: plan
title: "Shipped agent, skill and context text and module docs name start, finish and the kinds (AC-DCS1-24)"
status: draft
priority: high
phase: "P3 Shipped text and plan close"
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: PLAN-243
plan: PLAN-243
links:
  - {id: TASK-1949, type: supersedes}
  - {id: TASK-1924, type: blocks}
---
Covers: AC-DCS1-24.
TDD-Role: red then green, tests first in this task
Approach: describe the new flow once in `assets/agents/lore-implementer.md` (the lifecycle protocol: `lore start`, `lore finish --red` before implementing, `lore finish`, then the orchestrator's `lore integrate` and `lore done`; `lore claim --worktree` stays for a worktree the harness made; `--write-set`; kinds; `lore approve --red-waiver`) and in `assets/context/corpus-workflow-3-execute.md`; the other files get one short sentence or their stale lines removed (`--declare-no-new-tests`, `lore red-first`, no-branch claims, `[Skill:test]` red tasks, the MCP server). `assets/agents/lore-implementer.md` holds, exactly once, the sentence ``Run `lore finish` once every oracle is ready; it runs them for you.`` (the stored falsifier of AC-DCS1-24 replaces it; the file names `lore finish` elsewhere too, which is why the falsifier is a whole unique sentence). Keep the shipped text within its memory-file budgets and free of the patterns that `scripts/agent-hygiene-allowlist.json` scans for (AC-AU-6). Regenerate `packages/lore/src/generated/assets-manifest.ts` with the repository's own generator (`bun run build` regenerates it) so the co-change rule holds. Stage 2 verbs (`dispatch`, `land`) are NOT named. Stage 1 has no fold, so `assets/agents/lore-implementer.md` and `assets/context/worktree-dispatch.md` each state the one orchestrator step: after a task finishes, fold its branch into the integration branch before the next chained task claims, with `git -C <int-worktree> merge --ff-only <branch>` (otherwise the next task is refused for overlap, AC-DCS1-18); a worktree for the next task is cut at main and the integration branch merged in afterwards until BR-1353 as modified lands.
Tests first, in this task and this worktree (D33: no separate red task and no pass row that proves nothing). Under TODAY's rules: (1) write the tests of your owned criteria in `packages/lore/tests/unit/shipped-done-contract-text.test.ts` (each test name starts with `AC-DCS1-<n>:` with the colon, so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10; each asserts every item of its criterion through the compiled `dist/lore` on a throwaway repo and corpus, `makeCleanTreeRepo`, `patchLoreConfig`, `FIXTURE_HOME_OUTSIDE_REPO`, never this repository's own `.lore/`: exact exit code, refusal name, stored data, and the criterion's own false-green case) and commit them; (2) capture the red of every owned AC command with `lore evidence <task> --oracle test --command "<the AC command>" --result expected-fail --capture` (BR-1077: the runner summary must show failed tests; a run that could not start is not a red); (3) implement; (4) `lore verify` each owned AC; (5) record an attested UNFILTERED whole-file pass of `packages/lore/tests/unit/shipped-done-contract-text.test.ts` (`lore evidence <task> --oracle test --command "bun run test:file packages/lore/tests/unit/shipped-done-contract-text.test.ts" --result pass --capture`, no `-t`). The file holds only the tests of the tasks before and including this one, so it passes whole at every task's tip. The MCP server no longer exists: no test may start it. Every stored falsifier literal named below must occur exactly once in its file (the falsifier replaces the first occurrence only).
This task lands in the same integrate as P1 to P3 (it does not wait for J5). Done when: AC-DCS1-24 passes and is attested; its test file `packages/lore/tests/unit/shipped-done-contract-text.test.ts` passes unfiltered and is recorded; `bun run typecheck` passes; the memory-file budget checks of `lore status` pass for the touched CLAUDE.md files.

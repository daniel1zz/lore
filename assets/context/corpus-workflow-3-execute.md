---
id: corpus-workflow-execute
title: "EXECUTE — claim before you work, evidence over assertion"
inject: [launch]
---
## EXECUTE — claim before you work, evidence over assertion

- `lore ready <plan> --json` (readiness / sessions / anchor_conflicts), then pick a ready task. Its done contract (compiled at approve) fixes its kind: `code`, `check` or `corpus`, and the oracles it must pass.
- One flow per kind. `code`: `lore start <task>` (worktree + branch + install + claim + contract; `lore claim <task> --worktree <branch>` only for a worktree the harness made; `--write-set` names the files it will touch), `lore finish --red <task>` before implementing, `lore finish <task>` once every oracle is ready, then `lore land <task>` (folds into the plan's integration branch, or integrates into main, archives and cleans up). `check` and `corpus`: `lore finish <task>` from the shared checkout, no worktree, no claim. The orchestrator prints a subagent prompt with `lore dispatch <task>`.
- A code task's contract requires the red run (`red_required` true) unless the user waived it at approve with `lore approve <task> --red-waiver "<reason>"`; a migrated task's waiver is passed as `lore migrate done-contract --apply --red-waiver <slug>=<reason>`.
- `lore integrate` (through `lore land`) runs the contract oracles of the landing tasks once on the exact tree that becomes main and records the rows; no per-task whole-file run is needed for a task with a contract. A failing oracle is re-run once and a pass is flagged flaky. Landings queue FIFO. A plan closes itself when its last task archives.
- External oracles only (tsc / test / browser); never let an LLM self-grade its own work.
- Re-query shared mutable state (claims, readiness, sessions, sibling-plan progress) in the turn you assert it: an earlier query result is a snapshot, never current state. Re-query before any "still open" / "currently claimed" claim.
- Never discard lore's stdout (`lore set|approve|reject|claim|release|evidence|invalidate|archive` print state transitions and gate preconditions); trim with `| tail -3`, never redirect it away. Editing an approved doc demotes it to `draft` and silently blocks every downstream `task-claim` (`UPSTREAM_NOT_APPROVED`) until re-reviewed and re-approved.
- `lore finish` records the oracle rows itself (the runner spawns each command and records ITS output). For other evidence: `lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual> --command "<cmd>" --result pass --capture` (a hand-authored `--output-tail`/`--output-tail-file` with `--result pass` is refused, except `--oracle manual`). For script-bound ACs prefer `lore verify <plan>`.
- Measure an oracle's exit code WITHOUT a pipe: `<cmd> > out.log 2>&1; echo $?`.
- `lore release <task>` drops the lease only; it does not archive and does not remove the task from the ready set. Never hand-mark readiness.
- `lore done <task>` alone walks `approved → active → archived` on the stored contract, run by whoever can assert the work is landed (`lore land` does it). A task that cannot meet its contract goes through a contract amendment, never a waiver at archival.

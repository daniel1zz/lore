---
id: corpus-workflow-execute
title: "EXECUTE — claim before you work, evidence over assertion"
inject: [launch]
---
## EXECUTE — claim before you work, evidence over assertion

- `lore ready <plan> --json` (readiness / sessions / anchor_conflicts), then pick a ready task.
- External oracles only (tsc / test / browser); never let an LLM self-grade its own work.
- Re-query shared mutable state (claims, readiness, sessions, sibling-plan progress) in the turn you assert it: an earlier query result is a snapshot, never current state. Re-query before any "still open" / "currently claimed" claim.
- Never discard lore's stdout (`lore set|approve|reject|claim|release|evidence|invalidate|archive` print state transitions and gate preconditions); trim with `| tail -3`, never redirect it away. Editing an approved doc demotes it to `draft` and silently blocks every downstream `task-claim` (`UPSTREAM_NOT_APPROVED`) until re-reviewed and re-approved.
- Oracle passes → `lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual> --command "<cmd>" --result pass --capture` (the runner spawns `--command` itself and records ITS output; a hand-authored `--output-tail`/`--output-tail-file` with `--result pass` is refused, except `--oracle manual`). Record RED runs as `--result expected-fail --capture`. For script-bound ACs prefer `lore verify <plan>`.
- Measure an oracle's exit code WITHOUT a pipe: `<cmd> > out.log 2>&1; echo $?`.
- `lore release <task>` drops the lease only; it does not archive and does not remove the task from the ready set. Never hand-mark readiness.
- `lore done <task>` alone walks `approved → active → archived`, run by whoever can assert the work is merged into main; an implementer in its own worktree stops at `release`.

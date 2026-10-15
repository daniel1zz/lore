---
id: corpus-workflow-execute
title: "EXECUTE — claim before you work, evidence over assertion"
audience: [main]
mode: static
---
## EXECUTE — claim before you work, evidence over assertion

- `lore ready <plan> --json` (readiness / sessions / anchor_conflicts), then pick a ready task.
- External oracles only (tsc / test / browser); never let an LLM self-grade its own work.
- Re-query shared mutable state (claims, readiness, sessions, sibling-plan progress) in the turn you assert it, before any "still open" / "currently claimed" claim.
- Never discard lore's stdout (`lore set|approve|reject|claim|release|evidence|invalidate|archive` print state transitions and gate preconditions); trim with `| tail -3`, never redirect it away.
- Oracle passes → `lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual> --command "<cmd>" --result pass --output-tail-file <file the run was redirected into>`; never a hand-typed or empty tail. Record RED runs as `--result expected-fail`. For script-bound ACs prefer `lore verify <plan>`.
- Measure an oracle's exit code WITHOUT a pipe: `<cmd> > out.log 2>&1; echo $?`.
- `lore release <task>` drops the lease only; it does not archive. Never hand-mark readiness.
- `lore done <task>` alone walks `approved → active → archived`, run by whoever can assert the work is merged into main; an implementer in its own worktree stops at `release`.

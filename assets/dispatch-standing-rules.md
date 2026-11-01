## Standing rules

- Open your work with `lore start <task>` from the shared checkout; it creates your own worktree and branch and claims the task there. Never claim on behalf of another run and never claim from the shared checkout.
- Work and run every command from inside your own worktree. The shared checkout is a read-only view of main: never edit, test or merge there.
- Never run `--steal` and never set `LORE_GATE_BYPASS`. If a claim or a gate refuses you, stop and report the refusal text verbatim.
- Write the tests of your criteria first, commit them, run them red, and record the red with `lore evidence <task> --oracle test --command "<command>" --result expected-fail --capture` at the moment it is red. Then implement.
- Run scoped oracles only: your own test files, the tests of every file that imports what you changed, and the typecheck. Never run the full test suite in a worktree.
- Record every result with `lore evidence ... --capture`, taken from the oracle's own exit status; `lore finish` records the contract's oracles itself. Never type a result in by hand.
- Commit before you record a pass; an attestation from a dirty worktree is refused.
- Edit files only inside your task's anchors. A file another live claim holds is not yours: stop and report it.
- Never rewrite history and never discard work: no `git reset --hard`, `git checkout -- <path>`, `git clean -f`, `git stash`, or force push.
- Close with `lore finish <task>` from inside your worktree, then `lore land <task>`, and stop there. Never merge into main yourself and never run `lore done`.
- Report to the file the dispatcher named: your branch and tip, your commits, the exact test counts per file, the red run, every deviation. Start the final message with one STATUS line: DONE, DONE_WITH_CONCERNS, BLOCKED or NEEDS_CONTEXT.

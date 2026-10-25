---
id: TASK-1707
type: task
role: plan
title: "A corpus-writing script ignores unknown arguments, so --help ran the real migration"
status: deprecated
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Incident 2026-10-19 14:05 (session 482f1e89): `bun scripts/strip-site-map-excuses.ts --help` ran the REAL corpus migration (128 leaf versions, 25,819 site-map values removed) because the script ignores unknown arguments (main() only looks for --lore and --dry-run). The outcome happened to be the planned P2 step, verified afterwards (0 non-BR values, 1,356 BR-n kept, no leaf status changed), but it ran before the operator's final pre-checks.

End state: a script under scripts/ that writes the corpus refuses any argument it does not define (exit 2, naming the argument and listing the accepted ones) and answers --help without side effects; enforced for every corpus-writing script, not only this one (e.g. a check: step scanning scripts/*.ts that spawn a lore write verb for a strict argument parser).

AC: `bun scripts/strip-site-map-excuses.ts --help` and `... --bogus` each exit without spawning lore (exit 0 for --help printing usage, exit 2 for --bogus naming it), on a throwaway corpus whose site maps are unchanged afterwards.

---
id: TASK-1712
type: task
role: plan
title: "A corpus-writing script ignores unknown arguments, so --help runs the real migration"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"scripts","tags":["corpus-write","argv"],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"f63ee03d-f5d4-435e-a5ed-b9b9ac4c168b"}
---

scripts/strip-site-map-excuses.ts writes the corpus (lore baseline map per leaf) and its main() only looks for --lore and --dry-run; any other argument is silently ignored. On 2026-10-19 14:05 (session 482f1e89) `bun scripts/strip-site-map-excuses.ts --help` ran the real migration on this repository's corpus (128 leaf versions, 25,819 site-map values removed). The result happened to be the planned step, but it ran before the operator's final checks. Reproduced safely with --dry-run on 2026-10-19: --help and an invented --bogus are both ignored and the plan runs.

**Expected:** A script that writes the corpus answers --help with usage and no side effects (exit 0), and refuses any argument it does not define (exit 2 naming it and listing the accepted ones), before spawning lore; enforced for every corpus-writing script under scripts/, not only this one.
**Actual:** `bun scripts/strip-site-map-excuses.ts --help --dry-run` exit 0, prints '0 leaf/leaves would change' (the plan, not usage); `bun scripts/strip-site-map-excuses.ts --bogus --dry-run` exit 0, same output. Without --dry-run the same invocation writes the corpus.
**Repro command:** `bun scripts/strip-site-map-excuses.ts --bogus --dry-run; echo $?`

Reported by: agent:session-482f1e89

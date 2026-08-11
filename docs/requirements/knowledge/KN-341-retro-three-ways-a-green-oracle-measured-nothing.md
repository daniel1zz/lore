---
id: KN-341
type: knowledge
role: knowledge
title: "Retro — three ways a green oracle measured nothing (suite short-circuit, wrapper exit code, attested tail eviction)"
status: approved
priority: medium
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-104
---
Three oracle-integrity defects observed while closing
`plan-fix-dashboard-no-open-inert-nonce-failure-page-f5a-defects`. All three share one
shape: **a green signal that never measured what it claimed to.** They belong to the same
family as the five false-oracle vectors in CLAUDE.md.

## F1 — `bun run test` short-circuits, so "full suite green" can mean half the suite never ran

`"test": "bun run test:vitest && bun run test:bun"`. A vitest failure — including a purely
environmental one — makes `&&` skip the ENTIRE bun stage. Measured this session: the run
reported `Test Files 1 failed | 386 passed` and stopped; `grep -c "Ran N tests across"` over
the log returned **0**, i.e. not a single `.bun.test.ts` file executed. The change under
test was covered exclusively by bun-runner files, so the "full suite" verdict carried zero
information about it.

The two failures were `hooks/session-start-freshness.test.ts` timing assertions
(`expect(elapsedMs).toBeLessThan(100)`, measured 106.8ms / 156.8ms) under concurrent load —
they re-ran 13/13 green in isolation. So a flaky wall-clock assertion in an unrelated module
silently voided the other runner's entire verdict.

Discipline: after any `bun run test`, assert BOTH stages reported — a vitest summary AND a
`Ran N tests across M files` line. Exit code alone cannot distinguish "bun stage passed"
from "bun stage never started". Prefer running the stages independently when the verdict
matters.

## F2 — a wrapper that appends the exit code makes the harness report the WRAPPER's status

`cmd > out 2>&1; echo "EXIT=$?" >> out` always exits 0 (the `echo` succeeds), so the
background-task completion notification announced "exit code 0" for a suite that had in fact
exited 1. The real code was only visible inside the file. Verified twice this session (the
second time it was correct, which is exactly what makes the pattern dangerous — it is right
until it isn't).

Discipline: when a runner's exit code is the verdict, read it back from the file you wrote
it to; never accept the wrapper's own status as the measurement. CLAUDE.md's
"exit code not measured through a pipe" rule extends to this `;`-separated form.

## F3 — `lore verify`'s attested `output_tail` can drop the very summary it exists to prove

`verify-executor.ts:150` records `tailChars(stdout + stderr, 4000)`. Concatenation puts
stderr LAST, so when a harness writes progress/banners to stderr and its result summary to
stdout, the retained tail is banner text and the summary is discarded.

Measured on this plan's AC-F5A-8 record: `output_tail` is 1311 chars and ends with
`[e2e globalSetup(static)] Running 'bun run build'...` / `Lore server running at ...` /
`Dashboard ready: ...`. The playwright verdict (`Running 2 tests using 1 worker` / `2 passed`)
is nowhere in it. The AC passed — independently re-confirmed by running the command directly
(5 / 2 / 2 matched tests for AC-F5A-1 / F5A-2 / F5A-8) — but the ATTESTED RECORD cannot show
that any test matched at all.

This is a direct contradiction of the repo's own standing rule ("after any path/`-t`-filtered
run, assert the matched count"): the mechanism meant to make evidence trustworthy is exactly
where the matched count gets thrown away. A zero-match filtered run exits 0 and would produce
an equally clean-looking attested record.

Secondary defect on the same line: the retained banner text embeds
`LORE_DASHBOARD_URL=http://localhost:8787/auth/bootstrap?nonce=<uuid>`, so a launch nonce is
persisted verbatim into the corpus. Single-use and 60s-TTL make the blast radius small, but
transient secrets should not land in a shared knowledge base at all.

Candidate fixes (NOT implemented — needs its own slice): retain a head+tail window rather
than a pure tail; or capture the tail of stdout and stderr SEPARATELY so neither can evict
the other; and scrub `nonce=` query values before persisting.

## Status

F1 and F2 are discipline items, applicable immediately. F3 is a product defect in
`lore verify` itself and needs a scoped fix; recorded here rather than patched inline
because it is out of scope for the plan that surfaced it.

---
id: KN-265
type: knowledge
role: knowledge
title: "grep in the agent shell is ugrep --ignore-files and its blind spot does not match git check-ignore: a zero-hit result proves nothing"
status: approved
priority: high
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
## The finding

In the Claude Code agent shell, `grep` is not `grep`. It is a shell function that
execs `ugrep -G --ignore-files --hidden -I --exclude-dir=.git …`. Its skip set is
**not derivable from `git check-ignore`**, so a file that git tracks and does not
ignore can still be invisible — silently, as a clean exit 1 that is
indistinguishable from "the pattern is genuinely absent".

Every conclusion of the form *"grep found zero hits, therefore X does not exist"*
is unsound when made with the wrapper.

## Measured, 2026-08-01

```
$ type grep
grep is a shell function from ~/.claude/shell-snapshots/snapshot-zsh-….sh

$ grep -c "" packages/lore/src/store/in-memory-store.ts     # wrapper
(no output)                                          exit 1

$ /usr/bin/grep -c "" packages/lore/src/store/in-memory-store.ts
1095                                                 exit 0
```

The function body:

```zsh
ARGV0=ugrep "$_cc_bin" -G --ignore-files --hidden -I \
  --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg \
  --exclude-dir=.bzr --exclude-dir=.jj --exclude-dir=.sl "$@"
```

And the file is not ignored by git at all:

```
$ git ls-files --error-unmatch packages/lore/src/store/in-memory-store.ts  → TRACKED
$ git check-ignore -v packages/lore/src/store/in-memory-store.ts           → exit 1 (not ignored)
```

That divergence is the dangerous part. If the blind spot tracked `git
check-ignore`, an author could reason about it. It does not, so **which files are
invisible is not predictable from the repository's own configuration** — the only
safe assumption is that any zero-result from the wrapper may be a false negative.

## How it surfaced

A dispatched implementer caught it only because a `grep` result contradicted a
`Read` of the same file, and it re-verified its writer-less-field findings with
`/usr/bin/grep`. Nothing in the tooling announced the skip.

The orchestrator had, earlier in the same session, used the wrapper for two
DECISION-CRITICAL absence claims:

- `grep -rn attestation_exempt packages/lore/src/adapters` → 0 hits, used to
  conclude the sanctioned exemption had no writer, which is what justified
  building `lore plan exempt-attestation`;
- `grep -rn adhoc <verify surfaces>` → 0 hits, used to conclude the ad-hoc task
  channel is structurally unreachable from `lore verify`.

Both were re-run with `/usr/bin/grep` and **both held**. That is luck, not
method: the wrapper's zero was correct in these two cases and there was no way to
know that at the time.

## Mechanization

1. **Any source scan whose CONCLUSION rests on absence uses `/usr/bin/grep`** (or
   `rg`), never the bare `grep` in this shell. Presence claims are safe — a hit is
   a hit; it is the zero that lies.
2. **A zero-hit result is not evidence until re-run with an absolute-path grep.**
   Treat "grep found nothing" the way a negative test result is treated: confirm
   the instrument can detect a positive. Cheapest control — grep the same pattern
   somewhere it is known to appear, in the same invocation style.
3. Tests that scan source (`AC-061-14`'s no-duplicate scan, `AC-069-12`'s
   writer-exists audit, the `AC-LL-10` call-site pin) are **not** affected: they
   read files through Node `fs` inside vitest, not through the shell. The hazard
   is agent shell reasoning, not the mechanized scans — which is an argument for
   moving any absence claim that matters INTO such a scan rather than leaving it
   in a session transcript.

## Standing form

> `grep` in the agent shell is `ugrep --ignore-files`, and its blind spot does not
> match `git check-ignore`. A zero-hit result proves nothing until re-run as
> `/usr/bin/grep`.

## Source

Caught by the implementer of `task-escalated-recommended-2026-07-24-still-unbuilt-attestation`,
2026-08-01, and confirmed by the orchestrator against the shell-snapshot function
body. Not a lore defect and not distribution-first — it is a property of the agent
harness, so it belongs in the standing-lessons layer, not in an `assets/` pipe.

---
id: KN-558
type: knowledge
role: knowledge
title: "A correction asserting an oracle's strength is itself an unverified claim, and test:changed can demand a build a worktree agent must refuse"
status: approved
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
links:
  - {id: SPEC-153, type: relates-to}
  - {id: KN-546, type: relates-to}
---
Findings from landing SPEC-153. ⛔ This document has been REWRITTEN once: its first version's
central example was itself wrong, in exactly the way the finding warns about. That history is
kept below rather than tidied away, because the second error is the better evidence.

## F1 — A correction that asserts an oracle's strength is itself an unverified claim

Measured 2026-08-25 on `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by`, three
rounds deep.

**Round 1 — the miscount.** The spec's S1 said `list.ts` had FIVE `--json` emit sites, three of
them wide. The implementing agent measured SIX with FOUR wide (`grep -c 'args.json'` = 6 on a
NUL-free `list.ts`); the uncounted one was `--governed-by`. An author's hand-enumeration had
silently become the criterion's blind spot — the failure
`knowledge-five-findings-from-planning-the-github-read-side-a` already records.

**Round 2 — the correction that reassured.** I wrote:

> AC-MOS-1 survived it only because it asserts a property of EVERY branch rather than a list of
> branches.

FALSE, and the spec review caught it: AC-MOS-1's operative oracle IS a list of five enumerated
invocations, none of which named `--governed-by`. ⛔ The general shape: **a correction paragraph
is a new claim and inherits none of the credibility of the error it corrects.** Admitting a
mistake feels like the verification step and is not one. Watch specifically for the clause that
reassures the reader the damage was contained — "fortunately X already covered this" — because
that is the part nobody re-measures.

**Round 3 — the evidence FOR round 2 was also false, and this is the real finding.** I then
"confirmed" the gap by running `grep -c governed` over both criterion test files and getting 0
from each. On that basis I rewrote the spec, widened the AC, and opened a whole task to add
coverage that ALREADY EXISTED. What the grep actually did is F2.

⛔ So the lesson survived three rounds while every instance of it I produced was wrong. That is
not an argument against the lesson; it is the measurement of how cheap it is to write a confident
correction and how expensive it is to verify one. The durable output is not this prose — it is
that AC-MOS-1 now names its invocation count as load-bearing and enumerates six.

## F2 — One committed NUL byte silently blinds every grep-shaped oracle over its file

The finding that generated F1's third round, and the most reusable thing here.

`packages/lore/tests/integration/list-json-row-contract.test.ts` carried a raw NUL at byte offset
15160 (`keys.join("\0")` inside a `distinctKeySets` helper). Measured on main before the fix:

| probe | result |
|---|---|
| `file(1)` | `data` — not `text` |
| NUL bytes | 1 |
| occurrences of `governed`, counted on the raw bytes in Python | **10** |
| `grep -c governed <file>` | **no output, exit 1** |

⛔ BSD grep classifies the file as binary and suppresses every match **without printing the
`Binary file … matches` line**. The observable result is byte-identical to "the pattern is not in
this file". There is no tell. A structural oracle, a census, a coverage check, a pre-dispatch
sanity grep — all of them return a confident, wrong zero.

⛔ The control that distinguishes them exists and costs nothing: count on the raw bytes
(`python3 -c "print(open(f,'rb').read().count(b'pat'))"`), or check `file(1)` first. ⛔ A
`grep -c` returning 0 over a file you did not confirm is text is not a measurement.

**The repo's guard exists, works, and I still shipped past it.** `scripts/check-no-nul-bytes.ts`
exits 1 naming the file and the offset, with a remediation message; `scripts/tests/check-no-nul-bytes.test.ts`
scans the whole tracked tree and was RED on main from the moment the file landed. I merged that
file on the strength of targeted per-file runs and never ran the suite, so a guard that was
working perfectly told nobody. ⛔ `hooks/pre-push` runs six checks and NONE is a test — that is
documented in the root CLAUDE.md ("a test-shaped oracle is push-invisible until something INVOKES
it"), and this is what it costs in practice: the only invoker of the NUL guard is the suite, and
the merge protocol's "scoped oracles only in the worktree" rule means nobody runs the suite until
the orchestrator does.

⛔ Also worth knowing before designing a fix: the checker's own message says a NUL inside git's
first-8000-byte binary-sniff window makes the whole file unreviewable (`git show --stat` reports
`Bin 0 -> N bytes`, no diff). This one sat at 15160, past that window, so the diff rendered
normally and review saw nothing unusual. **The blast radius of a NUL depends on its offset**, and
the quiet case is the one that got through.

## F3 — `bun run test:changed` can demand a build, which a worktree agent must refuse

Measured 2026-08-25 by the implementing agent. On a change to
`packages/lore/src/adapters/cli/commands/list.ts` — a high-fan-in CLI surface — `bun run
test:changed` selected **181 files** and reported **`build-first: yes`**.

The agent refused, correctly: `bun run build` is the orchestrator's step, and a stale `dist/lore`
makes any spawning test measure a DIFFERENT commit than the one under test. It hand-picked direct
consumers instead and reported what it ran.

⛔ The root CLAUDE.md warns that `test:changed` UNDER-selects and OVER-selects. It does not say
the tool can emit a `build-first` requirement a worktree agent is forbidden to satisfy. In that
state the repo's designated deterministic worktree oracle has **no legal invocation at all** —
not slow, not noisy: unavailable — and the fallback is the hand-picked judgement the tool exists
to remove.

⛔ Unenforced gap: nothing tells a dispatching orchestrator, at bundle-writing time, that a task's
anchor is high-fan-in enough to trip `build-first`. The bundle promises an oracle the agent will
discover it cannot run. NOT BUILT.

## F4 — AC-MOS-1's six invocations reach only five distinct emit sites

Measured by the implementing agent with a per-site mutation sweep — reverting each
`toListJsonRows` call site in turn and recording which cases reddened:

| site | branch | cases reddened |
|---|---|---|
| 439 | `--governed-by` | 1/13 |
| 565 | `--phase` | 3/13 |
| 607 | `--type task` | 4/13 |
| 659 | `--include-invalid` | 5/13 |
| 705 | `--plan-id` alone | 1/13 |

⛔ `--type task --plan-id <p>` is absorbed by the `--type task` branch (607) and never reaches
705: mutating 607 reddens that capture, mutating 705 does not. So the AC's six invocations cover
five distinct sites, and the sixth site is reached only by the BARE `--plan-id` invocation the AC
does not name. The enumeration is still one short of the closed set it claims — the same defect
as round 1, one layer down. Corrected in the AC after this measurement.

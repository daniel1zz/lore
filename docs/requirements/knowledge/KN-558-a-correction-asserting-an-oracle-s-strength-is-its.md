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

## F5 — the NUL guard is blind at exactly the moment an agent consults it, which closes F2's loop

Measured 2026-08-25 with a paired probe. A file containing one raw NUL, placed under
`packages/lore/src/`:

| state | `bun scripts/check-no-nul-bytes.ts` |
|---|---|
| UNTRACKED | **exit 0** — "3410 tracked file(s) considered, zero raw NUL bytes in any text-source file" |
| the SAME file, staged | **exit 1** — names the file |

The checker scans git-TRACKED files only. So an implementer who authors a NEW file and runs the
guard before committing gets a green that says **nothing about the file they just wrote**, and the
green's own wording ("3410 tracked file(s) considered") reads as thorough.

⛔ This is how F2's NUL reached `main`. The sequence is not a lapse by any one actor:

1. the implementing agent authored a new test file containing a raw NUL;
2. any pre-commit run of the NUL guard was vacuous, because the file was untracked;
3. the worktree protocol says agents run SCOPED oracles only, so nobody ran the suite that would
   have caught it;
4. the orchestrator merged on the strength of targeted per-file runs — and `hooks/pre-push` runs
   six checks, none of which is a test.

Every step followed the documented rule. The defect is that the guard's ONE reliable invoker (the
vitest suite) is the one nobody is supposed to run until after the merge.

⛔ Unenforced gap, NOT BUILT: the checker should consider untracked-but-would-be-tracked files, or
say out loud how many candidate files it skipped for being untracked. A count of what was
CONSIDERED, with no count of what was SKIPPED, is the same shape as F2's silent grep — an
affirmative report over a question that was never asked.

## F6 — `--output-tail`'s window structurally cannot carry a multi-conjunct attribution

Measured by the implementing agent on AC-MOS-6's red probe. `lore evidence --output-tail-file`
retains the LAST 4000 characters. vitest prints its compact per-assertion failure list FIRST and
then expands each failure. For a soft-assertion oracle with 17 failures, the tail therefore holds
the last three expansions plus the summary — and the verdict the criterion actually asked for
("(a) and (b) red while (c) still green") falls outside the window BY CONSTRUCTION, not by
truncation bad luck.

Alternatives measured and rejected: `--reporter=dot` still emits full expansions (18.9 KB);
`--reporter=github-actions` gives one line per failure (14.1 KB) but emits NO runner summary line,
which violates the standing rule that an evidence tail must carry one.

⛔ Consequence to state plainly rather than paper over: that evidence row proves the oracle went
red. It does NOT prove which conjuncts. The agent recorded the unedited output rather than curate
an excerpt — correct, because a curated tail is indistinguishable from a flattering one — and
reported the attribution separately, where it is prose rather than evidence. ⛔ The mechanism this
wants is a head+tail window, or a per-assertion structured result; neither exists. NOT BUILT.

## F7 — I steered three agents into self-reported reds by prescribing the wrong flag

Measured at this plan's `lore assess`, which raised it as a MAJOR and was right. Across the
plan's four tasks:

| task | expected-fail rows | attested |
|---|---|---|
| row contract | 2 | 0 |
| argv parser | 5 | 0 |
| narrowed prune scope | 1 | 0 |
| `--governed-by` coverage | 1 | **1** |

Eight of nine reds are `capture_source: self-report`. The plan's own text required an attested
expected-fail per criterion; it got one.

⛔ **The cause is a bundle-authoring error of mine, not agent laziness.** An early agent reported,
correctly, that `lore evidence --result expected-fail` is REFUSED without a tail. I turned that
into a bundle instruction:

> `lore evidence … --result expected-fail --command "<cmd>" --output-tail-file <file>`

and copied it into every later bundle. `--output-tail-file` satisfies the tail requirement and
records `capture_source: self-report`. `--capture` ALSO satisfies it, spawns `--command` itself,
and records `capture_source: runner` with a real `exit_code` — for ANY `--result`, red included.
The one attested red in the table came from the agent that did not follow my template.

⛔ The rule, stated so the next bundle carries it: **a red probe records with `--capture`, with the
mutation IN PLACE while the command runs. ⛔ Never `--output-tail-file` for a red** — that is a
self-report, and a self-reported red is precisely what the red-first discipline exists to replace.
`--capture` and `--output-tail*` are mutually exclusive, so this is a choice, not an oversight one
can make in both directions.

⛔ Second-order, and the reason this is worth a whole finding: the incomplete report was TRUE.
"expected-fail is refused without a tail" is a correct measurement. What made it harmful was
promoting a true observation about ONE flag into a prescription, without checking whether a better
flag satisfied the same constraint. A measurement answers the question it was asked; a
prescription answers a question nobody measured.

## F8 — two of this plan's four assess findings were backwards, and one was the most valuable output

Machine-checked every finding that named a path, per the standing rule:

- MAJOR "every attested row is a pass, all mutation reds self-reported" — **CORRECT**, and it is F7.
- minor "AC-MOS-1's label set may be asserted by count rather than equality" — **BACKWARDS**.
  `packages/lore/tests/integration/list-json-row-contract.test.ts:628` reads
  `expect([...pinnedEmitSites.keys()].sort()).toEqual(PINNED_LABELS)` — equality, exactly as the
  criterion demands.
- minor on AC-MOS-6's tail attribution — correct; it is F6.
- minor on `.lore/export-index.json` sitting outside both tasks' file anchors — correct and
  expected; it is a generated corpus artifact the orchestrator commits, not task work.

⛔ Two of four survive. That ratio is why the rule is "machine-check every finding that names a
path" rather than "weigh the judge's confidence": path existence and a line's content are
decidable, and deciding them costs one command each.

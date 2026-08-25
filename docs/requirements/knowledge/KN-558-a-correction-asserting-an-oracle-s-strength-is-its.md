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
Two findings from landing SPEC-153's first task. Both are new to the corpus — the other four
things this session measured turned out to be already recorded, and finding that out AFTER
measuring them is itself the reason the first item below matters.

## F1 — A correction that asserts an oracle's strength is itself an unverified claim

Measured 2026-08-25 on `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by`.

The spec's S1 said `list.ts` had FIVE `--json` emit sites, three of them wide. The implementing
agent measured SIX with FOUR wide — `grep -c 'args.json'` and `grep -c 'console.log(JSON.stringify'`
both return 6 — the uncounted one being the `--governed-by` branch. My hand-enumeration had
silently become the criterion's blind spot, which is the failure
`knowledge-five-findings-from-planning-the-github-read-side-a` already records.

⛔ **The interesting part is the correction I then wrote, not the miscount.** It said:

> AC-MOS-1 survived it only because it asserts a property of EVERY branch rather than a list of
> branches; had it enumerated the five, the sixth would have shipped wide and the AC would have
> certified it.

That sentence is FALSE, and the spec review caught it on the next pass. AC-MOS-1's operative
oracle IS a list — five enumerated invocations, none of which reaches `--governed-by`. Confirmed
by the grep I had not run:

| probe | result |
|---|---|
| `grep -c governed packages/lore/tests/integration/list-json-row-contract.test.ts` | **0** |
| `grep -c governed packages/lore/tests/integration/list-json-real-corpus-buffer.test.ts` | **0** |
| `list.ts` header after the fix | declares SIX projected emit sites |

So the code was correct and the oracle could not see it: reverting the `--governed-by` emit site
to `fullDocs` would have left AC-MOS-1 GREEN, and the AC would have certified its own gap.

⛔ Generalised: **a correction paragraph is a new claim, and it inherits none of the credibility
of the error it corrects.** Admitting a mistake feels like the verification step and is not one.
The specific shape to watch for is a correction that ends by reassuring the reader the damage was
contained — "fortunately X already covered this" — because that clause is exactly the part nobody
re-measures. Here the reassurance took one grep to refute and I wrote it without running that grep.

⛔ Mechanism, NOT prose: the criterion was widened from five enumerated invocations to six, and
the count is now called out IN the AC as load-bearing. The durable form is that an AC over "every
branch of X" must either enumerate a set it proves closed, or assert a property no enumeration
mediates. AC-MOS-1 is the first kind and now says so.

## F2 — `bun run test:changed` can demand a build, which a worktree agent must refuse

Measured 2026-08-25 by the implementing agent inside its worktree. On a change to
`packages/lore/src/adapters/cli/commands/list.ts` — a high-fan-in CLI surface — `bun run
test:changed` selected **181 files** and reported **`build-first: yes`**.

The agent refused to run it, correctly: `bun run build` is the orchestrator's step, and a stale
`dist/lore` makes any spawning test measure a DIFFERENT commit than the one under test. It
hand-picked direct consumers instead (`list-paging`, `list-plan-membership`,
`list-validity-visibility`, `dispatch-validity-visibility`, `list-sub-type-*`,
`scripts/tests/mirror-status-parity.test.ts`, `scripts/check-unclaimed-oracle.ts`) and reported
what it ran.

⛔ The root CLAUDE.md already warns that `test:changed` UNDER-selects and OVER-selects. It does
NOT say the tool can emit a `build-first` requirement that a worktree agent is forbidden to
satisfy. In that state the repo's designated deterministic worktree oracle **has no legal
invocation at all** — not slow, not noisy: unavailable. The fallback is hand-picked consumers,
which is exactly the judgement the tool exists to remove.

⛔ Recorded as an unenforced gap: nothing tells a dispatching orchestrator, at bundle-writing
time, that the task's anchor is high-fan-in enough to trip `build-first`. The bundle promises an
oracle the agent will discover it cannot run. NOT BUILT.

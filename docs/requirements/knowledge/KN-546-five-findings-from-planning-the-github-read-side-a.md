---
id: KN-546
type: knowledge
role: knowledge
title: "Five findings from planning the GitHub read side: a refusal can promise a phase no spec declares"
status: approved
priority: high
created: 2026-08-24
updated: 2026-08-25
tags: [defect-channel, governance, oracle-design, handoff-hygiene]
parent: PRD-001
links:
  - {id: SPEC-150, type: informs}
  - {id: SPEC-145, type: informs}
---
## Context

Measured 2026-08-24 while planning `spec-a-github-filed-defect-must-be-claimable-one-ingest-seam` — the phase that closes the GitHub defect channel's read side. Every figure below was produced by a command run in that session, not carried from a handoff. Two of the five findings CONTRADICT the handoff that opened the session (`knowledge-handoff-agent-main-orchestrator-127`), which is itself finding F5.

## F1 — A refusal message can promise a "later phase" that no spec defines, and nothing refuses that

Three production refusal sites tell the caller their case is "a later phase of `spec-the-defect-channel-reaches-no-machine-but-its-own-github`":

- `packages/lore/src/adapters/cli/commands/issues.ts:346-347`
- `packages/lore/src/adapters/cli/commands/report-issue.ts:326-327`
- `packages/lore/src/adapters/mcp/tools.ts:2927`

That spec's Migration Plan table stops at **P5**, and no phase in it ever carried either the GitHub-backed read source or the MCP filing path. The promise resolves to nothing. `lore issues` exits 4 and names a phase that does not exist; an agent reading that message concludes the work is scheduled, when in fact nobody ever wrote it down.

**Mechanism**: a phase name inside an error string is free text. Nothing joins a refusal message against the phase set its cited spec actually declares, so the deferral is unfalsifiable — it reads as governed while being ungoverned. This is the "must not lie" property failing at the message layer rather than the verdict layer.

**What would refuse it**: a scan that extracts a cited `spec-*` slug from any refusal string under `packages/lore/src` and asserts the accompanying phase reference resolves against that spec's declared phases. NOT BUILT — recorded here as an unenforced gap, not as a resolved one.

## F2 — Run a structural oracle BEFORE declaring it; declaring first hides the sites the anchor list omits

`AC-GR-8` scans for the refusal wording. The plan going in named TWO sites, taken from the prior handoff. Running the candidate command before recording it as an AC returned **5 matches across 3 files** — the third being `adapters/mcp/tools.ts`, a whole surface the two-site list never mentioned and which the spec's own anchors would therefore never have covered.

The corpus already records the neighbouring failure ("a structural AC is only as wide as the file list it greps, and here the AC's grep set and the spec's anchors were the same narrow set, each derived from the other" — `spec-the-retired-shape-refusal-message-has-two-byte-identical`). This is the cheap counter-move to it: **the oracle is a better site-census than the author's file list, but only if it runs first.** Declare-then-implement lets the author's blind spot become the AC's blind spot, and the AC then certifies the blind spot as covered.

Corollary measured in the same pass: the generic needle was load-bearing. `a later phase of spec-the-defect-channel-reaches` occurs **0** times in `tools.ts` because a string concatenation splits it across two source lines — the same literal-scan-evades-concatenation boundary `AC-GI-7` already records. A scan on the specific needle alone would have gone green while the MCP site stood. The generic needle (`is not yet supported`) carries a named residual — a future unrelated use reddens the AC — and that cost was accepted in writing rather than traded for a scan that provably misses a real site.

## F3 — `create` cannot express a deterministic identity, and the asymmetry is invisible

`slug: slugSchema.optional()` sits on `docPatchSchema` (`packages/core/src/schemas.ts:787`) — the **update** schema. It is absent from `createDocInputSchema`. `CorpusService.create` (`corpus-service.ts:1301-1315`) unconditionally calls `slugifyWithCollision`, which appends `-2`/`-3` on collision.

So a caller that already knows the identity it wants cannot state it at create time, and the collision behaviour is **aliasing, not convergence**: two sessions creating "the same" doc get two docs. Meanwhile `docs.slug` IS UNIQUE at the store level and both stores already map the violation to a typed `DUPLICATE_SLUG` (`sqlite-store.ts:556`, `turso-store.ts:690`) — the convergence primitive exists and the write path cannot reach it.

⛔ `slugifyWithCollision`'s own check-then-insert is itself racy: two sessions can both observe a candidate free and both insert, so `create` can already surface a `DUPLICATE_SLUG` a caller never asked for.

## F4 — A shared test stub that asserts nothing is a FALSE-RED generator for the next consumer

`healthyGhStubDir()` (`packages/lore/tests/integration/helpers/healthy-gh-stub.ts`) writes `#!/bin/sh\nexit 0` and is **memoized per test-file process**. That is correct and deliberate for its only current consumer, `runGitHubHealthCheck`, which inspects exit codes and never stdout.

The trap is for the NEXT consumer: any path that PARSES stdout (`GitHubIntakePort.listIssues` parses a JSON array) gets empty stdout, fails to parse, and returns a `VALIDATION_ERROR`. That reads as a real defect in the code under test. The helper's name (`healthy`) actively invites the reuse that breaks.

**Rule**: a stub whose contract is "exit code only" must not be widened for a payload-parsing consumer — add a sibling. And a shared memoized helper is the worst place to discover this, because widening it silently changes every existing consumer's fixture.

## F5 — Two of the opening handoff's own decisions were false, and both were falsifiable in one command

`knowledge-handoff-agent-main-orchestrator-127` KD3 (confidence 96) asserted `listIssues` was "ABSENT from github-intake-port.ts" and that "AC-GI-12 has no evidence rows". Measured: `listIssues` is implemented at `github-intake-port.ts:344`, the named test file exists at 15k, and `lore ac list` shows AC-GI-12 with **1 attested pass**. NS6 asserted a worktree held 1 unmerged commit; `git rev-list --count main..<branch>` returned **0** for both worktrees.

Neither error was subtle and both cost one `grep` / one `git rev-list` to disprove. The load-bearing point is not that a handoff was wrong — it is that **a handoff's confidence figure is an assertion about the past, and the reader's job is to re-measure, not to weigh the number.** A 96 next to a claim that a symbol is absent is worth exactly one grep.

The same session's real gap was one the handoff never named: `fileGithubIssue` makes NO corpus write at all, so the missing piece was never "wire `listIssues` into the CLI" — it was that a GitHub-filed defect has no claimable corpus object in the first place.


## F6 — The two runners disagree on a zero-match `-t`, in OPPOSITE directions

Measured 2026-08-24, both ends, because a concurrent session's handoff (`knowledge-handoff-agent-main-orchestrator-128` KD3) reported the vitest half and six ACs written in this slice used `-t` filters.

| runner | `-t` matching nothing | consequence for `<cmd> && echo "AC-X PASS"` |
|---|---|---|
| `bunx vitest run <file> -t <missing>` | **exit 0**, `77 skipped` | the trailing echo FIRES over zero assertions — a false green |
| `bun test <file> -t <missing>` | **exit 1**, `regex "…" matched 0 tests` | refused |

The root CLAUDE.md standing lesson states only the vitest half. Stating one half invites two opposite errors: hardening a `bun test` oracle that never needed it, and — far worse — assuming the runners agree in the OTHER direction, i.e. that a bun-style loud refusal is what vitest also does.

⛔ Practical rule, and note it is a property of the RUNNER, not of the oracle text: a `-t`-filtered oracle under **vitest** MUST additionally require a `Tests N passed` summary; under **bun test** the zero-match exit is already loud. The six ACs on `spec-a-github-filed-defect-must-be-claimable-one-ingest-seam` that use `-t` are all `bun test`, so they are safe — by accident of runner choice, not by design. Anyone moving one of those oracles to vitest must add the summary requirement in the same edit.

⛔ Second-order, unmeasured and therefore stated as a hypothesis rather than a finding: `bun test -t` appears to match as a SUBSTRING, so `-t "AC-GR-1"` would also select a block named `AC-GR-10: …`. That direction is stricter (more tests must pass), so it cannot produce a false green — but it does mean one AC's oracle can fail on another AC's test, and a reader debugging that failure will look in the wrong place.

## F7 — A `-t`-filtered AC command and `lore done`'s unfiltered-run floor are structurally opposed

Measured at P2's archival. `lore done` refused with:

> Task … declares test-file anchor(s) with no attested UNFILTERED result:pass run … requires, for EACH declared test-file anchor, at least one `oracle:test result:pass` evidence row whose command runs that file with no `-t` / `--testNamePattern` / `--test-name-pattern` (or any of the three joined to a value with '=') case filter

Both mechanisms are correct and they pull opposite ways:

- The **AC** wants one criterion per assertion, so several ACs share one test file and each names its own `describe` with `-t`. That is what makes each AC independently attributable.
- The **floor** wants the whole anchored file green, because a filtered run leaves the rest of the file unverified — a real hole, since an implementer can add a passing filtered case beside a failing unfiltered one.

⛔ Neither is the bug. The consequence is a standing obligation: **every task whose test-file anchor is covered only by `-t`-filtered AC commands must ALSO record a companion unfiltered run** (`lore evidence … --result pass --capture`), or it cannot be archived. On the spec this was measured against, 6 of 12 ACs are `-t`-filtered and one phase has all four of its ACs filtering the same file.

⛔ Recorded as an unenforced gap: nothing warns at `lore ac add` time that a filtered command will later need a companion row. The mechanism it wants is a check at AC-declaration time — the same class of "the tool knows at declaration time what it will refuse at archival, and says nothing until archival" gap. NOT BUILT.

⛔ Second measured detail, easy to misread: on the run that first hit this, the unfiltered command's tail read `Ran 1 test across 1 file`. The file held exactly one test, so the filter was a no-op and the companion row was byte-equivalent to the filtered one. A reader could conclude the floor is pointless. It is not — the equivalence is a property of that file at that moment, and it disappears the instant a second phase adds its own case to the same file, which the plan schedules.

## F8 — Four agent deaths were the machine sleeping, and I attributed the first three to prompt design

Measured 2026-08-25. Four consecutive subagent runs on one task died. Three reported `Agent stalled: no progress for 600s (stream watchdog did not recover)`; the fourth reported `API Error: Your computer went to sleep mid-response`. Only the fourth named the cause. `pmset -g log` then showed the machine had entered Sleep three times in the preceding 45 minutes (994s, 974s, 536s), and `pmset -g` reports `sleep 1` — one minute of idle.

⛔ **The 600s watchdog cannot distinguish "the agent is hung" from "the host stopped executing it."** Both present as a silent stream. The watchdog's message NAMES the first reading, and that name is what I believed.

What I did with three data points and no measurement:

1. After stall #1 I attributed it to context load and told the agent to read in slices.
2. After stall #2 I attributed it to reading a 4500-line file, pre-digested every fact it needed, and injected a "never read a large file" anti-pattern.
3. After stall #3 I attributed it to transcript replay compounding across resumes, declared retrying the same agent to be "letting the problem compound", abandoned the worktree, and dispatched a fresh agent.

Each explanation was plausible, each was stated with more confidence than the evidence carried, and each was **wrong**. The cost: two wasted retries, one wasted fresh dispatch, one deleted worktree, and a bundle carrying an anti-pattern derived from a fault that never happened.

⛔ The rule this violates is already in this project's standing discipline — *investigate before judging; a 5-second check beats a 5-minute wrong path* — and the trigger fired three times without being honoured. What makes this case worth recording is WHY it kept not firing: **each new failure looked like confirmation of the previous theory.** Stall #2 during a large read "confirmed" the reading hypothesis. Stall #3 arriving quickly after a resume "confirmed" the transcript hypothesis. A theory that predicts every observation is not being tested by them.

**The cheap check that would have settled it at stall #1**: `pmset -g log | grep -iE "Sleep  |Wake "` on macOS. Roughly one second. ⛔ Before attributing ANY agent stall to prompt design, task scope, or context size, first establish that the host was actually running: check for host sleep, then for a stuck process holding a lock, then for load. Those are decidable; a prompt-design theory is not.

⛔ Named as an unenforced gap: nothing in the dispatch path checks whether the host is likely to sleep before launching a long-running agent, and the stall notification carries no host-liveness signal that would let the orchestrator tell the two cases apart. Either would have prevented this. NOT BUILT.

## F9 — A read-only agent keeps its worktree "unchanged", and an unchanged isolation worktree can be reclaimed under it

Measured 2026-08-25, the fourth death on the same task. The agent reported that its working directory stopped existing between two tool calls, and refused to continue — correctly, since the only fallback offered was the parent session's shared checkout.

Verified from the main checkout afterwards: `git worktree list` showed ONLY the main checkout, `.claude/worktrees/` had no subdirectories, `.git/worktrees/` metadata was empty, and every `worktree-agent-*` branch was gone — including a concurrent session's, which this session had explicitly decided not to touch.

⛔ **No data was lost, and that was checked before anything else was done.** The concurrent session's commit `060189fa` was already in `main` via merge `d11be557`; the dead agent had zero commits. Every vanished branch was merged. The order matters: establish loss-or-no-loss FIRST, then diagnose.

The explanation most consistent with the evidence: the harness auto-cleans an isolation worktree that is *unchanged*, and this agent had done nothing but `grep`/`sed`/`Read` — so its worktree never left the unchanged state, even while it was actively working. ⛔ Stated as the best-supported reading, NOT as established fact: branch deletion accompanied the removal, and it is not determined that the same mechanism does both.

What IS determined, and is the operationally useful half: **an agent doing only reads is indistinguishable from an agent that has done nothing.** Time spent is not a signal any cleanup can see; a file on disk is.

**Mitigation, now in the dispatch bundle**: the agent's first substantive action is to create its test file skeleton and commit it as a WIP commit, before any extended reading. Red-first already requires writing that file early, so this costs nothing and takes the worktree permanently out of the reclaimable state.

⛔ Unenforced gap: nothing in the dispatch path guarantees a worktree becomes "changed" before the agent's first long read, and the agent gets no warning that its isolation root has been reclaimed until a tool call fails. NOT BUILT.

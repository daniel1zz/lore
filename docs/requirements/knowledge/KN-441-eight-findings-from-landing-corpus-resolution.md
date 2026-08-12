---
id: KN-441
type: knowledge
role: knowledge
title: "Eight findings from landing corpus-resolution provenance: two ACs pinned to mechanisms that do not exist, and two assess MAJORs that were truncation artifacts"
status: approved
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
---
Session 2026-08-12, `agent:main-orchestrator`, resuming `knowledge-handoff-agent-main-orchestrator-96`. Five plan tasks plus one adhoc task landed, all attested on the merged tree. These are the findings the round produced, each with the mechanism that would have caught it.

## 1. Two more ACs were pinned to mechanisms nobody measured — and both were caught before dispatch, not by the AC

`AC-CP-4(c)` asserts its resolver is "retrieved by the SAME keyed dispatch entry that yields the six existing `resolve*GateEnabled` helpers", and warns that "a seventh predicate wired past the table goes RED". **There is no table.** Measured three ways: the seven resolvers in `packages/core/src/config.ts:1275-1433` are seven hand-written exported functions; production imports each by exact name (`adapters/cli/commands/gate.ts:209-211`, `service/gate-enforcer.ts:105`); and `resolveGateEnabled` (`:1228`) keys on CHECKPOINT, not sub-predicate.

`§D5`'s adapter table cites `serve.ts:26`. Right line, wrong directory — the file is `adapters/cli/commands/serve.ts`, not `adapters/http/serve.ts`.

The repo already carries this exact standing lesson from a prior round ("MEASURE a field or command before pinning an AC's oracle to it"). These are instances two and three, and both were produced during AUTHORING, before any implementer saw them.

**Root cause**: the lesson is written as a rule for the person pinning the oracle, and rules are not mechanisms. Nothing in `lore ac add` or `lore review` resolves a path or symbol named inside an AC statement.

**Mechanization**: `lore review`'s AC pass should extract path-shaped and `Symbol`-shaped tokens from each AC statement and from spec design sections, resolve them against the tree, and report unresolvable ones. Path existence is decidable — it is never a judgment call, which is exactly the property that makes it mechanizable. A `--check-drift` already does this for `code_anchors`; AC statements and design prose are the same class of claim with no such check.

## 2. One third of an AC was vacuously true on the day it was written

`AC-CP-2(c)` asserts `utils.ts` declares zero FunctionDeclarations named `findLoreDbPath`, `findLoreDbPathQuiet`, or `findMainCheckoutLoreDb`. **`findLoreDbPathQuiet` was never in `utils.ts`** — it lived at `gate-bypass-audit.ts:138`. That clause passed with zero code changes.

It was caught by measuring the anchors before dispatch, not by any control the AC declared. The AC's own CONTROL ("the relocated module DOES declare those three functions") would have carried the weight — but only if the implementer genuinely relocated the function, which is what the dispatch bundle had to demand explicitly.

**Root cause**: an AC that enumerates N things and asserts a property over all of them is only as strong as its weakest member, and nothing measures per-member discriminating power.

**Mechanization**: for any AC asserting absence, the dispatch bundle must require ONE deliberate red PER MEMBER, not one per assertion. This round proved the value: the per-member red on `findLoreDbPathQuiet` is what turned a vacuous clause into a real one.

## 3. Both of this round's assess MAJORs were truncation artifacts, and they read exactly like real defects

`lore assess` produced a 234192-char diff against an `ai.assess.max_diff_chars` budget of 80000. Seven files were dropped, including `foreign-corpus-write-guard.ts`, `mcp/tools.ts`, and all five test files. Both MAJORs said the AC's core claims "cannot be confirmed against source".

Machine-checked, both were false as defect reports: `foreign-corpus-write-guard.bun.test.ts:296` asserts `result.exitCode === 4 && result.stderr.includes(TOKEN)` with `TOKEN` imported from the guard's exported constant at `:77`; `foreign-corpus-write-adapters.test.ts:255/:364` assert `toHaveBeenCalledTimes(1)` and `:294/:316/:317` assert `provenance` is `toBeNull()`.

The judge did not lie — it listed every omitted file under `Unverifiable`. But it emitted `severity: major` for "I could not see this", which is the same severity vocabulary it uses for "this is wrong".

**Root cause**: severity conflates the finding's importance with the judge's confidence, so an absence of material and a presence of defect render identically.

**Mechanization**: a gap whose supporting file appears in the run's own truncation manifest must be emitted under a distinct severity or a distinct type — `unreviewable`, not `major`. The manifest is already computed; the finding just does not consult it. Until then, the standing rule holds: machine-check every assess finding that names a path before scoring it.

## 4. Splitting "capability" from "wiring" across two tasks worked, because the seam was a red test that the second task had to turn green

`AC-CP-4` landed the config sub-predicate; `AC-CP-3` landed the guard that calls it. `AC-CP-4(c)` can only prove the helper EXISTS and is name-reachable. `AC-CP-4(a)` is behavioural and was therefore RED on `main` from the moment AC-CP-4 merged until AC-CP-3 landed.

That red was deliberate, recorded as `--result expected-fail` by the implementer at the moment it was red, and written with a self-describing assertion message naming AC-CP-3 as the landing task. The orchestrator then re-ran it on the merged tree and watched it go green.

This is a reusable shape for the repo's recorded "capability implemented, never wired" failure: **make the wiring proof a test that is red until the wiring lands, owned by the capability task, and turned green by the wiring task.** It is stronger than a wiring assertion inside the wiring task, because it cannot be satisfied by the same agent that wrote it.

Cost, stated honestly: `main` carried a genuinely red test for one dispatch cycle. That is acceptable only when the red is (a) recorded as expected-fail, (b) self-describing about who turns it green, and (c) closed inside the same session. Two of the three are the author's discipline; none is enforced by a gate.

## 5. A dispatch bundle that asks for a "red baseline" without naming `lore evidence` produces no evidence

The adhoc comment-rewrite task measured its red baseline correctly — the three stale needles each matched at `:85/:88/:98` before the edit — and wrote it into its report. It never landed as an evidence row, so `lore done` refused the task for having no `expected-fail`, and the only honest close-out was `--declare-no-new-tests` plus `--override-attestation` with the gap disclosed in the reason text.

Retro-recording was not an option: a red transcribed after the fact is not evidence in this repo, and by then the merge had already removed the red state.

**Root cause**: the bundle named the observation but not the instrument. Three of four bundles that round said "record it via `lore evidence --result expected-fail`"; the fourth said only "record a RED baseline". The implementer did exactly what it was asked.

**Mechanization**: the responsibility is the bundle designer's, not the implementer's. Any dispatch bundle whose task will face the `lore done` red-first gate must name the exact command, not the outcome. A bundle template with a fixed verification-discipline block would remove the choice.

## 6. Five of five implementer agents stalled waiting on a Monitor for the long scoped-oracle run

Every one of the five worktree agents this session ended a turn with "waiting for the Monitor" and had to be resumed by the orchestrator. Each then completed normally. `bun run test:changed` runs 600-700s in this repo under contention, which is long enough that agents arm a Monitor and yield.

Two agents also mistook the wrapper's exit code for the runner's; one correctly identified `EXIT_CODE=143` as its own `kill` rather than a verdict, after being told to.

**Root cause**: a background oracle's completion signal reports the shell's exit code, and the agent that armed it has no local way to distinguish "finished green", "finished red", and "was killed".

**Mechanization**: the dispatch bundle must require the runner's exit code to be persisted to a file by the command itself and read back from that file, never taken from a notification. Every bundle this round that said so got a correct verdict; the pattern is cheap and should be in the template rather than repeated per bundle.

## 7. An exemption asserted at a constructor default does not reach the composition root that overrides it

`AC-CP-5(c)` required a typed spy proving the HTTP write path invokes the predicate exactly once with `provenance` EXACTLY `null`. It passed. It drives a bare `CorpusService` carrying the constructor default `{provenance: null, enabled: true}`.

But `loadLoreApp` (`adapters/cli/loader.ts:355`) overrides that default for every surface that boots through it, HTTP included, using the SERVER's startup directory. So the exemption the spec names is conditional on where `lore serve` was launched. Filed as `task-the-http-exemption-is-conditional-on-where-lore-serve-was`.

**Root cause**: the AC named the value (`null`) and the observation point (the predicate boundary) but not the OBJECT — and the object a composition root builds is not the object a constructor default produces.

**Mechanization**: an AC asserting a default must name which construction path it drives, and any AC whose subject is an exemption must drive the composition root, because a default is what the exemption looks like when nothing has wired it yet. Disclosed unprompted by the implementer, confirmed by inspection, and independently re-derived by `lore review`, which escalated on the resulting contradiction between §D5 and AC-CP-5(c) before it was written down clearly — the review gate did its job here.

## 8. Orchestrator error: an exit code measured through a pipe

`lore done ... | tail` reported `EXIT=0`. That was `tail`'s exit code; `lore done` had been refused by the attestation gate. The repo's own discipline says exit codes are not measured through pipes, and the failure text happened to be visible, which is the only reason it was noticed.

**Mechanization**: redirect to a file, read `$?` immediately, print it, then read the file. Every subsequent command this session used that shape.

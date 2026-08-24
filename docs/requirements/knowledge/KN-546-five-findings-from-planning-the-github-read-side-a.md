---
id: KN-546
type: knowledge
role: knowledge
title: "Five findings from planning the GitHub read side: a refusal can promise a phase no spec declares"
status: approved
priority: high
created: 2026-08-24
updated: 2026-08-24
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

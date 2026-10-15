---
id: SPEC-118
type: spec
role: spec
title: "Dispatch isolation must be enforced by a gate, and isolation does not imply a correct base"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-10-10
tags: []
---
## Overview

Worktree isolation for implementation subagents rested on the dispatcher remembering a parameter. Measured failure: one session omitted `isolation: 'worktree'` on **three consecutive dispatches**, so no worktree was ever created; two agents self-rescued on finding the checkout occupied and one worked in the shared checkout while 8 concurrent commits landed around it. The predecessor's own handoff recorded it as "MY ERROR" — which is exactly the shape that says the prose layer is the wrong layer.

A second, independent axis emerged while closing that plan: **`isolation` guarantees isolation, not a correct base.** The harness cuts every worktree from the shared checkout's CURRENT HEAD. When the integration line is elsewhere — it sat 60 commits ahead of `main` for the whole plan — a dispatch that correctly passes `isolation: 'worktree'` still hands the agent a tree where the target code is **absent**. Its most natural recovery is to write the missing files itself, producing a plausible reimplementation of already-merged work that passes its own scoped oracles.

## Measured payload contract

Probed 2026-07-31 in this harness with a positive and a negative run, because the gate cannot be built against assumed fields:

| Dispatch | `tool_input` keys | `isolation` |
|---|---|---|
| without isolation | `[description, prompt, subagent_type]` | key **ABSENT** |
| with `isolation: 'worktree'` | `[description, **isolation**, prompt, subagent_type]` | `"worktree"` |

The field is absent — not `null`, not `""` — when unset, so `!== 'worktree'` is a sound single test. The payload's top level also carries `cwd`, `session_id`, `permission_mode`, `transcript_path`.

## Decisions

**D1 — deny, never advise.** Exit 2 on violation. `pre-subagent-gate.mjs` is the counter-example in this repo: self-documented advisory with every path exiting 0, its intact bypass logic fossil evidence that it once meant to deny. An advisory gate for an invariant that has already failed three times is decoration.

**D2 — the writing-agent list is deliberately SHORT: `lore-implementer`, `tester`.** These are the types whose definition is writing code/tests, and the ones the incident involved. `claude` is excluded: it is a catch-all routinely used for read-only work, and false denials are how gates get bypassed. `general-purpose` is excluded because `pre-no-general-agent-gate.mjs` already denies it outright — double-denying would only obscure which rule fired. Read-only types cannot corrupt a shared checkout because they cannot write to it.

**D3 — the base half is DIAGNOSTIC, not a denial.** This is a deliberate reduction from the original two-conjunct design, and the reason is that the second conjunct is not decidable from available signals. Nothing in the payload states which base was INTENDED, and no local signal distinguishes "HEAD is behind the line I meant" from "HEAD is exactly right and the other branches are unrelated". Denying on a guess would fire on every repo that merely has feature branches. So the gate reports what it can PROVE — the branch and short HEAD the worktree will be cut from, plus any ref strictly ahead of it — and leaves the judgement to the dispatcher.

The enumeration uses `git for-each-ref --contains HEAD refs/heads refs/remotes`, NOT `git branch --contains`, for two measured reasons found in review:

- `branch --contains` emits git's synthetic display row `(HEAD detached at <sha>)` in a detached worktree, and `rev-parse --abbrev-ref HEAD` returns the literal `HEAD` there, so no filter on the current branch name removes it. The row was then printed as a ref "strictly behind" while the same message instructs the agent to `git merge --ff-only <that>` — a command that cannot work, because the row is not a ref. Reproduced live in a detached worktree in this repo. An earlier revision of this decision rationalized that output as "correct for that case"; that rationale was wrong and is retracted here.
- Including `refs/remotes` covers a local branch sitting behind its upstream. A heads-only scan reports NO diagnostic at all in that case — silently reading as "base is fine" in precisely the wrong-base scenario this spec exists for. The denial message additionally carries the base-correction recipe, so the two axes are taught together at the moment the first one is enforced.

**D4 — diagnostics may never block, and a HANG is not a failure.** The whole git section is wrapped, so any *error* (not a repo, git absent, unborn HEAD, detached state) falls through to exit 0. That is necessary but insufficient: a `try/catch` cannot rescue a git call that never returns, and a PreToolUse hook sits in front of the dispatch, so a stalled git (`index.lock` contention, a network-backed filesystem) would wedge the tool call with no error to catch. Every git invocation therefore carries an explicit `timeout` (2s) and an explicit `maxBuffer`; a timeout raises, which the existing wrap already converts to exit 0. The bound is PER CALL, not per diagnostic: three sequential git calls means a uniformly-slow-but-succeeding git costs up to ~3×2s before the hook returns, and only a call that actually exceeds 2s is killed (measured: a git sleeping 30s returns the hook in exactly 2s at exit 0, because the first timeout aborts the rest). Correctness is unaffected — diagnostics never block — but the worst-case added latency under a degraded filesystem is ~6s, not 2s. The branch list is additionally capped when rendered (5 shown, overflow counted) so a repo with hundreds of branches cannot bury the message the diagnostic is attached to. A gate whose informational half can wedge or drown a legitimate dispatch is worse than no diagnostic.

Detached-HEAD note, since the diagnostic reads `--abbrev-ref HEAD`: there it yields the literal `HEAD`, which matches no branch name, so nothing is filtered from the containing-branch list and every containing branch is reported. That is the correct behaviour for a detached worktree, not an accident.

**D5a — the wiring is the enforcement, and it fails OPEN.** Claude Code treats a hook exiting 1 as a non-blocking error, and both a missing file (`MODULE_NOT_FOUND`) and a syntax error exit 1 — measured. So a deleted, renamed, or corrupted gate silently reverts dispatch to the trust-the-dispatcher regime that failed three times in one session, leaving only a transcript line. Combined with D5 below (deliberately not auto-registered), the single `.claude/settings.json` line is the ONLY thing enforcing this gate, and `gate-hooks.bun.test.ts` pins g1/g2/g3's wiring but pinned nothing here. AC-DI-5 therefore asserts the registration itself, parsed rather than grepped, with a control on the sibling gate.

**D5 — not auto-registered by `lore setup`.** `HOOK_REGISTRATIONS` (`packages/core/src/distribution-hooks.ts`) deliberately excludes orchestration-POLICY hooks: they encode one team's subagent-dispatch discipline rather than a safety/governance invariant every consumer should inherit unasked. This gate is squarely policy — a team with a different dispatch model would find it wrong, not merely strict. It is hand-wired in this repo's `.claude/settings.json` against `$CLAUDE_PROJECT_DIR/assets/hooks/`, so a teammate who never ran `lore setup` still gets it.

**D6 — no hardcoded branch or tip.** A pinned integration tip would rot the moment the line moved, which is the same staleness that produced the original confusion. Asserted by a source-level test.

## Acceptance

Script-mode ACs (AC-DI-1 … AC-DI-3) verified by `lore verify`, plus a live end-to-end confirmation recorded as manual evidence: a real `lore-implementer` dispatch WITHOUT isolation was issued and the harness blocked it before the agent started, reproducing the denial message verbatim. Unit tests prove the hook's logic; only the live dispatch proves the hook is actually WIRED — the distinction that let a registered-nowhere hook be described as "Hook enforced" in this repo's own CLAUDE.md.


## Acceptance Criteria (structured)

- [·] [script] AC-DI-1: A dispatch of lore-implementer or tester whose isolation is absent exits 2 and the stderr names the subagent type plus the observed isolation value as the literal <absent> (so a future harness change that starts sending null or empty string surfaces in the message instead of being silently reclassified as the same case); a non-worktree isolation value such as remote is also denied rather than accepted as good enough; and the denial carries the base-correction recipe naming merge --ff-only, bun install, and the reset --hard it must not use
  script: test — bunx vitest run packages/lore/tests/unit/hooks/pre-dispatch-isolation-gate.test.ts -t "is denied"
- [·] [script] AC-DI-2: The gate exits 0 for every read-only subagent type (Explore, lore-explorer, lore-reviewer, Plan, researcher) even without isolation, for the catch-all claude type, for general-purpose (left to its own dedicated gate rather than double-denied), for a non-Agent tool call, and for a dispatch with no subagent_type at all — so the gate cannot produce the false denials that get gates bypassed
  script: test — bunx vitest run packages/lore/tests/unit/hooks/pre-dispatch-isolation-gate.test.ts -t "stays narrow"
- [·] [script] AC-DI-4: Against a REAL temporary git repository detached onto an earlier commit so that a branch strictly contains HEAD, the base diagnostic exits 0, fires (stderr contains 'strictly BEHIND' and the containing branch name, so the negative below is not vacuous), and contains neither the substring 'HEAD detached' nor any open parenthesis — proving git's synthetic display row is not reported as a ref the message would then tell an agent to merge
  script: test — bunx vitest run packages/lore/tests/unit/hooks/pre-dispatch-isolation-gate.test.ts -t "synthetic detached row"
- [·] [script] AC-DI-3: The full gate suite passes with zero failures — no total asserted, for the same anti-drift reason as AC-SL-4. Covers: a correctly isolated lore-implementer and tester exit 0; unparseable stdin, empty stdin, a non-git cwd, and an unborn HEAD (zero commits, where rev-parse exits 128) all exit 0, proving the diagnostic can never block a legitimate dispatch; and a source assertion that the hook hardcodes no branch name or integration tip, paired with a control that the file under test is the gate
  script: test — bunx vitest run packages/lore/tests/unit/hooks/pre-dispatch-isolation-gate.test.ts
- [·] [script] AC-DI-5: This repo's own .claude/settings.json registers the gate on an Agent-matching PreToolUse group, asserted by parsing the file rather than grepping it, with a control assertion that the sibling pre-no-general-agent-gate is also registered so a wholesale restructure cannot pass vacuously; and the registered hook path exists on disk. Load-bearing because a missing or syntactically broken hook exits 1, which Claude Code treats as NON-blocking, and because spec D5 keeps this hook out of lore setup's auto-registration — that config line is the only thing enforcing it
  script: test — bunx vitest run packages/lore/tests/unit/hooks/pre-dispatch-isolation-gate.test.ts -t "only enforcing if it is WIRED"

## Code anchors

- assets/hooks/pre-dispatch-isolation-gate.mjs

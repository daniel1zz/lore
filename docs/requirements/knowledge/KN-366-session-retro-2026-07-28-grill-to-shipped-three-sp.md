---
id: KN-366
type: knowledge
role: knowledge
title: "Session retro 2026-07-28 — grill-to-shipped: three specs landed, seven process findings"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: KN-297
links:
  - {id: KN-305, type: supersedes}
---
## Scope

Full-session retro for the grill-review execution run (2026-07-28): a `/grill-me` interrogation of Lore's current state produced seven decisions, which were then executed end-to-end — cross-corpus generalization retro, then three specs (SPEC-102 trace layer, SPEC-103 tiered review, SPEC-104 worktree-derived actor identity) taken through spec → AC → plan → task → worktree implementation → merge → attested verify → assess. Parent decisions: `knowledge-grill-review-2026-07-28-seven-product-direction`; Phase 0 findings: `knowledge-cross-corpus-generalization-retro-2026-07-28-guyin`.

## What landed (all merged to main, all ACs attested by `lore verify`)

| Spec | Mechanism | Attested |
|---|---|---|
| SPEC-102 | `trace_events` (migration-011) + fire-and-forget TraceRecorder port + read/deny instrumentation + `lore trace stats` + retention prune | 7/7 |
| SPEC-103 | ledger fast-track (knowledge assessment/retro/handoff/uat), judgment-required promote with worst-decision-wins + two audited override escapes, honest `ai_provenance`, pending-as-promises, `review backfill-ledger` | 10/10 |
| SPEC-104 | worktree-derived `agent:<branch>` actor tier (filesystem-only detection, fail-open) + fallout fixes | 5/5 |

Final oracle (re-run at 8ead3a0 after the Phase 4 hardening below): full two-runner suite on a CLEAN isolated worktree — vitest fully green, bun runner **1478 pass / 1 fail**, that one failure being a concurrent session's self-labelled RED test for the unrelated F5a dashboard feature (its own name says "allowed GREEN in this RED run").

First measured payoff, same day: `lore trace stats` on all three corpora — lore 823/831 docs never read, guyin 161, babyai 432. The "write-automation ≻ read-consumption" asymmetry, previously an impression, is now a number that can be tracked over time.

## Process findings (mechanization candidates, ranked by blast radius)

1. **A dirty concurrent working tree silently corrupts a full-suite verdict.** Running `bun run test` in the shared main checkout while another session had in-flight `assets/` edits AND a deleted `dist/lore` produced 20+ failures; the same commit in a clean detached worktree produced 4 (all foreign RED tests). Diagnosis cost was ~15 min of misattribution risk. LESSON: a full-suite verdict is only valid against a CLEAN tree at a NAMED commit — `git status --porcelain` must be empty (or the run must happen in an isolated worktree) before any "the suite is green/red" claim. This generalizes the existing "wrong execution root" false-oracle vector to "wrong tree STATE", and it is mechanizable: a preflight in the test script that fails loud when the tree is dirty or `dist/lore` is missing/stale.
2. **`scripts/changed-tests.ts` had a real path-parsing bug** (`.trim()` before the fixed-offset `slice(3)` corrupted every ` M`-prefixed porcelain line, silently dropping modified files from the changed-set — untracked `??` files were unaffected, so the tool still "worked" and never warned). Fixed this session with an end-to-end regression test. **CORRECTION (measured after the first draft of this retro): the "second, distinct under-selection gap" I recorded here does not exist.** The SPEC-103 implementer's worktree was branched from main BEFORE the porcelain fix merged, so its 12 modified-but-uncommitted source files were all ` M` lines — all corrupted, all dropped — leaving only its 2 NEW untracked (`??`) test files visible. Same root cause, observed pre-fix. Post-fix measurement on the identical change set: `bun run test:changed a2d83e5 --list` selects **280 vitest + 105 bun** files including `review-service.test.ts` — the transitive reverse-dependency closure is intact, and `changed-tests-selector.test.ts` already covers source→consumer transitive edges (cases 1 and 5). No new oracle needed. LESSON ABOUT THE LESSON: I recorded a subagent's diagnosis as a finding without re-deriving it — the same "shared mutable state must be re-evidenced in the turn you assert it" rule applies to a subagent's causal claims, not just to corpus state.
3. **`set -e` is INERT in this agent shell — the real root cause behind what I first misfiled as two `lore ac add` defects.** Measured controls: `( set -e; false; echo REACHED )` prints REACHED and exits 0, at top level too. So a multi-command batch runs to completion past ANY failure, and a batch of corpus writes is silently partial (one AC went missing this session exactly this way). `lore ac add` itself is NOT defective: it exits 2 on a dash-leading `--statement` (correctly loud), and the standard `--statement=<value>` equals form works (probe: exit 0, criterion added). The defect was entirely in my batch-authoring pattern trusting an inert `set -e`. Discipline: chain with `&&`, or assert the resulting state after every batch — and never report a CLI as broken before probing its documented escape form.
4. **An API connection drop mid-implementation is recoverable but needs a disk-state re-read protocol.** The SPEC-103 agent died mid-edit ("inserting a private helper after enforceApprovalGate"); resuming it with an explicit instruction to re-establish ground truth from `git status` + re-Read the half-edited file (never from its own memory of what it had written) produced a clean continuation. Worth keeping as the standing resume template.
5. **Both assessments flagged the same structural gap: no diff in the assess bundle.** `scope_fidelity` scored on `absence` for both plans (68-70) purely because `diff_available: false` — the judge cannot confirm anchor discipline or rule out drift. This is not a delivery defect but an instrument defect, and it recurs on every plan: `lore assess --diff` exists; the orchestrator did not pass it. Standing fix: always run `lore assess --diff` with the range derived from the plan's own first task commit.
6. **Self-reported vs attested asymmetry per task — solvable today, no new capability needed.** All three assessments flagged it: attested ratios 0.33–0.50, with the earlier tasks of each chain carrying zero attested records (SPEC-103 T1: 5 self-reported, 0 attested). Root cause read from the code: `lore verify <plan>` resolves ONE target task (fresh claim, or `--task`) and lands every AC's attested evidence there — by design, documented in `commands/verify.ts`. The fix is orchestrator discipline with EXISTING flags, not a spec: verify once per task with `--task <task> --ac <that task's ACs>`, so each task carries its own attestation. Applied forward from this session (both hardening tasks verify against their own task id). Deliberately NOT applied retroactively to the archived tasks — rewriting the evidence trail of completed work to look better than the process that produced it is exactly the self-certification this session set out to remove.
7. **Adversarial spec review paid for itself twice.** Two parallel adversarial reviewers against the tiered-review draft killed a BLOCKER before any code existed (auto-approving `task` docs would have corrupted claim/ready/done, which assume draft preconditions) and forced two honesty corrections: actor-string distinctness is forgeable (replaced by judgment independence), and the I1 author≠judge check was vacuous without `ai_provenance` (now recorded). Cost: two read-only agents, ~10 minutes. Keep this as the default gate before any lifecycle-semantics spec.

8. **`git add <file> && git commit` is NOT path-scoped in a shared checkout.** Committing a one-line CLAUDE.md edit swept in a file rename the concurrent session had already staged (`RM` in porcelain) — the commit landed with the rename attached, misattributing their work to my commit message. Nothing was destroyed (the rename carried 0 content change; their unstaged content edits survived intact) and NO history rewrite was attempted — rewriting HEAD on a branch another session is actively committing to is the genuinely destructive move, strictly worse than the misattribution it would repair. MECHANIZABLE FIX: in any repo where concurrent sessions share one checkout, always commit path-scoped — `git commit -- <paths>` / `git commit <file>` — never bare `git commit` after a targeted `git add`. This is the write-side twin of finding 1: finding 1 says a dirty tree corrupts what you MEASURE, this says it corrupts what you WRITE.

## Standing lessons (landed in CLAUDE.md)

- A full-suite verdict requires a clean tree at a named commit — `git status --porcelain` empty or run it in an isolated worktree; a dirty concurrent checkout turns foreign in-flight work into phantom regressions of your own.
- `set -e` is inert in the agent shell; batches run past failures and corpus writes go silently partial. Chain with `&&` or assert the resulting state. Dash-leading flag values need the `--flag=<value>` form.

## Phase 4 — assessment-driven hardening (added after the first close-out)

Re-running all three assessments with `lore assess --diff` (the instrument fix from finding 5) moved `scope_fidelity` from absence-based 68-70 to evidence-based 76-91 AND surfaced defects that every passing oracle had missed. Four were confirmed by reading the code, then fixed:

- **feed-trace gate trap** — the trace write was gated on `process.exitCode === 0`, but Node's success default is `undefined`; all three current handlers happen to assign 0 explicitly, so there was no live bug, but any future handler written the natural way would silently drop its trace. Predicate now treats unset as success. NO oracle asserted a feed row existed at all — that gap was real and is now covered.
- **`--override-judgment` unreachable for the commonest denial** — it required an id resolving to an existing judgment, while NO_JUDGMENT means zero judgments exist. Added `--override-no-judgment`, legal only on a never-judged doc, audited as `override_no_judgment: true`.
- **`ai_provenance` was a dishonest tuple** — `{provider, model: <provider name>, prompt_version: "v1"}`. Now a real model id via the `ModelAwareProvider` capability, or OMITTED entirely — never the provider name. Honest consequence, recorded in the spec rather than left to be discovered: `claude-cli` cannot know its own model, so on this corpus `ai_provenance` is absent and I1 collision detection is genuinely N/A; M2's judgment gate is the whole protection here.
- **SPEC-103 D4 claimed "atomic" re-fast-track; the code does two separate writes.** A false claim in the SSOT, corrected in the spec with the accepted self-healing residual stated.

`deny_retry_gap` also went from O(denies x full audit history) to O(n+m), and the retention prune's completion is now awaited on the App close path.

Blocked and reported honestly rather than faked: AC-TRACE-7's real Turso wiring is unconstructible in-test — `@libsql/client` passes `syncUrl` to a native binding that PANICS the process (SIGABRT, uncatchable) on `file:` URLs, and `libsql://` needs a real network. The spec now states exactly what that AC proves (the replicated-set exclusion) and what it does not.

## The mechanism caught its own author (live proof, not a test)

Editing SPEC-102 reset it to draft; `lore approve` returned **exit 4 NO_JUDGMENT** — I could not approve my own spec edit. `lore review` produced an independent judgment, and only then did approve succeed. On SPEC-103 the judge went further and **escalated**, with two blocking questions that were both correct: (a) which escape covers a doc whose only judgments are on prior versions — answered by reading the code, which accepts any-version ids, a documentation hole not an implementation one; (b) the registered ACs now contradicted the corrected prose. Investigating (b) surfaced a design property worth naming: **evidenced ACs are immutable** — `lore ac rm` refuses an AC that evidence references and `lore ac add` refuses a duplicate id, so a passing oracle can never be retro-fitted to a changed claim. The resolution was additive: AC-TIER-9/10 for the genuinely new behavior. The anti-lottery rule meant re-rolling the judge was not an option; answering was the only path.

## Pattern: subagent and judge CAUSAL claims have a low hit rate

Three refuted by measurement in one session: (1) a "second, distinct under-selection gap" in `test:changed` that was the same porcelain bug seen from a pre-fix worktree; (2) a judge's claim that feed traces were being dropped today (the trap is real, the live bug was not); (3) an agent's claim that `lore anchor add` demotes an approved spec — an isolated-corpus probe showed it stays approved; the real cause was my own edit seconds earlier. Their FINDINGS were valuable every time; their CAUSAL ATTRIBUTIONS were wrong more often than right. Record the finding, re-derive the cause.

## Also learned: `--diff` range selection is itself a trap

First reassessment of SPEC-104 scored `scope_fidelity` 52 with a MAJOR finding of foreign dashboard files in scope. The files were real — my range ended at the MERGE commit, so everything main had accumulated from a concurrent session came along. Re-running against the plan's OWN commits (`git show <task commits>` into `--diff-file`) scored 76 with the drift correctly narrowed to the fallout task's own out-of-anchor edits. CLAUDE.md's existing lesson says "derive the range from the plan's own first task commit" — the missing half is that the range must END at the plan's own last commit too, never at a merge.

## Correction log (this doc, v4)

Findings 2 and 3 as first written were both misattributions — a subagent's causal claim and my own inference, neither re-derived before recording. Both were empirically refuted in the same session and rewritten above with the measurements that refuted them. The pattern worth keeping: a retro written from reports rather than measurements is itself an unverified artifact, and the corpus is where that error would have hardened into "team knowledge". Every finding in a retro should name the measurement that produced it.

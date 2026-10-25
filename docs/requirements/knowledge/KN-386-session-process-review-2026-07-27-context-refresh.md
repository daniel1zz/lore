---
id: KN-386
type: knowledge
role: knowledge
title: "Session process review — 2026-07-27 context-refresh incident → CTX Phase 4 hardening"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-10-23
tags: [session-review, dogfood, context-verb]
parent: PRD-001
links:
  - {id: PLAN-088, type: informs}
  - {id: PLAN-106, type: informs}
---
# Lore-Governed Session Performance Review — 2026-07-27 context-refresh incident → CTX Phase 4 hardening
**Mode**: live   **Judge**: independent (lore-reviewer subagent)

## Verdict summary
8 PASS / 1 VIOLATION / 1 N/A (I6 retired-tombstone excluded)  ·  deterministic checks: 7/7 clean

Session arc: user asked for a context refresh → `lore context refresh` polluted CLAUDE.md (302 gitignored-artifact lines) and silently breached lore's own ceiling → revert, retro, AC-CTX-8/9 added, three worktree-dispatched waves (RED suites → F1/F2 implementation → config-budget plumbing), two attested `lore verify` runs 9/9, live e2e closed the loop (refusal now cites configured 220/24576).

## Violations (most severe first)

### V1 [I3] — RED-phase evidence recorded as `result: "pass"` for a command that exited 1
- **Evidence**: wave-1 RED task evidence row (`recorded_by agent:ctx-red-suites`, 11:02:44Z, `oracle: test, result: "pass"`, no attestation object) — the underlying vitest command exited 1 at that moment by design (6 RED cases failing for the intended reason).
- **Consequence**: any future corpus reader sees `pass` with zero signal the raw oracle failed by design — the field encodes "AC intent satisfied" instead of "command exit code", which is the LLM-judgment substitution I3 exists to prevent, wearing TDD clothing.
- **Root cause**: `lore evidence --result` has no vocabulary for "red, and that's correct" — the schema forces recorders to choose between a dishonest `fail` and a semantically-laundered `pass`. The dispatch prompt (orchestrator-authored) explicitly instructed this encoding, so the breach was mechanized into the bundle, not improvised by the agent.
- **Fix**: none retroactive (the output_tail preserves the failing-assertion text; the intent is recoverable). → **Mechanization**: extend `lore evidence --result` with an explicit `expected-fail` (or `red`) value distinct from `pass`, so a RED-suite recording is structurally unable to collide with a green result in the audit trail; until then, dispatch bundles must record RED phases as `--result fail` with the intent documented in the note, never as `pass`.

### V2 [I2] — `--worktree` declaration silently degraded to empty string on wave-1 claim
- **Evidence**: `lore diff <red-task> --from 1 --to 2` shows `"worktree": ""` for wave 1's claim; waves 2/3 carry non-empty values.
- **Consequence**: session derivation and `noAnchorOverlap` group by `(by, machine, worktree)` — a blank-but-present worktree value looks declared while carrying no information, quietly weakening the mutex for that claim.
- **Root cause**: `lore claim --worktree` accepts `""` as "explicitly provided" — no validation distinguishes blank from meaningful.
- **Fix**: none needed retroactively (task closed, no concurrent claim existed). → **Mechanization**: `lore claim` should treat `--worktree ""` as omitted or fail loud — never persist a blank value that satisfies the "explicit" letter while defeating the field's purpose.

### V3 [uncatalogued, extends I7] — destructive-gate block answered by an outcome-equivalent unmatched command
- **Evidence**: `git checkout -- CLAUDE.md` was blocked by `pre-bash-git-safety-gate.mjs` (whose sanctioned escalation is "ask the user"); the orchestrator instead self-verified the diff was a pure append (`git diff | grep -c '^-[^-]'` → 0) and truncated via `head -199`, a command shape the gate never inspects.
- **Consequence**: this instance was verified-safe, but the pattern — reaching a blocked outcome through a command the syntax-based gate cannot see — is indistinguishable in the audit trail from an unverified agent doing the same. The gate's threat model is syntax, not file-state outcome.
- **Root cause**: the gate inspects command syntax only; the "escalate to user" path is prose, not enforced; outcome-based probing was deliberately rejected in the gate's own design notes (probe bug ⇒ false-allow).
- **Fix**: none (action was evidence-verified before execution). → **Mechanization**: none proposed — record as a KNOWN ACCEPTED GAP of the syntax-based gate design, per the gate's own documented trade-off. The compensating discipline stands: any workaround of a blocked destructive verb MUST be preceded by an in-turn safety proof (as done here) or escalated to the user.

### V4 [uncatalogued, orchestrator-observed; judge did not adjudicate] — blocks-link readiness has no reachable "done" state inside a live plan
- **Evidence**: after wave 1's evidence+release, the dependent task stayed `ready: false` (readiness "done" = terminal status `archived|deprecated`; released tasks stay `draft`); `lore archive --sweep` returned 0 candidates mid-plan; the orchestrator manually ran three `lore set --status` transitions (draft→approved→active→archived) per finished task to unblock the chain.
- **Consequence**: the EXECUTE loop (claim→evidence→release) produces no state that blocks-links recognize as met — any plan using blocks-links either deadlocks or forces hand-rolled status choreography that no skill/prose prescribes (and which superficially collides with "readiness is computed, never hand-marked").
- **Root cause**: two "done" notions diverge — workflow-done (evidence recorded + claim released) vs lifecycle-done (terminal status) — and no lore verb bridges them during a plan.
- **Fix (this session)**: manual transitions, audited, applied only to genuinely-completed tasks. → **Mechanization**: either (a) a `lore done <task>` verb that validates evidence-presence then performs the terminal transition atomically, or (b) readiness treating released-with-passing-evidence as blocker-met, or (c) an archive-sweep rule admitting evidence-complete released tasks mid-plan. One of the three, decided by spec — today's gap invites exactly the hand-marking the governance prose forbids.

### V5 [uncatalogued, orchestrator-observed; judge did not adjudicate] — fresh worktrees have no corpus access; symlink workaround invented and propagated
- **Evidence**: wave 1's agent found `.lore/lore.db`/`config.yaml`/`local-key` absent in its worktree (gitignored, not materialized by `git worktree add`) and symlinked them from the main checkout; the orchestrator then prescribed the same workaround in waves 2/3 dispatch bundles.
- **Consequence**: SPEC-042's own protocol ("claims are made BY THE IMPLEMENTER from inside its own worktree") is unexecutable in a fresh worktree without an undocumented workaround; every future dispatcher either rediscovers it or claims from the wrong place.
- **Root cause**: lore resolves `.lore/` relative to cwd and has no git-common-dir fallback for linked worktrees.
- **Fix (this session)**: symlink workaround, worked cleanly (worktree removal unaffected). → **Mechanization**: lore should resolve the corpus root via `git rev-parse --git-common-dir` when cwd is a linked worktree and `.lore/` is absent — making the prescribed claim-from-worktree protocol work out of the box (SPEC-063 solved execution-root for `verify`; this is the corpus-locating sibling).

## Deterministic check table
| ID | Result | Evidence |
|---|---|---|
| D1 | PASS | merges baa7340/28662fa/90f5b2d each carry exactly the reported commit (53d2943/b65bd4e/c466c46) |
| D2 | PASS | `git worktree list` → main only; no unmerged branches |
| D3 | PASS | dangling commits all pre-session stash-shaped (≤07:25Z) |
| D4 | PASS | 3 claims + 3 releases, 3 distinct `agent:*` actors (10:54/11:06/11:34Z) |
| D5 | PASS | all evidence rows external commands; `recorded_by` matches claim holder; verify rows attested with exit_code+execution_root |
| D6 | PASS | no bypass strings; both gate denials (AC-id uniqueness, verify provenance) resolved via sanctioned correction (confidence-limited: absence-of-evidence) |
| D7 | PASS | `git status --short` empty at session end |

## Out-of-scope observations
- Wave-3 combined RED-test-writing and implementation in a single agent (complexity judged low) — test-independence trade-off belongs to lore-tdd / lore-test, not judged here. [out-of-scope → lore-tdd]

## What went well
- `lore verify` attestation layer worked exactly as designed both runs: real exit codes, execution_root, matched-file counts, actor identity threaded through main-checkout runs.
- Three-wave dispatch showed clean merge hygiene: branch content verified before every merge, immediate cleanup, zero orphans at session end.
- The incident retro is a model artifact: mechanism-level root cause, fixes proposed AND landed same-day, updated in place (v3) when the live e2e recheck caught the second-order config-source residual.
- Gate denials (AC-id collision, verify provenance) were resolved by correcting input via sanctioned paths — no bypass reached for.

## N/A invariants
- I9 handoff — nothing session-scoped left unfinished; remaining plan tasks predate the session (09:47–09:56Z).
- I6 — retired tombstone, not graded.
- I11 sub-checks assess/invalidate — plan not fully done; no knowledge disproven (retro was corrected in place, which is the update path, not invalidation).

## Prior-retro cross-check (escalation scan)
Mechanizations recommended by earlier session reviews (resolved-actor advisory; e2e port serialization rule; worktree-remove guard; assess suggest_archive; exemption-clause tightening) are either landed (SPEC-035 advisory) or verified-unnecessary ("Escalation ≠ build" lesson). None of this session's findings (V1–V5) repeats a previously-recommended, un-built mechanization → no severity escalation applies. V1/V2/V4/V5 are first-occurrence product-gap findings; each names its mechanization above.

---
id: ADR-049
type: adr
role: decision
title: "Autonomy is decided by measured facts: one decision function, human only below threshold or for human-always classes"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PRD-001
links:
  - {id: ADR-021, type: relates-to}
  - {id: KN-580, type: relates-to}
---
## Context

North Star: development ~100% by AI, many concurrent sessions, unattended after the opening phase. Today lore has three disconnected permission models (inventory 2026-10-18):
1. Irreversible git operations: absolute refusal in the shipped hook assets/hooks/pre-bash-git-safety-gate.mjs, "ask the user to run it in their own shell" (adr-a-gate-premised-on-the-agent-s-judgment-being-untrustworthy: "Site the authorisation outside the actor, or accept that the control is absolute"; it rejected "auto-allow when the probe reports the operation is a no-op").
2. Corpus gates with config switches and audited overrides (approve --override-judgment, done --override-attestation, ac exempt, --yes) — every one executable by the agent itself, since lore's identity has only `main|subagent` and no human.
3. Prose "ask the user" rules in assets (autopilot M1-M5, --steal, bypass) — not enforced.

No score in lore is calibrated against outcomes: review/assess confidence is LLM self-report (same version judged escalate and approve, both 0.72); `lore calibration` measures judge-vs-approver agreement where the approver is usually the agent, and nothing reads it (BR-1005 undecided). Two earlier designs never landed: knowledge-score-gated-autonomy-ai-assesses-decision-factors-the (draft; the AI scores its own factors) and spec-governance-weight-must-scale-with-measured-blast-radius-a (deprecated).

Live cost (2026-10-18): the human was asked three times to kill orphan processes, drop stashes and remove worktrees that lore could have proven safe; the stash list grew to 28 because assets steer agents into `git stash push` while only a human may drop.

User direction (2026-10-18): every decision is analysed into a score; only a score below threshold, or an especially important decision, reaches the human; this is lore's foundational mechanism and every other permission derives from it. Decisions taken in this ADR's interview: (1) make an operation recoverable first, then automate it — truly irreversible external operations always reach the human; (2) a human answer counts only through a channel the agent cannot use; (3) automatic adjustment only tightens, loosening needs the human; (4) phase 1 = engine + human channel + cleanup operations + the most forgeable approval paths, gates migrate later.

## Decision

### D1. One decision function, facts in, verdict out
Every permissioned operation is an instance of an OPERATION CLASS registered in one registry (code, not prose). `decide(class, subject, facts) -> {verdict: auto|escalate|refuse, score, factors, reasons}` is a pure function in @lore/core. Gates, hooks, approve/override/waiver/exempt paths, and lore's own maintenance verbs call it; none keeps a private permission rule once migrated.

### D2. Factors are measured by lore, never asserted by the actor
| Factor | Source (deterministic unless stated) | Scale |
|---|---|---|
| R recoverability = what could be LOST beyond recovery, not whether the action itself can be undone | checked against facts: `reversible` (lore restore/release/reopen undo it), `loss-free-by-proof` (lore proves nothing is lost: it first moves the object somewhere recoverable — a stash commit to refs/lore/archive/stash/<sha> — or proves the object holds nothing of value — a process of an ENDED run whose results are committed), `irreversible-local` (local data or work could be lost), `irreversible-external` (push --force, report-issue, data leaving the machine) | 1.0 / 0.9 / 0.2 / 0 |
| B blast radius | who could be affected: own run's objects or objects with no live owner (an ended run's, or unattributable) / own session's / shared state other actors read live (main's tree, config) / an object owned by another LIVE run or session / anything off the machine; from run/claim/worktree facts and git diff (existing radius machinery) | 1.0 / 0.9 / 0.6 / 0.2 / 0 |
| E evidence | how the safety predicate was established: lore evaluated it itself this call (attested), runner-attested oracle, self-report, none | 1.0 / 0.8 / 0.1 / 0 |
| C calibration | per class: Wilson lower bound of "not later reversed" over this class's past auto decisions (D6); a class with no history uses its registered prior | 0..1 |
| J judgment (optional) | an LLM review of the subject, when the class asks for one | 0..1 |

Each class declares which factors are REQUIRED (R, B, E, C always; J only for classes that ask for a review). A required factor the caller could not measure scores 0 (AS-17: never default to safe). An optional factor that is absent is left out of the minimum; when present it enters the minimum, so it can only lower the score, never raise it.

### D3. Score is the weakest link; hard rules come first
1. Importance tier `human-always` (registered per class; initial set from autopilot M1-M5: spending money, credentials/2FA, product-direction choices with tied options, out-of-plan scope, anything leaving the machine) -> escalate.
2. R = irreversible-external -> escalate. R = irreversible-local with B beyond own session -> escalate.
3. Otherwise score = min over the required factors plus any present optional factor (R, B, E, C[, J]). verdict = auto iff score >= the class's threshold, else escalate. No weighted sum: no factor can buy back another.
Verdicts `refuse` stay for invariant violations (malformed input, lock), unchanged.

### D4. Lore executes; the agent only asks
A destructive maintenance operation is performed by a lore verb (e.g. `lore stash prune`, `lore run reap`, `lore done` worktree removal), which gathers the facts, calls decide(), and acts only on `auto`. Recoverability per phase-1 class: stash drop = loss-free-by-proof (the stash commit is first written to refs/lore/archive/stash/<sha>); worktree removal = loss-free-by-proof only when the existing removal test proves it clean (no untracked or modified files), its branch merged, AND `git status --ignored` lists no ignored path outside the class's declared regenerable set (node_modules, dist, build caches) — an ignored .env, database or other local data makes R irreversible-local, so it escalates; process reap = loss-free-by-proof only for a process whose owning run is ended and whose ancestry or start time ties it to that run (its results are committed; killing it loses nothing). The shipped git-safety hook keeps refusing the raw commands typed by an agent (that control stays absolute, as the earlier ADR requires — the agent's judgment still never authorises a destructive command). What changes: authorisation for lore-executed, predicate-proven, loss-free-by-proof operations comes from lore's measured facts, not from a human shell. This SUPERSEDES adr-a-gate-premised-on-the-agent-s-judgment-being-untrustworthy only in its rejection of "auto-allow when the probe proves safety" for operations lore itself executes after making them recoverable; its rule that an actor-settable override is no override stands and is extended (D7).

Archive refs under refs/lore/archive/ are never pruned automatically; pruning them is its own class (irreversible-local, escalates). Referenced commits survive git gc.

### D5. Every decision is a record; no re-rolling
decide() appends a decision record (class, subject ids, subject version/sha, facts snapshot, factor values, score, threshold, verdict, executor run) to an append-only, hash-chained log. For a given (class, subject, version), the effective verdict is the latest human-tty decision if one exists; otherwise the WORST of all machine records: re-scoring cannot cross the threshold (the anti-lottery rule, BR-278 generalised), only the human can. New facts (a new version) start a new subject.

### D6. Calibration from outcomes, tightening only
An auto decision's outcome is observed later by lore itself: reversed (the object restored from its archive ref, a reopen/restore/correction/invalidate of the subject, a reverted merge) or stood. C per class is the Wilson lower bound (z = 1.96) over the class's last 50 outcomes plus 50 pseudo-outcomes at the class prior (so a new class starts near its prior instead of near zero, and each real reversal moves it). When C falls below the class threshold the class escalates automatically. Blind spot, named: harm that nobody reverses through lore counts as `stood`, so C can drift upward. Two counterweights: calibration only tightens by itself, and the PRD's permanent sampling floor (PRD §12/§14 I2) applies — a fixed fraction of each class's auto decisions (initially 1 in 10, at least one per class per week of activity) is queued for non-blocking human audit; an audit finding `wrong` counts as a reversed outcome. Raising a prior, lowering a threshold, or moving a class out of `human-always` is itself a decision of class `governance-loosen`, importance `human-always`.

### D7. The human channel
An escalation becomes a pending decision. The nonce is never written to any output an agent can read (not in the escalating command's output, not in lore pending, not in --json); `lore decide` generates it per invocation and shows it only on the controlling terminal after its checks pass. It resolves only through `lore decide <id> --accept|--reject [--reason]`, which (a) requires an interactive TTY on stdin and a per-decision nonce shown on screen and typed back, and (b) is refused when invoked through an agent tool call: the shipped PreToolUse hook denies a Bash call containing `lore decide`; `lore decide` itself refuses when any ancestor process is the agent harness or the environment carries an agent run identity; MCP and HTTP expose no decide. The record carries channel=`human-tty`. Anything an agent records ("user said yes") is channel=`agent-asserted` and never resolves an escalation. Pending decisions are batched: the human sees one list with scores, facts and the recommended answer. Honest limit: an agent running as the same OS user could in principle defeat any local check; the design makes forgery require deliberate circumvention of two shipped controls, leaves an audit trail, and is detectable — not impossible.

Honest limit of the chain: it is unkeyed, so an actor with write access as the same OS user can recompute it end to end; it detects naive edits, not deliberate rewriting. To make deliberate rewriting detectable, the chain head is recorded in every mirror-export commit and in every human-tty decision record; a rewrite of rows older than the last pushed head contradicts the remote's history (pre-push verifies the local chain reproduces every head already pushed).

### D8. Thresholds are governed data
Class thresholds, priors and tiers live in one corpus record; lore validates every change through decide() (D6: loosening = human). A naive direct edit that bypasses lore breaks the record's hash chain; lore then treats every class as unmeasured (score 0 -> escalate) until the human re-confirms. A deliberate edit that also recomputes the chain is caught only at the next pre-push or mirror export, when the local chain no longer reproduces a head already pushed; until then it is undetected — a named gap, not a guarantee. The thresholds record is also mirrored as a git-tracked file, so any loosening shows in the diff of the commit that carries it.

Initial phase-1 class values (starting points; tightened by outcomes, loosened only by the human): stash-drop threshold 0.8, prior 0.95; worktree-remove 0.8 / 0.97; process-reap 0.85 / 0.97; override-judgment, override-attestation, ac-exempt 0.8 / 0.5 (escalate until outcomes accumulate); verify-new-command 0.8 / 0.95; governance-loosen, report-issue, push-force, archive-ref-prune: human-always. The spec carries the authoritative table and the B/E/J measurement tables.

### D9. Migration in phases
Phase 1: engine, decision log, human channel, three cleanup classes (stash archive+drop, orphan-process reap, worktree removal via the existing removal test), agent hygiene that stops creating the mess (no stash steer, no self-matching waits, helpers reap their own children), and the forgeable approval paths (approve --override-*, done --override-attestation, ac exempt, verify --yes) read decide() so an agent-only override escalates instead of passing. Later phases migrate each gate, each with outcome data.

### D10. Relation to the PRD's autonomous feedback loop (G9, §14)
PRD G9/§14 defines assist/auto levels per document type, unlocked on Wilson-bounded agreement data, with a permanent human sampling floor (I2). This ADR generalises that loop from document lifecycle to every permissioned operation class and implements it with outcome-based calibration instead of judge-vs-approver agreement; the sampling floor is kept as stated above. Document-lifecycle levels become operation classes of this registry in a later phase; until then §14's own levels stand unchanged.

## Consequences
- The human is reached for: human-always classes, irreversible-external operations, low-calibration classes, and threshold loosening — batched, with the evidence attached.
- Cleanup of runs, stashes and worktrees no longer needs the human.
- Approval overrides an agent could self-grant today start escalating: expect more pending decisions at first; that is the measurement the calibration needs.
- adr-a-gate-premised-on-the-agent-s-judgment-being-untrustworthy is superseded in part (D4); its absolute refusal of agent-typed destructive git commands is kept.
- Rejected: AI-scored factors (self-grading; the 2026-10-11 draft); weighted sums (a high score in one factor hides an irreversible one); trusting in-conversation consent recorded by the agent (forgeable); both-direction auto-tuning (a biased calibration would ratchet open).

---
id: KN-358
type: knowledge
role: knowledge
title: "Session process review — 2026-07-28 grill-to-shipped (SPEC-102/103/104 + assessment-driven hardening)"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-29
tags: []
parent: KN-297
links:
  - {id: PLAN-108, type: informs}
  - {id: PLAN-109, type: informs}
  - {id: PLAN-107, type: informs}
  - {id: KN-366, type: relates-to}
---
# Lore-Governed Session Performance Review — 2026-07-28 grill-to-shipped (SPEC-102/103/104 + hardening)
**Mode**: live   **Judge**: independent (`lore-reviewer` subagent; it re-ran git/lore commands rather than trusting the orchestrator's summary, and refused to confirm one claim it could not corroborate)

## Verdict summary
9 PASS / 1 VIOLATION (I11 sub-check) / 0 N/A among catalog invariants, plus 2 uncatalogued findings · deterministic checks: 7/7 clean

## Violations (most severe first)

### V1 [I11 — CLOSE-phase hygiene: assess ran against a stale state] — medium
- **Evidence**: `lore assess` timestamps 11:52Z (SPEC-102) and 11:58Z (SPEC-103) versus their post-assessment hardening commits `183f860` @ 20:23+08:00 (=12:23Z) and `98f9eaf`/`055669d`/`8ead3a0` @ 20:33–20:50+08:00. The hardening tasks were CREATED BY those very assessments (`task-t4-hardening-…` created 11:53:44Z), so each plan's permanent quality record describes an intermediate state that predates the fixes its own assessment triggered. (Precision note: the judge reported all three plans; verified timeline shows SPEC-104's 11:57Z assessment POSTDATES its last commit `b81ca31` @ 18:15+08:00 — SPEC-104 was current, only two plans were stale.)
- **Consequence**: a future session reading `scope_fidelity`/`outcome` for these plans would trust a score computed before the defects were fixed — understating what shipped and, worse, treating an assessed plan as closed while unassessed commits sit on top of it.
- **Root cause**: `lore assess` is timestamp-blind. It has no notion of "this plan gained task activity after my last run", and nothing in the corpus marks an assessment as superseded by later work. The discipline "assess when the plan is done" is prompt-only, and "done" is not a state assess can observe — so an assessment that TRIGGERS more work silently becomes stale by its own success.
- **Fix (applied this session)**: both plans re-assessed against their full final commit sets via `--diff-file` → SPEC-102 outcome 80 / evidence 72 / scope 88; SPEC-103 outcome 82 / evidence 74 / scope 80. → **Mechanization**: `lore assess` should compare its own last-run timestamp against the plan's most recent task `evidence`/`done` audit timestamp at invocation and (a) warn loudly when a stored assessment is older than the plan's latest activity, and (b) let the `plan-close` gate — already armed — refuse closure when the newest assessment predates the newest task activity. That converts "remember to re-assess" into the same deterministic shape as every other gate in this repo.
- **MECHANIZATION LANDED, same session** (SPEC-106 `spec-assessment-freshness-plan-close-denies-a-stale-assessment`, merged `287503f`, `lore verify` 5/5 attested): `assessmentFreshness` is now an additive predicate on the already-armed `plan-close` gate — it denies closure when the plan's newest `evidence`/`done` AUDIT row postdates its newest linked assessment, with a feeding pack naming the exact re-run command; `lore assess` itself only WARNS (gating the remedy on the condition it cures would deadlock); the opt-out mirrors `attestation_exempt` (flag + mandatory reason). Staleness is computed read-side, never stored. Assessed at outcome 88 / evidence 76 / scope 92. This finding therefore does NOT carry forward as an un-built recommendation — the class is closed by mechanism, not by prose.

## Uncatalogued findings

### V?-1 [uncatalogued] — the catalog checks "did assess run", never "did assess run against the FINAL state"
- **Evidence**: I11's sub-checks are satisfied by the mere existence of an assess audit row; this session passed that letter while failing its intent on two plans (V1).
- **Consequence**: any reviewer mechanically walking I1–I11 marks this session's CLOSE phase clean.
- **Root cause**: the invariant was written for the "assess never ran" failure, not the "assess ran too early" failure — which only appears once assessments become good enough to generate follow-up work, as they did here for the first time.
- **Fix**: amend I11's assess sub-check to read "…ran AND its range/timestamp covers the plan's final task activity". → **Mechanization**: same as V1's, and it LANDED this session (SPEC-106) — the gate now makes the invariant self-enforcing rather than reviewer-dependent, so a future reviewer walking I11 mechanically can no longer pass a session with a stale assessment.

### V?-2 [uncatalogued] — no invariant covers a CO-RESIDENT independent session sharing the checkout
- **Evidence**: a `git add CLAUDE.md && git commit` swept in a file rename the concurrent F5a session had staged; it landed in this session's commit under this session's message (0 content change; the other session's unstaged edits survived; disclosed, no history rewrite attempted).
- **Consequence**: every bare commit in a shared checkout can misattribute or prematurely publish another session's work — and the whole catalog (I2 anchor mutex, I5/I10 worktree dispatch) assumes the only other actors are this orchestrator's own subagents.
- **Root cause**: lore's concurrency model is file-anchor mutex between LORE-TRACKED tasks in SEPARATE worktrees. Two top-level sessions in ONE primary checkout share an index that no lore mechanism can see: CLAUDE.md is cross-cutting and would never be a declared anchor.
- **Fix (applied)**: standing lesson landed in CLAUDE.md this session — commit path-scoped (`git commit -- <paths>`) whenever a co-resident session may be live; every commit after the incident used that form. → **Mechanization**: a pre-commit hook comparing `git diff --cached --name-only` against an intended-path list (or simply refusing a commit whose staged set exceeds the paths named on the command line) is the deterministic version; the catalog should also gain a co-residency invariant, since prose discipline is what just failed.

## Deterministic check table
| ID | Result | Evidence |
|---|---|---|
| D1 empty-branch merge | PASS | all 20 merges in `b2e72bd..HEAD` carry ≥1 commit on `^2`; this session's own 8: 3/1/1/2/1/1/1/1. `git log <branch>` was run before every merge. |
| D2 worktree remnants | PASS | `git worktree list` → main checkout only; the single `--no-merged` branch (`worktree-agent-ada3640f23484b4b5`) is the concurrent F5a session's, not this one's. All 9 of this session's worktrees removed with the NON-force form, branches `-d` deleted after merge verification. |
| D3 dangling work | PASS | `git fsck --dangling` subjects are all stash-shaped (`WIP on main:`, `On worktree-agent-…`), from before this session or from the concurrent one; no dangling commit is the sole surviving copy of reported work. |
| D4 corpus chain | PASS | 10 claims / 10 releases / 62 implementer evidence rows across 7 distinct `agent:*` identities, each claiming from its own worktree (trace-layer 3/3/7 · tiered-review 2/2/11 · actor-derive 1/1/6 · spec104-fallout 1/1/4 · trace-hardening 1/1/12 · tiered-hardening 1/1/19 · provider-modelid 1/1/3). The one unclaimed agent (`spec103-fixtures`) was declared non-task fixture housekeeping up front. |
| D5 oracle quality | PASS | every evidence entry across all 10 tasks carries a `command`; oracle kinds are `test`/`tsc` ONLY; zero `manual`, zero command-less entries. Provenance sub-check: zero orchestrator-written evidence rows lacking a runner `attestation` — no evidence-by-proxy. |
| D6 gate bypass | PASS | `action='gate_skipped'` rows = 0; no `LORE_GATE_BYPASS` / `--no-verify` / `CLAUDE_SUBAGENT_GATE_BYPASS` issued. A real deny was hit (`lore approve` exit 4 NO_JUDGMENT) and resolved by obtaining a judgment. A safety-gate hook blocked `git worktree remove --force` twice; both times the non-force form was used after restoring a build artifact. **Verifiability note**: the judge could not corroborate the `--force` block from artifacts (harness-level blocks leave no git trace) and correctly declined to accept it as confirmed — recorded here as the orchestrator's account, not as independently verified fact. |
| D7 end state | PASS | `git status --short` empty at session end. |

## Out-of-scope observations
- The `--diff-file` build step exposed that `grep` silently reports nothing on a diff containing binary bytes (a "quiet tool ≠ empty result" false oracle); cross-checked with Python. `[out-of-scope → tooling hygiene, not a lore invariant]`
- SPEC-103 T1's tests were written implementation-first rather than red-first (self-disclosed by the implementer). `[out-of-scope → lore-tdd]`

## What went well
- **Gate compliance under real pressure, not simulated**: the session's own new gate (SPEC-103 M2) denied the orchestrator's approval of its own spec edit (exit 4), and the AI judge later ESCALATED with two blocking questions. Both were resolved by answering — reading the code for one, probing CLI behavior in a throwaway corpus for the other — never by re-rolling the judge (which the anti-lottery rule forbids) and never by bypass.
- **Evidence provenance was clean**: implementers recorded their own oracle runs from their own worktrees; every orchestrator-written evidence row is runner-attested. No prose report was laundered into a corpus evidence row.
- **Three causal claims were refuted by measurement and corrected IN the corpus** rather than left standing: a phantom `test:changed` gap, a phantom `lore ac add` defect (real cause: `set -e` is inert in this shell), and a subagent's claim that `lore anchor add` demotes an approved spec (refuted by isolated-corpus probe).
- **A blocked oracle was reported as blocked, not faked**: AC-TRACE-7's real Turso wiring proved unconstructible (libsql panics the process on a `file:` syncUrl); the agent declined to substitute a mirror test and the spec now states exactly what that AC does and does not prove.

## N/A invariants
None — every catalog invariant was exercised this session (I6 is a retired tombstone and was not judged).

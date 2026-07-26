---
id: KN-092
type: knowledge
role: knowledge
title: "Session process review — 2026-07-21 setup-scaffold + config-layer + verify-trust fixes"
status: approved
priority: medium
created: 2026-07-21
updated: 2026-07-24
tags: []
parent: PRD-001
links:
  - {id: PLAN-066, type: informs}
  - {id: PLAN-065, type: informs}
  - {id: PLAN-062, type: informs}
  - {id: PLAN-064, type: informs}
---
# Lore-Governed Session Performance Review — 2026-07-21 setup-scaffold + config-layer + three verify-trust fixes

**Mode**: live   **Judge**: independent (`lore-reviewer`, tool-verified — it re-ran `lore audit`/`git fsck`/`status --check-drift` rather than accepting the orchestrator's summary)

## Verdict summary

8 PASS / 1 VIOLATION / 1 N/A · deterministic checks: 7/7 clean · **3 uncatalogued findings** + **1 escalated repeat**

Scope note: this session shipped 4 specs / 13 tasks / 12 merges. The code outcome is not what is judged here.

## Violations (most severe first)

### V1 [I10 + ESCALATED REPEAT] — merge-verify mechanization recommended 2026-07-20, still not built; termination discipline failed 4× before a partial guard landed

- **Evidence**: The 2026-07-20 retro (`knowledge-session-process-review-2026-07-20-lore-self-audit-fix`) states verbatim: *"Recommend mechanizing: a pre-`worktree remove` check that greps the merge's own stdout for 'Already up to date' before allowing cleanup to proceed"* and *"the mechanization gap (no hook enforces 'check git log before merge+cleanup') … should be treated as CLAUDE.md-or-hook-worthy, not just retro-worthy, on its next occurrence."* This session built the **commit-before-done** half (`subagent-stop-commit-guard.mjs`, blocks uncommitted/zero-commit termination) but **not** the merge-verify half — `git worktree remove` still has no gate reading the preceding merge's outcome. Separately, implementer deferred-termination occurred **4×**; 3 were caught by manual `SendMessage` recall, and the 4th slipped past the already-deployed guard v2 (`"Waiting for the bun test monitor to report back"` — the regex required `the monitor` contiguous).
- **Consequence**: The one incident class that already caused data loss in this repo (empty branch merged as "Already up to date", worktree then removed) remains prompt-only after being flagged as hook-worthy. It did not recur this session solely because the orchestrator manually ran `git log main..<branch>` before all 12 merges — i.e. the safety came from vigilance, not mechanism, and vigilance is exactly what the next session may not have.
- **Root cause**: Two distinct failures were treated as one. "Agent loses work" has two independent failure points — the **producer** side (subagent stops with work unpersisted) and the **consumer** side (orchestrator merges/cleans without verifying the branch carries commits). The guard built this session addresses only the producer. The consumer side has no enforcement point at all because `git worktree remove` is invoked by the orchestrator itself, and the orchestrator's own actions are ungated by design in this setup (`pre-bash-git-safety-gate.mjs` blocks `--force` removal but says nothing about a *non-force* removal following a no-op merge).
- **Fix**: none needed retroactively — all 12 merges were manually verified and all branches were non-empty (D1 clean).
- **Mechanization**: extend `pre-bash-git-safety-gate.mjs` (already vendored + auto-registered) with a rule on `git worktree remove` (non-force path): resolve the worktree's branch, and if `git rev-list --count main..<branch>` is 0 **and** the branch was never merged, block with the recovery text. This is the consumer-side twin of the SubagentStop guard, closes the class end-to-end, and reuses a hook that already ships. **Severity escalated one level per the skill's repeat rule: a twice-recommended, still-unbuilt gate is itself a governance failure.**

### V2 [uncatalogued] — plan documents left at `approved` after every task archived and `lore assess` ran

- **Evidence**: All 5 session plans read `status: approved` at review time despite 13/13 tasks archived and 4/4 assessments persisted. Found by the judge, not by the orchestrator's own CLOSE-phase pass.
- **Consequence**: `lore bootstrap`'s `active_plans` will keep surfacing finished work to every future session, diluting the resume signal — the exact Cross-Session-Amnesia surface the corpus exists to protect. It also makes "is this plan done?" unanswerable from status alone.
- **Root cause**: The CLOSE-phase discipline (CLAUDE.md + I11) enumerates `anchor add` / `assess` / `invalidate` / spec-status but **never names the plan's own terminal transition**. Tasks have a well-worn archive path (readiness computation makes an unarchived task visibly block its successors); a finished plan produces **no such pressure** — nothing downstream breaks, so it is silently skipped. I11's four sub-checks encode the same blind spot.
- **Fix**: applied during this review — 4 plans transitioned to `archived`; `plan-implementation-spec-062-config-write-layer` deliberately left `approved` because it carries one genuinely open task (`task-t4-open-deny-check-ancestor-subtree-coverage-reject-patches`).
- **Mechanization**: `lore assess` already knows a plan's full task set — on success, when every task is archived, emit a `suggest_archive` line in text mode and `"suggest_archive": true` in `--json`. Additionally add plan-terminal-status as a fifth I11 sub-check in `references/invariants.md` so the catalog stops reproducing the blind spot.

### V3 [uncatalogued] — main-agent exemption in CLAUDE.md has no size ceiling; a 247-line security-critical guard was written by the orchestrator directly

- **Evidence**: CLAUDE.md's 分发制 exemptions list three clauses; only the source-file clause carries a bound (`diff ≤ 3 行 AND 文件已 Read`). The `hooks/` / `.claude/` clause has none. Under it the orchestrator authored `subagent-stop-commit-guard.mjs` (247 lines, blocking logic, exit-2 semantics) plus a 28-assertion test suite, with no spec, no task, no claim, and no independent review — literally compliant.
- **Consequence**: A hook that can **block every subagent in the session** shipped without the independent-perspective check the 分发制 exists to guarantee. A false-positive in it wedges the whole pipeline; that risk profile is strictly higher than the 3-line source edits the policy does bound. (Two real defects did surface — v1 missed the stall class entirely, v2 was defeated by a phrasing variant — both found by the author's own tests, but neither by an independent reviewer.)
- **Root cause**: The exemptions were written asymmetrically — bounded where edits were expected to be *small* (source), unbounded where files were expected to be *config* (hooks/, .claude/). "Files under `hooks/`" was a proxy for "trivial config", and that proxy silently broke once hooks became real programs with test suites.
- **Fix**: retroactive — the guard is now vendored, spec-referenced (SPEC-046 amendment), covered by a task, and its 28 assertions plus two reverse-control runs are recorded.
- **Mechanization**: amend CLAUDE.md's exemption clause — hooks/`.claude/` edits qualify only when the change is under ~50 lines and adds no test suite; anything larger is treated as source (subagent-dispatched, or at minimum task+claim opened *before* the edit).

### V4 [uncatalogued] — orchestrator recorded all attested evidence as OS username `apple`, not `agent:main-orchestrator`

- **Evidence**: every `lore verify`-produced row across 4 tasks carries `recorded_by: "apple"`, while implementers correctly used `agent:t1-completeness-guard` / `agent:t3-config-cas` / etc. The orchestrator applied actor discipline to its subagents but not to itself.
- **Consequence**: Audit degradation, not data corruption. The corpus already uses `agent:main-orchestrator` as an established identity (`knowledge-handoff-agent-main-orchestrator*`), so the same real actor now appears under two names, and "who attested this?" no longer answers cleanly. The judge explicitly ruled this does **not** compromise evidence integrity (see below).
- **Root cause**: `LORE_ACTOR` is exported inside every dispatch bundle for subagents, but the orchestrator's own shell never sets it — the discipline lives in the bundle template, which by construction only covers the dispatched, never the dispatcher.
- **Fix**: `export LORE_ACTOR=agent:main-orchestrator` set for the remainder of this session (applied before the plan-archive commands above).
- **Mechanization**: have `lore verify`/`lore evidence` print a one-line advisory (never blocking) when the resolved actor matches the OS username rather than an `agent:`/`ai:` prefix; or have the session-start hook export the default. The advisory is preferable — it teaches at the point of use without adding a failure mode.

## Deterministic check table

| ID | Result | Evidence |
|---|---|---|
| D1 empty-branch merge | **PASS** | 12 merge commits in `65a0534..HEAD`; each contributed 1–2 commits; none empty |
| D2 worktree remnants | **PASS** | `git worktree list` → main checkout only; `git branch --no-merged main` → empty |
| D3 dangling work | **PASS** | 1 dangling commit dated today: `On worktree-agent-a8c7e1f393295aefe: wip-t1-verify-execroot-repro-check` — a `git stash` from SPEC-063's red-before-green proof, popped; content is the fix itself, on main. (Also found: a **2026-06-15** stash `autopilot-pre-merge-cleanup` whose content `INVALID_PARENT_TYPE` is long since in `packages/core/src/errors.ts:20` and whose target path `src/core/errors.ts` no longer exists post-monorepo — safe to drop, left for the owner as it is irreversible.) |
| D4 corpus chain | **PASS** | 13/13 tasks carry claim + evidence; per-task actors distinct; `--worktree` declared by implementers |
| D5 evidence oracle quality | **PASS** | All rows are command+exit-code oracles (`test`/`tsc`); zero self-assessment prose. Split: implementer self-reported rows (correct `agent:*` actor) + orchestrator `lore verify` attested rows (`runner: lore-cli`, wrong actor — V4) |
| D6 gate bypass | **PASS** | No `LORE_GATE_BYPASS` / `--no-verify` / `CLAUDE_SUBAGENT_GATE_BYPASS`. `--allow-new-commands` used repeatedly — the judge ruled this a legitimate SPEC-039 §M2 approval flag, not a bypass |
| D7 uncommitted state | **PASS** | `git status --short` empty at session end |

## Judge rulings that corrected the orchestrator's own suspicions

Recorded because self-suspicion was wrong in both directions and that is itself worth keeping:

1. **evidence-by-proxy — NOT a violation.** The orchestrator suspected that running `lore verify` itself while the claim was held by an implementer laundered unverified claims. The judge ruled the opposite: I3's proxy concern is about *transcribing a subagent's prose into an evidence row*. `lore verify` derives `result` from a real exit code with `attestation.runner`; **who invokes it is irrelevant to trustworthiness** — that is precisely SPEC-039 §M2's multi-writer design intent.
2. **5 tasks with 0 attested / all self-reported evidence — NOT a violation.** Self-reported ≠ oracle-less: an implementer running `bunx vitest`/`tsc` in its own worktree and recording the real exit code satisfies I3. `attestation` is an optional hardening layer, not the bar. Judged "compliant but shallower defence-in-depth", not a breach.
3. **The guard hook under I2 — N/A, but the policy is flawed.** `~/.claude/hooks/` is outside this repo's lore-tracked scope, so I2's own exemption applies literally. The judge separated this cleanly from V3: the *execution* was compliant; the *policy* has the hole.

## Out-of-scope observations

- Three ACs in SPEC-063 substitute stubs for the behaviour their statements demand (judge-flagged, `evidence_integrity` 66) — `[out-of-scope → lore-test]`.
- SPEC-061's completeness guard compares **file counts only**; a `-t 'REPRO'` oracle running 1 of N cases in a file still judges `complete` — `[out-of-scope → lore-test]` as a test-depth issue, though the *mechanism* gap is tracked in CLAUDE.md's eval log.
- `bun test`'s hard-coded 5000 ms per-test timeout is unusable on a loaded machine (164 failures at load 38–44, 0 assertion failures) — `[out-of-scope → lore-test]`.

## What went well

- **Self-correction written into the corpus rather than quietly fixed.** Two `lore assess` runs were fed wrong diff ranges, producing two false scope verdicts (38/42). Both were caught, `lore invalidate`d with `--superseded-by` and a reason naming the orchestrator's own input error, and re-run correctly (88/90). The judge called this the session's strongest discipline practice — the corpus now records the mistake instead of the wrong conclusion.
- **Agents' honest self-reporting was load-bearing.** Every one of the four false-oracle vectors was surfaced by someone declining to work around a problem: an implementer flagging its own poisoned attestation rather than silently re-running, T2 flagging the TOCTOU it could not fix inside its anchors, T5 asserting design-scoped residuals instead of loosening its assertions.
- **Hallucination intercepted before it became a mechanism.** A research subagent returned a fabricated `SubagentStop` field table (with an official-looking URL) containing exactly the `worktree_path` field the design needed. Reading the real docs plus an empirical probe hook disproved it; the guard was built on measured fields, and the incident is now recorded in the hook's own module header.
- **CLOSE phase mostly ran unprompted**: anchors declared for all 4 specs (`--check-drift` consistent, 51 specs), assessments persisted, CLAUDE.md index + 4 eval-log rows written — the gap was the plan-status transition alone (V2).

## N/A invariants

- **I9 handoff** — N/A: all 13 tasks archived and all plans closed except the one carrying a deliberately-open task, which is named in the final summary. No unfinished work needed carrying forward.
- **I6** — retired 2026-07-20 (tombstone; general TDD discipline, judged under `lore-tdd`).

---
id: KN-094
type: knowledge
role: knowledge
title: "Session process review — 2026-07-22 SPEC-062/-064 continuation + two hotfixes"
status: approved
priority: medium
created: 2026-07-22
updated: 2026-07-24
tags: []
parent: PLAN-059
links:
  - {id: PLAN-059, type: informs}
---
── 01KY4CE0… Session process review — 2026-07-22 SPEC-062/-064 continuation + two hotfixes ────────────────────────────────────────
Type: knowledge | Status: draft | Priority: medium | v1
Created: 2026-07-22 by system | Updated: 2026-07-22

# Lore-Governed Session Performance Review — 2026-07-22 SPEC-062/-064 continuation + two hotfixes
**Mode**: live   **Judge**: independent (lore-reviewer)

## Verdict summary
9 PASS / 0 VIOLATION / 2 N/A (I6 tombstoned, I9 not-exercised) · deterministic checks: 7/7 clean · **2 uncatalogued findings** (both low-severity, non-corrupting)

No catalogued-invariant violation. The corpus chain, gates, and worktree-dispatch protocol were followed end-to-end across 9 dispatched agents, 7 merges, 2 hotfixes, and one near-miss that the discipline CAUGHT. The two findings below are traceability/robustness gaps the catalog does not yet name — neither cost data or landed a false attestation.

## Uncatalogued findings (most severe first)

### V1 [uncatalogued, escalated] — the orchestrator's OWN oracle-run evidence has no stable actor identity (16 entries under bare OS username `apple`, inconsistent within a single task)
- **Evidence**: `lore audit --action evidence --actor apple` → 16 entries across 5 tasks. Within ONE task (T6 regression, `01KY3SFG1T…`) one evidence row is `recorded_by: apple` (05:10:42Z, e2e pass) and the next is `recorded_by: agent:main-orchestrator` (05:12:24Z, manual fail) — `LORE_ACTOR` was exported intermittently, not consistently, for the orchestrator's own `lore verify`/`lore evidence` calls.
- **Consequence**: `lore audit --actor agent:main-orchestrator` — the natural "what did the orchestrator itself attest" query — silently misses most of the orchestrator's own oracle runs; they are indistinguishable in the audit trail from any other tool a human `apple` ran. No concurrency/anchor impact this session, but it erodes the exact traceability guarantee the actor-identity discipline exists for. `lore assess` independently docked evidence_integrity to 68 (attested ratio 0.06) partly on this.
- **Root cause**: CLAUDE.md's actor-identity rule (`LORE_ACTOR=agent:…` per agent) is scoped to CONCURRENT DISPATCHED AGENTS only. There is no analogous convention for the orchestrator's OWN direct CLI invocations in the main checkout, so they fall through to the OS-user default — and aren't manually set consistently either (prompt discipline, predictably forgotten).
- **Fix**: (interim) prefix orchestrator `lore evidence`/`lore verify` with `LORE_ACTOR=agent:main-orchestrator`. → **Mechanization**: the durable fix is a lore CLI-side **resolved-actor advisory** — `lore evidence`/`lore verify` print a non-blocking warning when the resolved actor is a bare OS username rather than an `agent:`/`ai:` prefix (surfaces the gap every time, at the exact call site, instead of relying on memory). **ESCALATED**: this exact advisory was recommended in the 2026-07-21 handoff (P2 item c) and NOT built; a twice-recommended, un-mechanized item is itself a governance failure — stop re-recommending, build the advisory.

### V2 [uncatalogued, I10-adjacent, low] — concurrent Playwright runs collided on a shared fixed dev-server port (caught, no corruption, prose-only fix)
- **Evidence**: the orchestrator ran T6's regression Playwright concurrently with T5's tester Playwright against the same `--strictPort 5173` dev server → phantom "Target page/context/browser has been closed" write-flow failure; isolated re-run 20/20 green. No polluting evidence landed (T5's own log is clean 2/2) — the symptom surfaced in the orchestrator's own run, not as a false attestation.
- **Consequence**: low — no data loss, no false pass/fail in the corpus. But it is exactly the undeclared-collision class SPEC-042's anchor gate is structurally blind to: a runtime port, not a file anchor. The recorded fix is prose-only.
- **Root cause**: orchestration-hygiene (I10) enumerates file-anchor mutex but has no rule for shared EPHEMERAL RUNTIME resources (dev-server ports, browser instances) that two concurrently-running oracle commands collide on.
- **Fix**: serialize e2e-oracle runs (done, ad hoc). → **Mechanization**: a documented I10 sub-rule "never run two browser/e2e oracle suites against the same fixed dev-server port concurrently — serialize, or assign disjoint `--dashboard-port`/`--api-port` per concurrent run"; optionally a `lore verify` port-lock keyed on the dev-server port. Flagged as a candidate, not built this session.

## Deterministic check table
| ID | Result | Evidence |
|---|---|---|
| D1 empty-branch merge | PASS | all 7 session merges `rev-list --count ^1..^2` = 1 |
| D2 worktree remnants | PASS | only `main`; `git branch --no-merged main` empty |
| D3 dangling | PASS | all dangling commits from PRIOR sessions (SPEC-046/048); none from this session's agent ids |
| D4 corpus chain | PASS | 9 actors × 1 claim each, distinct identities; every task carries evidence |
| D5 oracle quality | PASS | evidence entries are external oracles (tsc/test/e2e + command + result); no self-assessment |
| D6 gate bypass | PASS | no BYPASS/`--no-verify`/`--force`; git-safety-gate `--force` block respected twice (plain remove + `-d`) |
| D7 dirty end-state | PASS | `git status` clean at session end |

## Out-of-scope observations (non-Lore)
- `[out-of-scope → lore-uat]` T7's UAT verdict self-discloses "self-verified — independence not achievable"; the corpus mechanism was used correctly and the limitation honestly surfaced. Whether a single-orchestrator session can produce genuinely independent UAT is a lore-uat methodology question, not corpus governance.
- `[out-of-scope → lore-review]` SPEC-064 a11y label gaps + bare "Required" validation copy — deferred UI quality debt, not governance.

## What went well
- **Actor-identity discipline on dispatched agents**: 9 agents, 9 distinct `agent:<slug>` identities, each claiming from its own worktree — the anchor-overlap gate had real, declared work to protect throughout.
- **The commit-before-cleanup discipline CAUGHT a real near-miss**: the AC-062-13 agent died pre-commit (0 commits); byte-identity verification before cleanup recovered the work instead of the W4 data-loss replay. I4/I5 worked as designed.
- **Evidence-over-spec-prose corrections handled cleanly 3×** (AC-064-7→8, requires-uat exit-code, ancestor coverage): append-and-document, never delete-and-hide; the `acceptance_criteria[].id` gate refusals were worked WITH, not around.
- **A standing escalated retro item was closed on EVIDENCE, not built blind**: the non-force worktree-remove gate was empirically probed, its premise refuted, and withdrawn with a linked knowledge doc — the correct response to a twice-recommended item is verify-then-decide, not reflexively build.
- **Doc-sync honesty**: the one mis-scoped `lore assess` was `lore invalidate`d with an accurate reason, not left standing.

## N/A invariants
- I6 — RETIRED (tombstone).
- I9 handoff — everything closed (plan archived through plan-close gate, both P0 items resolved, clean tree); no unfinished work to hand off.


── Navigation ──────────────────────────────────────────────────
Parent:   (none)
Siblings: (none)
Children: (none)
Related:  01KY3S6Q… Implementation — SPEC-064 Dashboard Settings UI (informs)

---

## V1 MECHANIZATION LANDED (same session, 2026-07-22)

The escalation was honored: instead of re-recommending, the durable fix shipped as `plan-hotfix-resolved-actor-advisory-retro-v1-mechanization` → `spec-spec-035-audit-trail-calibration-data` AC-AUDIT-ACTOR-1 (attested pass).

`resolveActor` (`utils.ts`, the single seam all 15 actor-stamping commands resolve through) now emits a once-per-process non-blocking stderr advisory ONLY on OS-username fallback — precise signal proven load-bearing via red-before-green (a naive "warn unless agent:/ai: prefix" rule failed the two `--by daniel` human-name cases). Return value + all exit codes byte-identical. Verified END-TO-END on the rebuilt `dist/lore`: os-fallback → `⚠ actor resolved to OS username "apple"…`; `LORE_ACTOR` set → silent. It is now structurally impossible to stamp an OS-username actor into the corpus without a visible warning at the call site — the interim CLAUDE.md prompt-line is superseded by this mechanism. Commit `fe98b1b`.

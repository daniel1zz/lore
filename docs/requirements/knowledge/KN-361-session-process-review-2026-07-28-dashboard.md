---
id: KN-361
type: knowledge
role: knowledge
title: "Session process review — 2026-07-28 dashboard evaluation to F5a packaging autopilot"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: [session-review, lore-discipline, plan-close]
parent: SPEC-105
links:
  - {id: PLAN-112, type: informs}
  - {id: SPEC-107, type: informs}
---
# Lore-Governed Session Performance Review — 2026-07-28 dashboard evaluation → F5a packaging autopilot
**Mode**: live   **Judge**: independent (lore-reviewer subagent) + orchestrator-run deterministic checks

## Verdict summary
10 PASS / 1 VIOLATION (uncatalogued, found by the independent judge) / 0 N/A · deterministic checks: 7/7 clean

The catalogued invariants (I1-I5, I7-I11) all passed. The single violation was found only by exercising the floor-not-ceiling license, and it was a live one: the plan sat non-terminal at "closure", so the `plan-close` checkpoint — whose `attestationFloor` predicate exists for precisely this session's evidence pattern — had never evaluated it. It has since been driven through the gate legitimately (see V1 resolution).

## Violations

### V1 [uncatalogued] — Plan reported closed while its own doc was non-terminal; the `plan-close` gate never evaluated it, and the CLOSE act that records closure is what silently de-promoted the plan

- **Evidence**: `lore get <plan> --json` → `status: draft, version: 4` at the moment the session reported "plan closed". `lore log` shows the causal chain: `v3 approve (agent:main-orchestrator)` → `v4 update (system)`. The v4 update was the orchestrator's own CLOSE-phase act of appending the closure addenda to the plan content — and per the documented lifecycle rule "editing content/title on an approved doc resets it to draft", that append silently de-promoted the plan. Corpus-wide only 1 plan was in `draft` (82 archived).
- **Consequence**: (1) `lore ready` / `lore tree` / any dashboard surface would keep showing this plan as open work — the next session inherits a phantom in-progress plan. (2) More seriously, the SPEC-069 `attestationFloor` predicate never fired. When later driven through the gate deliberately, it DENIED with `ATTESTATION_FLOOR_NOT_MET` and named 8 tasks carrying self-reported-only evidence — the exact P2-8 scenario the gate was built for. The session had archived those 8 tasks on self-report and would have "closed" without the floor ever being measured.
- **Root cause**: TWO layered causes, both structural, neither a memory lapse.
  1. Two independent, both-sanctioned "plan is done" surfaces exist: the per-task terminal walk (`lore done` × N, which CLAUDE.md's EXECUTE loop prescribes and which never touches the plan doc) and the plan doc's own status transition (the ONLY surface wired to `plan-close`). Nothing in the EXECUTE→CLOSE handoff — not CLAUDE.md, not the lore-plan skill, not `lore assess`'s own output — requires the second once the first completes for every task. `lore assess` ran happily on a draft plan and reported a score, which reads as closure.
  2. The CLOSE-phase discipline of appending closure addenda to the plan *is itself the de-promotion trigger*. Doing the right thing (recording the accepted exception + attribution proof) is what pushed `approved → draft`. A discipline whose correct execution silently reverses a prior gate promotion is a trap, not a discipline.
- **Fix (applied this session)**: re-approved the plan, earned runner-attested evidence for all 8 self-reported-only tasks (`lore verify <plan> --task <t>` — 8 passed / 0 failed each; attestation **can** be recorded against archived tasks, verified empirically), updated the domain doc to as-built F5a reality to satisfy the outline-sync predicate, then `lore set <plan> --status archived` → **exit 0**, gate passed legitimately, no exemption used.
- **Mechanization**: (a) `lore assess <plan>` on a plan whose tasks are 100% terminal should refuse to present as closure without the status transition — either performing it (thus routing through `plan-close`) or exiting nonzero naming it; (b) add a `--check-plan-terminality` drift signal (all children terminal + plan non-terminal) alongside `--check-drift`, so this class never depends on a human noticing a `draft` status; (c) for the de-promotion trap specifically: plan/spec content appends that are pure CLOSE-phase record-keeping need either a dedicated append verb that preserves status, or `lore set` must WARN loudly when it de-promotes an approved doc (currently silent). (c) is the highest-leverage: it removes the trap rather than adding a detector for it.

## Deterministic check table
| ID | Result | Evidence |
|---|---|---|
| D1 empty-branch merge | PASS | Every merge in `2797126..HEAD` has ≥1 branch-side commit (`git rev-list --count <m>^1..<m>^2`); F5a merges 1-4 commits each, none empty |
| D2 worktree remnants | PASS | `git worktree list` = main only. `git branch --no-merged main` = 1 branch, `worktree-agent-ada3640f23484b4b5`, deliberately unmerged (holds only the excluded byproduct commit `2101611`), exclusion documented in the merge message and handoff |
| D3 dangling agent work | PASS | Only one dangling object from this session's agents (stash `wip-nonce-cookie-helper`, `auth.ts`); its content (`buildSessionCookieHeader`) verified present on main — nothing lost |
| D4 corpus chain usage | PASS | All 13 F5a tasks: exactly 1 claim + 1 release + evidence rows, each under a distinct `agent:<task-slug>` actor. Anchor-overlap gate had real identities to work with |
| D5 evidence oracle quality | PASS (with the V1 attestation gap now closed) | Every entry names an external command + oracle kind; zero self-assessment prose. Attestation was initially absent on 8/13 tasks — earned retroactively during this review |
| D6 gate bypass | PASS | No `LORE_GATE_BYPASS`, `--no-verify`, or `CLAUDE_SUBAGENT_GATE_BYPASS`. One `lore ac rm --force` used to correct the orchestrator's own mistyped AC command, immediately re-adding the SAME id so evidence `ac_ref`s stayed valid. Audit grep hits for "bypass" were doc-content false positives |
| D7 uncommitted state | PASS | `git status --porcelain` empty at session end; two remaining stashes are assets-manifest regen byproducts, disclosed in the handoff |

## Lore defect found (dogfooding — filed as this doc, `lore report-issue` unusable)

The `plan-close` deny pack's remediation text is **factually wrong and actively misleading**. It asserted: *"this plan has no spec-tier ancestor at all — `lore verify` requires one ... so no attested evidence can ever be recorded against it via that path"*, then offered only (1) reparent the plan or (2) declare `attestation_exempt_kind: "pipeline-unreachable"`. Ground truth: the plan's `parent_id` = `01KYM0MCW8YAKN0YD03J4A0KBQ` = `spec-dashboard-production-packaging-one-command-lore-dashboard` (type `spec`, kind `tech`, status `approved`, 8 script-mode ACs), and `lore verify` had already run against that exact plan three times, resolving all 8 ACs. Both offered remedies would have corrupted a correct corpus; the real fix (record attested evidence) was not mentioned and was empirically easy. The plan-close gate's ancestor resolution disagrees with `lore verify`'s on the same plan. `lore report-issue` could not be used — it requires `feedback.upstream` config that no init/setup path provisions (a separately-known gap).

## Out-of-scope observations
- The F5a evidence chain shows three consecutive "all-green" tasks shipping a feature whose authenticated surface was entirely non-functional; that is a test-design/coverage issue `[out-of-scope → lore-test]`, already captured as `knowledge-a-session-row-is-only-as-real-as-the-api-keys-row-it`.

## What went well
- **Claim/actor discipline was real, not nominal**: 13/13 tasks claimed from inside their own worktree under distinct `agent:<task-slug>` identities — the condition without which the anchor-overlap gate is decorative.
- **Attested verification caught what worktree self-report missed**: `lore verify` on main failed AC-F5A-5 after an agent reported green, exposing both a mistyped AC path (orchestrator's own error) and a genuine ambient-state test defect.
- **Concurrent-session restraint**: a foreign session held the shared checkout dirty; the orchestrator escalated to the user rather than stashing foreign work, and later merged only the anchored commit when an agent's branch tip collided with that session's file — documenting the exclusion instead of silently dropping or blind-merging it.
- **Honest failure accounting**: the 7 foreign full-suite failures were attributed with a reproducible `git log` command recorded verbatim in the plan's Decisions Log, not waved away in prose.

## N/A invariants
None — every catalogued invariant was exercised and judged.

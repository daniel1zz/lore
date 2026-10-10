---
name: lore-plan
description: "Cross-session task planning and tracking on the lore corpus. Use when: user says 'plan this', 'break this down', 'create a task tree', 'what's the plan status', 'how should I approach this project', 'resume the plan', 'add a task', '计划' / '拆解任务', multi-step work spanning sessions, or any complex task needing structured decomposition with risk tracking and phase gates. Mode: create, resume, update, replan, status, list."
---

# Plan - Mode: $0

Read `references/mode-$0.md` for modes with reference files. No mode → ask user.

| Mode | Reference | Focus |
|------|-----------|-------|
| `create` | `references/mode-create.md` | Create new plan with phases + task docs |
| `resume` | `references/mode-resume.md` | Resume existing plan |
| `update` | `references/mode-update.md` | Record task completion with evidence + AC verification |
| `replan` | `references/mode-replan.md` | Modify plan structure (add/cancel/restructure tasks) |
| `status` | `references/mode-status.md` | View plan progress + critical path + risks |
| `list` | `references/mode-list.md` | List all plans |

## ⛔ Cross-Cutting Reference — AC Quality (read for any mode that writes AC)

| Topic | File | Read when |
|---|---|---|
| **AC Quality discipline** | `references/ac-quality.md` | Writing or reviewing acceptance criteria. Enforces banned vague verbs (跑通 / works / implement / wire / integrate / support) and mandates an `Integration:` block per user-facing task so "tests GREEN but feature unreachable" cannot ship. |

## Architecture

Plan Skill is the **orchestration layer** on top of the lore corpus (per-project `.lore/` SQLite, `lore` CLI on PATH, `CLAUDECODE=1` exported so AI-assist defaults off):

- **Document chain**: `prd → spec → plan → task` — all typed lore docs addressed by slug (e.g. `plan-user-auth`, `task-jwt-middleware`). A plan's parent (`--parent`) is its governing spec; the spec itself has no parent and cites baseline rules.
- **Structured ACs live on the spec**: `lore ac add <spec> <AC-ID> --statement "..." --mode script|ai|human [--oracle ...] [--command "..."]`. The `spec-promote` gate requires ≥1 AC. Task-level AC text (in task content) covers spec AC ids; evidence references them via `--ac`.
- **Phases**: `lore phase add <plan> <name> [--description "..."]` — declared on the plan; tasks reference one via `--phase`.
- **Tasks**: `lore create task --title "..." --parent <plan> --plan-id <plan> --phase <name> --anchor <path>` — content carries Estimate / Approach / AC.
- **Dependencies**: `lore link <blocker> <blocked> --type=blocks`. Readiness is **computed** (`lore ready <plan> --json`), never stored — a task is ready iff not archived/deprecated AND every blocker is archived.
- **Execution lease**: `lore claim` / `lore release` — advisory, TTL computed read-side, claimed by the implementer from inside its own worktree, never pre-claimed by the orchestrator.
- **Evidence**: `lore evidence <task> --oracle ... --command "..." --result pass|fail [--ac <id>]` — append-only oracle records. Script-mode ACs get attested runs via `lore verify <plan>` (exit code decides, never self-asserted).
- **Deterministic gates**: `spec-create` / `spec-promote` / `plan-promote` / `task-claim` intercept writes automatically (exit 4 + feeding pack). **Expect denials; fix per the pack.** Never bypass (`LORE_GATE_BYPASS=1`) without explicit user say-so. **Legacy alias (SPEC-056 D7)**: a `phase` doc's claim gates on `phase-claim` (same anchor-overlap predicate, additive to `task-claim` — legacy `task` docs still gate on `task-claim` unchanged until migration); a config still keyed under `workflow.gates."task-claim"` is honored for `phase-claim` too (one deprecation warning per process, never a silent drop).
- **feed-before-produce**: `lore feed <checkpoint>` pulls governing rules before authoring (e.g. `lore feed spec-create`, `lore feed plan-promote`). Session resume: `lore feed session-resume`.
- **Validation**: pre-exec = `lore ready <plan> --json` + gates + the lore-reviewer audit as one lens of the single bundle review (batched-governance S3); post-exec = `lore assess <plan>` (LLM-as-judge vs spec ACs + evidence trail), batched once at the END of the initiative across all its plans.

Plan Skill adds **ceremony**: Invariants, Phase Gates, AC verification, estimation, critical path analysis, risk register, carry-forward constraints.

## Sequential Thinking — Default Reasoning Engine
Plan's core is structured decomposition. **Uses `mcp__sequential-thinking__sequentialthinking` by default**:
- `create`: requirements analysis → risk identification → task decomposition → estimation → dependency inference → critical path → phase partitioning
- `resume`: progress evaluation → risk re-assessment → blocker analysis → re-planning
- `replan`: change analysis → impact assessment → critical path recalculation → task adjustment

**Principle**: Reason about task structure and dependencies with ST first, then create the task docs.

## Definitions

### Definition of Ready (DoR) — task can start when ALL met:
1. AC clearly defined (verifiable, not vague) — task AC text + spec AC ids it covers
2. Dependencies satisfied — `lore ready <plan> --json` reports the task `ready: true` (all blockers archived)
3. Approach specified (for implement tasks — `Approach:` + `Source:` in task content)
4. No unresolved `[NEEDS CLARIFICATION]` in relevant specs
5. Estimate assigned (`Estimate: S|M|L|XL`)
6. File anchors declared (`--anchor`) if the task is intended for parallel dispatch

### Definition of Done (DoD) — plan complete when ALL met:
1. All tasks archived, or explicitly cancelled (deprecated with rationale in Decisions Log)
2. All AC verified: every task carries pass evidence (`lore evidence`); script ACs carry attested evidence (`lore verify`)
3. Post-execution assessment run: `lore assess <plan>` — in the initiative's single end-of-run assess batch (batched-governance § Execution and closure); findings triaged (fix or accept with rationale)
4. Risk register reviewed — all H/M risks either mitigated or accepted with rationale
5. No open `[NEEDS CLARIFICATION]` markers
6. Handoff written (`lore handoff --plan <plan>`) with carry-forward context
7. Estimation accuracy logged (actual vs. estimated per phase)
8. Spec code anchors declared for the landed implementation (`lore anchor add <spec> <path[#Symbol]>` per key implementation file) — arms the doc-code drift oracle (SPEC-045); `lore status --check-drift` must stay exit 0. Declare AFTER code lands, never at planning time (a not-yet-written path is instant `file_missing` drift)

## Plan Exit Criteria

### Completion criteria (all required):
- All phases passed Phase Gates
- `lore assess <plan>` verdict reviewed; gaps fixed or explicitly accepted
- Feature backtrack: 100% spec AC coverage (`lore ac list <spec>` vs evidence `--ac` refs), or gaps explicitly accepted
- Risk register: no open H-impact risks without acceptance rationale

### Failure / abandonment criteria (any triggers replan or cancel):
- >50% of critical path tasks blocked for >2 sessions → trigger `replan`
- >3 risks materialized in same phase → pause and reassess via `replan`
- Scope change invalidates >30% of existing tasks → trigger `replan`
- User explicitly requests cancellation → deprecate remaining tasks with retrospective (`lore create knowledge --sub-type retro`)

## Rules

1. Plans are lore `plan` docs; tasks are lore `task` docs — NOT markdown checkboxes, NOT TodoWrite
2. ⛔ NEVER use TodoWrite/TodoRead for cross-session plans — use lore task docs exclusively
3. ⛔ NO `.plan-registry.yaml` — use `lore list --type plan` for discovery
4. ⛔ NO `docs/plans/` files — plan content lives in the plan doc, tasks are task docs
5. Every plan has **Invariants** in its content — verified at each Phase Gate
6. Every task has **AC** in its content — verified against oracle evidence before archiving. Spec-level structured ACs are the SSOT the plan decomposes (`lore ac list <spec>`)
7. ⛔ **Governance is batched — one flow, no modes**: `~/.claude/skills/shared/batched-governance.md` (S1 one decision interview → S2 uninterrupted production of ALL plans as drafts → S3 one bundle review → S4 one user approval). Phase Gates run and auto-proceed; an Invariant violation hard-blocks. The user is consulted mid-execution only per that file's Execution section. There is no `governance_mode` field.
8. **Skill→Task mapping**: matched skill chain auto-maps to task tree
9. Phases are declared via `lore phase add`; every task assigns one via `--phase`
10. Every task has **Estimate** (T-shirt: S/M/L/XL) — XL tasks MUST be split
11. Every plan has a **Risk Register** — reviewed at each Phase Gate
12. **Critical path** identified post-creation — critical path tasks get `--priority critical|high` (readiness is computed; priority is the stored scheduling signal)
13. **INVEST complete**: Independent, Negotiable, Valuable, Estimable, Small, Testable — all 6 enforced
14. **TDD Injection (two-pass)**: when the plan contains implement or refactor tasks, create mode runs the 5.4 TDD Injection Pass — business decomposition (5.1-5.3) and test design (5.4) happen in separate passes to prevent attention dilution. Each implement task is auto-paired with a `[Skill:test]` RED task; dependency direction: test blocks impl. See `references/mode-create.md` step 5.4.
15. **File anchors are mandatory for parallel-dispatch tasks** — the `task-claim` (legacy) / `phase-claim` (SPEC-056) anchor-overlap gate only sees declared anchors. Tasks/phases with overlapping anchors get a `blocks` link (serialize) instead of leaving the conflict to dispatch time.
16. **Expect gate denials** — exit 4 + feeding pack is the system working, not an error to route around. Fix per the pack, retry the write.
17. **Concurrency discipline**: each concurrent implementer gets a distinct `LORE_ACTOR=agent:<branch-or-slug>`; claims happen inside the implementer's worktree; before dispatch check `lore ready <plan> --json` → `sessions[]` / `anchor_conflicts[]`.

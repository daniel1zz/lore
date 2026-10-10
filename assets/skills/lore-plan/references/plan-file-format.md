# Plan Document Content Format

Plans and tasks are BOTH typed lore docs addressed by slug (e.g. `plan-user-auth`, `task-jwt-middleware`) — NOT markdown checkboxes, NOT a separate tasks table. The plan doc's content carries the ceremony (Invariants, Risk Register, Critical Path); each task doc's content carries its own Estimate/Approach/AC; claims and evidence live in task `extra` fields written exclusively via `lore claim` / `lore evidence` (never by editing the doc); readiness is computed on demand via `lore ready <plan> --json`, never stored.

## Plan Document Content Structure

The plan doc's content (`lore create plan --content-file ...`) contains:

```markdown
# [Title]

## Overview
[1-2 paragraph scope description]

## Pre-registered Branches
[Decisions that depend on a future measurement, approved by the user in the batched-governance S1 interview — a result landing on a listed path proceeds without asking]

| # | Trigger (measurable) | Path if met | Path if not met | Assessed when |
|---|---|---|---|---|
| B1 | [e.g. pilot probe ≥ 9/10] | [continue to slice 2 as designed] | [switch to method v2: task-xxx] | [at pilot plan close] |

## Invariants
[Global constraints ALL tasks MUST obey — each must be verifiable]
- Naming: [convention]
- Structure: [pattern]
- Quality: [baseline]

## Risk Register
[Identified risks with assessment and mitigation — reviewed at each Phase Gate]

| # | Category | Impact | Trigger | Mitigation | Contingency | Status | Linked Task |
|---|----------|--------|---------|------------|-------------|--------|-------------|
| 1 | Technical | H | [observable condition] | [preventive action] | [reactive plan] | active | task-xxx |
| 2 | Dependency | M | [observable condition] | [preventive action] | [reactive plan] | active | — |
| 3 | Scope | L | [observable condition] | [built into AC] | [descope option] | active | — |

Status values: `active` → `mitigated` | `triggered` | `accepted` | `closed`

## Estimation Summary
- **Total**: {N} session-units (S=1, M=2, L=3)
- **Critical path**: {M} session-units
- **Per phase**: Phase 1: {n1} su | Phase 2: {n2} su | Phase 3: {n3} su
- **RCF multiplier**: 1.0 (updated at each phase gate based on actual vs. estimated)

## Critical Path
→ task-xxx ({est}) → task-yyy ({est}) → task-zzz ({est}) = {total} session-units

## Exit Criteria
- [ ] All phases passed Phase Gates
- [ ] Script-mode spec ACs attested: `lore verify <plan>` all pass
- [ ] Post-execution `lore assess <plan>` (initiative's end-of-run batch) verdict reviewed; gaps fixed or accepted
- [ ] Coverage backtrack: 100% spec ACs covered (or gaps accepted)
- [ ] Risk register: no open H-impact risks without acceptance
- [ ] DoD checklist: all 7 items satisfied (SKILL.md § Definition of Done)

## Phase Descriptions
[Brief description of each phase's purpose and constraints — mirrors the
`lore phase add --description` text, which is the machine-readable copy]

### Phase 1: [Name]
- **Context**: [dependencies on prior phases or "none"]
- **Constraints**: [phase-specific norms]
- **Estimate**: {N} session-units
- **Phase risks**: [risk #s from Risk Register relevant to this phase]

### Phase 2: [Name]
- **Context**: [depends on Phase 1 outputs]
- **Constraints**: [phase-specific norms]
- **Estimate**: {N} session-units
- **Phase risks**: [risk #s]

## Decisions Log
| Date | Decision | Rationale | Impact |
|------|----------|-----------|--------|
```

Note: session logs and carry-forward do NOT live in the plan doc — they are handoff docs
(`lore handoff --plan <plan> ...`), consumed next session via `lore feed session-resume`.
Editing an approved plan resets it to draft (re-approve re-fires plan-promote), so plan
content edits are batched at phase gates.

## Plan/Task Structure in lore

```
spec (lore doc, parent of plan; structured ACs via lore ac add)
└── plan-user-auth (lore doc, type=plan; phases declared via lore phase add)
    ├── [Phase 1: Research & Design]          ← phase = label on the plan, not a doc
    │   ├── task-research-auth      (task doc, --phase "Phase 1: Research & Design")
    │   ├── task-design-auth-api    (blocked by task-research-auth)
    │   └── task-design-db-schema
    ├── [Phase 2: Implementation]
    │   ├── task-jwt-middleware     (--anchor src/middleware/, priority: critical)
    │   └── task-password-hashing   (--anchor src/auth/hash.ts)
    └── [Phase 3: Verification]
        └── task-e2e-auth-review
```

**Cross-phase parallel example** (phases with no mutual data dependency):
```
plan-tooling-upgrade
├── [Phase A: Hook Upgrades]
│   ├── task-upgrade-hook-x   (--anchor hooks/pre-batch.mjs)
│   └── task-upgrade-hook-y   (--anchor hooks/pre-status.mjs, blocked by task-upgrade-hook-x)
├── [Phase B: Skill Rules]        ← no blocks edge into Phase A: runs in parallel
│   └── task-update-skill-z   (--anchor skills/lore-plan/)
└── [Phase C: Integration]
    └── task-e2e-validation   (blocked by task-upgrade-hook-y AND task-update-skill-z)
```
In this DAG, Phase A ∥ Phase B execute in parallel. Phase C's task fans in via two blocks links.
Critical path = max(Phase A, Phase B) + Phase C = max(4,3) + 2 = 6su (not 4+3+2=9su).

- **Phases** = labels declared on the plan (`lore phase add`); tasks reference one via `--phase`
- **Dependencies** = `lore link <blocker> <blocked> --type=blocks` between leaf tasks (phases are not linkable — inter-phase serialization is last-of-phase → first-of-next-phase edges)
- **Readiness** = computed: `lore ready <plan> --json` — a task is ready iff not archived/deprecated AND every blocker is archived
- **Done** = task archived (`lore set <task> --status approved` then `--status archived`); this is what unblocks dependents
- **Claims/evidence** = task `extra` fields owned by `lore claim`/`lore release`/`lore evidence` — visible as badges on `lore tree` (`[claimed:by@branch (stale) ✔n/✘n]`), never hand-edited
- **Critical path** = recorded in plan content + expressed as `--priority critical|high` on the member tasks

## Invariant Format

- Must be verifiable (not vague)
- ✅ "All API paths follow /api/v1/{resource}"
- ❌ "Follow best practices"
- ✅ "Test coverage ≥80% per module"
- ❌ "Write good tests"

## Task Content Format

Include estimate, approach, scope alternatives, spec AC coverage, and acceptance criteria:

```
[Skill:implement] Build user authentication endpoint

Estimate: M
Approach: express-jwt middleware + bcrypt
Source: adr-auth-stack section 3.2
Dimensions: D-FUNC, D-CODE, D-SEC
Scope-Alt: Can defer refresh token rotation to Phase 3 without blocking auth flow
Covers: AC-AUTH-1, AC-AUTH-2

AC:
- POST /api/v1/auth/login returns JWT on valid credentials
- Invalid credentials return 401 with { code, message } body
- Rate-limited to 5 requests/min per IP
```

Created via:
```
lore create task --title "[Skill:implement] Build user authentication endpoint" \
  --parent plan-user-auth --plan-id plan-user-auth --phase "Phase 2: Implementation" \
  --anchor src/routes/auth.ts --anchor src/middleware/ \
  --priority high --content-file /tmp/task.md
```

## Estimation Scale

| Size | Session-Units | Description | Example |
|------|--------------|-------------|---------|
| S | 1 | <1 session, trivial change | Config update, simple component |
| M | 2 | ~1 session, standard task | API endpoint, UI form |
| L | 3 | ~2 sessions, complex task | Auth system, DB migration |
| XL | 4 | >2 sessions → MUST SPLIT | ⛔ Violates INVEST "Small" |

## Risk Register Status Flow

```
active → mitigated   (mitigation task completed, risk neutralized)
active → triggered    (trigger condition observed, contingency activated)
active → accepted     (user decides to accept risk with rationale)
active → closed       (risk no longer relevant due to scope change)
triggered → mitigated (contingency resolved the issue)
```

---
name: lore-biz-review
description: "Use when generating a domain-specific business review along two axes, by role (who reviews) or by scenario (what situation is reviewed): 'biz review', 'business review', 'role-based review', 'scenario review', '业务评审'. NOT for building the domain model itself (use lore-domain)."
---

# Biz Review

Generate domain-specific business reviews via two orthogonal axes: **Roles** (who reviews) and **Scenarios** (what situation is reviewed).

## Args

`$ARGUMENTS` is parsed as: `[mode] [filter]`

- **mode** (optional): `role` (default), `scenario`, or `matrix`
- **filter** (optional): Depends on mode

| Mode | Filter values | What it does |
|------|--------------|--------------|
| `role` | `all` (default), `security`, `ux`, `business`, `ops`, or comma-separated slugs | Role-driven review (existing behavior) |
| `scenario` | `all` (default), `core`, `lifecycle`, `peak`, `failure`, `cross-domain`, `compliance`, or comma-separated slugs | Scenario-driven review |
| `matrix` | (none) | Role × Scenario cross-review |

Examples:
- `/biz-review` → all roles (backward compatible)
- `/biz-review role security` → security roles only
- `/biz-review scenario` → all scenarios
- `/biz-review scenario peak,failure` → peak & failure scenarios
- `/biz-review matrix` → full cross-review

## Data Sources

### Expert Lenses (roles)
1. `lore search "{domain} expert lens" --type knowledge --json` (filter results to `extra.sub_type = "retro"`)
2. If found → use as role definitions
3. If not found → generate via analysis, suggest `domain:quick-lens`

### Business Scenarios
1. `lore search "{domain} business scenario" --type knowledge --json` (filter results to `extra.sub_type = "retro"`)
2. If found → use as scenario definitions
3. If not found → **auto-derive** via Scenario Discovery (below), suggest persisting

## Scenario Discovery (auto-derivation)

When no `business-scenarios.md` exists, derive scenarios from available sources:

1. **From domain docs**: Read `workflows.md`, `rules.md`, `entities.md` → extract core flows, state transitions, business rules
2. **From code**: serena `get_symbols_overview` on domain entry points → identify API endpoints, event handlers, state machines
3. **From Expert Lenses**: Cross-reference role scenarios → promote shared concerns to standalone scenarios
4. **Apply Scenario Dimensions**:

| Dimension | What to look for | Tag |
|-----------|-----------------|-----|
| **Core flows** | Product main paths end-to-end | `core` |
| **Lifecycle transitions** | State changes of users, data, system | `lifecycle` |
| **Peak & stress** | Abnormal scale or pressure | `peak` |
| **Failure & recovery** | System behavior after faults | `failure` |
| **Cross-domain** | Multi-domain coordination | `cross-domain` |
| **Compliance triggers** | Regulatory/policy-driven | `compliance` |

5. **Confirm**: Present discovered scenarios to user for adjustment
6. **Suggest persist**: Recommend saving as `business-scenarios.md` via domain docs

## Workflow by Mode

### Mode: `role` (default)

1. Load Expert Lenses → gap analysis against Role Dimensions → tag → filter → confirm
2. Generate per-role commands (`biz-review-{slug}.md`)
3. Generate scene group commands + unified command

### Mode: `scenario`

1. Load Business Scenarios (or auto-derive)
2. Gap analysis against Scenario Dimensions → tag → filter → confirm
3. Generate per-scenario commands (`biz-review-scenario-{slug}.md`)
4. Each command reviews the change through the scenario's lens: trigger → happy_path → edge_cases → failure_modes → cross_cutting. `failure_modes` is never optional filler (shared discipline `../shared/verification-discipline.md`): every scenario names at least one business-level mandated failure (limit hit, payment declined, permission revoked mid-flow, upstream outage) and rules on whether the change fails it LOUDLY and recoverably — "no failure mode applies" must be argued, not defaulted.

### Mode: `matrix`

1. Load both Roles and Scenarios
2. Build relevance matrix: for each (Role, Scenario) pair, determine if the role is an actor in that scenario
3. Present matrix to user for confirmation
4. Generate `biz-review-matrix.md` that launches parallel Task agents:
   - One agent per relevant (Role, Scenario) cell
   - Each agent reviews the change as {Role} in {Scenario} context
5. Synthesize into unified report with findings grouped by severity, cross-referenced by role and scenario

## Role Dimensions (gap analysis)

| Dimension | Expand into... | Scene tags | Examples |
|-----------|---------------|------------|----------|
| **End users** | All distinct user segments | `ux`, `business` | Game: player, streamer, guild leader |
| **Domain experts** | Professional rule enforcers | `business` | Accountant, physician, game designer |
| **Compliance & security** | Constraint/regulation enforcers | `security` | Security auditor, privacy officer |
| **Business ops** | Day-to-day operators | `ops`, `business` | Support agent, ops manager |

## Command Generation

### Per-role (`biz-review-{slug}.md`)
Embeds lens identity, checklist, red_flags, scenarios. Single-role review.

### Per-scenario (`biz-review-scenario-{slug}.md`)
Embeds scenario trigger, context, happy_path, edge_cases, failure_modes, cross_cutting. Evaluates the change against this specific business situation.

### Per-scene (`biz-review-{scene}.md`)
Launches matching role commands in parallel → synthesizes.

### Matrix (`biz-review-matrix.md`)
Launches (Role × Scenario) agents in parallel → synthesizes with cross-reference table.

### Unified (`biz-review-all.md`)
Launches all role + scenario commands → unified report by severity.

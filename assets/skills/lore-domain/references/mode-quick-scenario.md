# Domain - Mode: quick-scenario

**Purpose**: Rapidly create Business Scenarios without full domain documentation

## When to Use
- Domain exists but has no `business-scenarios.md`
- `biz-review scenario` finds no scenarios and suggests creation
- Suggested by workflow's `[DOC_ROUTE]` gaps

## Workflow

1. **Identify domain**: From user request or `[DOC_ROUTE]` gap
2. **Source analysis** (pick available sources, in priority order):
   - `workflows.md` → extract core flows and state transitions
   - `rules.md` → extract constraint-triggering situations
   - `entities.md` → extract lifecycle transitions
   - serena: `get_symbols_overview` on domain entry points → API endpoints, event handlers, state machines
   - Expert Lenses → cross-reference role scenarios for shared concerns
3. **Apply Scenario Dimensions** (see `domain-docs-template.md`):
   - Core flows, Lifecycle transitions, Peak & stress, Failure & recovery, Cross-domain, Compliance triggers
   - Target: 3-8 coarse-grained scenarios per domain
4. **Tag** each scenario: `core`, `lifecycle`, `peak`, `failure`, `cross-domain`, `compliance`
5. **Confirm**: Present scenario list to user for adjustment
6. **Persist**:
   - Create `docs/domain/{domain}/business-scenarios.md`
   - If dir doesn't exist → also create minimal `README.md` + `index.yaml`
   - Register in lore: `lore create knowledge --sub-type reference`

## Output
- `docs/domain/{domain}/business-scenarios.md`
- Minimal scaffolding if new domain
- lore registration (knowledge doc, `--sub-type reference`)

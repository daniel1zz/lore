# Domain - Mode: quick-lens

**Purpose**: Rapidly create Expert Lenses without full domain documentation

## When to Use
- Domain exists in codebase but has no Expert Lenses
- Suggested by workflow's `[DOC_ROUTE]` Gaps
- Quick domain perspective injection without full `domain:create` overhead

## Workflow

1. **Identify domain**: From user request or `[DOC_ROUTE]` gap
2. **Lightweight analysis**:
   - serena: `get_symbols_overview` on key domain files
   - Identify core entities, business rules, user-facing behaviors
3. **Generate lenses** (3-5 perspectives per [expert-lenses.md schema](domain-docs-template.md)):
   - End users (daily context, constraints, emotions)
   - Domain experts (professional rules, safety, compliance)
   - Operations (edge cases, failure modes, support)
   - Key principle: **specificity over generality**
4. **Confirm**: Present lens list to user for adjustment
5. **Persist**:
   - Create `docs/domain/{domain}/expert-lenses.md`
   - If dir doesn't exist → also create minimal `README.md` + `index.yaml`
   - Register in lore: `lore create knowledge --sub-type reference`

## Output
- `docs/domain/{domain}/expert-lenses.md`
- Minimal scaffolding if new domain
- lore registration (knowledge doc, `--sub-type reference`)

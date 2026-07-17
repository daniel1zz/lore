# Domain - Mode: update

**Purpose**: Update domain knowledge after code changes

## Workflow

1. **Detect changes** (serena: find_symbol, search_for_pattern + lore: `lore search "<domain>" --type knowledge` / `lore get <slug>`)
   - New entities/fields, changed business rules, modified workflows, moved files
   - New/changed aggregates, modified invariants, changed consistency boundaries
   - New domain terms or term meaning drift

2. **Update docs** at `docs/domain/{domain}/`
   - entities.md, rules.md, workflows.md, codebase.md as needed
   - aggregates.md: update invariants, cross-aggregate references, consistency choices
   - glossary.md: add new terms, update definitions, flag code-UL mismatches
   - Tools: serena: replace_content; lore: `lore set <doc> --content ...`, `lore link` / `lore unlink`

3. **Update metadata** at `docs/domain/{domain}/index.yaml`
   - updated date, entity_count/aggregate_count/rule_count/workflow_count/glossary_term_count, dependencies

## Lens Evolve

When updating after bug fixes or incident resolution, also evolve Expert Lenses:

1. Load `expert-lenses.md` for the domain
2. Evaluate: did the bug/incident reveal a gap in existing lenses?
   - Edge case missed → add to relevant lens's `checklist`
   - Anti-pattern caused bug → add to relevant lens's `red_flags`
   - New user scenario discovered → add to `scenarios`
3. Update via `lore set <doc> --content ...` for the registered knowledge doc
4. Output: `**[LENS_EVOLVE]** {domain} | {lens} | added: {checklist|red_flag|scenario} — "{item}"`

Skip if bug was purely technical (no domain/business dimension).

## UL Drift Detection

When updating domain knowledge, check for Ubiquitous Language drift:

1. Compare glossary terms against current code symbols (`serena: find_symbol`)
2. Flag **drift patterns**:
   - **Renamed in code**: Code symbol changed but glossary still has old name → update glossary
   - **New term introduced**: New class/type added without glossary entry → add to glossary
   - **Meaning shifted**: Term's usage in code no longer matches glossary definition → update definition
   - **Synonym creep**: Multiple code symbols for same concept → flag for alignment
3. Output: `**[UL_DRIFT]** {domain} | {term} | {drift_type} — "{details}"`

## Aggregate Evolve

When code changes affect aggregate boundaries:

1. Check if new entities were added to an aggregate
2. Check if invariants were added/modified/removed
3. Check if cross-aggregate consistency strategy changed
4. Update `aggregates.md` accordingly
5. Output: `**[AGG_EVOLVE]** {domain} | {aggregate} | {change_type} — "{details}"`

## Triggers

- "Update domain knowledge" / "Sync domain docs"
- After knowledge-persist suggests domain update
- After bug-fix sessions where domain lenses exist (lens evolve)
- After refactoring sessions that move entities or change boundaries (aggregate evolve)
- After feature additions that introduce new domain terms (UL drift detection)

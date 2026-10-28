# Domain - Mode: create

**Purpose**: Create domain knowledge documentation and skill

## Workflow

### 1. Extract Knowledge

serena: find_symbol, get_symbols_overview, search_for_pattern
→ Entity definitions, business rules, workflows, code locations

### 2. Create Docs

Path: `docs/domain/{domain}/`

| File | Content |
|------|---------|
| README.md | Overview, quick reference, strategic type (core/supporting/generic) |
| entities.md | Definitions, relationships |
| aggregates.md | Aggregate boundaries, invariants, consistency rules |
| rules.md | Constraints, validations |
| workflows.md | Processes, state machines |
| glossary.md | Ubiquitous Language terms, definitions, code mappings |
| codebase.md | Code locations, file index |
| expert-lenses.md | Expert evaluation frameworks |
| index.yaml | Domain metadata (including `strategic_type`) |

Tools: serena create_text_file; register in lore: `lore create knowledge --parent <spec or prd it concerns> --sub-type reference --title "Domain — {domain}"` + `lore link <from> <to> --type relates-to`
Templates: See [domain-docs-template.md] and `~/.claude/templates/domain-*.md`

### 2a. Create Aggregate Documentation

For each aggregate identified during analysis (see [aggregate-design.md](aggregate-design.md)):

1. Identify root entity, internal entities, value objects
2. Document invariants: business rules that must hold atomically within the aggregate
3. List commands accepted and events emitted
4. Map cross-aggregate references (by ID only)
5. Document consistency strategy for each cross-aggregate relationship (strong vs eventual)
6. Record lifecycle/state machine

Persist in `docs/domain/{domain}/aggregates.md` using the template from [aggregate-design.md](aggregate-design.md).

### 2b. Generate Expert Lenses

For each domain, identify 3-5 relevant expert perspectives:
- **End users**: Who uses this daily? (context, constraints, emotions)
- **Domain experts**: Who knows the professional rules? (safety, compliance, best practice)
- **Operations**: Who supports/maintains this? (edge cases, failure modes)

Per lens, define: identity, priorities (ordered), checklist (specific evaluation items), red_flags (code/design danger signals), scenarios (real usage situations with environmental context).

Key principle: **specificity over generality**. Not "consider safety" but "check allergen cross-reactivity for infants under 12mo". The more concrete, the more authentic the AI's expert perspective.

Confirm lens list with user before generating. Store in `expert-lenses.md` + register in lore (`lore create knowledge --parent <spec or prd it concerns> --sub-type reference`).

### 2c. Create Ubiquitous Language Glossary

1. Extract terms from code: class/type names (nouns), method names (verbs), enum values (states)
2. Extract terms from PRD/user stories via `lore search "<term>" --type prd`
3. For each term: definition, code symbol, bounded context scope, synonyms, anti-terms
4. Cross-reference code vs business terminology — flag mismatches
5. Persist in `docs/domain/{domain}/glossary.md` + register in lore (`lore create knowledge --parent <spec or prd it concerns> --sub-type reference`)

### 2d. Event Storm Documentation (optional, for analyzed domains)

If Event Storming was performed in analyze mode, persist results:
1. Event timeline per business process
2. Command → Event → Actor triples
3. Policy catalog (reactive rules)
4. Aggregate clusters
5. Hotspot register
6. Pivotal events list
Persist in `docs/domain/{domain}/event-storm.md` + register in lore (`lore create knowledge --parent <spec or prd it concerns> --sub-type reference`).

### 3. Create Skill + Command

- `.claude/skills/{domain}-domain/SKILL.md` — scope, boundaries, constraints, cross-domain rules
- `.claude/commands/{domain}.md` — activation command

### 4. Register in CLAUDE.md

Add domain to "Domain Expert Selection" section with scope, activation command, selection rules.

## Skill Template Structure

```
name: {domain}-domain
Strategic Type: Core | Supporting | Generic
Scope: Covers / Does NOT Cover (→ other-domain)
Core Constraints (MUST follow)
Quick Reference: Entity | Purpose | Docs
Aggregates: Aggregate | Root | Key Invariant
Code Entry Points: Component | Path
Cross-Domain: With | Direction | Interface | Pattern
Load More: links to entities/rules/workflows/aggregates/glossary/codebase.md
```

## CLAUDE.md Integration

```
Domain Knowledge Activation (MANDATORY at task start):
1. Analyze request → identify domains
2. Activate (max 2) → announce
Available: | Domain | Type | Scope | Activate |
Selection rules: entity→domain mapping
Loading: SKILL.md auto, README.md auto, others on-demand
```

## Required Output

- `docs/domain/{domain}/` (full structure including aggregates.md and glossary.md)
- `.claude/skills/{domain}-domain/SKILL.md`
- `.claude/commands/{domain}.md`
- Updated CLAUDE.md

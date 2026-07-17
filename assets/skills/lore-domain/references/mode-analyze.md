# Domain - Mode: analyze

**Purpose**: Analyze codebase to discover and map business domains using DDD strategic and tactical patterns.

## DDD Methodology Pipeline

```
Structure Scan → Event Storming → Aggregate Design → Context Mapping → Strategic Classification → UL Extraction
```

Each step feeds the next. Skip steps only if domain is trivially simple (≤2 entities, single bounded context).

## Methodology References

| Step | Reference | When to Load |
|------|-----------|--------------|
| Event Storming | [event-storming.md](event-storming.md) | Always for non-trivial domains |
| Aggregate Design | [aggregate-design.md](aggregate-design.md) | When entity clusters identified |
| Context Mapping | [context-mapping.md](context-mapping.md) | When multiple bounded contexts found |
| Analysis Checklist | [analysis-checklist.md](analysis-checklist.md) | Always — verification gate |

## Workflow

### 1. Check Existing Knowledge
`lore search "<domain>" --type knowledge` + `lore get <slug>` → skip what's already documented.

### 2. Structure Scan
- serena: `list_dir`, `find_file` + Grep for `*Service`/`*Entity`/`*Model`/`*Repository`/`*Event` patterns
- Map architecture style: DDD / feature modules / layered / hexagonal / monolith

### 3. Event Storming (NEW — see [event-storming.md](event-storming.md))
Primary DDD discovery technique. Execute the 7-step workshop flow:
1. **Event Discovery**: Collect all domain events from code (past-tense, `*Event`, `emit(`, state transitions)
2. **Timeline Ordering**: Arrange chronologically along business process swimlanes
3. **Command & Actor Identification**: Trace what/who triggers each event
4. **Policy Discovery**: Find reactive rules (event → command chains)
5. **Aggregate Clustering**: Group commands+events around consistency boundaries
6. **Hotspot Identification**: Mark contentious/complex/coupled areas
7. **Pivotal Events**: Identify phase-transition events that suggest context boundaries

**Complex domains**: Use `Sequential Thinking` for hotspot analysis and boundary decisions.

### 4. Aggregate Design (NEW — see [aggregate-design.md](aggregate-design.md))
For each aggregate cluster from Event Storming:
1. **Invariant Analysis**: Identify business rules that must hold atomically
2. **Boundary Sizing**: Apply contention-vs-invariant test
3. **Entity/VO Classification**: Distinguish entities (identity, mutable) from value objects (no identity, immutable)
4. **Cross-Aggregate Consistency**: Choose strong vs eventual consistency per relationship

### 5. Domain Identification & Context Mapping (STRENGTHENED — see [context-mapping.md](context-mapping.md))
- **Business-first**: PRD/user stories → business capabilities → candidate bounded contexts
- **Context detection**: Separate deployables > separate DB > separate modules > directory boundaries
- **Relationship mapping**: For each context pair, classify using full pattern catalog:
  Partnership, Shared Kernel, Customer-Supplier, Conformist, ACL, Open Host Service, Published Language, Separate Ways
- **Upstream/downstream**: Determine dependency direction via import analysis, API provider/consumer, event producer/subscriber
- **Boundary signals**: strong (different language, separate data, independent lifecycle) vs weak (shared tables, tight coupling, circular deps)

### 6. Strategic Domain Classification (NEW — see [context-mapping.md](context-mapping.md))
Classify each bounded context:

| Type | Definition | Investment |
|------|-----------|------------|
| **Core** | Competitive advantage, unique business value | Highest — best engineers, deepest modeling, most tests |
| **Supporting** | Necessary but not differentiating | Medium — pragmatic, good enough |
| **Generic** | Commodity, same across industries | Minimal — buy/SaaS/open-source |

Classification drives: build-vs-buy, team allocation, testing depth, documentation depth, refactoring priority.

### 7. Ubiquitous Language Extraction (NEW)
For each bounded context, extract and document the ubiquitous language:

1. **Term extraction from code**:
   ```
   serena: get_symbols_overview → class/interface/type names (domain nouns)
   serena: search_for_pattern → public method names (domain verbs)
   serena: search_for_pattern → enum values (domain states/categories)
   Grep: JSDoc/comments containing domain terminology
   ```

2. **Term extraction from PRD/stories**: `lore search "<term>" --type prd` → terms used by stakeholders

3. **Cross-reference**: Code terms vs PRD terms. Flag mismatches:
   - Same concept, different names → alignment needed
   - Same name, different meanings across contexts → acceptable (bounded context isolation)
   - Code uses technical jargon instead of domain term → rename candidate

4. **Persist**: `docs/domain/{domain}/glossary.md` → register in lore (`lore create knowledge --sub-type reference`)

## Output

- Domain analysis report + domain map table (with Context Mapping patterns + strategic classification)
- Event Storm summary (events, commands, aggregates, hotspots)
- Aggregate design summary (boundaries, invariants, consistency choices)
- Ubiquitous Language glossary per context
- Recommended domain list + interaction diagram
- Artifact: `docs/domain/DOMAIN-MAP.md` → register in lore (`lore create knowledge --sub-type reference`)

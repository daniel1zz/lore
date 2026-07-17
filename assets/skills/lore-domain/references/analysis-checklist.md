# Domain Analysis Checklist

## Phase 1: Structure Scan

- [ ] Scan `src/` top-level, identify domain dirs (domains/modules/features/contexts)
- [ ] Map architecture style (DDD/feature modules/layered/hexagonal)
- [ ] Find patterns: `*Entity.*`, `*Service.*`, `*Repository.*`, `*Event.*`, `*Command.*`

## Phase 2: Event Storming (see [event-storming.md](event-storming.md))

- [ ] Discover domain events: search `*Event`, `emit(`, `publish(`, state transitions, audit logs
- [ ] Order events chronologically along business process timelines
- [ ] Identify commands: what action triggers each event?
- [ ] Identify actors: who/what issues each command? (user roles, system crons, external webhooks)
- [ ] Discover policies: reactive rules ("when X happens, do Y")
- [ ] Cluster into aggregate candidates: commands+events grouped by consistency boundary
- [ ] Mark hotspots: contentious, complex, coupled, or missing areas
- [ ] Identify pivotal events: phase transitions suggesting context boundaries

## Phase 3: Aggregate Design (see [aggregate-design.md](aggregate-design.md))

- [ ] Per aggregate: identify root entity, internal entities, value objects
- [ ] Per aggregate: list invariants (business rules that must hold atomically)
- [ ] Apply boundary sizing: contention-vs-invariant test for each entity grouping
- [ ] Classify internal components: Entity (has identity, mutable) vs Value Object (no identity, immutable)
- [ ] Cross-aggregate references: by ID only, never by direct object reference
- [ ] Cross-aggregate consistency: choose strong vs eventual per relationship, document rationale
- [ ] Flag anti-patterns: God Aggregate, Anemic Aggregate, cross-aggregate transactions, invariant leaks

## Phase 4: Domain Identification & Context Mapping (see [context-mapping.md](context-mapping.md))

- [ ] Cluster aggregates into bounded contexts (shared language, shared lifecycle, team ownership)
- [ ] Map services → aggregates, service dependencies, cross-service calls
- [ ] Map data flow: cross-domain imports, event pub/sub, integration points
- [ ] Classify each relationship: Partnership, Shared Kernel, Customer-Supplier, Conformist, ACL, OHS, PL, Separate Ways
- [ ] Determine upstream/downstream for each relationship
- [ ] Document integration type per relationship: sync API / async event / shared DB / file transfer

## Phase 5: Strategic Classification

- [ ] Classify each bounded context: Core / Supporting / Generic
- [ ] Document rationale per classification (business uniqueness, complexity, change frequency, competitive impact)
- [ ] Derive investment strategy: build-vs-buy, team allocation, testing depth
- [ ] Flag anti-patterns: core treated as generic, generic built from scratch

## Phase 6: Ubiquitous Language

- [ ] Extract domain terms from code: class names (nouns), method names (verbs), enum values (states)
- [ ] Extract domain terms from PRD/user stories
- [ ] Cross-reference: flag mismatches between code and business terminology
- [ ] Create glossary per bounded context: term, definition, code symbol, context scope
- [ ] Validate: same name different meaning across contexts is OK (context isolation)
- [ ] Validate: same concept different names within one context is NOT OK (alignment needed)

## Phase 7: Expert Mapping

- [ ] 1 bounded context = 1 expert, related entities grouped, clear scope, max 5-7 total
- [ ] Naming: `{domain}-domain` format, consistent, no overlap
- [ ] Per expert: IN/OUT scope defined, no overlap, cross-domain handoffs defined

## Phase 8: Documentation Creation (per domain)

- [ ] `docs/domain/{domain}/`: README, entities, rules, workflows, codebase, glossary, aggregates, index.yaml
- [ ] `docs/domain/{domain}/event-storm.md` (if Event Storming was performed)
- [ ] `.claude/skills/{domain}-domain/SKILL.md`
- [ ] `.claude/commands/{domain}.md`
- [ ] CLAUDE.md updated with domain selection section

## Phase 9: Verification

- [ ] README ~300-500 lines, constraints accurate, code paths correct
- [ ] Aggregate boundaries match transaction boundaries in code
- [ ] Ubiquitous language glossary terms match actual code symbols
- [ ] Context map relationships match actual import/event/API patterns
- [ ] Strategic classification is justified (not all "core")
- [ ] Slash command works, skill loads, README loads on activation

## Serena Tool Reference

```
activate_project | list_dir | find_file | get_symbols_overview
find_symbol | search_for_pattern | find_referencing_symbols
```

---
id: BASE-082
type: baseline
role: intent
title: "Standard: storage"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-094
links:
  - {id: SPEC-002, type: supersedes}
---
# Standard: storage

Rules for the store layer: schema evolution and query safety.

Each rule is an AS-n in four parts. The rule records (`extra.rules`) are the source of truth; the section below renders them as stored on 2026-10-10 so a reader of this body sees all four parts. Edit rules with `lore rule set`, then re-render.

## AS-11: Schema changes are append-only: a shipped migration is never edited, a change adds the next numbered migration, and every real store applies the same migration SQL constants.

- Confidence: established; enforced by: prompt-only; lifecycle: live
- **Current Reality**: Measured 2026-10-10: packages/lore/src/store/migrations holds migration-001..015 (plus 001-initial.sql); sqlite-store.ts and turso-store.ts each reference the shared MIGRATION_0nn constants (35 references each). No test pins a shipped migration's bytes, so 'never edit in place' is held by the store module doc and review.
- **Target Rule**: Each schema change is a new migration constant applied by SQLiteStore and TursoStore alike; shipped migration text never changes.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None known. A byte-pin test over shipped migrations would move enforcement from prompt-only to guaranteed.
- **Examples**:
  - Adding the AS/AD rule-id prefixes added migration-015 rather than altering migration-014.
  - Refused in review: editing migration-009's audit hash backfill after it shipped.

## AS-12: User text never reaches SQL unescaped: FTS5 MATCH input always passes escapeFtsQuery (empty input short-circuits before MATCH), and every value, LIMIT and OFFSET is a bind parameter.

- Confidence: established; enforced by: prompt-only; lifecycle: live
- **Current Reality**: Measured 2026-10-10: the two FTS5 MATCH sites (sqlite-store.ts, turso-store.ts) bind escapeFtsQuery(query) as a '?' parameter after an empty-input short-circuit; no LIMIT/OFFSET template interpolation found in packages/lore/src/store.
- **Target Rule**: Same as today for every new query: escape FTS input with escapeFtsQuery, short-circuit empty input, bind every value.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed.
- **Examples**:
  - A search for 'NOT foo*' is phrase-quoted so the FTS5 operators are inert.
  - lore audit --limit 5 binds 5 as a parameter; it is never interpolated into the SQL string.

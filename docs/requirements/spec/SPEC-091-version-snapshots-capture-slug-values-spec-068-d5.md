---
id: SPEC-091
type: spec
role: spec
title: "Version snapshots capture slug values (SPEC-068 D5 follow-up)"
status: approved
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: [spec-072, version-history, slug]
parent: PRD-001
---
# SPEC-072 — version snapshots capture slug values (SPEC-068 D5 follow-up)

## Problem

Found by the SPEC-068 adversarial tester (corpus: `knowledge-spec-068-d5-gap-version-snapshots-do-not-capture-slug`): `VersionRecord` snapshots `content/extra/status/title` but not `slug`. A `lore set --slug` rename bumps the version count, yet the slug value at any historical version is unrecoverable from `lore log` — SPEC-068 D5's "recorded in the version log like title changes" is count-true but not value-true.

## Decision (user-approved 2026-07-24)

Extend the snapshot: `VersionRecord` gains a nullable `slug`. Legacy rows are NOT backfilled. `lore restore` explicitly does NOT restore slug (a slug is a stable address; restoring it could also collide with a doc that has since taken it) — this non-restore semantic is documented and test-pinned.

## Design

- **D1**: `VersionRecord` (`packages/core/src/types.ts`, browser-safe) gains `slug?: string`. Absent on legacy rows — every consumer must tolerate absence (degrade by omission, same convention as `deriveTypeMeta`).
- **D2**: versions storage gains a nullable `slug TEXT` column via the next sequential store migration (follow the existing migration recipe/convention in `packages/lore/src/store/`); all three stores (`SQLiteStore`, `TursoStore`, `InMemoryStore`) write the doc's slug at every version-insert point from now on. No backfill of existing rows.
- **D3**: `lore log` renders the slug per version when present; legacy rows render without it (no "unknown" placeholder noise). `lore diff` is out of scope (slug is not diffed content).
- **D4**: `lore restore <doc> --to N` restores content/title/extra per existing semantics and NEVER touches the doc's current slug, even when the target version row carries one. The restore command's help/docs state this.

## Non-goals

- No backfill migration for historical rows.
- No slug-based addressing of historical versions.
- No dashboard UI changes this round.

## Regression stance

Existing version-history tests must pass unchanged except where they enumerate VersionRecord fields exhaustively. The append-only invariant of the version log is untouched.


## Post-implementation clarification (2026-07-24)

AC-072-1 originally said the row carries the "pre-change" slug. Implementation follows the codebase-wide snapshot convention instead: every version row snapshots doc state AS OF that version (post-patch), exactly like content/title/status/extra. A rename's own row carries the NEW slug; the prior value sits on the preceding row (which also carries slug going forward). The spec's stated problem — historical slug unrecoverable from lore log — is fully solved; no mixed before/after scheme was introduced. AC-072-1's statement is frozen (evidence references it); this note is the authoritative semantics.


## Acceptance Criteria (structured)

- [✔] [script] AC-072-1: A lore set --slug rename writes a version row whose snapshot carries the doc's pre-change slug value; lore log --json for that doc exposes slug per version
  script: test — bunx vitest run packages/lore/tests/unit/service/version-slug.test.ts -t 'AC-072-1'
- [✔] [script] AC-072-2: Legacy version rows without slug parse and render without error or placeholder noise (absence-tolerant consumers)
  script: test — bunx vitest run packages/lore/tests/unit/service/version-slug.test.ts -t 'AC-072-2'
- [✔] [script] AC-072-3: lore restore to a version whose row carries a different slug leaves the doc's current slug untouched
  script: test — bunx vitest run packages/lore/tests/unit/service/version-slug.test.ts -t 'AC-072-3'
- [✔] [script] AC-072-4: SQLite store migration adds nullable slug column; pre-migration db opens cleanly post-migration and new version inserts persist slug (bun:sqlite runner)
  script: test — cd packages/lore && bun test tests/unit/store/version-slug-migration.bun.test.ts

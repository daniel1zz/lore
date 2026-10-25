---
id: KN-792
type: knowledge
role: knowledge
title: "DUPLICATE_SLUG existing_id names the doc that already holds the slug"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
---
- **`DUPLICATE_SLUG.existing_id` names the doc that ALREADY HOLDS the slug, never the rejected one** — each store resolves the conflicting row through its own lookup before constructing the error (`TursoStore.findSlugConflictId`, `SQLiteStore.findSlugConflictIdSync`, `InMemoryStore.findSlugConflict`). ⛔ `existing_id: doc.id` is the false label this closed: the id of the doc the UNIQUE index just REJECTED and therefore never persisted, so `corpusService.get(error.existing_id)` answered `DOC_NOT_FOUND` every time — and it survived because the two stores that got it wrong need a real database while the one that got it right is the vitest double. ⛔ Deliberately NOT one cross-store construction site: the lookup is sync `bun:sqlite` / async libsql on either a client or a live tx / a `Map` scan, and the only shareable part is a two-field literal a fourth store could fill in wrongly just as easily. What refuses that drift instead is a SOURCE CENSUS in `tests/unit/store/sqlite-store.bun.test.ts` — zero `existing_id: doc.id` outside comments, exactly ONE construction site per store file, exactly 3 total, with a positive control asserting all three files were actually scanned. A new store adds one lookup and bumps that count. ⛔ Neither lookup filters `deleted_at`: `docs.slug` is column-level UNIQUE (migration-006), not a partial index, so a soft-deleted row still holds its slug and still refuses the insert — adding the filter would silently convert honest `DUPLICATE_SLUG`s into the vanished-holder branch. A vanished holder returns `STORE_ERROR`, never `DUPLICATE_SLUG` with a fabricated id. SSOT: `task-skill-implement-duplicate-slug-existing-id-names-the`.

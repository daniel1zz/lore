---
id: RETRO-001
type: knowledge
role: knowledge
sub_type: retro
title: "Phase 1 Retrospective — CLI + Local Store"
status: approved
priority: medium
created: 2026-06-08
updated: 2026-06-08
tags: [retro, phase-1, learnings]
parent: PRD-001
---

# Phase 1 Retrospective — CLI + Local Store

## Delivery Summary

| Metric | Target | Actual |
|---|---|---|
| Duration | M1-M3 (3 months) | ~1 session (accelerated by AI parallelism) |
| Total tests | — | 868 (386 vitest + 482 bun:test) |
| Source files | — | 34 files, 5,831 LOC |
| Binary cold-start | < 200ms | 42ms |
| CLI commands | 18 planned | 18 delivered |
| Risks cleared | 3 identified | R1 (bun:sqlite compile) ✅, R2 (MDX cold start) ✅, R7 (Bun compile) ✅ |

## What Worked

1. **Interface-First strategy** — Defining types and StoreInterface first enabled 5 services to be implemented in parallel with zero merge conflicts. Each service owned disjoint files.

2. **Service layer abstraction** — Every CLI command is a thin adapter (parse args → call service → format output). This made the CLI implementation mechanical after services were done.

3. **Dual-key ID scheme (ULID + slug)** — Slugs make CLI UX natural (`lore get spec-auth-v2`). ULIDs provide stable internal references. The resolve pattern works well.

4. **Regex-based MDX over remark/unified** — Avoided heavy dependency. Regex handles self-closing MDX components for Phase 1. Keeps cold-start at 42ms.

5. **InMemoryStore test double** — 52 tests mirror SQLiteStore behavior, proving adapter independence. All service tests use InMemoryStore for speed.

6. **TDD pairing** — Each service had RED tests written before or alongside implementation. Caught issues early.

## What Didn't Work

1. **Slug resolution not in all services** — CorpusService had `resolve()` from the start, but ReviewService and VersionService used `store.find(id)` directly, which only accepts ULIDs. CLI passes slugs, causing DOC_NOT_FOUND. Required post-integration fix to extract shared `resolveDoc()`.

   **Root cause**: Subagents for B.2 and B.3 followed their spec literally (SPEC-005 and SPEC-006 defined `DocId` params), but the CLI adapter passes user input (which may be slug). The spec-to-implementation gap is at the service boundary.

   **Fix for P2**: Service interfaces should accept `string` (idOrSlug) not `DocId`, and resolve internally. Update SPEC-001 §3.2 and §3.3.

2. **bun:test vs vitest split** — `bun:sqlite` doesn't work in vitest (Vite can't resolve the native module). SQLiteStore tests must use `bun test`. This creates two test runners, complicating the `test` script. Future: evaluate if vitest-bun plugin resolves this.

3. **SQL migration file bundling** — `readFileSync` for `001-initial.sql` failed in compiled binary (Bun's virtual FS doesn't bundle non-JS assets). Required inlining SQL as TypeScript string constant. This pattern should be standardized for any future migration files.

4. **First subagent dispatch (C.1) updated CLAUDE.md instead of writing code** — The docman-implementer agent prioritized documentation over implementation. Required re-dispatch with explicit "YOUR JOB IS TO WRITE CODE" instruction. Subagent prompts must be unambiguous about deliverables.

## Bugs Found During Dogfood (D.2)

| Bug | Root Cause | Fix |
|---|---|---|
| `lore approve <slug>` → DOC_NOT_FOUND | ReviewService used `store.find(slug)` which only matches ULID | Extract shared `resolveDoc()`, use in ReviewService |
| `lore log <slug>` → empty | VersionService used `store.findVersions(slug)` which matches by ULID | Use `resolveDocId()` before calling store |
| `bun build --compile` failed with migration SQL | `readFileSync` not supported in Bun virtual FS | Inline SQL as TS string constant |

## Phase 2 Adjustments

Based on Phase 1 learnings:

1. **Standardize slug resolution**: All service methods that accept a doc identifier should use `resolveDocId()` from `src/service/resolve.ts`. Update SPEC-001 interfaces to use `string` (idOrSlug) instead of `DocId`.

2. **SQL migration pattern**: Future migrations should be TypeScript files exporting SQL strings, not `.sql` files loaded with `readFileSync`.

3. **Subagent prompts**: Start with "YOUR JOB IS TO WRITE CODE" and explicitly list files to create. Avoid ambiguity about deliverables.

4. **E2E test isolation**: Current E2E tests spawn `bun run src/index.ts` per command. For Phase 2 (MCP + sync), may need a long-running server — evaluate `Bun.spawn` with persistent process.

## Phase 1 Exit Criteria Verification

- [x] All tasks completed (A.1-A.4, B.1-B.5, C.1-C.4, D.1-D.3)
- [x] All acceptance criteria verified via 868 tests + manual dogfood
- [x] `lore` compiled binary works on macOS (42ms cold start)
- [x] Lore manages its own development corpus (PRD + 7 specs)
- [x] Risk register reviewed: R1, R2, R7 all cleared
- [x] Phase 1 retrospective completed (this document)

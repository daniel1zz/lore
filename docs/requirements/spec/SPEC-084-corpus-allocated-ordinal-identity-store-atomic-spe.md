---
id: SPEC-084
type: spec
role: spec
title: "Corpus-allocated ordinal identity: store-atomic SPEC/ADR numbering, prose titles, repair migration"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-10-17
tags: []
links:
  - {id: KN-162, type: relates-to}
  - {id: KN-168, type: supersedes}
  - {id: SPEC-240, type: relates-to}
  - {id: SPEC-240, type: implements}
---
## Overview / Goal

### Problem (live incident, 2026-07-26)

`SPEC-NNN` is title-declared free text. The only allocator (`ExportDocsService.buildOrExtendIndex`, SPEC-021 A1) runs at **export time** with silent-renumber semantics. Three concurrent sessions each read "max = 079" from their snapshot and self-declared SPEC-080. Result: corpus held 3 (now 2) specs titled SPEC-080; a subsequent export gave the file-number 080 to one, silently renumbered another to 081 (filename scar `SPEC-081-080-…`), and cascaded unrelated old specs' files to 082/083. Title / export-index / filenames / git history now disagree at ≥4 docs.

**Root cause**: lore has three identifier layers — ULID `id` (store-allocated, atomic), `slug` (write-time uniqueness-checked), ordinal (NO write-time authority). The ordinal is the only identity living outside the transactional store; the allocation authority sits downstream of the write (export) — unguarded race window + late silent resolution. The convention survived from the file era where the filesystem WAS the allocator.

**Goal (long-term, one-time design)**: make the ordinal a store-allocated, DB-uniqueness-enforced, immutable first-class attribute — concurrency-native by construction, with a one-shot repair migration that converges the current mess loudly.

## Module Boundary

**Public API (new)**
- `@lore/core`:
  - `ORDINAL_REGISTRY: Readonly<Partial<Record<DocType, {prefix: string; exemptKinds?: readonly string[]}>>>` = `{spec: {prefix: "SPEC", exemptKinds: ["domain-overview"]}, adr: {prefix: "ADR"}}` — declarative; kind exemption is DATA in the registry, consumed at exactly one allocation site. Hardcoded prefixes (no `numbering.prefixes` config — per-corpus prefix drift would break ordinal-form resolution across SPEC-078 multi-project mounts).
  - `formatDocDisplayId(doc): string | null` (`"SPEC-084"` / null for un-numbered) and `composeDocDisplayTitle(doc): string` (`"SPEC-084 — {title}"` / bare title) — the ONLY legal composition sites, import-graph-pinned; the composed string is NEVER stored.
  - `parseOrdinalRef(input): {type, ordinal} | null` — `^(spec|adr)-0*(\d+)$` case-insensitive, feeding resolution.
- `StoreInterface`:
  - `insertWithAllocatedOrdinal(doc): Promise<Result<DocRecord>>` — ONE atomic store call owning MAX+1 + insert + ≤3 bounded retries on UNIQUE violation, transaction-scoped (splitting read-MAX/insert across the service/store seam would reintroduce the TOCTOU this design kills). 3 impls: SQLiteStore (single-writer serialized), TursoStore (primary-serialized), InMemoryStore (parity via contract suite).
  - `allocateOrdinalForExisting(id, expectedVersion): Promise<Result<DocRecord>>` — the UPDATE-scoped sibling for the kind-flip transition (an ordinal landing on an ALREADY-PERSISTED row is an UPDATE and cannot reuse an insert-scoped method): atomic MAX+1 + CAS-guarded UPDATE (`expectedVersion`, STALE_VERSION on mismatch) + the SAME ≤3 bounded retry; no-op error if the row already carries an ordinal (immutability guard lives in the store, not just the service). Sole production caller: `CorpusService.set`'s exempt→numbered kind transition.
  - **Retry-exhaustion failure shape (both methods)**: `err(STORE_ERROR)` whose message carries the literal token `ORDINAL_ALLOCATION_EXHAUSTED` — a named, assertable failure, never a silent NULL ordinal (the incident's exact violated property).
  - `findByTypeOrdinal(type, ordinal): Promise<Result<DocRecord | null>>` — indexed lookup, same 3-impl shape as SPEC-065's `findByIdPrefix`.
- Schema: `docs.ordinal INTEGER NULL` + **partial UNIQUE index `(type, ordinal) WHERE ordinal IS NOT NULL`** — deliberately NOT filtered on `deleted_at`: soft-deleted docs retain their ordinal forever → **numbers are never reused**, historical references never dangle. New schema migration (next in the migration chain).
- CLI/MCP/HTTP: no new verbs. `lore get SPEC-84` / `SPEC-084` / `adr-12` resolve via `resolveDoc` (new step: after exact id/slug miss, `parseOrdinalRef` match → `findByTypeOrdinal`, BEFORE the SPEC-065 id-prefix fallback — the ordinal pattern `^[a-z]+-\d+$` with a registered prefix is unambiguous). NO public `--ordinal`/`--number` flag anywhere — the repair migration writes through an internal store path; a public flag would reopen the spoofing surface.

**Changed semantics**
- **Titles become pure prose — on BOTH write paths.** Create: `createDocInputSchema` superRefine rejects a title matching `^(SPEC|ADR)-\d+\b` for numbered types. Update: `CorpusService.set` applies the SAME rule to any title patch on a numbered-type doc (`docPatchSchema.title` is untyped prose, so the check is an explicit service-side validation — the same "re-check on set what create validates automatically" shape SPEC-040 D5 established for `ac_scope`). Both reject `VALIDATION_ERROR` naming the rule + the allocated-display alternative. Without the set-path guard, one rename reintroduces self-declared numbers the moment SPEC-021 A1's export backstop is retired — the review's blocking finding, closed here. Collision is eliminated by construction at every surface (CLI/MCP/HTTP/service), no gate-predicate needed.
- **Allocation timing**: ordinal assigned inside `CorpusService._createImpl` iff `ORDINAL_REGISTRY[type]` exists ∧ kind not in `exemptKinds` (spec_kind resolved the same way the registry's superRefine already sees it). **Kind-flip semantics (explicit)**: `set` transitioning a spec's kind FROM an exempt kind TO a numbered kind allocates at that write via `allocateOrdinalForExisting` (the UPDATE-scoped store method above — never the insert-scoped one); flipping TO an exempt kind KEEPS the ordinal (immutable-once-assigned, harmless); an ordinal is never retracted, never changed, never reassigned (the store method itself refuses a row that already has one).
- **Slugs never contain ordinals again** (slugify input = bare prose title).
- **Export inverts**: `human_id` for numbered types = `formatDocDisplayId` read of the column; SPEC-021 A1's title-parse + sequential-fallback + silent-renumber allocator is RETIRED for numbered types (superseded loudly in the corpus, not silently dropped); non-numbered types keep the legacy export path unchanged.

**Explicitly unchanged**
- ULID `id`, `slug` machinery, `resolveDoc`'s existing id/slug/id-prefix steps.
- Per-parent ordinal namespaces (AC-`NNN-K` on specs, `R-##` on PRDs, phases on plans) — different scoping (parent-relative), already have working dedicated writers; generalizing the corpus-global allocator onto them is rejected as speculative coupling.
- domain-overview specs stay numberless (PRD-as-outline taxonomy, deliberate).

## Design Decisions

| # | Decision | Choice | Rationale (perspective source) |
|---|---|---|---|
| D1 | Allocation home | Store-atomic `insertWithAllocatedOrdinal`, service only decides WHETHER | Coupling: service-side loop over a dumb insert reintroduces TOCTOU; mirrors the CAS/`expected_version` precedent |
| D2 | MAX+1-with-retry vs counters table | MAX+1 over the partial index | Cohesion raised counters-table; rejected: write volume is tiny, index MAX is O(log n), retries bounded by the constraint, and never-reuse comes free from including soft-deleted rows — a counter row adds a table + drift surface for zero measured need |
| D3 | Column name | `ordinal` (not `doc_number`) | Cohesion: avoids collision with export's `human_id` string concept |
| D4 | Kind exemption | Data in `ORDINAL_REGISTRY.exemptKinds`, consumed at the single allocation site | Reuse: (type,kind)-aware from day one — the next kind exemption is a data edit, not a shape migration; Cohesion's "registry stays declarative" satisfied since exemption is data, not logic |
| D5 | Display composition | ONE core formatter pair, import-graph-pinned; composed string never stored | Coupling+Cohesion convergence: N ad-hoc `${PREFIX}-${NNN}` interpolations WILL drift; storing the composite denormalizes against prose titles |
| D6 | Self-declared numbers | Schema-superRefine rejection (all surfaces), collision impossible by construction | Stronger than a gate predicate (which only guards gated checkpoints); VALIDATION_ERROR message carries the recovery guidance |
| D7 | Public number override | None. Repair migration uses an internal store path | Reuse: a CLI `--number` flag conflates the human surface with the repair tool and reopens spoofing |
| D8 | Prefix configurability | Hardcoded registry | Reuse: zero demand; config would break cross-corpus ordinal-ref parsing under multi-project dashboard |
| D9 | Reuse-after-delete | Never (index includes soft-deleted) | History integrity: a number cited in commits/handoffs must never point at a different doc later |
| D10 | Legacy prose refs ("SPEC-072" inside old bodies/commits) | Left as-is; no alias/redirect layer | Reuse: search finds docs by content; a redirect layer is over-engineering. Git messages are immutable scars, acknowledged |

## One-shot repair migration (`lore migrate ordinals`, dry-run default + `--apply`)

1. **Backfill**: every numbered-type doc with a title-declared number claims it as `ordinal`, resolved by `created_at` priority; collision losers get next-free.
2. **LOUD mapping report** (Coupling's hard requirement — the silent-renumber failure mode must not recur in the repair itself): every `old-display → new-display` reassignment printed AND persisted into the migration's knowledge/report output; zero silent moves.
3. **Title strip**: number prefixes removed from titles via direct store writes (MigrationService precedent: un-gated, NO approved→draft reset, version rows still written).
4. **Export-index reconcile**: `human_id`/`file_path` rewritten from columns for numbered types; stale doubled-number filenames renamed; set-equality invariants asserted in dry-run BEFORE any write (per-doc triple `(title#, index#, ordinal)` convergence table).
5. **Idempotency oracle**: literal second-run assertion `writes === 0` (not implied).
6. **Live-corpus safety**: the AC pins the SPEC-056 precedent as a command — copy the db, dry-run against the copy, never the live corpus first.

Applied to the current corpus (created_at priority): bootstrap-injection keeps **SPEC-080** (earliest), PRD-as-outline → **SPEC-081**, audit-hardening-2 → **SPEC-082**, and the incident-drifted export entries for old SPEC-072/073 snap back to their title-declared numbers. All movements appear in the mapping report.

## Test Plan (six-dimension; testing-review shaped)

- **Contract suite** `ordinal-allocation.contract` — ONE parametrized suite over SQLiteStore (bun test) + InMemoryStore (vitest twin, same cases): forced-collision retry (pre-insert the colliding `(type, ordinal)` row → next create lands MAX+1; the DB constraint IS the race oracle — honest under bun:sqlite's single-connection model, no fake concurrency), retry exhaustion at 3 → loud error, soft-deleted ordinal never reused, cross-type independence (SPEC-5 and ADR-5 coexist), exempt-kind allocation skipped, kind-flip allocation on exempt→numbered transition.
- **HAPPY**: create spec → ordinal = max+1; display/`lore list` shows composed id; `lore get SPEC-84` resolves.
- **NEGATIVE**: title self-declaring `SPEC-99` → VALIDATION_ERROR at every surface (CLI/MCP/HTTP param tests); unknown ordinal → DOC_NOT_FOUND; `parseOrdinalRef` non-matches fall through to id-prefix path (SPEC-065 REGRESSION).
- **BOUNDARY**: first doc of a type (ordinal 1); ordinal 0*084 zero-padding forms; exempt kind creates with NULL ordinal.
- **ERROR**: store constraint violation surfaces as retried-then-ok or bounded loud failure, never silent.
- **STATE**: migration on a fixture corpus reproducing the live mess (2×080 titles + diverged index) → bijectivity (`new Set(ordinals).size === numberedDocs.length`), mapping report exact, export convergence (post-migration human_id reads == column), double-run zero-diff.
- **REGRESSION**: slug fixtures (new docs' slugs number-free; existing slugs untouched); FTS search by old number still finds docs whose CONTENT mentions it; dashboard e2e green; formatter import-graph pin (grep: no `SPEC-` template interpolation outside the core formatter).

## Quality Gates (module mode)

- [x] No circular deps — core registry/formatters ← store ← service ← adapters; migration is a leaf
- [x] Single responsibility — allocation: one store method; policy (whether): one service site; display: one formatter; uniqueness: the DB index
- [x] Black-box testable — contract suite over the public StoreInterface; migration via dry-run report
- [x] Dependencies injectable — registry is data; store methods on the existing DI seam

## Rollout

1. Migration N (schema): `ordinal` column + partial unique index.
2. Core registry + formatters + `parseOrdinalRef`; store methods ×3 impls + contract suite.
3. Service allocation + schema superRefine title rejection + resolveDoc step; CLI/MCP/HTTP inherit.
4. Export read-path switch + SPEC-021 A1 retirement for numbered types (corpus supersede note).
5. `lore migrate ordinals` repair + run on THIS corpus (dry-run → mapping report → user-visible → --apply).
6. Docs: CLAUDE.md entry, invalidate the collision knowledge doc's "resolution protocol" section (superseded by the migration), handoff.

Breaking-change window justification: numbering semantics change (titles lose prefixes) is acceptable NOW precisely because adopting projects are few — the entire motivation for doing this once, properly, today.


## Invariant restatement (post-D7, 2026-07-27)

The plan doc's Invariant 2 ("exactly TWO allocation sites") undercounts the shipped contract by one. The store contract has **three** sanctioned ordinal-write sites, not two:

1. `insertWithAllocatedOrdinal` — INSERT-scoped MAX+1 allocation (new numbered-type doc creation).
2. `allocateOrdinalForExisting` — UPDATE-scoped MAX+1 allocation (exempt→numbered kind-flip transition).
3. `assignOrdinalForRepair` — SPEC-084 D7's targeted-assignment repair path (`lore migrate ordinals --apply`); never a MAX+1 allocation, but still a direct write to the `ordinal` column and equally sanctioned/scoped.

Sites 1 and 2 both delegate their retry mechanics to the SAME shared seam (`allocateWithBoundedRetry` in `store-shared.ts`) — this is what the plan's "exactly two ALLOCATION call sites" language was accurately describing; site 3 is a distinct, non-allocating assignment path that the plan text omitted. The DB partial unique index `idx_docs_type_ordinal ON docs(type, ordinal) WHERE ordinal IS NOT NULL` remains the sole uniqueness AUTHORITY regardless of write-site count (D9, unchanged).

A pending, concurrently-tracked task may land a fourth composite store method (`insertWithAllocatedOrdinalAndProvenance`, closing a BUG-002 provenance window on numbered creates) — if/when it lands, it becomes a fourth sanctioned site under the same shared allocation seam; the restated count here is not assumed final.

Mechanized oracle: `bun run check:ordinal-sites` (`scripts/check-ordinal-write-sites.mjs`) greps `packages/*/src/**` for MAX(ordinal)/`ordinal + 1` allocation arithmetic and direct SQL writes to the `ordinal` column (`SET ordinal`, `INSERT ... ordinal`), failing loud (exit 3, naming the offending file:line) outside an explicit, easy-to-extend allowlist of the sanctioned files above. Exit 0 on the current tree.


## Acceptance Criteria (structured)

- [⚑] [script] AC-084-4: Repair migration suite passes on a fixture reproducing the live incident (2 same-number titles + diverged export-index): created_at priority assignment; ordinal bijectivity (set size == numbered doc count); loud old-to-new mapping report contains every reassignment; title prefixes stripped without approved-to-draft resets; export-index human_id reads converge to columns; second run performs literally zero writes
  script: test — bunx --bun vitest run packages/lore/tests/unit/store/migrate-ordinals.bun.test.ts
  other_command=16
- [·] [script] AC-084-5: Compiled-binary e2e: dist/lore migrate ordinals (dry-run default) against a COPY of a seeded corpus exits 0 and prints the mapping report + set-equality invariants without writing; --apply then converges; lore get SPEC-<n> resolves post-migration; suite asserts >0 executed tests and never touches the repo .lore/
  script: e2e — bunx --bun vitest run packages/lore/tests/e2e/migrate-ordinals-compiled.bun.test.ts
  other_command=15
- [⚑] [script] AC-084-6: Monorepo typecheck passes with the ordinal column, store methods on all 3 StoreInterface impls, registry and formatters: tsc --noEmit exits 0
  script: tsc — bun run typecheck
- [·] [script] AC-084-1: Ordinal-allocation contract suite passes under bun:sqlite, cases consumed from the SHARED exported case table (ordinal-allocation-cases.ts): forced-collision (pre-inserted (type,ordinal) row) retries to MAX+1; retry exhaustion at 3 returns err(STORE_ERROR) whose message contains ORDINAL_ALLOCATION_EXHAUSTED (asserted literally, never a silent NULL ordinal); soft-deleted ordinal never reused; SPEC-5 and ADR-5 coexist; domain-overview kind allocates NULL ordinal; exempt-to-numbered kind flip allocates via allocateOrdinalForExisting (UPDATE-scoped, CAS-guarded, refuses a row already carrying an ordinal)
  script: test — bunx --bun vitest run packages/lore/tests/unit/store/ordinal-allocation.contract.bun.test.ts
  other_command=14
- [⊘] [script] AC-084-2: InMemoryStore twin passes under vitest importing the SAME ordinal-allocation-cases.ts case table (mechanical parity: both runners iterate the shared exported list; the vitest suite asserts the imported case count equals the table length, so runner-level drift is structurally impossible)
  script: test — bunx vitest run packages/lore/tests/unit/store/ordinal-allocation.contract.test.ts
- [⚑] [script] AC-084-3: Service+resolution unit suite passes: create of numbered type auto-allocates; title self-declaring SPEC-99/ADR-7 rejected VALIDATION_ERROR on BOTH paths — createDocInputSchema superRefine at create AND CorpusService.set title-patch validation on update (rename to SPEC-099 rejected); resolveDoc resolves SPEC-84/spec-084/0-padded forms via findByTypeOrdinal and falls through to SPEC-065 id-prefix path on non-ordinal input (regression); formatDocDisplayId/composeDocDisplayTitle are the only composition sites (in-test grep/import-graph pin)
  script: test — bunx vitest run packages/lore/tests/unit/service/ordinal-identity.test.ts

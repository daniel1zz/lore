---
id: SPEC-079
type: spec
role: spec
title: "SPEC-079 — Audit hardening: link provenance + actor fidelity + tamper-evident hash chain"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
# SPEC-079 — Audit hardening: relationship provenance + actor fidelity + tamper-evident hash chain

> Kind: tech. Parent: PRD root. Closes the three audit-coverage gaps confirmed 2026-07-25:
> (G1) link/unlink/tree-fix leave zero audit trace; (G2) CorpusService create/update/delete
> audit entries hardcode `actor: "system"`; (G3) the audit table is plain rows — paired
> deletion or in-place rewrite of `versions`+`audit` rows is invisible to `lore audit --verify`.
> Declared dependencies: SPEC-035 (audit surface + verify oracle), SPEC-042 (session/actor
> discipline), SPEC-051 (`--by` flag precedent), SPEC-072 (version-insert rollout precedent).

## Overview/Goal

Make every corpus mutation attributable and every audit row tamper-evident:

1. **Relationship provenance (G1)** — `CorpusService.link` / `CorpusService.unlink` and
   `TreeCheckService` auto-repairs each write an audit entry; `links.created_by` records
   the resolved actor instead of the hardcoded `"system"`.
2. **Actor fidelity (G2)** — CorpusService's create/update(set)/delete audit entries carry
   the resolved actor (`--by` > `$LORE_ACTOR` > session tier > OS username, the SPEC-071
   `resolveActorWithSource` chain) instead of the literal `"system"`.
3. **Tamper-evident chain (G3)** — every audit row is hash-chained to its predecessor
   (`prev_hash`/`entry_hash`, sha256 over a canonical serialization); `lore audit --verify`
   walks the chain and reports the first break; `lore audit anchor` writes a git-trackable
   head snapshot (`.lore/audit-anchor.json`) so history rewrites before the anchor point
   (including paired row deletion) are detectable from git history.

## Scope

**In scope**

- `CorpusService.link/unlink`: new audit actions `"link"` / `"unlink"` (`doc_id` = from-doc,
  `details` = `{to_id, link_type}` — for unlink, the full list of removed link types).
  Audit-only: NO versions row (links are not doc-content snapshots). The new actions belong
  to NO `VERSION_ACTION_AUDIT_FAMILY` family (same non-membership rule as `"judge"`), so
  `AuditService.verify`'s versions⋈audit join is untouched by construction.
- `TreeCheckService.fix`/reconcile writes: audit action `"tree-fix"`, one entry per applied
  repair, `details` = the repair descriptor (kind, doc_id, old/new parent).
- Actor threading: `CorpusService.create/set/delete/link/unlink` accept optional `opts.by`;
  adapters resolve and pass it (CLI via the existing resolver + `--by` where absent; MCP
  tools follow the existing explicit-`by` convention; HTTP cookie routes pass the session
  user, bearer routes the token name). Service-side fallback when omitted:
  `resolveActorWithSource(undefined, process.env)` — bare unit-test constructions keep
  working and never crash. `links.created_by` = the same resolved actor.
- `audit.session_id` semantics are NOT changed in this spec (currently doc-id-valued on
  corpus writes; documented as out of scope — changing it is a separate decision).
- Hash chain: migration-009 adds nullable `prev_hash TEXT` + `entry_hash TEXT` to `audit`,
  then backfills the chain over ALL existing rows in `id` ASC order inside the migration
  transaction (trust anchor = migration time; pre-existing tampering before migration is
  explicitly NOT detectable — documented limitation). `entry_hash =
  sha256(canonicalJson({timestamp, actor, session_id, action, doc_id: doc_id ?? null,
  details: details ?? {}, prev_hash}))` with deterministic sorted-key serialization;
  genesis `prev_hash = ""`. The pure functions (`canonicalAuditPayload`,
  `computeAuditEntryHash`) live in `packages/lore/src/store/store-shared.ts` (server-only —
  `@lore/core`'s browser-safe barrel must not import `node:crypto`). All three stores
  (SQLiteStore, TursoStore, InMemoryStore) compute the chain at EVERY audit insert point
  (`appendAuditEntry` AND the three `*WithProvenance` transactional paths), reading the
  current head inside the same transaction/serialized write so concurrent writers cannot
  fork the chain.
- `lore audit --verify` chain walk: after the existing completeness join, recompute the
  full chain in `id` ASC order; report the first break as
  `{id, reason: "hash_mismatch" | "prev_link_mismatch" | "unchained_row"}` (an
  unhashed row is legal ONLY as part of the contiguous pre-migration prefix — after
  migration-009's backfill that prefix is empty, so any NULL-hash row is a break).
  Exit semantics follow the existing verify mapping (clean → 0, findings → existing
  non-zero code).
- `lore audit anchor`: writes `.lore/audit-anchor.json`
  `{head_id, head_hash, entry_count, anchored_at}`; the file is git-tracked (mirror the
  existing `export-index.json` gitignore-exception pattern). When the file exists,
  `lore audit --verify` additionally asserts the anchored `(head_id, head_hash)` pair still
  exists in the chain; a mismatch or missing row is reported as `anchor_mismatch`.

**Out of scope**

- `MigrationService`'s one-shot v1-import bypass (documented, frozen).
- Hand-edits of `.lore/config.yaml` (config file is outside the DB audit domain).
- `delete`-action rows joining `AuditService.verify`'s completeness anchor set (SPEC-035
  documented exclusion stands).
- Cryptographic signing / external timestamping services — the anchor file + git history
  is the chosen trust root.

## Design Decisions

- D1 — Link ops are audited, never versioned; new audit actions join no verify family.
- D2 — Actor resolution reuses the SPEC-071 `resolveActorWithSource` chain; services take
  optional `opts.by`, adapters resolve. No new resolution logic.
- D3 — Chain hash functions are pure, shared, and server-only (`store-shared.ts`).
- D4 — Migration-009 backfills the whole table so `unchained_row` is always a violation
  post-migration; the migration is the trust anchor.
- D5 — The anchor file is the ONLY external trust root; verify never reaches the network.
- D6 — InMemoryStore implements the identical chain so vitest suites can assert chain
  behavior without `bun:sqlite`.

## Acceptance Criteria

Structured ACs are declared via `lore ac add` (all script-mode). Canonical test file paths
are part of the contract — implementers create exactly these paths:

- AC-079-1 — link/unlink/tree-fix provenance suite passes:
  `bunx vitest run packages/lore/tests/unit/service/link-provenance.test.ts`
- AC-079-2 — actor fidelity suite passes (create/set/delete audit entries carry the
  resolved actor; `links.created_by` is the resolved actor; omitted `by` falls back to the
  env chain): `bunx vitest run packages/lore/tests/unit/service/audit-actor-fidelity.test.ts`
- AC-079-3 — chain construction suite passes (every insert extends the chain across all
  audit write paths; migration-009 backfill chains a legacy fixture DB; fresh `lore init`
  corpus verifies clean): `cd packages/lore && bun test tests/unit/store/audit-chain.bun.test.ts`
- AC-079-4 — tamper detection suite passes (in-place UPDATE of one audit row →
  `hash_mismatch` at that id; DELETE of a (versions,audit) row pair → chain break;
  appended forged row with fabricated hashes → `prev_link_mismatch`):
  `cd packages/lore && bun test tests/unit/store/audit-tamper.bun.test.ts`
- AC-079-5 — anchor roundtrip suite passes (`lore audit anchor` writes the file; verify
  consumes it; a rewound/rewritten chain is reported as `anchor_mismatch`):
  `cd packages/lore && bun test tests/integration/audit-anchor.bun.test.ts`
- AC-079-6 — InMemoryStore chain parity suite passes:
  `bunx vitest run packages/lore/tests/unit/store/in-memory-audit-chain.test.ts`
- AC-079-7 — full regression: `bun run typecheck && bun run test` exits 0 (both runners).


## Acceptance Criteria (structured)

- [✔] [script] AC-079-1: link/unlink/tree-fix provenance suite passes: every CorpusService.link and unlink call and every TreeCheckService applied repair writes exactly one audit entry with the documented action and details shape
  script: test — bunx vitest run packages/lore/tests/unit/service/link-provenance.test.ts
- [✔] [script] AC-079-2: actor fidelity suite passes: create/set/delete audit entries and links.created_by carry the resolved actor; omitted by falls back to the resolveActorWithSource env chain
  script: test — bunx vitest run packages/lore/tests/unit/service/audit-actor-fidelity.test.ts
- [✔] [script] AC-079-3: chain construction suite passes: every audit insert path extends the hash chain; migration-009 backfills a legacy fixture DB into a verifiable chain; a fresh corpus verifies clean
  script: test — cd packages/lore && bun test tests/unit/store/audit-chain.bun.test.ts
- [✔] [script] AC-079-4: tamper detection suite passes: in-place UPDATE of one audit row yields hash_mismatch at that id; paired DELETE of versions+audit rows yields a chain break; a forged appended row yields prev_link_mismatch
  script: test — cd packages/lore && bun test tests/unit/store/audit-tamper.bun.test.ts
- [✔] [script] AC-079-5: anchor roundtrip suite passes: lore audit anchor writes .lore/audit-anchor.json; verify consumes it; a rewritten chain is reported as anchor_mismatch
  script: test — cd packages/lore && bun test tests/integration/audit-anchor.bun.test.ts
- [✔] [script] AC-079-6: InMemoryStore chain parity suite passes: the in-memory store produces the identical chain semantics for all audit write paths
  script: test — bunx vitest run packages/lore/tests/unit/store/in-memory-audit-chain.test.ts
- [✔] [script] AC-079-7: full regression passes: typecheck and both test runners exit 0
  script: build — bun run typecheck && bun run test

## Code anchors

- packages/lore/src/store/store-shared.ts#computeAuditEntryHash
- packages/lore/src/store/migrations/migration-009.ts
- packages/lore/src/service/audit-service.ts#walkAuditChain
- packages/core/src/actor-resolution-node.ts

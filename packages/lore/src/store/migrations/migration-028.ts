/**
 * Migration 028 — the schema marker for "claims compare runs only"
 * (spec-every-write-is-made-by-a-known-party-an-attested-agent-run end state 4, BR-1352). SQL is an inlined string
 * constant so `bun build --compile` can bundle it without filesystem access.
 *
 * Public surface: {@link MIGRATION_028_SQL}.
 *
 * Invariants:
 *   - NO DDL: a claim lease is data inside `docs.extra`. This migration only moves `PRAGMA user_version` to 28, so a
 *     corpus written before runs were compared (leases held by NAME) is refused by every command until
 *     `lore migrate schema` upgrades it (`schema-behind.ts`).
 *   - The expiry of the leases that carry no run is NOT done here: it must write a version row and a hash-chained
 *     audit row per document, which only the write route can do. `adapters/cli/migrate-schema.ts` runs
 *     `service/legacy-claim-expiry.ts::expireRunlessClaims` right after this migration, in the same command.
 *   - The number follows 026: 027 is taken by another branch that has not landed yet (per-item baseline approval).
 *     A corpus opened by a binary that has both runs 027 first (the chain is ordered); a corpus already at 28 never
 *     re-runs it.
 *
 * Side-effect class: schema DDL (executed once per store).
 */
export const MIGRATION_028_SQL = `-- Migration: 028-claims-compare-runs-only
-- Schema version: 28

BEGIN IMMEDIATE;

PRAGMA user_version = 28;

COMMIT;
`;

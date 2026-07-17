# Deploy Mode: Migration

> Database/data migration with zero-downtime patterns.

## Migration Types

| Type | Tools | Key Concern |
|------|-------|-------------|
| Schema | Prisma, Flyway, Liquibase, Alembic, knex | Lock duration, index creation, backward compatibility |
| Data | Backfill, normalize, cleanup, transform | Batch size, progress tracking, verification, idempotency |
| Application | Expand-Migrate-Contract | Code supports old+new → migrate → code uses new only |

## Zero-Downtime Patterns

| Operation | Steps | Rollback |
|-----------|-------|----------|
| Add column | Add nullable → deploy writes → backfill → add NOT NULL | Drop column (safe if no reads yet) |
| Remove column | Stop reads → stop writes → drop | Re-add column + backfill from backup |
| Rename column | Add new → dual-write → backfill → switch reads → drop old | Switch reads back to old, stop dual-write |
| Change type | Add new col → dual-write → backfill+convert → switch reads → drop old | Switch reads back, stop dual-write |
| Add index | `CREATE INDEX CONCURRENTLY` (Postgres) / online DDL (MySQL 8+) | `DROP INDEX` |
| Split table | Create new table → dual-write → backfill → switch reads → stop old writes | Switch reads back, stop new writes |

## Expand-Migrate-Contract Methodology

This is the universal pattern for any non-trivial schema change in a zero-downtime environment.

### Phase 1: EXPAND (deploy schema change)
- Add new columns/tables alongside existing ones
- No removal of anything existing
- Code continues using old schema exclusively
- **Verify**: Old code works with expanded schema
- **Rollback**: Drop new columns/tables (no data in them yet)

### Phase 2: MIGRATE (deploy code + data)
- Deploy code that writes to both old AND new schema (dual-write)
- Backfill existing data from old to new
- Progressively switch reads to new schema
- **Verify**: Both old and new paths produce correct results
- **Rollback**: Switch reads back to old, stop dual-write

### Phase 3: CONTRACT (cleanup)
- Remove code that reads/writes old schema
- Drop old columns/tables
- **Verify**: Service operates fully on new schema
- **Rollback**: Forward-fix only (old schema already dropped)

**Timing**: Each phase is a separate deployment. Wait for verification between phases. Minimum 1 deployment cycle between EXPAND and MIGRATE, minimum 1 cycle between MIGRATE and CONTRACT.

## Data Migration Best Practices

| Practice | Why |
|----------|-----|
| Batch processing | Avoid locking entire table; process in batches of 1000-10000 rows |
| Idempotent operations | Migration can be safely re-run if interrupted |
| Progress tracking | Log batch progress; allow resume from last completed batch |
| Verification queries | Run count/checksum before and after to verify completeness |
| Off-peak execution | Schedule large data migrations during lowest traffic period |
| Read replica usage | Backfill reads from replica to avoid primary load |

## Quality Gates

| Gate | Check | Block |
|------|-------|-------|
| Staging test | Migration applied and rolled back in staging | HARD |
| Lock analysis | `EXPLAIN` on DDL shows acceptable lock duration | HARD |
| Backward compat | Current code works with new schema | HARD |
| Batch sizing | Data migration batch size tested (no timeouts, no lock escalation) | HARD |
| Verification queries | Pre/post row counts and checksums prepared | HARD |
| Rollback plan | Documented per SKILL.md Phase 5 | HARD |
| Backup verified | Recent backup exists and is restorable | HARD |

## Rollback

- **Preferred**: Forward-fix (deploy corrective migration)
- **Alternative**: Rollback migration (if safe — additive changes only)
- **Last resort**: Point-in-time recovery (see methodology-rollback.md)
- **Always**: Test rollback in staging. Document steps. Set rollback criteria with specific thresholds.

**Rollback decision matrix**:

| Situation | Action |
|-----------|--------|
| EXPAND phase failed | Drop new columns/tables (no data loss) |
| MIGRATE phase — dual-write broken | Switch reads back to old, stop dual-write, fix code |
| MIGRATE phase — backfill corrupted data | Stop backfill, fix transform logic, re-run on corrupted batch |
| CONTRACT phase — old data needed | Forward-fix: re-add column, backfill from audit log |
| Unknown failure | STOP. Do not drop anything. Investigate with data intact. |

## Exit Criteria

- [ ] Schema applied with zero downtime (verified in staging and production)
- [ ] Rollback tested in staging (each Expand-Migrate-Contract phase)
- [ ] Data verified: row counts match, checksums match, sample queries correct
- [ ] Old+new code paths both work during transition period
- [ ] No long-running locks observed during migration
- [ ] Backfill completed with progress tracking and verification
- [ ] Post-migration cleanup scheduled (CONTRACT phase)

## Tools

- `serena`: create_text_file (migration files), execute_shell_command (run migrations)
- `context7`: Prisma/Flyway/Alembic docs for migration syntax
- `lore`: `lore create knowledge --sub-type reference --title ...` for migration procedures, `lore search "<q>" --type knowledge --json` for existing runbooks

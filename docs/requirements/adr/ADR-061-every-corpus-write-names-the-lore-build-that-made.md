---
id: ADR-061
type: adr
role: decision
title: "Every corpus write names the lore build that made it; issues are bound to build ranges"
status: approved
priority: high
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PRD-001
links:
  - {id: SPEC-252, type: informs}
---
## Context

An audit of the corpus cannot tell a record written by today's lore from one written by a build whose defect is already fixed. Those old records then surface as "new" findings and pollute the audit, while the records a known defect really corrupted are not singled out for re-verification, although gates still read them.

Measured on this repo's corpus (2026-10-26, read-only queries on `.lore/lore.db`):

- `scripts/build.ts` already embeds `build_commit`, `build_dirty` and `built_at` into the compiled binary (`__LORE_BUILD_PROVENANCE__`, read by `service/binary-provenance.ts::readEmbeddedBuildProvenance`). Its only consumer is `lore status --check-binary-provenance`.
- No written record carries it: `audit` (76,490 rows), `versions` (61,011), `decision_log` (643) and `review_judgments` (2,067) have no build column. Local precedents of stamping the producer: `write-context-store.ts::withWriteContext` stamps `harness_run` on every audit and version row; `decision_log` carries `executor_run`; `review_judgments` records `judge_provider`, `judge_model` and `judge_prompt_version`.
- `schema-behind.ts` refuses a corpus OLDER than the binary, but nothing refuses a binary older than the corpus: an old binary keeps writing to an upgraded corpus.
- `package.json` version is `0.1.0` and has never been bumped; several worktrees run different builds at the same time.
- Issue #456's body carries no version. GitHub owns issue facts (`spec-github-owns-issue-report-state-no-mirror-task-work-carries`); a carrier task's `extra.landing.landing_commit` already records the main commit that landed its fix.
- `audit.entry_hash` is computed by `store-shared.ts::canonicalAuditPayload` over timestamp, actor, session_id, action, doc_id, details and prev_hash.

## Decision

D1. **Build identity is the build commit sha.** A `builds` table registers one row per distinct build: commit (40-hex, or the literal `unknown`), dirty flag, run kind (`compiled` | `source` | `unknown`), schema version and the assets-manifest hash. Its id is a content hash of those fields, inserted with `INSERT OR IGNORE`, so concurrent sessions converge on one row. A source run (`bun run dev`, tests) reads HEAD and the dirty state of lore's own source root (never the cwd, which is the project being worked on); a run that cannot read either has run kind `unknown` and commit `unknown`. Neither field is ever blank.

D2. **Stamp the writer, in the store.** `build_id` is added to the four append-only fact tables (`audit`, `versions`, `decision_log`, `review_judgments`). Each store implementation is constructed with the process's build and binds it on every insert into them, beside the existing `harness_run` stamping. Per-call facts that already have a home (judge model and prompt) stay there.

D3. **The stamp is inside the chains.** `canonicalAuditPayload` (an object) adds a `build_id` key only when the row has one. `computeDecisionEntryHash` (a positional array whose optional `detail` is already appended only when present) appends the pair `[detail ?? null, build_id]` when `build_id` is present, so the two values can never share a slot. Every existing row hashes byte-identically; no hash-formula version is needed.

D4. **Issues are bound to builds.** A filed report records the reporter's build (`found_in`, an optional field of the front-matter JSON). `found_in` serves triage and reproduction; the audit does not use it, because it only bounds when a defect was seen, not the commit that introduced it, so the affected range is conservatively every build lacking the fix. When lore closes an issue as completed (archive or sync path), the comment names the task's landing (`fixed_in`: branch head and landing commit). The affected builds are those containing neither commit, decided by git ancestry, never by time; the branch head counts because a build from the branch tip contains the fix without the merge commit.

D5. **The fixer declares what was tainted.** Only a task naming an issue may declare `extra.taints`, each a table plus one allow-listed field value (no bare table), validated on every write path and frozen once the task is archived. Without a declaration an issue excludes nothing.

D6. **Audit partitions, never drops.** An audit by build reports four groups with counts: `unstamped` (no build), `known-defect` (affected build AND declared kind, listed per issue and as needing re-verification), `uncertain` (commit `unknown` or foreign to lore's history, or a dirty or source build not caught as known-defect) and `current`. Rows with no build stay `unstamped`; their build is never inferred from timestamps. Without lore's git history the audit refuses (exit 4).

D7. **Unstamped writes are counted, not refused.** A missed insert site in this codebase is refused by test (the full write matrix must leave zero NULL rows on every store). A binary built before this change can still write NULL rows to an upgraded corpus; the audit counts, per table, the NULL rows dated at or after this corpus's provenance start (its earliest `builds` row) as `unstamped_after_start`, the visible trace of an old binary still writing. `builds` joins the tables `lore sync push` replicates, so a pushed `build_id` resolves on the remote.

## Benchmarks (what was borrowed)

- Sentry: every event carries `release`; an issue resolved in a release ignores events from older releases and turns `Regressed` on a newer one. Borrowed: issue bound to a version range, old data is not a new finding.
- OpenTelemetry: `service.version` is a resource attribute of the producer. Borrowed: stamp the writer once, not per field.
- OpenLineage: a job's `sourceCodeLocation.version` is the git sha that produced a dataset, so outputs of a bad version can be found and re-run. Borrowed: old outputs that are still consumed are listed for re-verification, not just ignored.
- SQLite header offset 96 records only the last writer's library version. Rejected as a model: too coarse for concurrent writers.

## Rejected options

| Option | Why rejected |
|---|---|
| Semver release number | Never bumped; cannot tell concurrent worktree builds apart |
| Last-writer version per corpus (SQLite style) | Many sessions write concurrently; per-record is required |
| A build column on every table | Duplicates one producer fact; the four fact tables cover every write |
| Hand-filled affects/fix version (Jira style) | Relies on an agent remembering; landing data already holds `fixed_in` |
| Infer old rows' build from timestamps | Concurrent checkouts run different binaries; a wrong guess corrupts the audit |
| Refuse writes from source or dirty runs | Breaks tests and dev loops; marking them `uncertain` keeps them out of evidence without blocking |
| Hash formula version column | Absent-key payload keeps old rows byte-identical; a version column adds a second source of truth |
| `BEFORE INSERT` trigger refusing NULL rows (with a per-corpus time cutoff) | `lore sync push` copies with `INSERT OR IGNORE`, which does not ignore a trigger abort; corpora upgrade at different times, so a remote upgraded earlier would refuse forever the rows another corpus legitimately wrote before its own upgrade (found in the third review round) |
| Bare-table taints | One declaration could hide every unrelated finding from an affected build |
| `fixed_in` = landing (merge) commit only | A build from the branch tip contains the fix but not the merge, and would be misread as affected |

## Consequences

- Auditing a consumer corpus needs lore's git history for the ancestry test; the consumer's records carry the commit, and the audit runs in the lore repo.
- An older binary keeps writing unstamped rows until rebuilt or reinstalled; they are counted (D7), not prevented, and the count trusts the writer's clock. No rollback step is needed: older code ignores the new columns and table.
- `versions` and `review_judgments` are not chained, so their `build_id` is not tamper-evident; audit and decision rows are.
- A build containing the fix under a rebased or cherry-picked commit is grouped `known-defect`: accepted, it costs re-verification, not a hidden finding.
- Automatic regression detection (Sentry's `Regressed`) is out of scope: matching a new record to an old issue's symptom is not deterministic.
- Separate concern, not decided here: `versions` holds a full snapshot for operational writes (83% of successive versions change only `extra`).

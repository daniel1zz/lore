---
id: SPEC-021
type: spec
role: spec
title: "lore export-docs — reverse sync from corpus to spec files"
status: approved
priority: medium
created: 2026-06-30
updated: 2026-07-14
tags: [cli, corpus, sync, export, drift, phase-10, stub]
parent: PRD-001
links:
  - {id: KN-542, type: relates-to}
---
# SPEC-021: `lore export-docs` — reverse sync (corpus → file)

> **Status: stub.** The forward sync exists (SPEC-018); the missing reverse direction is the SSOT gap.

## 1. Purpose

`lore sync-docs` (SPEC-018) ships file → corpus only. Three concrete pain points result:

1. **AI-created docs lose git history.** `lore create spec --ai` writes only into `lore.db`; the team's git workflow (PR review, blame, diff) never sees the doc.
2. **Dashboard edits cannot be reviewed.** Once SPEC-022 ships a write-capable dashboard, browser-authored content lives only in the SQLite blob.
3. **Disaster recovery is broken.** Lose `lore.db` and you lose anything created after the last git-tracked spec, with no replay path.

SPEC-021 adds `lore export-docs`: a one-way corpus → file emitter, mirror-symmetric to `lore sync-docs`. Each corpus row becomes a `docs/requirements/<type>/<SPEC-NNN-...>.md` file with full YAML frontmatter; round-tripping `export-docs` → `sync-docs` must be a no-op (idempotent).

## 2. Goals & Non-Goals

### 2.1 Goals

- New CLI subcommand `lore export-docs` — no flags required; defaults to dry-run + apply-create-only (parallels SPEC-018).
- Writes one file per doc to `docs/requirements/<type>/`:
  - `spec/SPEC-NNN-kebab.md`
  - `prd/PRD-NNN-kebab.md`
  - `adr/ADR-NNN-kebab.md`
  - `plan/PLAN-NNN-kebab.md`
  - `task/TASK-NNN-kebab.md`
  - `knowledge/KN-NNN-kebab.md`
- Frontmatter shape: same as the one SPEC-018 reads — id, type, role, title, status, priority, phase (optional), created, updated, tags, parent (resolved to "PRD-001"-style human ID), links.
- ID-numbering: stable across runs — once a corpus row has been exported with `SPEC-019`, subsequent exports preserve that number even if internal ULID order shifts. Mapping stored in `.lore/export-index.json`.
- Drift: file exists, body differs from corpus → print `⚠ drift: <file>`, skip; mirrors SPEC-018 §2.1.
- `--force` writes corpus body over file (the inverse of SPEC-018's deferred `--force`); v1 ships warning-only.
- `--dry-run` reports what WOULD be written.
- `--type <type>` restricts export to one type.
- Six-dimension test coverage including roundtrip test (export → sync should yield zero net changes).

### 2.2 Non-Goals

- ❌ **Bidirectional auto-sync / watch mode** — manual invocation only, same as SPEC-018.
- ❌ **Separate link-graph file** — frontmatter `links:` IS written into each per-doc file from corpus link rows (this is part of round-trip parity with SPEC-018), but no aggregate `.json` graph file is emitted.
- ❌ **Deletion sync** — if a corpus row is soft-deleted, the file is NOT removed (data preservation > tidiness).
- ❌ **Version-history export** — only the latest version per doc; history stays in `lore.db`. `lore export-versions` is a separate future SPEC.
- ❌ **MCP / HTTP exposure of `export-docs`.** CLI-only.
- ❌ **Cross-repo export** — single-target directory only.

## 3. Open Design Questions

### Q1 — ID-numbering policy

When corpus has 18 specs numbered SPEC-001..018 (from frontmatter), and a new corpus-only spec arrives, what number does it get?

- Option A: max(existing file numbers) + 1
- Option B: hash of ULID, padded to 3 digits (deterministic per ULID; not sequential)
- Option C: configurable in `.lore/export-index.json` — first export assigns + stores; future exports reuse

**Recommendation**: C. Sequence stability + simple human eyeballing.

### Q2 — Drift resolution UX

`⚠ drift` is identical to SPEC-018 — but here the source of truth is the file or the corpus? After `lore set --content` updates corpus, drift appears on next export. Should:

- Always show drift, never resolve (current SPEC-018 stance, mirror for symmetry)
- Auto-write when corpus.updated > file mtime (heuristic)
- Require explicit `--force` flag

**Recommendation**: third option, mirroring SPEC-018's `--force` deferral.

### Q3 — Where do AI-created docs land first?

If `lore create spec --ai` writes only to corpus, should we also auto-export on success? Or require manual `lore export-docs` afterwards?

- Auto: lower friction; but means SPEC-017 changes
- Manual: explicit user action; user remembers to commit

**Recommendation**: manual. Auto-export is a config option (`ai.auto_export: true|false`, default false) covered in a tiny SPEC-021.1 follow-up; out of v1 scope here.

### Q4 — Frontmatter `parent:` shape

SPEC-018 expects `parent: PRD-001` (human ID). Corpus stores ULID. Mapping requires `.lore/export-index.json` to bidirectionally translate. What if the parent has no exported file yet?

**Recommendation**: export topologically — parents first. If a parent is corpus-only and not yet exported, export it implicitly before children.

### Q5 — What about task type?

Tasks have `extra.plan_id` (ULID) — frontmatter needs human-readable plan reference. Symmetric handling required.

**Recommendation**: same `.lore/export-index.json` table; resolve plan_id → human ID before write.

### Q6 — Directory layout

SPEC-018 reads only `docs/requirements/spec/`. New types need new directories. Pre-create them on first export?

**Recommendation**: yes, mkdir -p per type. Pre-creation is idempotent.

## 4. Acceptance Criteria (early draft)

**AC-EXPORT-1** `lore export-docs` with no args walks every doc in corpus, writes one .md file per doc under `docs/requirements/<type>/`.

**AC-EXPORT-2** First export creates `.lore/export-index.json` with `{<doc_id>: {human_id, file_path}}` for every exported doc.

**AC-EXPORT-3** Subsequent export with no corpus changes is a no-op (no files written, no index changes).

**AC-EXPORT-4** Round-trip: `lore export-docs && lore sync-docs` returns "0 created, 0 drifted" — full SSOT preservation.

**AC-EXPORT-5** New corpus-only doc → second export creates one new file; `.lore/export-index.json` grows by exactly one entry.

**AC-EXPORT-6** Frontmatter `parent:` resolves to a human ID (e.g. `PRD-001`) — never a raw ULID.

**AC-EXPORT-7** `--dry-run` reports the same plan as the real run, writes nothing.

**AC-EXPORT-8** `--type spec` exports only specs, leaving all other corpus rows alone.

**AC-EXPORT-9** Drift detected → `⚠ drift: <file>` warning, file NOT overwritten without `--force`.

**AC-EXPORT-10** Soft-deleted corpus rows are skipped — never exported, never removed from disk if previously exported.

**AC-EXPORT-CORE-1** `.lore/export-index.json` shape validated via Zod `exportIndexSchema` in `@lore/core`.

**AC-EXPORT-COLLISION-1** Two concurrent exports racing to allocate the same human ID (e.g. both pick `SPEC-019`) — the second writer detects the collision via filesystem `open(O_EXCL)` on the target `.md` path (the `.lore/export-index.json` is a regular JSON file, not SQLite, so it has no native UNIQUE guarantee). On collision the second writer reads the now-extant index, picks `next = max(used)+1`, and retries. Both writers end up with distinct sequential numbers; no doc loss.

## 5. Out-of-scope rejections

- "Sync versions / audit log to git" — too noisy; lore.db remains version-history SSOT.
- "Auto-commit after export" — user remains the git agent.
- "Export to Markdown subfolders by status" — flat per-type layout matches existing repo.
- "Conflict-resolution UI" — drift remains warning-only; manual `lore set` is the resolution.

## 6. Risks

| Risk | Mitigation |
|---|---|
| `.lore/export-index.json` corrupted or deleted | Rebuild on next export by matching corpus titles to existing files by exact title (mirroring SPEC-018's match algorithm). |
| Two collaborators run `lore export-docs` concurrently and produce divergent index numbers | Index updates happen pre-write; SQLite WAL serialises. Worst case: two specs both numbered SPEC-019; next-export detects collision and renumbers the later one. Document this. |
| Drift becomes the steady state (every export complains) | Telemetry tracks drift count; alert at threshold. Future SPEC adds `--force-direction` if drift volume is real. |
| File names with unusual characters break shell tools | Reuse `slugify()` from `@lore/core`; same rules as SPEC-002 §6.1. |
| Topological export errors when parent chain has cycles | Cycles already forbidden at link time by `CorpusService.link` (SPEC-002 §6.3); export does a defensive sort with cycle detection. |

## 7. Outstanding Decisions (block implementation)

~~Resolved — see §8 below.~~

## 8. Resolved Decisions (ratified 2026-07-01)

| Question | Ratified Answer |
|---|---|
| Q1 ID-numbering policy | **C: `.lore/export-index.json`** stores first-time assignment; future runs reuse per-doc-id → human-id mapping. Deterministic + human-eyeball-friendly. |
| Q2 Drift resolution UX | **Warning-only in v1** — mirrors SPEC-018 §2.1 stance. `--force` writes corpus body over file; originally deferred to v2 consistent with SPEC-018's `--force`. **Superseded by Amendment A2 (2026-07-07): `--force` is now implemented** — see below. |
| Q3 Auto-export after AI create | **Manual only in v1**. Config option `ai.auto_export: boolean` deferred to SPEC-021.1 follow-up. `lore create --ai` writes only to corpus; user runs `lore export-docs` afterwards. |
| Q4 Frontmatter `parent:` shape | **Topological export — parents written first.** If a corpus-only parent has no exported file yet, export it implicitly before children. Human-ID resolution via `.lore/export-index.json`. |
| Q5 task `extra.plan_id` resolution | **Same `.lore/export-index.json` table.** Resolve `plan_id` (ULID) → human ID (e.g. `PLAN-001`) at write time. |
| Q6 Directory layout | **`mkdir -p docs/requirements/<type>/` per type on first export.** Idempotent. Types: `spec` (existing), `prd`, `adr`, `plan`, `task`, `knowledge`. |
| Q-extra `.lore/export-index.json` git-tracked? | **Git-tracked** — sequence stability across the team requires shared knowledge of the ID map. Add to root README or CLAUDE.md as a hand-off note; do NOT `.gitignore`. |

## 9. Architecture Notes (implementation-ready)

### 9.1 File touch list

| File | Change |
|---|---|
| `packages/core/src/schemas.ts` | Add `exportIndexSchema`: `z.object({ version: z.literal(1), mappings: z.record(z.string(), z.object({ human_id: z.string(), file_path: z.string() })) })`. Emit derived TS type `ExportIndex` via `z.infer`. |
| `packages/lore/src/service/export-docs-service.ts` | **NEW** (~450 lines, mirrors `sync-docs-service.ts` 460 lines). Public API: `exportDocs({ dryRun, type?, force? }): Promise<Result<ExportReport, LoreError>>`. `ExportReport = { created: string[], skipped_clean: string[], drift: string[], errors: string[] }`. |
| `packages/lore/src/adapters/cli/commands/export-docs.ts` | **NEW** (~130 lines, mirrors `sync-docs.ts` 134 lines). Flags: `--dry-run`, `--type <type>`, `--force` (v1 rejected with "not yet implemented" hint per Q2), `--json`. |
| `packages/lore/src/adapters/cli/index.ts` | Register `"export-docs": () => import("./commands/export-docs.js").then((m) => m.default)`. |
| `packages/lore/src/app.ts` | Wire `ExportDocsService` into `App` composition root (both SQLite and Turso builders). |
| `packages/lore/tests/unit/service/export-docs-service.test.ts` | **NEW** — happy path, drift detection, topological ordering, collision, empty-type filter. |
| `packages/lore/tests/integration/cli/export-docs.test.ts` | **NEW** — end-to-end subprocess: create doc, export, verify file exists with correct frontmatter, rerun idempotent. |
| `packages/lore/tests/integration/cli/roundtrip.test.ts` | **NEW** — round-trip parity: create doc via CLI → `export-docs` → `sync-docs` → status returns "0 created, 0 drifted". |

### 9.2 Frontmatter shape (must roundtrip with SPEC-018 sync-docs)

```yaml
---
id: SPEC-025             # human-readable ID from export-index.json, NOT the corpus ULID
type: spec
role: spec               # SSOT: derived from type via DOC_TYPE_ROLE_MAP
title: "Doc title verbatim from corpus"
status: draft            # current corpus status
priority: medium         # current corpus priority
phase: P10               # optional, from doc.extra.phase (legacy) or omitted
created: 2026-07-01
updated: 2026-07-01
tags: [foo, bar]
parent: PRD-001          # human ID of parent (resolved via index)
links:
  - {id: SPEC-017, type: extends, note: "..."}
---
```

### 9.3 `.lore/export-index.json` shape

```json
{
  "version": 1,
  "mappings": {
    "01KVZ4C445EK479938W1TYT3AJ": {
      "human_id": "PRD-001",
      "file_path": "docs/requirements/prd/PRD-001-lore-platform.md"
    },
    "01KWBSWC5J6K30Q0DHJ3FJGX03": {
      "human_id": "PLAN-001",
      "file_path": "docs/requirements/plan/PLAN-001-cli-v3-roadmap.md"
    }
  }
}
```

- Git-tracked (Q-extra).
- Rebuilt on next export if lost: match corpus titles against on-disk files by exact title (mirroring SPEC-018 match algorithm) + assign next-available number for anything unmatched.
- Corpus-only docs (never exported) get a new number: `max(existing_human_ids) + 1` scoped by type.

### 9.4 Human-ID numbering per type

- `spec`: SPEC-NNN (3 digits, zero-padded). Existing files SPEC-001..024 seed the next-index counter to 25.
- `prd`: PRD-NNN. Existing: PRD-001 only.
- `adr`: ADR-NNN.
- `plan`: PLAN-NNN.
- `task`: TASK-NNN.
- `knowledge`: KN-NNN (2-letter prefix — 3-letter "KNW" is uglier and "K" is ambiguous).

Numbering scoped per type. `SPEC-025` and `PLAN-025` can coexist.

### 9.5 Topological export ordering

Walk `parent_id` chain from the leaves upward, invert to get root-first order. For SPEC-021's initial export:

```
PRD-001 → PLAN-001 → TASK-{001..013}  (13 tasks under 1 plan under 1 prd)
       ↘ SPEC-{001..024}              (24 specs directly under prd)
```

If cycles detected (should never happen — CorpusService.link rejects cycles), abort with `VALIDATION_ERROR` naming the cycle path.

### 9.6 Drift detection algorithm

For each corpus doc that already has an entry in `.lore/export-index.json`:

1. Read the file at `mapping[doc_id].file_path`.
2. Strip frontmatter, normalise whitespace.
3. Compare against corpus `doc.content` (also whitespace-normalised).
4. If differ → `⚠ drift: <file>` + add to `report.drift[]`, do NOT overwrite unless `--force` is passed (implemented per Amendment A2), in which case the file is rewritten and reported in `report.overwritten[]` instead.

Frontmatter itself is NOT compared (title/status/priority may legitimately differ if user edited via CLI between exports — body is the diff signal).

### 9.7 Concurrent-writer safety

- `.lore/export-index.json` writes go through `open(O_EXCL)` on a temp file + `rename()` for atomicity.
- Per-file writes also use `open(O_EXCL)` on the target path.
- On EEXIST: reread index, recompute next-available number for that type, retry once. Second EEXIST → fail loud with `STORE_ERROR`.

### 9.8 Test layout

- Unit (vitest): schemas (`exportIndexSchema`), service methods (topo sort, drift detection, ID allocation).
- Integration (vitest subprocess): full CLI, using a temp corpus + temp `docs/` root.
- Roundtrip (vitest subprocess): export → sync-docs → verify 0 drift.

### 9.9 Out of §9 scope (still SPEC-021)

- ~~`--force` to overwrite drift (Q2 defers to v2)~~ — implemented, see Amendment A2.
- `ai.auto_export` config option (Q3 defers to SPEC-021.1).
- Version-history export (`lore export-versions` is a separate future SPEC).
- MCP / HTTP surface for `export-docs`.
- Watch mode (`--watch` for corpus changes).
- Deletion sync (soft-deleted corpus rows leave files alone).

## Amendment A1 (2026-07-07): title-declared numbering in human_id allocation

**Incident**: `buildOrExtendIndex` allocates human_ids with a pure per-type sequential counter (max+1), ignoring series numbers embedded in doc titles. The corpus doc titled "SPEC-035 — Audit trail + calibration data" was exported while the doc titled "SPEC-033 — Dashboard as living-PRD projection" was not yet on disk, so it received human_id SPEC-033 — filename and frontmatter `id:` contradicted the title's self-declared number, and the real SPEC-033 was on track to be allocated SPEC-036. Repaired by hand-editing the index (commit 9b282d0); this amendment prevents recurrence.

**Behavior change** (new-allocation path only; title-match reconcile and existing index mappings are untouched):

1. When allocating a human_id for an unmapped doc, first try the doc's self-declared number: `doc.title` matched against `^\s*{PREFIX}-(\d+)\b` where `PREFIX = TYPE_PREFIX[doc.type]` (so a plan titled "SPEC-035 implementation — …" can never claim a SPEC number: its prefix is PLAN).
2. Normalize the captured number to the canonical padded form `{PREFIX}-{NNN}` (`padStart(3, "0")`; numbers ≥ 1000 keep their natural width).
3. Adopt the claimed id iff it is not already held by an existing mapping or by an earlier allocation in the same pass — tracked via a `usedHumanIds` set seeded from `index.mappings` (mirror of `usedFilePaths`). Otherwise fall back to the sequential counter.
4. The sequential fallback must skip numbers present in `usedHumanIds` (increment until free) so a title-claimed forward number can never collide with a later counter allocation.
5. Allocation stays deterministic: same corpus + same index ⇒ same result.

**Acceptance criteria**:

- AC-A1-1: unmapped spec titled "SPEC-040 — X" allocates human_id `SPEC-040` (filename `SPEC-040-…`).
- AC-A1-2: two unmapped specs both titled "SPEC-040 — …" → first in iteration order gets `SPEC-040`, second falls back to sequential; human_ids never duplicate.
- AC-A1-3: title-declared number already claimed in the index → sequential fallback.
- AC-A1-4: after a title-claim of `SPEC-036` while the counter sits at 035, the next sequential allocation skips to `SPEC-037`.
- AC-A1-5: title "SPEC-7 — …" normalizes to `SPEC-007`.
- AC-A1-6: titles with no leading `{PREFIX}-{N}` (or a foreign prefix) behave exactly as before (pure sequential) — regression: existing allocation tests stay green.

## Amendment A2 (2026-07-07): `--force` implemented; drift-check basis clarified as SSOT-correct

**Incident** (`KN — export-docs drift check false-positives on projected docs`): a report claimed two defects: (1) drift detection compares the on-disk file against the RAW corpus body while export writes a `renderResolvedToMarkdown` PROJECTION (SPEC-032 §3.3), so any placeholder-bearing doc would drift forever; (2) the drift warning recommends `--force`, but `--force` was rejected as "(v2, not yet implemented)".

**Finding on (1)**: already fixed by SPEC-032 T3 (commit `5ff4902`) before this amendment — `ExportDocsService.resolveDocBody(doc)` is called ONCE per doc and its output (`resolvedBody`) is used for BOTH the drift comparison and the on-write content (see module header CRITICAL note in `export-docs-service.ts`). No further code change was needed for this half; two regression tests were added to `export-docs-service.test.ts` to lock it in:
- an unchanged placeholder-bearing doc re-exports `skipped_clean` (already covered before this amendment),
- a placeholder-bearing doc whose children/links CHANGE since the last export now correctly reports `drift` — this is a TRUE positive (the file is a stale projection of the CURRENT corpus state, not a comparison-basis bug) — newly covered by "STATE — corpus children change under a placeholder doc → drift IS reported".

**Finding on (2) — resolved by implementing `--force` for real**, superseding §8 Q2's "deferred to v2" stance:

1. `ExportDocsService.exportDocs({ force: true })` no longer rejects with `VALIDATION_ERROR`. When a doc's on-disk file differs from the current expected content (frontmatter + resolved body), the file is rewritten in place with fresh frontmatter and body — same construction path used for newly-created files (`buildFileContent`, factored out of the create-path so force-overwrite doesn't only patch the body while leaving stale frontmatter).
2. Overwritten paths are reported in a new `ExportReport.overwritten: string[]` field, never in `drift`. `dryRun: true` + `force: true` reports `overwritten` without writing (mirrors `created`'s dry-run semantics).
3. Files with no drift are unaffected by `force` (still `skipped_clean`) — force never touches a file that already matches.
4. CLI (`export-docs.ts`): the early `--force` rejection is removed; `--help` text and the drift-warning copy no longer reference "(v2, not yet implemented)" — the warning now explains the file is either hand-edited or a stale projection, and that `--force` (or manual reconciliation) resolves it.

**Why (a) over (b)** (the two options considered — implement `--force` for real, vs. drop it from the warning copy and document the delete+re-export workaround): the writer path (`buildFrontmatterString` + `canonicaliseBody(resolvedBody)` + a plain write) already existed for the create branch; force-overwrite only needed to reuse it for an existing path (no `O_EXCL`) instead of introducing a second, permanently-broken promise in the CLI's own help text and warning copy. Implementing it removes a standing "the tool describes a capability it does not have" inconsistency at comparable cost to rewording it away.

**Acceptance criteria**:

- AC-EXPORT-9 (re-scoped): `force: true` on a drifted file overwrites it with the current expected content, reported in `overwritten`, never in `drift`.
- `force: true` on an already-clean file is a no-op (still `skipped_clean`, file bytes untouched).
- `force: true, dryRun: true` reports `overwritten` without writing to disk.
- After a force-overwrite, a subsequent plain (non-force) export converges to `skipped_clean` (proves the overwrite actually reset the comparison basis).
- Raw-body (non-placeholder) doc drift behavior is unchanged when `force` is omitted — regression guard.


## Code anchors

- packages/lore/src/service/export-docs-service.ts

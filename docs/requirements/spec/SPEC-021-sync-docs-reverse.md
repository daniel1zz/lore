---
id: SPEC-021
type: spec
role: spec
title: "lore export-docs — reverse sync from corpus to spec files"
status: draft
priority: medium
phase: P10
created: 2026-06-30
updated: 2026-06-30
tags: [cli, corpus, sync, export, drift, phase-10, stub]
parent: PRD-001
links:
  - {id: SPEC-018, type: relates-to, note: "Inverse direction of lore sync-docs — note: lore link-type vocabulary lacks 'complements', using relates-to"}
  - {id: SPEC-017, type: relates-to, note: "AI-created docs only live in corpus until exported"}
  - {id: SPEC-022, type: relates-to, note: "Dashboard write UI needs roundtrip to git"}
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

- Q1-Q6 above each need a final answer.
- Confirm `.lore/export-index.json` is git-tracked (recommended: yes — sequence stability across team) or in `.gitignore` (would defeat the purpose). Default recommendation: git-tracked.

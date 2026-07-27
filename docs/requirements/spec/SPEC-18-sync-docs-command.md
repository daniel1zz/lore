---
id: SPEC-018
type: spec
role: spec
title: "lore sync-docs — backfill new spec files into corpus"
status: draft
priority: medium
phase: P9
created: 2026-06-28
updated: 2026-06-28
tags: [cli, corpus, sync, drift, docs, phase-9]
parent: PRD-001
links:
  - {id: SPEC-002, type: depends-on, note: "Uses corpus create/list/get via CorpusService"}
  - {id: SPEC-003, type: extends, note: "Adds new lore sync-docs subcommand"}
  - {id: SPEC-007, type: relates-to, note: "Migration is one-shot v1 import; sync-docs is the ongoing companion"}
---

# SPEC-018: `lore sync-docs` — backfill new spec files into corpus

## 1. Purpose

`lore migrate v1` is one-shot: it imports the v1 corpus once, then the user moves on. New spec files authored directly in `docs/requirements/spec/SPEC-*.md` (during PR-review workflows, AI-generated SPEC creation, etc.) never enter `lore.db` — `lore search`, `lore tree`, and the dashboard all silently miss them.

This SPEC adds `lore sync-docs`: a one-way file → corpus reconciler that scans `docs/requirements/spec/*.md`, parses frontmatter, and creates corpus rows for missing specs. Drift (file body differs from corpus body) is reported but never auto-applied — corpus changes go through `lore set` or `lore approve`, not through silent overwrite.

Result: after authoring `SPEC-NNN-foo.md` and committing it, running `lore sync-docs` lands it in corpus as a `draft` spec linked to the appropriate parent.

## 2. Goals & Non-Goals

### 2.1 Goals

- New CLI subcommand `lore sync-docs` — no flags required; defaults to dry-run-print + apply-create-only.
- Scans `docs/requirements/spec/*.md` (path configurable via `--from`).
- For each file: parses YAML frontmatter (`title`, `type`, `parent`, `tags`, `priority`), strips frontmatter from body, normalises whitespace.
- Matches each file against corpus by exact title (`CorpusService.list({type:"spec"})` → match `doc.title === frontmatter.title`).
- For unmatched files: creates a new `spec` row via `CorpusService.create` with body = file content (frontmatter-stripped), `parent_id` resolved from frontmatter `parent:` (matched against existing PRD by exact title in corpus, or falls back to single PRD if only one exists).
- For matched files where body differs: prints `⚠ drift: <file>` and skips. `--force` flag would push file body → corpus via `lore set` (new `--no-edit` shortcut path; see §3.4) — but `--force` is OUT of scope for v1; warning-only.
- `--dry-run` reports what WOULD happen without writing.
- Six-dimension test coverage.

### 2.2 Non-Goals (explicit)

- ❌ **Sync for `prd`, `adr`, `plan`, `knowledge`, `task`.** v1 ships spec-only. Other types use `lore create` directly.
- ❌ **Reverse sync (corpus → file).** No `lore export-docs` in this SPEC. Round-tripping is a future SPEC.
- ❌ **`--force` to overwrite drift.** v1 prints warnings; user uses `lore set` manually to push file → corpus.
- ❌ **Automatic delete.** If a corpus row exists for a title and no file matches, the row is left alone (not flagged, not removed). Data preservation > tidiness.
- ❌ **Frontmatter `id` preservation.** Corpus assigns new ULIDs; the frontmatter `id` (e.g., `SPEC-018`) lives only in the file. Cross-referencing relies on title and slug.
- ❌ **Hook into `lore create`** — `lore create spec --title X` does not auto-import other files. sync-docs is a deliberate user action.
- ❌ **Watch mode** (`--watch` for file changes). Manual invocation only.
- ❌ **Link migration.** Frontmatter `links:` are ignored by sync-docs. Users run `lore link` for cross-doc relationships.
- ❌ **MCP tool exposure** (`lore_sync_docs`). CLI-only for v1.
- ❌ **Conflict detection across runs** (e.g., file deleted between two syncs). Each invocation is independent.

## 3. Architecture

### 3.1 Module layout

```
packages/lore/src/adapters/cli/commands/
└── sync-docs.ts                       ← NEW: citty subcommand

packages/lore/src/service/
└── sync-docs-service.ts               ← NEW: SyncDocsService (stateless, takes CorpusService dep)

packages/core/src/
└── ai.ts (or new sync.ts)             ← OPTIONAL: SyncReport type if shared with adapters; otherwise local

packages/lore/src/adapters/cli/
└── index.ts                           ← MODIFIED: register sync-docs subcommand (lazy import)
```

No changes to `@lore/core` if `SyncReport` lives in service; keep it package-local.

### 3.2 Frontmatter parsing

Uses existing `yaml` package (already in deps via SPEC-007). Pattern:

```ts
function parseSpecFile(absPath: string): Result<ParsedSpec, LoreError> {
  const raw = readFileSync(absPath, "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return err({ code: "VALIDATION_ERROR", field: "frontmatter", message: `${absPath}: missing frontmatter` });
  const fm = parseYaml(match[1]);
  if (fm.type !== "spec") return err({ code: "VALIDATION_ERROR", field: "type", message: `${absPath}: type='${fm.type}' (expected 'spec')` });
  return ok({
    path: absPath,
    title: String(fm.title),
    body: match[2].trimStart(),
    parent_title_hint: typeof fm.parent === "string" ? fm.parent : undefined,
    priority: VALID_PRIORITIES.includes(fm.priority) ? fm.priority : "medium",
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
  });
}
```

### 3.3 `SyncDocsService.run(opts)`

```ts
export interface SyncDocsOptions {
  fromDir: string;        // e.g. "docs/requirements/spec"
  dryRun: boolean;        // default true at adapter level
}

export interface SyncReport {
  scanned: number;
  created: Array<{ file: string; slug: string }>;
  matched_clean: Array<{ file: string; slug: string }>;
  matched_drift: Array<{ file: string; slug: string; diff_chars: number }>;
  errors: Array<{ file: string; error: string }>;
}

class SyncDocsService {
  constructor(private corpus: CorpusService) {}
  async run(opts: SyncDocsOptions): Promise<Result<SyncReport, LoreError>>;
}
```

Algorithm:
1. `readdirSync(opts.fromDir)` → filter `*.md` → parse frontmatter for each → accumulate `ParsedSpec[]` and errors.
2. `corpus.list({ type: "spec" })` → build `Map<title, DocRecord>`.
3. For each ParsedSpec:
   - Match by title. If matched: compare `body.trim() === doc.content.trim()` → bucket into `matched_clean` or `matched_drift`.
   - If no match: resolve parent (see §3.4) → if `!opts.dryRun`, call `corpus.create({type:"spec", title, content: body, parent_id, priority, tags})` → push to `created`.
4. Return `ok(report)`.

### 3.4 Parent resolution

Frontmatter `parent:` is a string like `"PRD-001"`. v1 strategy:
1. `corpus.list({ type: "prd" })` once at the start.
2. If exactly one PRD exists: use it as the parent for ALL synced specs regardless of frontmatter value (warn once if multiple files claim different parents).
3. If multiple PRDs exist: look up by title equality against frontmatter `parent_title_hint`. If still ambiguous: error with `VALIDATION_ERROR` and instruct user to disambiguate manually.
4. If zero PRDs exist: error with `VALIDATION_ERROR` ("no PRD in corpus; create one first or use `lore create spec --parent <slug>`").

### 3.5 CLI surface

```bash
lore sync-docs                              # default: scan docs/requirements/spec/, dry-run + apply-create-only
lore sync-docs --from <path>                # custom scan dir
lore sync-docs --dry-run                    # report only; no writes
lore sync-docs --json                       # machine-readable SyncReport
```

Default behaviour (no flags):
- Scan default path.
- Apply creates (not dry-run).
- Print human report.
- Exit 0 if no errors; exit 4 if any per-file `VALIDATION_ERROR`.

Human report shape:
```
Scanned docs/requirements/spec/ — 18 files
✓ Created 4 new specs:
    SPEC-014-monorepo-skeleton.md         → spec-monorepo-skeleton-bun-workspaces-p1-layout
    SPEC-015-dashboard-readonly-skeleton.md → spec-dashboard-read-only-skeleton
    SPEC-016-cookie-auth-local-bootstrap.md → spec-cookie-auth-cli-managed-local-bootstrap
    SPEC-017-ai-provider-built-in.md       → spec-built-in-ai-provider-for-lore-create
✓ 12 specs matched corpus (clean)
⚠ 2 specs differ from corpus body (use `lore set <slug> --content "$(cat <file>)"` to push):
    SPEC-003-cli-adapter.md
    SPEC-005-review-workflow.md
```

### 3.6 `App` wiring

`app.ts` gains `syncDocsService: SyncDocsService` field (required, like other services). Constructed in `createApp` from `corpusService`. No new config, no new schema.

## 4. Implementation Plan

Single-phase (service + CLI + tests fit in one implementer pass given limited surface area).

1. New `packages/lore/src/service/sync-docs-service.ts` per §3.3.
2. New `packages/lore/src/adapters/cli/commands/sync-docs.ts` per §3.5.
3. `packages/lore/src/app.ts` — wire `SyncDocsService`.
4. `packages/lore/src/adapters/cli/index.ts` — register lazy import.
5. `packages/lore/src/service/CLAUDE.md` — bump count "seven → eight"; add row.
6. `packages/lore/src/adapters/cli/CLAUDE.md` — bump subcommand count "23 → 24"; add row.
7. Tests:
   - `packages/lore/tests/unit/service/sync-docs-service.test.ts` (vitest, uses `InMemoryStore` + temp dir).
   - `packages/lore/tests/integration/sync-docs-cli.bun.test.ts` (bun test, real CLI invocation against temp `.lore/` + `docs/`).

## 5. Acceptance Criteria

### 5.1 Behaviour

**AC-SD-1** `lore sync-docs` on a corpus with 13 spec rows and 17 spec files in `docs/requirements/spec/` creates 4 missing specs, reports "Created 4 new specs", exits 0.

**AC-SD-2** `lore sync-docs --dry-run` on the same state reports identical output but creates 0 rows; corpus row count unchanged.

**AC-SD-3** `lore sync-docs --from <empty-dir>` reports "Scanned ... — 0 files", exits 0, no error.

**AC-SD-4** Re-running `lore sync-docs` after AC-SD-1 reports "Created 0 new specs", "17 specs matched corpus (clean)", exits 0 (idempotency).

**AC-SD-5** `lore sync-docs --json` outputs valid JSON matching `SyncReport` shape; integers are integers, arrays are arrays.

### 5.2 Drift

**AC-SD-6** Edit `docs/requirements/spec/SPEC-017-ai-provider-built-in.md` body in place; re-run `lore sync-docs` → reports `⚠ 1 spec differs`; corpus body for that spec is unchanged; exit 0.

### 5.3 Parent resolution

**AC-SD-7** Corpus with exactly 1 PRD → all synced specs get that PRD as parent.

**AC-SD-8** Corpus with 2 PRDs and a spec file with `parent: "PRD-001"` matching one PRD's title — that PRD is selected as parent.

**AC-SD-9** Corpus with 2 PRDs and a spec file with `parent: "ghost"` matching neither — service returns `VALIDATION_ERROR` for that file; report lists it under errors; other files still process; exit 4.

**AC-SD-10** Corpus with 0 PRDs and a spec file to import — `VALIDATION_ERROR`; exit 4; report instructs creating PRD first.

### 5.4 Frontmatter validation

**AC-SD-11** Spec file without frontmatter → `VALIDATION_ERROR`; reported under errors; other files still process.

**AC-SD-12** Spec file with `type: "knowledge"` (not "spec") → `VALIDATION_ERROR`; reported.

**AC-SD-13** Spec file with malformed YAML in frontmatter → `VALIDATION_ERROR`; reported.

### 5.5 Boundary / SSOT

**AC-SD-14** `SyncDocsService` constructor accepts only `CorpusService`; no other state. Verified by structural inspection.

**AC-SD-15** `lore sync-docs` does NOT call `app.aiProviderService` even once (no AI generation involvement).

### 5.6 Oracle

**AC-SD-16** `bun run typecheck` clean.

**AC-SD-17** `bun run test:vitest` ≥ +12 new tests vs current baseline, all green.

**AC-SD-18** `bun run test:bun` ≥ +5 new tests vs current baseline, all green.

**AC-SD-19** `bun run build` produces a runnable `dist/lore`; `dist/lore sync-docs --help` lists the subcommand and shows `--from`, `--dry-run`, `--json` flags.

## 6. Out-of-scope rejections

- "Auto-update on `lore create` of any doc type" — sync-docs is intentionally manual; auto-syncing creates surprise.
- "Push file body → corpus on drift" — `--force` deferred to v2 to avoid silent overwrites.
- "Sync PRDs / ADRs / plans" — sufficient demand has not been observed; specs are the dominant in-file authoring surface today.
- "Sync .docs frontmatter metadata into `extra` field" — frontmatter `tags` and `priority` are read; everything else (links, status, phase) is ignored. Status promotion stays via `lore approve`.
- "Reverse export (corpus → file)" — separate concern; future SPEC if needed.

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Title-match dedup misses if user renames a file's title | Acceptable v1 limitation; user can `lore delete` the stale row and re-sync, or `lore set --title` to realign. Future SPEC may add stable id via frontmatter id → corpus extra. |
| User has multiple PRDs with non-unique titles | Error per §3.4 step 3 — points user at `lore create spec --parent <slug>` for manual sync. |
| Body trim comparison too strict (CRLF vs LF) | Normalise both sides with `.replace(/\r\n/g, "\n").trim()` before equality check. |
| Large bodies (>50KB) repeated string compare | One-shot equality check is O(n); acceptable for spec sizes (largest today is 27KB). |
| File added then removed before sync | Out of scope; sync is per-invocation, no state between runs. |
| Frontmatter parsing security (YAML deserialisation gadgets) | Use `yaml.parse` with default safe mode (no custom tag resolution). Existing `yaml` dep in SPEC-007 already runs safe mode. |

## 8. Open Questions (deliberately none)

All design questions answered up front; ambiguity resolved in §3.4 (parent resolution rules).

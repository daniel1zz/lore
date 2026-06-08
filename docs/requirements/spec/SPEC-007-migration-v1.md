---
id: SPEC-007
type: spec
role: spec
title: "Migration v1"
status: draft
priority: high
phase: P1
created: 2026-06-08
updated: 2026-06-08
tags: [migration, docman-v1, import, phase-1]
parent: PRD-001
links:
  - {id: SPEC-001, type: implements, note: "MigrationService in service layer"}
  - {id: SPEC-002, type: consumes, note: "Maps v1 types to v2 corpus schema"}
---

# SPEC-007: Migration v1

## 1. Purpose

Define the one-shot migration tool that imports DocMan v1 corpus into Lore v2. Zero data loss. No ongoing compatibility — this is a one-way bridge.

## 2. DocMan v1 Source Format

v1 corpus location: `~/.claude/docman-mcp/docs/` (or user-specified path)

v1 document format: Markdown files with YAML frontmatter.

```yaml
---
id: "ARCH-01KPZ6GG4N4AXRHX9WKE6DVP6P"  # ULID-based ID
type: architecture
status: published
priority: high
created: "2025-12-15"
updated: "2026-01-20"
tags: [architecture, module-map]
links:
  - "PRD-01KJ2MTE53XHNSPJY1W43YMRZQ"
  - "SPEC-01KT8XDXQ135ZPXH863X13GHR1"
---

# Document content in markdown...
```

### v1 → v2 Mapping

| v1 Field | v2 Field | Transformation |
|---|---|---|
| `id` (ULID) | `id` | Preserve original ID as-is (or map to v2 ID scheme with alias) |
| `type` | `type` + `role` | See type mapping table below |
| `status` | `status` | Map: `published` → `approved`, `draft` → `draft` |
| `priority` | `priority` | Direct mapping |
| `created` | `created_at` | ISO 8601 |
| `updated` | `updated_at` | ISO 8601 |
| `tags` | `tags` | Direct copy |
| `links` (array of IDs) | Link records | Each becomes a `relates-to` link. Parent-child inferred from type hierarchy |
| Content (markdown) | `content` | Direct copy. MDX components not present in v1 |

### v1 Type → v2 Type+Role Mapping

| v1 Type | v2 Type | v2 Role |
|---|---|---|
| `prd` | `prd` | intent |
| `feature-spec`, `tech-spec` | `spec` | spec |
| `architecture` | `spec` | spec (sub_type: architecture) |
| `decision`, `adr` | `adr` | decision |
| `plan` | `plan` | plan |
| `knowledge`, `ideation`, `retrospective` | `knowledge` | knowledge |
| `task` | `task` | plan |
| (other) | `knowledge` | knowledge (with warning) |

## 3. MigrationService Interface

```typescript
interface MigrationService {
  analyze(sourcePath: string): Promise<MigrationReport>
  execute(sourcePath: string, opts: MigrateOpts): Promise<MigrationResult>
}

interface MigrateOpts {
  dryRun: boolean           // true = analyze only, don't write
  skipSecretScan: boolean   // false by default — always scan
  idStrategy: 'preserve' | 'remap'  // preserve v1 ULIDs or generate new IDs
}

interface MigrationReport {
  source_path: string
  total_files: number
  parseable: number
  unparseable: FileError[]
  type_mapping: { v1Type: string, v2Type: string, count: number }[]
  link_mapping: { total: number, resolvable: number, broken: number }
  secret_warnings: SecretWarning[]  // potential API keys, tokens found
  estimated_corpus_size: string     // e.g., "234 docs, 1.2MB"
}

interface MigrationResult {
  imported: number
  skipped: number
  errors: FileError[]
  link_resolution: { created: number, broken: number }
  warnings: string[]
}

interface SecretWarning {
  file: string
  line: number
  pattern: string           // what was detected (e.g., "potential API key")
  snippet: string           // surrounding context (redacted)
}
```

## 4. Secret Scan

Before import, scan all v1 documents for potential secrets:

| Pattern | Detection |
|---|---|
| API keys | Regex: `[A-Za-z0-9_-]{32,}` near keywords like `key`, `token`, `secret`, `api` |
| AWS keys | `AKIA[A-Z0-9]{16}` |
| Private keys | `-----BEGIN (RSA\|EC\|OPENSSH) PRIVATE KEY-----` |
| `.env` content | Lines matching `[A-Z_]+=.{8,}` |

If secrets detected:
1. Report shows file, line, redacted snippet
2. User must confirm with `--force` or fix source files before re-running
3. Migration does NOT proceed without confirmation

## 5. Migration Flow

```
lore migrate v1 --from ~/.claude/docman-mcp/docs/
  │
  ├─ 1. Scan source directory for .md files
  │
  ├─ 2. Parse each file: YAML frontmatter + markdown content
  │     ├─ Success → add to migration queue
  │     └─ Failure → add to unparseable list
  │
  ├─ 3. Secret scan across all files
  │     └─ If found → print report, ask for confirmation
  │
  ├─ 4. Print MigrationReport (always, even with --dry-run)
  │     └─ If --dry-run → stop here
  │
  ├─ 5. User confirms: "Import N docs? [y/N]"
  │
  ├─ 6. For each doc:
  │     ├─ Map v1 type → v2 type + role
  │     ├─ Create doc via CorpusService.create()
  │     ├─ Set created_at/updated_at from v1 frontmatter
  │     └─ version = 1, action = 'migrate'
  │
  ├─ 7. Resolve links:
  │     ├─ For each v1 link reference → find target in imported docs
  │     ├─ Create link via CorpusService.link()
  │     ├─ Infer parent links from type hierarchy (specs → PRD)
  │     └─ Log broken links (target not found)
  │
  └─ 8. Print MigrationResult
```

## 6. Acceptance Criteria

| Given | When | Then |
|---|---|---|
| v1 corpus with 200+ docs at `~/.claude/docman-mcp/docs/` | `lore migrate v1 --dry-run --from <path>` | Report shows doc count, type mapping, link stats, secret warnings. No writes to Lore |
| Same corpus, no secrets | `lore migrate v1 --from <path>` | All docs imported. Links resolved. Broken links logged. `lore status` shows imported count |
| v1 doc has unknown type "custom-note" | Migration | Imported as `knowledge` type with warning in report |
| v1 doc contains `AKIA...` pattern | Secret scan | Warning displayed. Migration blocked until `--force` or file fixed |
| v1 link references non-existent ID | Link resolution | Link skipped. Logged as broken in MigrationResult |
| Already migrated (docs exist) | `lore migrate v1 --from <path>` again | Skips existing docs (by original v1 ID). Reports: "N docs already exist, skipped" |
| v1 doc has `links: [ID-A, ID-B]` | Link resolution | Creates `relates-to` links from this doc to A and B. If A is a PRD and this doc is a spec, also infers `parent` link |

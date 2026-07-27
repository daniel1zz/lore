---
id: SPEC-003
type: spec
role: spec
title: "CLI Adapter"
status: in-review
priority: critical
phase: P1
created: 2026-06-08
updated: 2026-06-08
tags: [cli, adapter, ux, phase-1]
parent: PRD-001
links:
  - {id: SPEC-001, type: implements, note: "CLI adapter calls service layer interfaces"}
  - {id: SPEC-002, type: consumes, note: "CLI validates against corpus schema"}
  - {id: SPEC-004, type: consumes, note: "CLI renders resolved MDX output"}
---

# SPEC-003: CLI Adapter

## 1. Purpose

Define the CLI adapter — the first (Phase 1) transport layer for Lore. The CLI parses arguments, calls service layer methods, and formats responses for terminal output. **Zero business logic in this layer.**

## 2. Design Principles

- **Thin adapter**: `parse args → call service → format output`. Nothing else.
- **Composable**: Every command outputs structured data that can be piped (`--json` flag for machine-readable output).
- **Two output modes**: Default human-friendly text vs `--json` machine-readable. (`--verbose` was considered but dropped — `--json` already provides full detail and the text/JSON split keeps the surface small.)
- **Consistent error model**: All errors follow same format with exit codes.

## 3. Command Taxonomy

### 3.1 CRUD Commands

| Command | Service Call | Description |
|---|---|---|
| `lore create <type>` | `corpusService.create()` | Interactive: prompts for title, opens $EDITOR for content. `--title` and `--content` flags for non-interactive |
| `lore get <id-or-query>` | `corpusService.get()` + `outlineService.resolve()` | Displays doc content + navigation footer. `--raw` skips MDX resolution. `--json` for structured output |
| `lore set <id> [--title] [--status] [--content]` | `corpusService.set()` | Update specific fields. Opens $EDITOR if no flags. Prints version number on success |
| `lore delete <id> --confirm` | `corpusService.delete()` | Soft-delete. Refuses without `--confirm` flag |

### 3.2 Discovery Commands

| Command | Service Call | Description |
|---|---|---|
| `lore list [filters]` | `corpusService.list()` | Table output: `ID | Type | Title | Status | Updated`. Filters: `--type`, `--status`, `--since`, `--author`, `--tag` |
| `lore search <query>` | `corpusService.search()` | FTS5 results: `ID | Title | Snippet | Score`. `--type` filter. `--limit` |
| `lore tree [root-id]` | `corpusService.tree()` | Terminal tree rendering using parent links. Default root: first PRD. `--depth` limits expansion |

### 3.3 Graph Commands

| Command | Service Call | Description |
|---|---|---|
| `lore link <from> <to> [--type]` | `corpusService.link()` | Default link type: `relates-to`. Validates both IDs exist |
| `lore unlink <from> <to>` | `corpusService.unlink()` | Removes link. Error if link doesn't exist |

### 3.4 Lifecycle Commands

| Command | Service Call | Description |
|---|---|---|
| `lore init` | N/A (setup) | Guided project setup: name, storage path. Creates `.lore/` directory + SQLite DB |
| `lore migrate v1 --from <path>` | `migrationService.analyze()` then `.execute()` | `--dry-run` calls only `analyze()`. Shows report before executing |
| `lore status` | `corpusService.status()` | Corpus stats, sync state (P2), health check |

### 3.5 Review Commands (FR-15)

| Command | Service Call | Description |
|---|---|---|
| `lore pending [--author]` | `reviewService.pending()` | List docs in `draft` status. `--author` filters by creator |
| `lore approve <id>` | `reviewService.approve()` | Transition draft → approved. Records reviewer in audit |
| `lore reject <id> [--reason]` | `reviewService.reject()` | Transition draft → rejected. Reason stored in audit |

### 3.6 Version Commands (FR-16)

| Command | Service Call | Description |
|---|---|---|
| `lore log [<doc-id>]` | `versionService.log()` | Without doc-id: recent audit entries. With doc-id: version history for that doc |
| `lore diff <doc-id> [v1 v2]` | `versionService.diff()` | Default: latest vs previous. Colored diff output in terminal |
| `lore restore <doc-id> <version>` | `versionService.restore()` | Creates new version with old content. Prints new version number |

### 3.7 P2 Extension Commands

These commands were added in Phase 2 alongside the MCP / HTTP / sync / eval specs. They are part of the shipped CLI surface and follow the same `--json` and exit-code conventions as P1 commands.

| Command | Spec | Description |
|---|---|---|
| `lore serve [--port] [--host]` | SPEC-010 / SPEC-011 | Start the Lore HTTP API server (Bun.serve, bearer-token auth). Mounts the HTTP adapter |
| `lore agent <create\|list\|revoke>` | SPEC-010 §3.2 | Manage API keys for AI agents (issued tokens for the HTTP API). NOT an MCP-server launcher — MCP is entered via top-level `--mcp-server` flag |
| `lore sync <setup\|status\|push\|pull>` | SPEC-009 | Configure and operate the Turso embedded-replica sync engine. Bypasses `loadLoreApp` and manages TursoStore directly |
| `lore eval [--scenario]` | SPEC-013 | Run read-only evaluation scenarios against the corpus (FTS5 resilience, etc.) |

`lore serve`, `lore agent`, and `lore eval` go through `loadLoreApp` and inherit telemetry wiring (AC-K3-1). `lore sync` is exempt — it manages TursoStore itself and does not require a pre-existing corpus DB for all subcommands.

## 4. Output Formatting

### 4.1 Document Display (`lore get`)

```
── SPEC-001 Service Layer Architecture ──────────────────────
Type: spec | Status: draft | Priority: critical | v3
Created: 2026-06-08 by owner | Updated: 2026-06-08

[document content here, with MDX components resolved to terminal tree]

── Navigation ──────────────────────────────────────────────
Parent: PRD-001 Lore Platform
Siblings: SPEC-002 Corpus Schema, SPEC-003 CLI Adapter
Children: (none)
Related: ADR-001 Bun Selection (informs)
```

### 4.2 List Display (`lore list`)

```
ID        Type   Title                    Status   Updated
SPEC-001  spec   Service Layer Arch       draft    2h ago
SPEC-002  spec   Corpus Schema            draft    1h ago
ADR-001   adr    Bun vs Deno              proposed 3d ago

3 documents (filter: --type spec,adr)
```

### 4.3 Tree Display (`lore tree`)

```
PRD-001 Lore Platform (approved)
├── SPEC-001 Service Layer Architecture (draft)
├── SPEC-002 Corpus Schema (draft)
├── SPEC-003 CLI Adapter (draft)
├── SPEC-004 PRD-as-Living-Root (draft)
├── SPEC-005 Review Workflow (draft)
├── SPEC-006 Version History (draft)
└── SPEC-007 Migration v1 (draft)
```

### 4.4 Error Display

```
Error: Document not found: SPEC-999
  Suggestion: Did you mean SPEC-001?
  Run `lore list --type spec` to see available specs.
```

### 4.5 JSON Mode (`--json`)

Every command supports `--json` flag for machine-readable output. Identical structure to what MCP adapter (P2) will return.

## 5. Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments / usage error |
| 3 | Document not found |
| 4 | Validation error (schema violation, cycle detected) |
| 5 | Conflict (stale version) |

## 6. Configuration

### 6.1 Project Config (`.lore/config.yaml`)

Created by `lore init`. Lives in project root.

```yaml
project:
  name: "lore"
  author: "owner"            # default author for this project

# P2: sync config added here
# sync:
#   remote: "libsql://xxx.turso.io"
#   token: "${LORE_SYNC_TOKEN}"
```

### 6.2 Global Config (XDG-aware)

User-level preferences. **Path resolution order** (pick the first file that exists; if none exists, no global config is loaded):

1. `$LORE_CONFIG_HOME/config.yaml` — app-specific escape hatch (highest precedence)
2. `$XDG_CONFIG_HOME/lore/config.yaml` — XDG explicit
3. `~/.config/lore/config.yaml` — XDG default

`$XDG_CONFIG_HOME` defaults to `~/.config` per the XDG Base Directory Specification. macOS / Windows users get the same `~/.config/lore/` path by default — Lore intentionally uses cross-platform XDG (matching `gh`, `helm`, `pnpm`) rather than per-OS native paths (`~/Library/Application Support/` etc.) so docs and tutorials stay portable.

**Schema** (`GlobalConfigSchema`, all keys optional, strict — unknown keys rejected):

```yaml
defaults:
  editor: "vim"              # overrides $EDITOR for lore create/set; falls back to $EDITOR, then vi (Unix) / notepad (Windows)
  format: "text"             # default output: text | json
  color: true                # ANSI colour in terminal output
```

**Merge semantics with project config** (`.lore/config.yaml`):

- Global config provides defaults for `defaults.*` keys only — it MUST NOT contain `project`, `sync`, or `telemetry` sections (those are per-project).
- Project config wins on any conflict (project keys override global keys).
- A missing global file is not an error; commands proceed with built-in defaults (`format: text`, `color: true`, editor: `$EDITOR` → `vi`/`notepad`).
- Malformed global config: parse error printed to stderr; commands continue with built-in defaults (fail-loud at the per-key level, not catastrophic — the user should still be able to run `lore`).

### 6.3 Data Directory

- `.lore/` — project root, contains:
  - `config.yaml` — project config
  - `lore.db` — SQLite database (corpus + versions + audit + FTS5)
  - `lore.db-wal` — WAL file (SQLite WAL mode for concurrent reads)
  - `.gitignore` — auto-generated: ignores `lore.db*`

## 7. Acceptance Criteria

### 7.1 Unit-level (AC-CLI-001)

`AC-CLI-001`: CLI utility functions (formatError, exitCode, formatTable, formatTree, formatNavigation, relativeTime) produce correct output for all input classes.

| Given | When | Then |
|---|---|---|
| User runs `lore get SPEC-001` | CLI adapter parses args | Calls `corpusService.get({id: "SPEC-001"})`, formats result with navigation footer |
| User runs `lore get SPEC-001 --json` | Same parse | Same service call, outputs raw JSON (same structure as future MCP response) |
| User runs `lore get NONEXISTENT` | Service returns DocNotFound | CLI prints error with suggestion, exits with code 3 |
| User runs `lore create spec --title "Auth"` | CLI calls `corpusService.create({type: "spec", title: "Auth"})` | Prompts for parent_id (required for spec), opens $EDITOR for content |
| User runs `lore list --type spec --status draft` | CLI calls `corpusService.list({type: "spec", status: "draft"})` | Displays formatted table |
| User pipes `lore list --json \| jq '.docs[].id'` | JSON output | Parseable by jq — proves composability |

### 7.2 End-to-end subprocess-level (AC-E2E-001)

`AC-E2E-001`: The full CLI pipeline — argument parsing → service layer → SQLite persistence → output formatting — behaves correctly as observed from a spawned subprocess.

`AC-E2E-001.01`: `lore init` creates `.lore/` directory containing `lore.db` and `config.yaml`. Running `init` twice exits non-zero.

`AC-E2E-001.02`: `lore get <slug>` displays document content with navigation footer in human-readable form.

`AC-E2E-001.03`: `lore get <slug> --json` outputs valid JSON envelope `{ok, data: {doc, navigation}}`.

`AC-E2E-001.N01`: `lore get <nonexistent>` prints error to stderr and exits with code 3.

`AC-E2E-001.04`: `lore create <type> --title <t>` creates a document and prints its slug. `--json` returns the full document envelope.

`AC-E2E-001.05`: `lore list --type <t>` returns only documents of the specified type.

`AC-E2E-001.06`: `lore list --json` produces a JSON object where `.data.docs[].id` is extractable by downstream tools (jq-composable).

`AC-E2E-001.07`: `lore delete <slug>` without `--confirm` exits with code 4 and prints instructions. With `--confirm` deletes successfully.

`AC-E2E-001.08`: `lore pending` lists draft documents. `lore approve <id>` transitions draft→approved and removes the doc from `pending` output.

`AC-E2E-001.09`: After one `set` update, `lore log <id>` shows 2 version entries. `lore diff <id>` shows v1→v2 changes.

`AC-E2E-001.10`: `lore status --json` returns `{ok: true, data: {total_docs, by_type, last_updated}}` with correct counts.

`AC-E2E-001.11`: `lore tree --json` returns a root doc with children array reflecting parent-child hierarchy.

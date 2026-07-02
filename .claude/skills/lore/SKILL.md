---
name: lore
description: Store and retrieve team knowledge via the lore CLI — a shared corpus of PRDs, specs, ADRs, plans, and knowledge docs with review workflow and version history. Use when the user says "记到 lore" / "存到知识库" / "查一下团队知识库" / "save this decision", when capturing decisions/learnings worth sharing across sessions or teammates, or before starting work that earlier PRDs/specs/ADRs may already cover.
---

# Lore — Team Knowledge Base

Single binary `lore`, data lives in `.lore/lore.db` (per-directory corpus; run commands from the project root that owns the corpus).

Not installed? `ln -sf <lore-repo>/dist/lore /usr/local/bin/lore`, then `lore init --name <corpus> --author <name>` once in the corpus directory.

## Quick start

```bash
lore search "optimistic locking" --limit 5   # FTS5 full-text, BEFORE writing something new
lore get <id-or-slug>                        # read one doc (slug format: {type}-{kebab-title})
lore create prd --title "Payment module" --content "..." --tags payments,p0
lore link spec-payment-api prd-payment-module --type=implements
```

Every command supports `--json` for machine-readable output. Errors print to stderr with non-zero exit — never parse stdout on failure.

## Retrieval (do this before creating)

```bash
lore search "<topic>" [--type adr] [--limit N]   # content search
lore list --type adr                             # browse by type
lore tree                                        # hierarchy view
lore status                                      # corpus stats / health
```

Always search first — duplicating an existing doc fragments team knowledge. Link instead.

## Creating documents

| Type | Required besides --title |
|---|---|
| prd, plan | — |
| spec | `--parent <id-or-slug>` |
| task | `--parent <plan>` + `--plan-id <plan>` (+ optional `--phase <name>`, must be declared on the plan) |
| adr | `--decision-status proposed\|accepted\|deprecated\|superseded` |
| knowledge | `--sub-type ideation\|retro\|research\|reference` |

All six types are CLI-creatable (type-specific flags landed with SPEC-023). The MCP interface (`lore --mcp-server`) remains the path for arbitrary `extra` fields beyond these flags.

Flags: `--title --parent --content --content-file <path> --priority critical|high|medium|low --tags a,b --json`.

## Plans with phases (SPEC-023)

```bash
lore phase add <plan> <name> [--description]   # declare a phase (exit 4 on duplicate)
lore phase list <plan> | rm | rename           # manage phases
lore create task --parent <plan> --plan-id <plan> --phase <name> --title "..."
lore tree <plan>                               # tasks grouped under phase headers
```

## Review workflow

New docs start as `draft`. Lifecycle: draft → in-review → approved → active → archived (fast-track draft→approved allowed; approved→deprecated). Editing an approved doc's content/title resets it to draft.

```bash
lore pending                          # what awaits review
lore approve <id>
lore reject <id> --reason "why"       # reason lands in audit log
lore set <id> --status active         # other transitions
```

## Version history (append-only, non-destructive)

```bash
lore log <id>                         # all versions
lore diff <id> --from 2 --to 5        # unified diff between versions
lore restore <id> 3                   # rollback = creates a NEW version
```

Concurrent writes are protected by optimistic locking — a stale write returns STALE_VERSION; re-read the doc and retry your edit on the fresh version.

## Linking

`lore link <from> <to> --type=<t>` with types: `parent | implements | informs | supersedes | relates-to | blocks` (default relates-to). Direction is detailed→abstract for implements (spec→prd). `lore unlink <from> <to>` removes.

## Agent/service integration

- MCP (preferred for agents): `lore --mcp-server` — full-field CRUD, resources, review tools.
- HTTP API: `lore serve` + `lore agent create --name <agent>` to issue API keys (`lore agent list|revoke`).

## Conventions

- One corpus per team workspace; back up = copy `.lore/lore.db`.
- Capture decisions as they're made (don't batch at session end); prefer linking related docs over restating context.
- `lore delete <id>` is a soft delete (30-day recovery); status `archived` is preferred over deletion.

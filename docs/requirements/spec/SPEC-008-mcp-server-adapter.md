---
id: SPEC-008
type: spec
role: spec
title: "MCP Server Adapter"
status: deprecated
priority: critical
created: 2026-06-08
updated: 2026-10-10
tags: [mcp, adapter, ai-agent, phase-2]
links:
  - {id: SPEC-001, type: implements}
  - {id: SPEC-010, type: relates-to}
---
# SPEC-008: MCP Server Adapter

## 1. Purpose

MCP adapter on the same service layer as CLI. Enables AI agents (Claude Code, Cursor, etc.) to interact with the Lore corpus via Model Context Protocol.

## 2. Tech Stack

- **Package**: `@modelcontextprotocol/sdk` v1.29.0 (stable)
- **Transports**: stdio (primary — Claude Code), Streamable HTTP (remote agents)
- **Schema**: Zod v4 for tool input schemas (already in project)
- **Entry**: `lore --mcp-server` (stdio) or `lore serve --mcp` (HTTP)

## 3. Tool Surface

Each tool maps 1:1 to a service layer method. Tool names prefixed with `lore_`.

| Tool | Service Call | Input Schema | Output |
|---|---|---|---|
| `lore_create` | `corpusService.create()` | `{type, title, content?, parent?, tags?, extra?, ai?}` | `{id, slug, type, status, version}` |
| `lore_get` | `corpusService.get()` + `outlineService.resolve()` | `{id_or_slug, resolve_mdx?, include_navigation?}` | `{doc, navigation?, resolved_components?}` |
| `lore_set` | `corpusService.set()` | `{id_or_slug, title?, content?, status?, tags?, extra?, slug?}` | `{doc, version}` |
| `lore_delete` | `corpusService.delete()` | `{id_or_slug, confirm: true}` | `{deleted_id, recoverable_until}` |
| `lore_list` | `corpusService.list()` | `{type?, status?, since?, author?, tag?, limit?, offset?}` | `{docs: DocSummary[], total}` |
| `lore_search` | `corpusService.search()` | `{query, type?, limit?}` | `{results: SearchHit[]}` |
| `lore_tree` | `corpusService.tree()` | `{root?, depth?}` | `{tree: TreeNode}` |
| `lore_link` | `corpusService.link()` | `{from, to, type?}` | `{link}` |
| `lore_log` | `versionService.log()` | `{id_or_slug, limit?}` | `{entries: VersionEntry[]}` |
| `lore_diff` | `versionService.diff()` | `{id_or_slug, from?, to?}` | `{diff}` |
| `lore_pending` | `reviewService.pending()` | `{author?, type?}` | `{docs: PendingDoc[]}` |
| `lore_approve` | `reviewService.approve()` | `{id_or_slug, reviewer?}` | `{doc}` |
| `lore_schema` | (static) | `{}` | `{doc_types, link_types, required_fields, status_values}` |
| `lore_context_bundle` | composite | `{id_or_slug, max_depth?}` | `{target, linked_specs, related_adrs, active_plans}` |
| `lore_batch` | composite | `{operations: [{op, args}]}` | `{results: Result[]}` |
| `lore_status` | `corpusService.status()` | `{}` | `{CorpusStatus}` |

### 3.1 lore_create — ai field (SPEC-024)

`ai?: boolean` — whether to invoke AI content generation before creating the doc.

- Default: `false` — MCP callers are always AI agents; running AI generation by default
  would cause claude-on-claude nesting (wasteful, SPEC-024 §1 rationale).
- Pass `ai: true` to explicitly opt in to AI generation (same pipeline as CLI `--ai`).
- When `ai: true` and `content` is not provided, `AIProviderService.generate()` is called
  and its output becomes the document body.
- `caller_surface: "mcp"` and `ai_default_source: "explicit_arg"` are passed to the telemetry
  event so consumers can distinguish MCP-sourced AI writes from CLI-sourced ones.

## 4. Resources

```typescript
// Dynamic resource template for documents
server.registerResource(
  'document',
  new ResourceTemplate('lore://docs/{docId}', { list: listAllDocs }),
  { title: 'Lore Document', mimeType: 'application/json' },
  async (uri, { docId }) => getDocAsJson(docId)
)

// Static resource for corpus schema
server.registerResource(
  'schema',
  'lore://schema',
  { title: 'Corpus Schema', mimeType: 'application/json' },
  async () => getSchemaJson()
)
```

## 5. Transport Modes

### 5.1 stdio (`lore --mcp-server`)

- For local AI agents (Claude Code spawns this process)
- No auth needed (OS-level process isolation)
- Single-session: one client, one server

### 5.2 Streamable HTTP (`lore serve --mcp`)

- For remote agents
- Bearer token auth via Better-Auth (SPEC-010)
- Multi-session capable
- Uses `WebStandardStreamableHTTPServerTransport` (Bun-native)

## 6. Implementation Pattern

```typescript
// src/adapters/mcp/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio'
import { createApp } from '../../app'
import { registerTools } from './tools'
import { registerResources } from './resources'

export async function startMcpServer(dbPath: string) {
  const app = createApp(dbPath)
  const server = new McpServer({ name: 'lore', version: '0.1.0' })

  registerTools(server, app)
  registerResources(server, app)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
```

Each tool file: parse input → call service → format as MCP content. Same thin-adapter pattern as CLI.

## 7. Error Mapping

| LoreError code | MCP error code | Behavior |
|---|---|---|
| DOC_NOT_FOUND | -32602 (InvalidParams) | Include suggestions in error data |
| VALIDATION_ERROR | -32602 | Include field + message |
| STALE_VERSION | -32409 (custom) | Include expected/actual versions |
| STORE_ERROR | -32603 (InternalError) | Sanitized message |

## 8. Acceptance Criteria

| Given | When | Then |
|---|---|---|
| MCP server running via stdio | Client sends tools/list | Returns all 16 tool definitions with Zod schemas |
| MCP server running | Client calls lore_get({id_or_slug: "spec-auth"}) | Returns doc + navigation JSON |
| MCP server running | Client calls lore_create({type: "spec", title: "Auth"}) without parent | Returns SCHEMA_VIOLATION error |
| MCP server running | Client requests lore://docs/PRD-001 resource | Returns PRD document as JSON |
| MCP server running | Client calls lore_context_bundle({id_or_slug: "spec-auth"}) | Returns target + parent PRD + related ADRs |


## Code anchors

- packages/lore/src/adapters/mcp/

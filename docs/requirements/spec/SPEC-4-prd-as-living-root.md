---
id: SPEC-004
type: spec
role: spec
title: "PRD-as-Living-Root"
status: approved
priority: high
created: 2026-06-08
updated: 2026-07-02
tags: [mdx, living-root, navigation, core-differentiator, phase-1]
parent: PRD-001
links:
  - {id: SPEC-001, type: implements}
  - {id: SPEC-002, type: relates-to}
  - {id: SPEC-003, type: relates-to}
---
# SPEC-004: PRD-as-Living-Root

## 1. Purpose

Define the MDX placeholder component system that makes a PRD (or any document) a **living outline** — embedded components resolve to live corpus subtrees at read time. This is Lore's core differentiator.

## 2. Concept

A document's content can contain MDX-style placeholder components:

```mdx
# My Product PRD

## Feature Specs
<ChildrenOf role="spec" />

## Recent Decisions
<RecentDecisions limit={5} />

## Architecture
<ModuleTree />
```

When this document is read (via `lore get`, MCP `lore_get`, or web UI), the OutlineService **resolves** each component by querying the corpus and injecting live data. The document is always current — no manual updating.

## 3. Component Catalog

### 3.1 `<ChildrenOf>`

Renders child documents of the current doc, filtered by type/role.

| Prop | Type | Default | Description |
|---|---|---|---|
| `role` | string? | (all) | Filter by doc role |
| `type` | string? | (all) | Filter by doc type |
| `status` | string? | (all) | Filter by status |
| `depth` | number | 1 | Tree depth (1 = direct children only) |

**Resolution query**: `SELECT * FROM docs WHERE parent_id = :current_doc_id AND type LIKE :filter`

### 3.2 `<RecentDecisions>`

Renders recently created/updated ADRs.

| Prop | Type | Default | Description |
|---|---|---|---|
| `limit` | number | 5 | Max results |
| `status` | string? | (all) | Filter: proposed, accepted, deprecated |

**Resolution query**: `SELECT * FROM docs WHERE type = 'adr' ORDER BY updated_at DESC LIMIT :limit`

### 3.3 `<ActivePlans>`

Renders plans with incomplete tasks.

| Prop | Type | Default | Description |
|---|---|---|---|
| `status` | string? | "active" | Plan status filter |

**Resolution query**: Plans with progress.completed < progress.total.

### 3.4 `<ModuleTree>`

Renders the full document type hierarchy as a tree.

| Prop | Type | Default | Description |
|---|---|---|---|
| `root` | DocId? | (current doc) | Tree root |
| `depth` | number | 3 | Max depth |

**Resolution query**: Recursive parent-link traversal from root.

### 3.5 `<RelatedOf>`

Renders documents linked to the current doc by non-parent link types.

| Prop | Type | Default | Description |
|---|---|---|---|
| `type` | LinkType? | (all) | Filter by link type |
| `direction` | "in"\|"out"\|"both" | "both" | Link direction |

### 3.6 `<Embed>`

Inlines another document's content.

| Prop | Type | Default | Description |
|---|---|---|---|
| `id` | DocId | (required) | Document to embed |
| `section` | string? | (all) | Specific heading to embed |

**Security**: Only internal corpus IDs allowed. External URLs rejected at parse time.

### 3.7 `<HealthStats>`

Renders corpus health statistics.

| Prop | Type | Default | Description |
|---|---|---|---|
| (none) | | | |

**Resolution**: Aggregation query — doc count by type, by status, stale docs (>30d no update), orphans (no parent).

## 4. Resolution Pipeline

```
Input: Doc with MDX content
  │
  ├─ 1. Parse MDX AST (remark-parse + remark-mdx)
  │
  ├─ 2. Walk AST → find component nodes
  │
  ├─ 3. For each component:
  │     ├─ Validate: is it in the whitelist? (security)
  │     ├─ Validate: are props well-typed?
  │     ├─ Execute query against StoreInterface
  │     └─ Replace AST node with resolved data
  │
  ├─ 4. Return ResolvedDoc with surface-neutral data
  │
Output: ResolvedDoc { content, resolvedComponents[] }
```

The OutlineService returns **surface-neutral resolved data**. Each adapter formats it for its surface.

## 5. Rendering Contract

Each component renders differently per surface:

| Component | CLI (terminal) | MCP (JSON) | Web (P3) |
|---|---|---|---|
| `<ChildrenOf>` | Indented tree: `├─ [SPEC] auth (draft)` | `{children: [{id, title, type, status}]}` | Expandable tree node |
| `<RecentDecisions>` | Table: `ID \| Title \| Date \| Status` | `{decisions: [{id, title, date, status}]}` | Card list |
| `<ActivePlans>` | `• PLAN-003 auth [3/7]` | `{plans: [{id, title, completed, total}]}` | Progress bars |
| `<ModuleTree>` | Full indented tree | `{modules: nested}` | Collapsible tree |
| `<RelatedOf>` | `1. [ADR] auth-tokens (implements)` | `{related: [{id, title, type, link_type}]}` | Tag-grouped cards |
| `<Embed>` | Inline content with `── embedded: SPEC-042 ──` separator | `{embedded: {id, title, content}}` | Embedded card |
| `<HealthStats>` | `Corpus: 234 docs \| 12 draft \| 3 stale` | `{stats: {total, by_status, by_type}}` | Dashboard widget |

## 6. Performance

- Component resolution = SQL queries against local SQLite
- At 500 docs: each component query < 5ms
- Full PRD with 7 components: < 50ms total resolution time
- Lazy resolution: `--raw` flag skips resolution entirely (useful for editing)

## 7. Acceptance Criteria

| Given | When | Then |
|---|---|---|
| PRD-001 contains `&lt;ChildrenOf role="spec" /&gt;` and 3 child specs exist | `lore get PRD-001` | CLI output includes indented tree of 3 specs with type badges and status |
| Same PRD | `lore get PRD-001 --raw` | MDX component shown as-is, not resolved |
| Same PRD | `lore get PRD-001 --json` | JSON includes `resolvedComponents` array with structured children data |
| PRD contains `&lt;Embed id="NONEXISTENT" /&gt;` | Resolution | Component renders as `[Embed: NONEXISTENT not found]` — graceful degradation, not crash |
| PRD contains `&lt;ScriptInjection /&gt;` (not in whitelist) | Resolution | Component stripped from output. Warning in stderr |
| 500-doc corpus | Resolve PRD with all 7 component types | Total resolution < 50ms |

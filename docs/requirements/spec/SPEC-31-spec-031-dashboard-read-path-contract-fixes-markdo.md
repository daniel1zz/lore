---
id: SPEC-031
type: spec
role: spec
title: "SPEC-031 — Dashboard read-path contract fixes + markdown typography"
status: approved
priority: high
created: 2026-07-03
updated: 2026-07-03
tags: [dashboard, contract, bugfix, spec-031]
parent: PRD-001
---
# SPEC-031 — Dashboard read-path contract fixes + markdown typography

> Upstream: PRD §Web UI; sibling of SPEC-015 (read skeleton) / SPEC-022 (write UI) / SPEC-027 (hardening).
> Origin: 2026-07-03 product/design review walkthrough (see linked knowledge doc) — two of four read views crash against the real backend; markdown renders unstyled.

## 1. Problem

A live walkthrough with the real corpus (102 docs) found three defects, all verified with root cause:

1. **`/tree` crashes** (`nodes.map is not a function`). Backend `GET /api/tree` returns a single recursive root object `{ doc: DocSummary, children: TreeApiNode[] }` (after the `{ok,data}` envelope is unwrapped by `fetchJson`). Frontend `apiTree()` (`src/lib/api.ts`) declares `Promise<TreeNode[]>` and `DocTree` reads `node.title` / `node.type` / `node.id` at the top level — double contract drift.
2. **`/search` crashes** (`Cannot read properties of undefined (reading 'map')`). Backend returns `data.results: Array<{id, slug, title, snippet, ...}>`; frontend `search.tsx` reads `data.docs`.
3. **Markdown typography is dead.** `DocDetail.tsx` uses `prose prose-sm dark:prose-invert` but `@tailwindcss/typography` is not installed — Tailwind preflight flattens all headings/tables in doc content to plain text.

Root cause of 1–2: component tests mock the shapes the frontend *assumed*; the only e2e suite (`write-flow.pw.ts`) covers the write path. No test exercises the read path against the real server, so backend envelope evolution silently broke the frontend.

## 2. Direction

Backend envelope is the SSOT (shared by CLI/MCP consumers via the service layer). The frontend adapts; **no backend changes**.

## 3. Acceptance Criteria

- **AC-1** `/tree` renders the corpus tree from the real envelope (recursive `{doc, children}` shape). Node rows show title + type; click navigates to `/docs/$id`. No runtime crash.
- **AC-2** `/search?q=…` renders results from `data.results`. No runtime crash.
- **AC-3** Frontend types (`TreeNode`→ real shape, `SearchResponse`) match the real HTTP envelope; component tests for `DocTree` and the search route use the **real** shapes (fixtures derived from actual server responses).
- **AC-4** New Playwright e2e `read-flow.pw.ts` (same infra as `write-flow.pw.ts`, real `lore serve` + vite): tree page renders the PRD root node; search page renders ≥1 result for a seeded term. This is the regression oracle for read-path contract drift.
- **AC-5** `@tailwindcss/typography` installed and wired via Tailwind v4 CSS syntax (`@plugin` in `src/index.css`); DocDetail markdown headings/tables render with typography styles; a component test asserts rendered `<h1>`/heading structure inside the prose container.
- **AC-6** `bun run typecheck`, `bun run test` (both runners), and `cd packages/dashboard && bunx playwright test` all pass.

## 4. Out of scope

- Project-overview/dashboard-home aggregation views (pending queue, ready tasks, plan progress) — separate product track.
- List-view status filters/sorting, breadcrumbs, Cmd+K.
- Backend route changes.

---
id: KN-018
type: knowledge
role: knowledge
title: "Dashboard product/design review — 2026-07-03 walkthrough findings"
status: approved
priority: medium
created: 2026-07-03
updated: 2026-07-08
tags: [dashboard, review, ux, spec-031]
parent: SPEC-031
---
# Dashboard product/design review — 2026-07-03 live walkthrough

Method: started `lore serve` + `lore dashboard` against the real corpus (102 docs), screenshot walkthrough of all 4 views (agent-browser), source reading, API shape verification via in-browser fetch.

## Verdict

The dashboard today is a **document CRUD surface, not a project information hub**. A new developer opening it cannot answer 4 of the 5 onboarding questions (what is this project / how far along / what's blocked / what's pending review / what's next) — only "what is this project", and only by manually filtering to the PRD and reading unstyled text.

## P0 defects found (verified root causes)

1. `/tree` crashes: `nodes.map is not a function`. Backend returns single recursive root `{doc, children}`; frontend `apiTree()` declares `TreeNode[]` and `DocTree` reads top-level `node.title`. (api.ts:217)
2. `/search` crashes: reads `data.docs`; backend returns `data.results`. (search.tsx:70)
3. Test gap that let 1–2 land: component tests mock assumed shapes; only e2e is write-flow. No read-path test hits the real server.
4. `prose` classes are dead — `@tailwindcss/typography` not installed; spec/PRD headings and tables render flat.

## P1 product/IA gaps

- No overview/home aggregation: `lore status` distribution, pending review queue, active plans + phase progress (SPEC-023), ready tasks (SPEC-025), assessments (SPEC-026) — none surfaced. CLI has all of these; the human-facing surface has none.
- Default list drowned in noise: 55/102 archived tasks fill the first screen; no status filter, no sorting, no pagination, PRD not pinned.
- Detail page: no breadcrumb/parent navigation; CHILDREN rendered as dense inline text without type/status badges.

## P2 design/UX

- Type badge palette too coarse (prd=spec, adr=plan share variants); low-density 3-col cards for 100+ docs; no Cmd+K; search requires Enter.
- Strengths: dark theme complete, skeleton/error states handled, write path (editor, conflict modal, history diff) engineering quality notably higher than read path, a11y attributes thorough.

## Disposition

P0 items (+typography) → SPEC-031 (this doc's parent). P1 overview/IA track deliberately deferred to a separate product/design cycle.

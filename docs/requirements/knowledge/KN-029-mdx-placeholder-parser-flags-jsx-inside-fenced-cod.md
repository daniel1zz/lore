---
id: KN-029
type: knowledge
role: knowledge
title: "MDX placeholder parser flags JSX inside fenced code blocks"
status: approved
priority: medium
created: 2026-07-07
updated: 2026-07-08
tags: [outline, eval, bug]
parent: PRD-001
---
# eval placeholders FAILED on code examples (2026-07-07)

OutlineService's placeholder regex matched `<RouterProvider />` and `<Outlet />` inside fenced code blocks of SPEC-016 / SPEC-015 bodies and reported them as unknown components; 'lore eval placeholders' therefore failed on legitimate React code samples.

FIXED same day (bugfix plan F2): extractComponentMatches now excludes fenced code blocks and inline code spans; eval scenario shares the same extraction point (no drift). Unterminated fences fall back to pre-fix scanning (pinned by test).

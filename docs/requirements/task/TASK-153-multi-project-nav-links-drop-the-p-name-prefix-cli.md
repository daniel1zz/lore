---
id: TASK-153
type: task
role: plan
title: "Multi-project nav links drop the /p/:name prefix — clicking any nav item under /p/guyin silently switches the user back to the default project"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Found during SPEC-078 two-project UAT (2026-07-25, agent-browser on compiled dist/lore dashboard, registry lore+guyin). Repro: switch to guyin via ProjectSwitcher (URL /p/guyin, header shows 107 docs + guyin) then click nav 'Library' → lands on /library (default project): header flips to 590 docs + 'Select project', content is the LORE corpus. Evidence: on /p/guyin/library, document.querySelectorAll nav hrefs are '/', '/library', '/tree', '/execution', '/settings', '/issues' — no project prefix. Direct /p/guyin/library works (T13 route mirrors are fine); the defect is ONLY the nav/header link builder not consuming useProjectParam. UX blast radius: user believes they are operating in guyin but reads (and could write via cookie-gated surfaces) against lore.

AC:
- Given the current project is a registered project P (URL under /p/P), When rendering nav links (Home/Library/Tree/Execution/Settings/Issues + logo), Then every href carries the /p/P prefix — component test asserting hrefs under a routed /p/P context.
- Given registry-less mode or the default project (no /p prefix), Then hrefs are byte-identical to today (regression).
- e2e (multi-project playwright config): switch to project 2 → click each nav item → header project name and doc count remain project 2's.

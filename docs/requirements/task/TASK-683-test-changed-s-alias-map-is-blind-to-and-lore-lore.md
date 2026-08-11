---
id: TASK-683
type: task
role: plan
title: "test:changed's alias map is blind to @/ and @lore/lore, so every dashboard component test is unselectable when its component changes"
status: draft
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PRD-001
---
Third residual of the deterministic worktree oracle, measured 2026-08-11/12 by the dashboard-parity implementer. loadCoreAliasMap covers only @lore/core and @lore/core/node. Probe: resolveImportSpecifier('@/components/IssuesList', …) returns undefined while the relative form resolves ⇒ a lone IssuesList.tsx change selects ZERO of packages/dashboard/tests/component/*.test.tsx. Separately, @lore/lore/... is not in the map either, so a change to the SERVER's IssueResolution union does not select the dashboard parity test that exists to catch exactly that drift (that direction happens to be covered by bun run typecheck, proven to fire).

⛔ Fix the SELECTOR, not just the docs: root CLAUDE.md points at this module's own header as the full contract, so the header is the SSOT and is currently incomplete — but a header note alone leaves the blindness armed. Add both alias families to the map and pin each with a unit test asserting resolveImportSpecifier resolves them; then the header's residual list drops from three to one.

Known residuals for reference: (a) selection reads CONTENT MARKERS so a subprocess/scan test naming none is invisible; (b) reverse-dep walks STATIC imports only so await import() consumers are never selected; (c) THIS one.

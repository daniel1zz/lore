---
id: TASK-1745
type: task
role: plan
title: "Two AC-DC2-19 census tests reach the repository corpus and are red on main under the test sandbox"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem: two tests in packages/lore/tests/integration/dc2-site-census-not-measured.bun.test.ts (AC-DC2-19 HAPPY 'gate spec-create resolves to its entry symbol' and NEGATIVE 'a third token that is no subcommand exits 4 naming the whole path') are red on main (measured on 79571711 and 350ad2c9): LORE_TEST_SANDBOX=1 refuses the repository's own corpus /Users/apple/Projects/zz/lore/.lore/lore.db. The tests reach the repo corpus instead of a throwaway one. They block lore done of any task anchoring that file (unfiltered-test-file floor).

AC: bun run test:file packages/lore/tests/integration/dc2-site-census-not-measured.bun.test.ts exits 0 (12 passed) with LORE_TEST_SANDBOX=1, and both tests still assert their original outcome against a throwaway corpus (mkdtemp + lore init).

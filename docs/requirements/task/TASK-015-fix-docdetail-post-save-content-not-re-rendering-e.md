---
id: TASK-015
type: task
role: plan
title: "Fix DocDetail post-save content not re-rendering (e2e scenario 2)"
status: archived
priority: high
created: 2026-07-02
updated: 2026-07-02
tags: []
parent: PLAN-002
plan: PLAN-002
---
Found by Playwright e2e scenario 2 (edit + save), reproduced deterministically twice: after a successful save (server version increments to v2, Edit button reappears), the content preview renders an empty heading — the saved markdown body does not appear. Suspected stale query cache / invalidation timing in DocDetail.tsx post-save path (onMutated wiring / useSuspenseQuery). e2e assertion that fails: expect(page.getByText('E2E-EDIT-MARKER-ONE')).toBeVisible(). Oracle: full playwright suite (6 scenarios) green.

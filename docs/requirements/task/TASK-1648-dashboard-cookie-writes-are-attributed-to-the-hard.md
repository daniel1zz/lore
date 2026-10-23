---
id: TASK-1648
type: task
role: plan
title: "Dashboard cookie writes are attributed to the hard-coded key owner \"admin\" (multi-project write-parity e2e red)"
status: draft
priority: medium
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"tests","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"3f740fc1-a22c-4d9a-96c8-d548c2d08186"}
---

ensureLocalApiKey (packages/lore/src/adapters/cli/local-key.ts) creates the machine key dashboard-local with owner "admin" (store.create("dashboard-local", "admin")). A cookie session is named by its owner (partyOfActor, request-identity.ts), so every dashboard write of a lore dashboard launch is recorded with actor "admin" rather than a person. packages/dashboard/tests/e2e/multi-project-write-parity.spec.ts 'an accepted write on a registered project records the same person as the launch project's write' asserts the recorded actor is not "admin" and fails. Separate from #321 (seed); found while fixing it.

**Expected:** an accepted dashboard cookie write records a real person, not the literal admin
**Actual:** audit row actor is "admin" for both project-b and the launch project; expect(actor).not.toBe("admin") fails
**Repro command:** `cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.multi-project.config.ts tests/e2e/multi-project-write-parity.spec.ts`

Reported by: agent:session-a979eecd

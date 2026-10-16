---
id: TASK-1382
type: task
role: plan
title: "Oracle-file precheck ignores a cd in a non-first chain segment: 'A && cd packages/lore && bun test tests/x.bun.test.ts' is refused as a missing path"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"oracle-path-resolution","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"15826485-d877-44c5-aa55-1cde0cd19cf7"}
---

lore ac set/add resolves every test path in a script-mode command against the repo root unless the cd is the FIRST segment. In 'bunx vitest run <root path> && cd packages/lore && bun test tests/unit/store/x.bun.test.ts' the shell runs the bun test inside packages/lore, but the precheck reports tests/unit/store/x.bun.test.ts as not existing (exit 4) and demands --allow-missing-path, which would then track an existing file as an UNREDEEMED declaration. Reproduced 2026-10-16 on main after rebuilding dist/lore (includes the execution-root fix of plan-close-the-eight-verified-critical-defects F7). Workaround used: root-relative 'bun test packages/lore/tests/...'.

**Expected:** The precheck applies a cd to the segments that follow it in an && chain, as the shell does
**Actual:** exit 4: Declared script-mode command names path(s) that do not exist yet: tests/unit/store/judgment-truncation-roundtrip.bun.test.ts

Reported by: agent:session-c1ffea04

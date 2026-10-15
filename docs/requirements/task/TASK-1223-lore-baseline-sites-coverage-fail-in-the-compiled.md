---
id: TASK-1223
type: task
role: plan
title: "lore baseline sites|coverage fail in the compiled binary: the census cannot load typescript from /$bunfs, so completeness checks only run from a source checkout"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"distribution","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"62cec130-68fc-4608-bd89-65070dd8f01c"}
---

Found by the slice-2a specification backfill. dist/lore (bun build --compile) lazy-loads typescript via createRequire, which resolves from the embedded /$bunfs root and fails even when run inside a repo that has typescript installed. Consumers only get the binary (distribution-first), so the BL-7 completeness step is unavailable to them.

**Expected:** lore baseline sites/coverage resolve typescript from the project being analysed (its node_modules) when run from the compiled binary, and refuse with a clear 'install typescript in this project' message when it is absent
**Actual:** exit 4: census:typescript-unavailable {cause: Cannot find package 'typescript' from '/$bunfs/root/index.js'} even inside this repo

Reported by: agent:main-orchestrator

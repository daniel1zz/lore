---
id: TASK-888
type: task
role: plan
title: "A worktree has no node_modules, so @lore/core resolves upward to the MAIN checkout — every agent editing packages/core measures the wrong copy"
status: draft
priority: medium
created: 2026-08-26
updated: 2026-08-26
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"false-oracle","tags":["worktree","oracle","monorepo","dispatch"],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"9f61b591-3f69-43b9-9956-79d9427b1c9c"}
---

Worktrees created for dispatched agents contain no node_modules of their own. Bun/TS therefore resolve the '@lore/core' workspace specifier by walking UP the directory tree until they reach the main checkout's packages/core. An agent that adds or changes an export in ITS OWN packages/core is then typechecked and tested against the MAIN CHECKOUT's copy of that package, not against the code it just wrote. This is the harness-sees-its-own-copy false oracle named in CLAUDE.md's dogfooding lessons, reached through a path that requires no mistake by the agent. Measured 2026-08-25 while landing the vendor-intake change: the implementer added 'export const VENDOR_INTAKE_REPO' to packages/core/src/issue-report.ts inside its worktree, and the first 'bun run typecheck' in that same worktree reported TS2305 for that very export. The agent worked around it by hand-creating node_modules/@lore/{core,lore,dashboard} symlinks into ../../packages/*, after which typecheck and the suites finally measured its own tree. The workaround is the signal: a green (or red) verdict from any packages/core-editing worktree agent carries no guarantee about that agent's code until the link exists. Note both directions are damaging — a FALSE RED wastes a dispatch cycle and looks like the agent's bug (this is the observed case), and a FALSE GREEN certifies an export that does not exist in the branch about to be merged. The mechanism root is worktree provisioning, not agent diligence: prose telling agents to check first is exactly the layer CLAUDE.md says is the wrong layer.

**Expected:** A worktree created for a dispatched agent resolves @lore/core to ITS OWN packages/core, so typecheck and test verdicts describe the agent's code. Either the worktree provisioning step establishes the workspace links, or the toolchain refuses loudly when the resolved @lore/core lies outside the current worktree — never silently measures another tree.
**Actual:** @lore/core silently resolves to the main checkout's packages/core. bun run typecheck inside the worktree reported 'TS2305: Module "@lore/core" has no exported member VENDOR_INTAKE_REPO' for an export present in that worktree. No diagnostic anywhere names the resolution as the cause; the agent had to infer it and hand-link node_modules/@lore/* to proceed.
**Repro command:** `git worktree add /tmp/wt-probe origin/main && cd /tmp/wt-probe && echo 'export const PROBE_SYMBOL = 1;' >> packages/core/src/issue-report.ts && echo 'import { PROBE_SYMBOL } from "@lore/core"; void PROBE_SYMBOL;' > packages/lore/src/probe.ts && bun run typecheck; echo EXIT=$?`

Reported by: agent:main-orchestrator

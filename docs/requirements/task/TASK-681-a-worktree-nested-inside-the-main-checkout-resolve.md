---
id: TASK-681
type: task
role: plan
title: "A worktree nested inside the main checkout resolves the LIVE corpus, so any corpus-writing test run from it pollutes the shared corpus"
status: draft
priority: medium
created: 2026-08-11
updated: 2026-08-12
tags: []
parent: PRD-001
---
Root cause of the mirror-churn every implementer in this session fought, isolated by the vocabulary-relocation agent: harness worktrees live at <main>/.claude/worktrees/agent-*, i.e. NESTED inside the main checkout. findLoreDbPath walks cwd upward, so from a worktree it resolves /Users/apple/Projects/zz/lore/.lore — verified: 'lore status' run from a worktree reports the live 1406-doc corpus. Consequently the export-family tests (spec-loop-e2e, mirror-*, export-docs-*) run from a worktree WRITE INTO THE LIVE TEAM CORPUS and dirty the MAIN checkout's docs/requirements/ working tree while the orchestrator is working in it.

That is why every agent this session saw the spec-loop-e2e pollution guard fire, why three of them had to park mirror churn to satisfy the evidence guard, and why one deliberately refused to run test:changed at all (its @lore/core barrel edit selected 561 files including that family) rather than corrupt the shared corpus.

⛔ The upward walk is deliberate (SPEC M4: a fresh 'git worktree add' tree needs no local .lore/). The defect is that it makes a WRITE path reach a corpus the caller does not own. Candidate fixes to weigh: refuse corpus WRITES when the resolved corpus lives outside the cwd's own git worktree unless an explicit opt-in is passed; or have the test harness provision a throwaway corpus per worktree. ⛔ Do not 'fix' it by making the tests skip — the tests are correct, the resolution is what surprises.

## Re-baseline log — 2026-08-12, agent:main-orchestrator

The paragraphs above are preserved verbatim as filed. Two of their claims were re-measured before designing the fix; one held, two did not. Recorded here rather than edited away, because an in-flight correction that leaves no trace is indistinguishable from concealment.

**HELD — the defect itself, reproduced end to end.** Probe: throwaway mktemp git repo + `lore init`, one sentinel doc, then a NESTED worktree at `<repo>/.claude/worktrees/agent-x` carrying no `.lore/` of its own. From that worktree, `lore status` saw the parent corpus, and `lore create knowledge` took the parent from 1 to 2 docs — a process wrote into a corpus it does not own. CONTROL, which discriminates: a second worktree given its OWN `.lore/` reported 0 docs and could not see the parent sentinel, so the probe is not merely "everything reaches everything". The real repo's own `.lore/` was never touched.

**FALSIFIED — the attribution in paragraph 2.** The spec-loop-e2e pollution guard cannot have been reporting main-checkout dirt. `packages/lore/tests/integration/spec-loop-e2e.bun.test.ts:118` derives `REPO_ROOT` as `new URL("../../../../", import.meta.url)` — from the TEST FILE's own location, which inside a worktree is the WORKTREE root — and line 139 runs `git status --short .lore docs/requirements` with `cwd` set to that root. Measured on a synthetic worktree path: the URL walk resolves to `<repo>/.claude/worktrees/agent-x`, the worktree root. So that guard measures the worktree's own tree and is structurally blind to the main checkout. Whatever the implementers saw fire had a different mechanism, still unidentified. ⛔ Do not carry paragraph 2 into the fix's spec as a requirement — it would pin an AC to a causal story that measurement rejects.

**IMPRECISE — the SPEC M4 citation in paragraph 3.** §M4 made the `git rev-parse --git-common-dir` FALLBACK deliberate (`findMainCheckoutLoreDb`, the second of the two routes), not the upward walk, which predates it. The distinction is load-bearing for the fix: a NON-nested worktree reaches the main corpus via the fallback, a NESTED one via the walk, and only the fallback was ever a designed decision. Any fix keyed on "the corpus is outside my worktree" breaks §M4 for both routes alike, because `lore claim` / `lore evidence` / `lore verify` from an agent's own worktree are legitimate foreign writes and are what the whole dispatch protocol runs on.

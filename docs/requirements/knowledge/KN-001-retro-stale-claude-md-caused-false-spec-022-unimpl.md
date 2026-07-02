---
id: KN-001
type: knowledge
role: knowledge
title: "Retro: stale CLAUDE.md caused false 'SPEC-022 unimplemented' judgment"
status: approved
priority: medium
created: 2026-07-02
updated: 2026-07-02
tags: [retro, bootstrap, doc-drift]
parent: PLAN-002
---
# Retro: doc drift misled implementation-state judgment (2026-07-02)

## What happened
During the bootstrap-closeout session, the main agent judged SPEC-022 (dashboard write UI) as unimplemented based on two stale sources: root CLAUDE.md described @lore/dashboard as 'read-only v1', and the spec carried a '> Status: stub' banner + stub tag. Two implementer agents were dispatched before anyone checked git history. In reality SPEC-022 had already landed on main (e329703, d852b74, 1cd6faa, c231d57, 5dc7fdd) before the session started.

## Outcome
- Server-side agent detected the pre-existing implementation, verified oracles fresh (typecheck 0, vitest 1630 pass, bun 503 pass) and made zero changes. Cost: ~100k tokens for a verification pass.
- UI-side agent found three REAL residual gaps and fixed them before being stopped: dashboard production build broke on @lore/core barrel importing node:fs (rollup external fix), AC-DASH-WRITE-5 demotion not surfaced in save toast, draft cache saved on every keystroke instead of 1s debounce (spec §6). Merged as 13581bf.

## Root cause
Docs describing implementation state (CLAUDE.md module index, spec status banners) were not updated at merge time. Knowledge-state (corpus doc status) and code-state (git) drifted apart, and the agent trusted docs over git.

## Lessons
1. Implementation-state claims MUST be verified against git/code (git log --grep, file existence), never inferred from CLAUDE.md or spec prose.
2. Merge commits that land a spec should update: spec status banner, spec tags, root CLAUDE.md spec list, module CLAUDE.md purpose/invariants — in the same commit.
3. Duplicate-dispatch is not always waste: fresh-eyes verification found three genuine gaps the original implementation missed. But make it deliberate, not accidental.

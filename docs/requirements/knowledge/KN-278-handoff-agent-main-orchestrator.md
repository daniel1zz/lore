---
id: KN-278
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 6 next steps = 12 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

- .claude/settings.json
- assets/hooks/pre-dispatch-isolation-gate.mjs
- assets/hooks/stop-handoff-coverage.mjs
- assets/governance/corpus-workflow.md
- packages/core/src/distribution-hooks.ts
- packages/lore/src/adapters/real-setup-fs.ts
- packages/lore/src/service/setup-service.ts
- packages/lore/src/flows/setup-project-flow.ts
- packages/lore/src/flows/setup-project-uninstall.ts
- packages/lore/src/generated/assets-manifest.ts
- packages/lore/tests/unit/adapters/real-setup-fs-symlink.test.ts
- packages/lore/tests/unit/hooks/pre-dispatch-isolation-gate.test.ts
- packages/lore/tests/unit/stop-handoff-coverage.test.ts
- packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts
- packages/lore/tests/unit/assets-ssot.test.ts
- packages/lore/tests/unit/adapters/real-setup-ports.test.ts
- packages/lore/tests/unit/core/distribution-hooks.test.ts
- packages/lore/tests/unit/service/setup-service.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Plan closed (14/14 ACs runner-attested) and all four handoff-43 items executed. Two new specs shipped and approved: setup symlink safety, dispatch-isolation gate. My last commit is e640efb; HEAD has since moved to d373654 by a concurrent session touching only CLAUDE.md. | 95 |
| KD2 | The SAME defect class escaped THREE times. Root cause: the fix turned it into an opt-in 'boundary' parameter, so the defect moved from the implementation to the CALL GRAPH. Grepping the shape searches the callee — already correct — while the omission sits in a caller with no distinctive token. | 95 |
| KD3 | Two independent review rounds found 8 problems on a change set I had already red-greened, mutation-probed and full-suited. Self-review caught 2 of them before round one returned. Round two found the live data-loss path: a 4th unprotected call site, reproduced against a real filesystem. | 95 |
| KD4 | A WRONG rationale survives self-review better than a missing one. I examined detached-HEAD twice and wrote 'correct for that case' — every clause true except the last, which was the entire claim. Self-review re-reads its own conclusions instead of re-deriving them. | 95 |
| KD5 | The git-safety gate has a parameter-parsing defect of its own: it renders 'git stash drop stash@{0}' as an empty argument and reports it as destroying ALL 8 stashes. A gate that turns a precise operation into a catastrophic-looking one trains people to ignore its warnings. | 85 |
| KD6 | Write side and remove side are one invariant — never act THROUGH a link. renameSync onto a symlink replaces the link (measured: repo source untouched). That must NOT be changed to match remove's unlink/refuse, because writing through would corrupt the developer's own source. | 90 |

## Failing Oracle

(none)

## Next Steps

- NS1: Fix the git-safety gate's parameter parsing (SSOT: assets/hooks/pre-bash-git-safety-gate.mjs). Measured this session: a quoted 'stash@{0}' argument reaches the gate as an empty string, and it then lists every stash entry as WOULD DESTROY. Same class as the defects this session fixed — a safety mechanism whose own output misleads. Recommended first because it actively degrades trust in a gate that otherwise works correctly (it legitimately blocked reset --hard and checkout -- <path> twice this session).
- NS2: Make 'boundary' a REQUIRED parameter on the removal ports instead of optional. This is the mechanization the second retro identifies: the current source-scan pin enumerates a hardcoded list of files I remembered the fix touching, which inherits exactly the blind spot it exists to remove — and that blind spot is what let the same defect class escape three times. Making it required moves enumeration from a regex to the type checker. Cost: every test double (MapFs, PoisonedWriter, project-flow fakes) must supply it.
- NS3: Needs YOUR shell — the git-safety gate refuses it and says to ask you: git stash drop 'stash@{0}'. That entry is a redundant copy of the settings.json hook registration, byte-identical to commit 46e1157 (verified twice with cmp).
- NS4: Branch decision for the owner: fix/governance-never-discard-lore-output sits at 8227dd1, behind main with ZERO commits ahead (its content is fully contained in main), so it is safe to retire — but it is held checked out by the live concurrent session 81499892's worktree. Removing it would break that session; leave it until that session ends.
- NS5: Routine corpus hygiene, none of it produced by this session: lore archive --apply (expired handoffs -11, -14 and others past handoff_ttl_minutes whose plans are archived), and 7 pending review documents, the oldest being adr-distribution-first-every-improvement-names-its-consumer from 3 days ago.
- NS6: Deliberately NOT fixed, with reasoning, so it is not re-litigated blindly: assets/hooks/session-start-resume.mjs:169,184 carries the same existsSync/statSync-then-delete shape. Round two judged it low risk and I concurred — the targets are the hook's own privately created session-state directories, there is no path by which a developer symlinks them, and rmSync on a path that IS a link unlinks rather than recurses. Re-evaluate if that directory's ownership semantics ever change.

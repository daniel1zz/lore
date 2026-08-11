---
id: KN-325
type: knowledge
role: knowledge
title: "lore setup follows a dev symlink into assets/ and deletes the repo SSOT, then aborts mid-run while --check reports in sync"
status: approved
priority: medium
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PRD-001
---
## What happened

Ran `lore setup --yes` on this machine (2026-07-30). It aborted mid-run:

```
ENOTDIR: not a directory, rmdir /Users/apple/.claude/skills/lore-init-context
Committed before failure — committedBackups: [settings.json];
committedWrites: [skills/lore-biz-review/SKILL.md, hooks/claude-md-guard.sh, settings.json];
committedRemovals: [skills/lore-to-prd/SKILL.md, skills/lore-init-context/SKILL.md, governance/claude-md-contract.md]
The manifest was NOT written — this run changes are NOT yet authoritative.
```

`git status` immediately after showed `D assets/skills/lore-init-context/SKILL.md` — **a 336-line file inside the repo SSOT, deleted**. Restored with `git show HEAD:<path> > <path>` (NOT `git checkout --`, which `pre-bash-git-safety-gate.mjs` correctly blocked because the tree carried unrelated uncommitted work).

## Root cause

`~/.claude/skills/` on this machine holds ~40 symlinks pointing INTO the repo:

```
~/.claude/skills/lore-init-context -> /Users/apple/Projects/zz/lore/assets/skills/lore-init-context
~/.claude/skills/lore-plan         -> .../assets/skills/lore-plan
… ~40 lore skills, all of them
```

Two consequences compose into the failure:

1. **Removal follows the link.** `skills/lore-init-context/SKILL.md` is in `RETIRED_FROM_INSTALL_PATHS`, so setup removes it from the install dir. The path resolves through the symlink, so the delete landed on the repo SSOT, not on an installed copy. No backup was taken for removals (`committedBackups` held only `settings.json`), so the loss was only recoverable because the file was git-tracked.
2. **Then `rmdir` fails on the symlink itself.** POSIX `rmdir` rejects a symlink-to-directory with ENOTDIR — reproduced by hand: `rmdir ~/.claude/skills/lore-init-context` → `Not a directory`. So setup aborts AFTER the destructive step.

Worst possible ordering: the irreversible action commits, then the run aborts and declares itself non-authoritative. Re-running reproduces it identically — `lore setup` is permanently unable to complete on this machine, and `installed_at` is frozen at 2026-07-27.

## Second defect found in the same run: two surfaces disagree

- `lore setup --yes` → exit 1, "changes are NOT yet authoritative"
- `lore setup --check` → exit 0, "lore assets in sync"

One says the install failed, the other says everything is synced. `--check` compares content only, so it is blind to the aborted cleanup step that keeps the setup manifest unwritten. A consumer polling `--check` would never learn setup is broken.

## Fix direction (owner decision 2026-07-30: KEEP the symlinks, harden lore)

The symlinks are a deliberate dev convenience (edit `assets/` → effective immediately). lore must not be destructive in their presence:

- The removal path must `lstat` each target. For a symlink, `unlink` the LINK — never resolve through it, and never delete what it points at. A retired asset that happens to be symlinked should have its link removed, leaving the target untouched.
- Removals need the same backup treatment writes already get, or they must be refused when no backup is possible.
- `--check` must not report `in sync` while the setup manifest is unwritten from an aborted run; the two surfaces need one shared verdict source.

Delivery surface: `packages/lore/src/service/setup-service.ts` removal planning plus the real FS port that executes it, and the `--check` verdict path. This is consumer-facing — any developer who symlinks a skill dir hits it.

## Why the existing prose did not prevent it

The root CLAUDE.md already carries the standing lesson **"a dev symlink into assets/ is a shadow, not a pipeline"** (`adr-distribution-first-every-improvement-names-its-consumer`). The lesson was recorded, and the anti-pattern was then implemented ~40 times on the same machine, and the tool had no defense against it. Prose named the hazard; nothing enforced it. Same shape as the other findings this session: `turn-state.mjs` reading an env var this harness never sets, `pre-subagent-gate.mjs` documenting itself as a gate while every path exits 0, and an orchestrator omitting `isolation: "worktree"` on three consecutive dispatches with no mechanism to catch it.

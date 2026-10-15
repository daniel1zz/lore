---
name: lore-git-workflow
description: "Use when user says 'commit', 'create PR', 'create branch', 'resolve conflict', 'merge', 'rebase', 'git workflow', or when needing structured git operations with quality gates. Args: '<mode> [context]' — the FIRST token is the mode, one of: branch|commit|conflict|pr."
---

# Git Workflow - Mode: $0

Read `references/mode-$0.md` before starting. No mode → ask user.

| Mode | Reference | Focus |
|------|-----------|-------|
| `commit` | `references/mode-commit.md` | Create commits |
| `pr` | `references/mode-pr.md` | Create/manage pull requests |
| `branch` | `references/mode-branch.md` | Branch management |
| `conflict` | `references/mode-conflict.md` | Resolve merge conflicts |

## Step 0: Detect Project Conventions
- **Commit style**: Scan last 20 commit messages → detect pattern (conventional commits, gitmoji, etc.)
- **Branch strategy**: Check active branches → detect naming pattern (feature/, fix/, etc.)
- **PR process**: Check for PR template, CODEOWNERS, CI checks

## Principles
Atomic commits (one logical change each), meaningful history, branch hygiene, safe operations (no force-push without confirmation), convention over configuration.

---
id: TASK-1603
type: task
role: plan
title: "G4 replica priming resolves the corpus only for commands that open it"
status: archived
priority: medium
phase: "G"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-211
plan: PLAN-211
---
Main green, cluster C1. This was red before today, and it is the largest cluster: 45 tests plus 2 files that error out.

Cause: LORE_TEST_SANDBOX=1 refuses the repository's own corpus (corpus-resolution.ts:269-291, findSandboxRefusal, since 626e5c74 on 10-16). Since 10-19 (f12d056d, 20d2abdc), primeReplicaClientWhenSyncEnabled in run-cli.ts:209 resolves the corpus for EVERY command, including --help and `governance`. So any test that spawns lore with cwd at REPO_ROOT, or without a cwd, exits 4.

Affected tests:
- error-message-commands-executable (16)
- governance-compiled (8)
- context-provenance-compiled (8)
- governance-claude-md-compiled (6)
- rs-shipped-catalog (4)
- binary-provenance-check (2)
- cli-stdout-truncation (1)
- issue-adopt-compiled and npm-install-simulation, which error out as whole files

End-state fix: the replica priming resolves the corpus only for commands that open the corpus, and lazily, when the App is built. A corpus-free command (help, governance, setup --check, version) never resolves it. Do not weaken the sandbox. If some of these tests really need a corpus, they make their own with mkdtemp and `lore init`.

Oracle: all the listed files pass, unfiltered, from a worktree.

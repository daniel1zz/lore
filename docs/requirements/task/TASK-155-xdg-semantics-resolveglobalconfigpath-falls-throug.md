---
id: TASK-155
type: task
role: plan
title: "XDG semantics: resolveGlobalConfigPath falls through to ~/.config when XDG_CONFIG_HOME is set (test-env leak of real machine config)"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Found 2026-07-25 when the real ~/.config/lore/config.yaml (dashboard.projects, SPEC-078 usage) leaked into global-config.test.ts 'no global config present' tests (2 failed | 50 passed) DESPITE the tests setting XDG_CONFIG_HOME to an empty temp dir. Root cause: resolveGlobalConfigPath step 3 probes ~/.config/lore/config.yaml unconditionally, but per the XDG Base Directory spec ~/.config is the default ONLY when XDG_CONFIG_HOME is unset/empty — when set, it replaces the default, never stacks under it (pnpm/helm/gh all implement either-or). Audit resolveGlobalConfigWritePath for the same stacking.

AC:
- Given XDG_CONFIG_HOME set to a dir with no lore/config.yaml AND a real ~/.config/lore/config.yaml present, When loadGlobalConfig() runs, Then ok({}) — pinned by a new REGRESSION test simulating exactly the leak scenario (fake homedir seam or documented equivalent).
- Given XDG_CONFIG_HOME unset, Then ~/.config/lore/config.yaml still resolves (existing behavior preserved).
- Given the full global-config.test.ts file, Then green (52+ tests, incl. the 2 currently failing) + bun run typecheck exit 0.

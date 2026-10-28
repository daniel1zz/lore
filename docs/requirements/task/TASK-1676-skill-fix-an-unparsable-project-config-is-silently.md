---
id: TASK-1676
type: task
role: plan
title: "[Skill:fix] An unparsable project config is silently ignored; test fixtures append duplicate keys after init"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-27
tags: []
parent: PRD-001
---
Problem (found by DC2-5, 2026-10-19): a project `.lore/config.yaml` that does not parse (e.g. a duplicate `workflow:` key) is silently ignored and every command runs on built-in defaults (BR-926, marked suspected defect). DC2-5 makes plain `lore init` seed the settings template (user decision D5), which already holds a `workflow:` block; ~109 test files append a second block after `lore init`, so their config is silently dropped and the gates they meant to switch off come back on — tests pass or fail for the wrong reason, invisibly.
Approach: (1) the project config loader fails loud: an unparsable or schema-invalid `.lore/config.yaml` is refused with exit 4 naming the file and the parse error, on every route (CLI, HTTP), never a silent default; `lore setup --project` and `lore doctor`-style repair paths that must run on a broken file say so explicitly. Modify BR-926 accordingly. (2) A shared test helper (e.g. `patchLoreConfig(dir, patch)`) parses the existing file, deep-merges the patch and writes it back; migrate every fixture that appends to or overwrites `.lore/config.yaml` after init to it, so fixtures stay valid when init seeds a template.
AC: a corpus whose config.yaml has a duplicate top-level key: `lore list` exits 4 naming `.lore/config.yaml` and the duplicate key, writes nothing; `lore serve` refuses to start with the same message. No test file appends to `.lore/config.yaml` (a scan test asserts the helper is the only writer in tests). The full affected test set passes on top of the DC2-5 branch (`worktree-agent-ae8ac537fdff08afb`). Runner-produced red.

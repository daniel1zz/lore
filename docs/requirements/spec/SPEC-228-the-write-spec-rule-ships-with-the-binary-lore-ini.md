---
id: SPEC-228
type: spec
role: spec
title: "The write-spec rule ships with the binary; lore init writes no corpus document"
status: approved
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: [init, gate]
links:
  - {id: SPEC-214, type: relates-to}
---
## Overview/Goal

The write-spec rule that the spec-create gate feeds ships with the lore binary. `lore init` writes no corpus document.

Before this spec, DC2 D5 (`spec-defect-clusters-round-2-part-a-sessions-seats-setup-init`) had `lore init` seed an approved knowledge doc (sub_type skill, applies_to spec). Measured 2026-10-20 on the unlanded implementation (branch worktree-agent-a2e21971ddf014690): that doc has no parent, BR-400 reports it as an orphan, and a fresh corpus fails `lore status --check-tree` (exit 3) and its pre-push hook. Owner decision 2026-10-20: the rule ships with the binary instead.

## End state

1. `lore init` creates the corpus directory, ignore list, the settings file seeded from the shipped template, and an empty database. It writes no document, version or audit entry (BR-807). A fresh corpus passes `lore status --check-tree`.
2. Gate feeding for spec-create reads the project's newest approved knowledge doc with `extra.skill.applies_to: spec`. When there is none, it reads `assets/governance/write-spec-rule.md` from the binary's shipped assets.
3. The feeding pack's source line names which of the two was used: `corpus <slug>` or `shipped asset assets/governance/write-spec-rule.md`. The fallback is named, never silent.
4. A project's own approved doc always wins over the shipped one. If the shipped asset is missing from the install, the gate fails loud, naming the missing asset.
5. DC2 D5's seeding code, the seed slug and every test fixture that soft-deleted the seed are removed. The fixtures return to empty-corpus expectations.

## Scope

In:
- `packages/lore/src/flows/init-corpus.ts`;
- `packages/lore/src/store/init-seed.ts` (deleted);
- `packages/lore/src/service/gate-feeding.ts`;
- `packages/lore/src/adapters/cli/commands/gate.ts`;
- `assets/governance/write-spec-rule.md` and the assets manifest;
- the fixtures that reference the seed.

Out: the rest of DC2-5: atomic init, the gitignore entries and the config template.

## Acceptance Criteria

Structured criteria are recorded with `lore ac add` (AC-WSR-1..2). AC-WSR-1 supersedes AC-DC2-5 of the DC2 spec, carrying its items (a) to (c) unchanged and replacing (d).


## Acceptance Criteria (structured)

- [·] [script] AC-WSR-1: Plain lore init (never setup --project) in a temp git repo. (a) Under sh -c 'ulimit -f 0; lore init': exit 1 and .lore does not exist; a second plain lore init exits 0. (b) .lore/.gitignore lines equal {lore.db, lore.db-wal, lore.db-shm, .lore-project-check.json}; after lore setup --project --yes && lore setup --project --check, git status --porcelain lists no .lore/.lore-project-check.json. (c) .lore/config.yaml contains workflow.verification_profiles and lore status does not print 'Verification profiles: not configured'. (d) Right after init, lore list --json holds no document and the audit trail holds no document-scoped entry; after adding a root PRD and a tree blueprint, lore status --check-tree reports no orphan.
  script: test — bun run test:file packages/lore/tests/integration/dc2-init-scaffold.bun.test.ts && echo 'AC-WSR-1 PASS: atomic init, empty corpus, tree check clean'
- [·] [script] AC-WSR-2: In a fresh corpus a refused lore gate spec-create prints a feeding pack whose source line is 'shipped asset assets/governance/write-spec-rule.md' with a non-empty '## Rule' section and no 'bun scripts/'; after an approved knowledge doc with skill.applies_to spec is added, the source names its slug; with the shipped asset removed from the install and no project doc, the gate exits non-zero naming the missing asset.
  script: test — bun run test:file packages/lore/tests/integration/write-spec-rule-shipped-fallback.bun.test.ts && echo 'AC-WSR-2 PASS: shipped rule is the named fallback'

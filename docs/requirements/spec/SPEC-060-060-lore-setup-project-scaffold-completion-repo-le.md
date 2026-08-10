---
id: SPEC-60
type: spec
role: spec
title: "lore setup --project scaffold completion + repo-level install ledger"
status: approved
priority: medium
created: 2026-07-21
updated: 2026-07-27
tags: []
parent: PRD-001
---
# SPEC-060 — `lore setup --project` scaffold completion + repo-level install ledger

## Overview

`lore setup --project` today performs four steps (corpus init, gate hooks, tree
blueprint + config-template overlay, `core.hooksPath`) and keeps **no record of
what it wrote**. Two consequences, both confirmed by direct code reading during
the 2026-07-21 gap audit:

1. **No rollback.** The machine-target installer (`SetupService`) tracks every
   touched path in `<claude-dir>/.lore-setup-manifest.json` and can restore
   byte-identically on `--uninstall`. The repo-target path
   (`ProjectSetupService` + `flows/setup-project-flow.ts`) has no manifest, no
   backups, and no uninstall verb at all — a scaffolded repo cannot be
   un-scaffolded, and a conflicting file is reported but never recoverable.
2. **Scaffold gaps.** A freshly scaffolded repo still lacks a repo-root
   `.gitignore` (only `.lore/.gitignore` is written, covering the three
   `lore.db*` files) and a root `CLAUDE.md`, and the command's receipt names no
   next step, so the operator is left to discover `lore-init-context` /
   `lore-kickoff` on their own.

This spec closes both. It deliberately does NOT add any LLM-dependent
generation: everything scaffolded here is deterministic template material.
Semantic content (module architecture in `CLAUDE.md`, the initial PRD, README
prose) remains the job of the `lore-init-context` / `lore-kickoff` skills, which
the new receipt points at.

### Corrections to the audit (recorded so they are not re-litigated)

- `.lore/export-index.json` is **not** a gap — `ExportDocsService` creates it
  when absent (`export-docs-service.ts:250,450`) and self-heals corruption.
- `assets/project/lore-config-template.yaml` is **not** unconsumed — it is read
  by `commands/setup.ts` and merged via `initCorpusAt`'s `configTemplateYaml`
  overlay (`init-corpus.ts:124`). SPEC-058 D6 is implemented as documented.

## Scope

### In

- **D1 — repo-level install ledger.** A new `.lore/.lore-project-manifest.json`
  tracking every path `--project` writes, plus backups under
  `.lore/.lore-backups/<iso>/`, reusing the pure `@lore/core/setup-manifest.ts`
  primitives (`planInstall`, `setupManifestSchema`) unchanged — they are
  `targetDir`-agnostic pure functions over `(current, payload, existingFiles)`.
- **D2 — `lore setup --project --uninstall`.** Reverses strictly via the repo
  manifest: restore-from-backup where one exists, remove outright where none
  does, manifest deleted last (mirrors `SetupService.uninstall` ordering).
- **D3 — repo-root `.gitignore`.** New `assets/project/gitignore.template`,
  language-agnostic core only (`.DS_Store`, `node_modules/`, `dist/`,
  `coverage/`, `.agent-worktree-marker`, `.lore/lore.db*`). Written when absent;
  when present, the shipped block is **appended** under a delimited
  `# --- lore ---` marker if that marker is not already there, never rewritten.
- **D4 — root `CLAUDE.md` stub.** New `assets/project/CLAUDE.md.template`:
  a minimal Lore-workflow pointer plus an empty module-index section for
  `lore-init-context` to fill. Tracked in the D1 manifest with
  **backup-then-overwrite** semantics (owner directive 2026-07-21, chosen over
  the conflict semantics the hooks step uses).
  - *Recorded trade-off, per owner decision:* a re-run of `lore setup --project`
    against a repo whose `CLAUDE.md` has since been filled in by
    `lore-init-context` will overwrite it, recoverable only from
    `.lore/.lore-backups/<iso>/CLAUDE.md`. D6's receipt line is the required
    mitigation — the overwrite must never be silent.
- **D5 — receipt next-steps block.** After a successful `--project` run, print
  the ordered follow-ups (`/lore-init-context`, `/lore-kickoff`, first
  `lore create prd`), and under `--json` emit them as `next_steps: string[]`.
- **D6 — loud overwrite reporting.** Any step that backed up an existing file
  prints the backup path on its own line; `--json` carries `backups: string[]`.

### Out

- Anything requiring semantic understanding: `CLAUDE.md` module content,
  `README.md`, the initial PRD/spec skeleton (→ `lore-init-context`,
  `lore-kickoff`).
- Language/runtime-specific scaffold (`package.json`, `tsconfig.json`,
  `go.mod`, …) — not generically derivable.
- Project-level `.claude/settings.json` — the machine-level `settings.json`
  hook registration (SPEC-046 amendment) already arms every governance hook;
  a second project-level copy would be a competing registration site.
- `.lore/config.yaml` write surface and any dashboard configuration UI — a
  separate spec (config layer has no runtime write path today; `saveConfig`
  has exactly three callers, all CLI bootstrap).
- Turso sync credential provisioning.

## Design

`setup-project-flow.ts` gains a manifest-aware write seam. Each of the four
existing steps plus the two new file steps (D3/D4) routes its writes through one
`plannedWrite` collector; the flow then runs the same
plan → backup → write → manifest-last sequence `SetupService.install` uses. The
hooks step keeps its conflict semantics (repo hooks may be user-customised);
`CLAUDE.md` and `.gitignore` use the semantics stated in D3/D4.

`ProjectFsPort` gains `backup(src, destDir)` and `remove(path)` to support D1/D2,
mirroring `SetupFsWriter`'s surface.

## Acceptance Criteria

- **AC-060-1** — After `lore setup --project` in a throwaway git repo,
  `.lore/.lore-project-manifest.json` parses against `setupManifestSchema` and
  its `entries[].path` set equals exactly the set of files the run wrote.
- **AC-060-2** — A second identical `lore setup --project` run issues 0 writer
  calls and leaves every tracked file byte-identical (idempotency).
- **AC-060-3** — `lore setup --project --uninstall` restores every
  backed-up file byte-identically and removes every file that had no backup;
  the manifest file itself is absent afterwards.
- **AC-060-4** — In a repo with no `.gitignore`, the run creates one containing
  all 6 declared entries; in a repo with an existing `.gitignore`, the original
  bytes remain a prefix of the result and exactly one `# --- lore ---` block is
  appended; a third run appends 0 additional blocks.
- **AC-060-5** — In a repo whose `CLAUDE.md` differs from the template, the run
  writes `.lore/.lore-backups/<iso>/CLAUDE.md` byte-identical to the pre-run
  file, and stdout contains that backup path.
- **AC-060-6** — `lore setup --project --json` emits `next_steps` with ≥3
  entries and `backups` as an array; the text mode prints the same next-steps
  in the same order.
- **AC-060-7** — REGRESSION: the machine-target install/uninstall path
  (`SetupService`) writes a byte-identical `<claude-dir>` tree and manifest
  before and after this change (existing setup suites stay green).


## Acceptance Criteria (structured)

- [✔] [script] AC-060-1: After lore setup --project in a throwaway git repo, .lore/.lore-project-manifest.json parses against setupManifestSchema and its entries[].path set equals exactly the set of files the run wrote (0 extra, 0 missing)
  script: test — bunx vitest run packages/lore/tests/unit/flows/setup-project-manifest.test.ts -t 'manifest entries equal written file set'
- [✔] [script] AC-060-2: A second identical lore setup --project run issues exactly 0 writer calls and leaves every tracked file byte-identical
  script: test — bunx vitest run packages/lore/tests/unit/flows/setup-project-manifest.test.ts -t 'second run issues 0 writer calls'
- [✔] [script] AC-060-3: lore setup --project --uninstall restores 100% of backed-up files byte-identically, removes every file that had no backup, and leaves 0 manifest files on disk
  script: test — bunx vitest run packages/lore/tests/unit/flows/setup-project-uninstall.test.ts
- [✔] [script] AC-060-4: In a repo with no .gitignore the run creates one containing all 6 declared entries; with an existing .gitignore the original bytes remain a byte-exact prefix and exactly 1 '# --- lore ---' block is appended; a third run appends 0 additional blocks
  script: test — bunx vitest run packages/lore/tests/unit/flows/setup-project-gitignore.test.ts
- [✔] [script] AC-060-5: In a repo whose CLAUDE.md differs from the template, the run writes .lore/.lore-backups/<iso>/CLAUDE.md byte-identical to the pre-run file and stdout contains that exact backup path
  script: test — bunx vitest run packages/lore/tests/unit/flows/setup-project-claudemd.test.ts
- [✔] [script] AC-060-6: lore setup --project --json emits next_steps with >=3 entries and backups as an array; text mode prints the same next-steps in the same order
  script: test — bunx vitest run packages/lore/tests/unit/adapters/setup-render-next-steps.test.ts
- [✔] [script] AC-060-7: REGRESSION: the machine-target SetupService install/uninstall path produces a byte-identical <claude-dir> tree and manifest before and after this change, with 0 failing tests in the 3 existing setup suites
  script: test — bun run test:vitest packages/lore/tests/unit/setup-service.test.ts packages/lore/tests/unit/assets-ssot.test.ts packages/lore/tests/unit/real-setup-ports.test.ts
- [✔] [script] AC-060-8: REGRESSION (corrects AC-060-7 whose paths were wrong and silently matched only 1 of 3 suites): the 3 machine-target setup suites at their real paths (service/setup-service, assets-ssot, adapters/real-setup-ports) execute and report 0 failures across exactly 3 test files
  script: test — bunx vitest run packages/lore/tests/unit/service/setup-service.test.ts packages/lore/tests/unit/assets-ssot.test.ts packages/lore/tests/unit/adapters/real-setup-ports.test.ts

## Code anchors

- packages/lore/src/flows/setup-project-flow.ts
- packages/lore/src/flows/setup-project-uninstall.ts
- packages/lore/src/adapters/cli/setup-render.ts
- assets/project/gitignore.template
- assets/project/CLAUDE.md.template

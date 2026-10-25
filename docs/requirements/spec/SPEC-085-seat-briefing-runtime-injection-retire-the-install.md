---
id: SPEC-085
type: spec
role: spec
title: "Seat-briefing runtime injection: retire the installed seat-briefing.md"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-10-17
tags: []
links:
  - {id: SPEC-241, type: implements}
  - {id: SPEC-083, type: supersedes}
---
# SPEC-085 — Seat-briefing runtime injection: retire the installed seat-briefing.md (SPEC-083 follow-up)

## Overview/Goal

SPEC-083 migrated the corpus-workflow governance prose from an installed-file snapshot to runtime emission by the binary (`lore governance`), deliberately leaving `governance/seat-briefing.md` out of scope. This spec completes the migration for the seat briefing — the `<session-seat>` discipline block the session-start hook's Phase D injects when a session opens inside a linked git worktree of a lore-governed repo.

The same drift class applies, with live evidence: the briefing's SSOT still instructs `lore create knowledge --sub-type handoff` on seat exit — a path the writer-identity guard now REJECTS (the corpus-workflow copy was corrected in commit 01e147c; the seat-briefing copy was missed). Installed snapshots additionally lag behind even that stale SSOT. Runtime emission version-locks the briefing to the binary and removes the whole class.

One structural difference from SPEC-083: the briefing is a TEMPLATE — `{{ACTOR}}`/`{{BRANCH}}`/`{{MAIN_CHECKOUT}}` are substituted by the hook with values only the hook derives (branch name, resolved main checkout). The verb therefore emits the RAW template; substitution stays in the hook, unchanged.

## Design Decisions

- **D1 — `--seat-briefing` flag on `lore governance`.** The SPEC-083 verb gains one boolean flag: bare `lore governance` prints the corpus-workflow snippet exactly as today (byte-regression pinned); `lore governance --seat-briefing` prints `governance/seat-briefing.md` verbatim (raw template, placeholders intact). Same assets-root derivation, same exit-4-on-unreadable contract, still bootstrap-stage (no App/DB). Declared in the command's `args` so the SPEC-051 strict seam covers it with zero extra edits.
- **D2 — hook Phase D spawns the verb.** `assets/hooks/session-start-resume.mjs` Phase D replaces its two-candidate file lookup (`<claude-dir>/governance/seat-briefing.md`, then `<main-checkout>/assets/governance/seat-briefing.md`) with a `spawnSync` of the SAME resolved lore binary Phase C/E already spawn, running `governance --seat-briefing`. Placeholder substitution, the `<session-seat>` fence, and the fail-open contract are byte-preserved; the "no briefing found" stderr notice becomes a "briefing unavailable from binary" notice of the same shape (still stderr, still non-blocking).
- **D3 — install-set retirement via the existing SSOT.** Add `governance/seat-briefing.md` to `RETIRED_FROM_INSTALL_PATHS` (`real-asset-source.ts`) — the install walk AND `setup-check.ts::buildCheckEmbeddedManifest` both honor it automatically (the SPEC-083 fix's single-declaration design proves out here). The `governance/` install directory thereby becomes empty: the installer writes no governance files, `listManagedPaths` skips the absent dir, previously installed copies degrade to the generic `orphaned` class.
- **D4 — SSOT content fix rides along.** `assets/governance/seat-briefing.md` "On exit" section drops the writer-guard-rejected `lore create knowledge --sub-type handoff` instruction in favor of `lore handoff --by {{ACTOR}}` as the sole path (matching the corpus-workflow correction in 01e147c).

## Scope

In: `packages/lore/src/adapters/cli/commands/governance.ts` (flag), `assets/hooks/session-start-resume.mjs` Phase D, `packages/lore/src/adapters/real-asset-source.ts` (one Set entry), `assets/governance/seat-briefing.md` (D4 content fix), `packages/lore/src/generated/assets-manifest.ts` regeneration, and the four pinning suites that assert seat-briefing installed-ness or Phase D file-reads (`setup-governance-retirement`, `session-seat-injection`, `real-setup-ports`, `npm-install-simulation`) plus the compiled governance e2e.

Out: Phase C/E (untouched), seat model semantics (SPEC-047/057 — identity derivation, worktree detection, bootstrap redirection all unchanged), project assets, MCP/HTTP surfaces.

## Acceptance Criteria

Structured ACs via `lore ac add`. Sketch: (1) compiled e2e — `dist/lore governance --seat-briefing` byte-equals the SSOT template with placeholders intact, bare `dist/lore governance` output byte-unchanged vs SPEC-083; (2) retirement + hook pins — install set and check-embedded view both yield zero `governance/` entries, hook source contains zero seat-briefing file-path reads and passes `--seat-briefing` as a spawn argument, SSOT contains zero `create knowledge --sub-type handoff` occurrences; (3) session-seat-injection unit suite green with Phase D spawn-based injection (placeholder substitution + fail-open pinned); (4) `bun run typecheck` exit 0.


## Acceptance Criteria (structured)

- [⚑] [script] AC-085-1: Compiled-binary e2e: dist/lore governance --seat-briefing exits 0 with stdout byte-identical to assets/governance/seat-briefing.md (placeholders intact); bare dist/lore governance stdout stays byte-identical to assets/governance/corpus-workflow.md
  script: e2e — bunx --bun vitest run packages/lore/tests/integration/governance-compiled.bun.test.ts
  other_command=2
- [⚑] [script] AC-085-2: Retirement pins: install set and check-embedded manifest view both yield zero governance/ entries; hook source contains zero seat-briefing.md path-read occurrences and passes --seat-briefing as a spawn argument; SSOT briefing contains zero 'create knowledge --sub-type handoff' occurrences
  script: test — bunx vitest run packages/lore/tests/unit/setup-governance-retirement.test.ts
- [⚑] [script] AC-085-3: session-seat-injection unit suite exits 0 with Phase D spawn-based injection: placeholder substitution for ACTOR/BRANCH/MAIN_CHECKOUT and fail-open on spawn failure both pinned
  script: test — bunx vitest run packages/lore/tests/unit/hooks/session-seat-injection.test.ts
- [⚑] [script] AC-085-4: bun run typecheck exits 0 across all packages
  script: tsc — bun run typecheck

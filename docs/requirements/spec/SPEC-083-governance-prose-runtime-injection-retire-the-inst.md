---
id: SPEC-083
type: spec
role: spec
title: "Governance prose runtime injection: retire the installed corpus-workflow.md"
status: deprecated
priority: medium
created: 2026-07-26
updated: 2026-10-10
tags: []
links:
  - {id: SPEC-096, type: implements}
---
# SPEC-083 — Governance prose runtime injection: retire the installed corpus-workflow.md

## Overview/Goal

The corpus-workflow governance prose (FEED/PRODUCE/EXECUTE/CLOSE discipline) documents the lore binary's own behavior — gate semantics, handoff verbs, evidence rules — so it must be distributed version-locked with the binary. Today it is installed as a static file (`<claude-dir>/governance/corpus-workflow.md`) that the session-start hook's Phase C reads from disk. That file is a setup-time snapshot: upgrade the binary without re-running `lore setup` and the injected prose silently describes an older binary. SPEC-076's Phase F check-advisory exists largely to patch exactly this drift class, and there is no per-asset opt-out for operators who deliberately retire the file (live incident 2026-07-26: the dev machine's hook AND prose were stale, so sessions received the full untrimmed bootstrap report instead of the SPEC-080 injection projection; the operator's hand-retired governance file shows the missing opt-out).

Root fix: the binary emits the prose at runtime. A new read-only, bootstrap-stage CLI verb `lore governance` prints the corpus-workflow snippet resolved from the binary's own assets root (the same `resolveAssetsRoot` derivation `lore setup` already uses — assets sit next to the binary's real package/repo location, so prose and binary are always the same git version). The session-start hook's Phase C spawns that verb instead of reading an installed file, and `lore setup` stops installing `governance/corpus-workflow.md` entirely. The whole drift class — plus the install step and the check surface covering it — disappears.

Design record: `knowledge-converge-governance-prose-distribution-retire-the` (ideation, 2026-07-26).

## Design Decisions

- **D1 — `lore governance` verb.** New flat citty subcommand (lazy import in `index.ts`, auto-wrapped by the SPEC-051 strict seam). Bootstrap-stage: bypasses `loadLoreApp` (needs no corpus/DB — document the exemption per the adapters/cli module invariant). Resolves the assets root via the SAME `resolveBinPath`/`resolveAssetsRoot` path `lore setup` uses, reads `governance/corpus-workflow.md`, prints it verbatim to stdout, exit 0. Unreadable asset → the normal `formatError` pipeline, exit 4 (`VALIDATION_ERROR` from the asset source), never a silent empty print. No positional args, no `subCommands` (the `commands/feed.ts`/`audit anchor` citty-routing precedent does not arise). No `--json` (the payload IS text).
- **D2 — hook Phase C spawns the binary.** `assets/hooks/session-start-resume.mjs` Phase C replaces its `<claude-dir>/governance/corpus-workflow.md` file-read with a `spawnSync` of the resolved lore binary (`lore governance`), keeping the injected fence/tag format byte-identical to today's. Fail-open contract unchanged: binary missing, non-zero exit, or empty stdout → skip the phase silently, never block session start. No cache layer (Phase E already pays a binary spawn per session start; a second fast spawn is within budget — measure, do not assume, in the compiled e2e).
- **D3 — install-set retirement.** `governance/corpus-workflow.md` is removed from the machine install set: `RealAssetSource.load()` no longer yields it, so `lore setup` neither writes it nor tracks it in the manifest, and `lore setup --check`/`planUpdate` stop classifying it (previously installed copies degrade to the generic `orphaned` class — acceptable, report-only). The FILE stays in `assets/governance/` as the SSOT that D1 reads and the embedded assets manifest still fingerprints it (it ships with the package; it is simply never installed to `<claude-dir>`). `governance/seat-briefing.md` is explicitly OUT of scope — Phase D still reads it as an installed file; migrating it is a follow-up decision, not this spec.
- **D4 — no behavior change for non-lore-governed sessions.** Phase C already runs only for lore-governed sessions; D2 preserves that condition exactly.

## Scope

In: `packages/lore/src/adapters/cli/` (new `commands/governance.ts` + `index.ts` registration), the asset-source load set (wherever `governance/corpus-workflow.md` enters the machine install list), `assets/hooks/session-start-resume.mjs` Phase C, `packages/lore/src/generated/assets-manifest.ts` regeneration, new tests.

Out: `governance/seat-briefing.md` (stays installed), project-scaffold assets (`lore setup --project` — untouched), npm publish layout, MCP/HTTP surfaces (no new tool/route — the verb is hook-facing), Phase F check-cache mechanics (its coverage of this file simply vanishes with the manifest entry).

## Acceptance Criteria

Structured ACs via `lore ac add` (script-mode; see `lore ac list spec-083-...`). Sketch: (1) compiled-binary e2e — `dist/lore governance` stdout byte-equals `assets/governance/corpus-workflow.md`, exit 0; (2) unit — machine install plan contains zero `governance/corpus-workflow.md` entries while `governance/seat-briefing.md` remains, and the hook source contains zero `corpus-workflow` references while spawning the `governance` verb; (3) `bun run typecheck` exit 0; (4) `assets-ssot` suite stays green (manifest freshness + hook spawn invariants).


## Acceptance Criteria (structured)

- [⚑] [script] AC-083-1: Compiled-binary e2e: spawning dist/lore governance exits 0 and its stdout is byte-identical to assets/governance/corpus-workflow.md
  script: e2e — cd packages/lore && bun test tests/integration/governance-compiled.bun.test.ts
- [⚑] [script] AC-083-2: Unit suite pins: machine install set yields zero governance/corpus-workflow.md entries while governance/seat-briefing.md remains; hook source contains zero corpus-workflow references and spawns the governance verb
  script: test — bunx vitest run packages/lore/tests/unit/setup-governance-retirement.test.ts
- [⚑] [script] AC-083-3: bun run typecheck exits 0 across all packages
  script: tsc — bun run typecheck
- [⚑] [script] AC-083-4: assets-ssot suite exits 0 (embedded manifest freshness and hook spawn invariants hold after the hook edit and manifest regeneration)
  script: test — bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts

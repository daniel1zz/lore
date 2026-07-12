---
id: KN-055
type: knowledge
role: knowledge
title: "Retro — SPEC-045 drift oracle H3 (memory-hygiene trilogy complete; shell-quoted content trap; FsProbe stat-collapse deviation)"
status: draft
priority: medium
created: 2026-07-12
updated: 2026-07-12
tags: [retro, spec-045, drift, memory-hygiene]
parent: PLAN-029
---
## Context

Session 2026-07-12 (same session as the SPEC-043 close + SPEC-044 cycle): full SPEC-045
cycle — draft from PRD §16 H3 → 3-lens adversarial review (30 findings, 13 HIGH) → v2 +
9 structured ACs → judge approve 0.82 → plan + 2 serial worktree tasks → 8/8 script ACs
runner-attested + AC-DR-9 proxy live run → v6 assessment met 89/100. This completes the
§16 memory-hygiene trilogy (H1 invalidation / H2 staleness probes / H3 drift oracle) —
G11's three legs are all live.

## What shipped

- `packages/core/src/code-anchors.ts`: parseCodeAnchor (per-entry, path#Symbol grammar),
  scanExportedSymbols (line-anchored lexical, documented FP forms), computeDrift (six
  kinds incl. node_type_mismatch + probe_error; consistent only on affirmative
  verification — the G11 zero-false-negative property).
- DriftCheckService: FsProbe port (per-call error wrapping, no batch abort),
  addCodeAnchors/removeCodeAnchors (CAS RMW) + setCodeAnchors (MCP REPLACE),
  CorpusService D6a grammar seams, task-seam `#` rejection.
- status.ts restructured to value-returning composable checks: `--check-drift` with
  drift-3-wins-over-4 exit precedence, literal repair hints, FP footnote, store-only
  armed count on plain status; `lore create spec --code-anchor`; `lore anchor`
  doc-type dispatch; flows/drift-flow.ts single derivation site; MCP lore_status FIRST
  input schema (argless regression preserved) + lore_anchor_set spec REPLACE +
  bootstrap code_anchor_specs; feeding-source advisory line (D11).

## Learnings (durable)

1. **Long shell-quoted `--content` is a trap — use `--content-file` (NEW incident,
   twice this session)**: two `lore create` invocations with multi-KB `--content`
   strings containing mixed quotes/escapes/flag-like tokens failed as BIZARRE
   spec-create gate rejections (PARENT_REQUIRED / INVALID_PARENT_TYPE +
   MISSING_SKELETON) — i.e. the argv the CLI saw was not the argv intended. Minimal
   A/B probes (flag tokens, `#`, multiline, retro sub-type) all passed, so the break
   is in shell-level quoting of large mixed-escape strings, not a simple citty bug.
   Rule: any content beyond a couple of lines goes through `--content-file`; never
   embed flag-like tokens in `--title`. Open item: build a minimal repro to determine
   whether lore should defensively reject suspicious re-tokenized argv.
2. **Two-write-shape resolution pattern**: when CLI (incremental add/rm) and MCP
   (declarative REPLACE) both exist for one field, implement BOTH service methods and
   document the divergence in the MCP tool description (D6/D7, resolving review
   U3/S4) — forcing one shape onto the other is a data-loss footgun.
3. **Exit-code precedence beats max()**: composed check commands must rank "real
   finding" (exit 3) above "misconfiguration" (exit 4) — max() masks drift behind a
   missing blueprint (review U1). Corollary: composing checks required refactoring
   early-`process.exit` branches into value-returning functions — early-exit control
   flow is a composition blocker worth flagging in any spec that adds a sibling check.
4. **Review→dispatch pipeline keeps paying**: 30 findings pre-implementation; the
   fixture-prerequisite finding (T1: spec-create gate needs a PRD parent in throwaway
   corpora) saved the implementer a debugging round-trip; the probe-error finding (T2)
   closed a genuine false-negative hole in the G11 contract.
5. **Accepted deviation — real FsProbe stat-collapse**: the REAL node:fs probe maps
   every stat failure to `missing` rather than `probe_error` (deliberate: seeded
   deletions must classify as file_missing; direction is G11-safe). probe_error stays
   reachable via readFile/listDir throws and injected probes. If EACCES noise shows up
   in practice, revisit with an errno whitelist.

## Open items

- PRD §16 fully implemented (H1+H2+H3): bi-temporal invalidation ✓, staleness probes ✓,
  check-drift 0-false-negatives on seeded fixture ✓ (AC-DR-4 attested). PRD living
  projection refresh + G11 status update belong to the export/commit step.
- Assessment gaps (89/100): human-AC transcript truncation (same note as SPEC-044) —
  consider raising the manual-oracle output_tail cap once.
- Flaky p2-e2e-closed-loop / gate-hooks timeouts under parallel load — third sighting;
  raise per-step timeout or isolate (carried from SPEC-044 retro, still open).
- Shell-quoting incident minimal repro (learning 1).

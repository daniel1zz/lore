---
id: SPEC-095
type: spec
role: spec
title: "Project CLAUDE.md content contract — governance-injected prose target + deterministic line/byte ceiling lint across template, init-context, and pre-push"
status: approved
priority: medium
created: 2026-07-27
updated: 2026-10-10
tags: [claude-md, memory-files, distribution, governance]
links:
  - {id: TASK-632, type: supersedes}
  - {id: ADR-004, type: implements}
  - {id: KN-409, type: relates-to}
  - {id: SPEC-096, type: relates-to}
---
## Overview/Goal

Productize the project-CLAUDE.md design norm as a Lore-distributed convention: one contract SSOT consumed by three distribution surfaces (template, lore-init-context generator, deterministic pre-push oracle). Today the norm exists only as this repo's private ADR + prose — proven twice insufficient (164.6KB pre-2026-07-22; 52.8KB re-bloat 4 days later; see knowledge-retro-claude-md-spec-index-re-bloat-boundary-adr). Consumer projects get the same convention via `lore setup`.

AS-BUILT DRIFT (2026-08-24, synced from spec-claude-md-governance-content-dimension-checks-wire-the / SPEC-146): what shipped is no longer only the two levels below. A third deterministic band (`eviction_required` at `evict_threshold_fraction`, recurrence rule for task-a-module-claude-md-at-its-byte-ceiling-silently-relocates) sits between advisory and ceiling; the single lint module was split three ways; and content-dimension metrics were added beside the capacity ones. The statements below are corrected in place — read SPEC-146 for the split's own boundary.

Two normative levels, deliberately different in strength:
- **Target (advisory, official)**: prose contract cites Anthropic's under-200-lines-per-file guidance ([S] code.claude.com/docs/en/memory.md), content boundary (timeless discipline in; events/status/narratives → corpus), section taxonomy. AI-consumed at authoring time via `lore governance claude-md`.
- **Ceiling (deterministic, enforced)**: line + byte hard ceilings (looser than target), pure lint at `lore status --check-claude-md`, wired into the pre-push pair. Catches runaway re-bloat; never judges content semantics.

## Scope

In: prose contract asset `assets/governance/claude-md-contract.md` (no numbers — anti-dual-write); governance verb topic form `lore governance [topic]` (registry: `corpus-workflow` default | `seat-briefing` | `claude-md`; existing flags → deprecated aliases; multi-topic → exit 2); `context.memory_files.*` config section (`contextConfigSchema` in @lore/core config.ts — the ONLY home of numbers: `filenames: ["CLAUDE.md"]`, root 300L/30720B, module 200L/16384B, `enabled: true`; a third `rules` role 100L/8192B plus `warn_threshold_fraction`/`evict_threshold_fraction` landed later under SPEC-146, same anti-dual-write home); pure `lintMemoryFiles`, shipped in `packages/lore/src/service/claude-md-check.ts` and MOVED by SPEC-146's three-way split to `packages/lore/src/service/claude-md-budget.ts` — `claude-md-check.ts` no longer exists (prd-budget-check precedent; input `{path, role, content}` — lint measures lines AND Buffer.byteLength itself, single measurement point); discovery probe `real-memory-file-probe.ts` (root + module files; excludes `.git`, `node_modules`, linked worktrees — SPEC-146 added the `rules` role and narrowed the blanket `.claude` exclusion so `.claude/rules/**` is counted while `.claude/worktrees/` stays excluded); `lore status --check-claude-md` (exit 3, config-only, NO loadLoreApp — works pre-corpus); pre-push pair step (fail on violation; fail-open when lore/config absent; `enabled: false` opt-out; `--no-verify`); template pointer line (managed section); lore-init-context SKILL.md rewrite (own taxonomy prose DELETED, verb consumed at Step 0, `--check-claude-md` as final oracle; no offline fallback copy).

Out: marker-integrity check (deferred — marker constants must first relocate from setup-project-flow.ts to core); section-structure lint (semantics = AI-advisory only); per-path budget overrides; dashboard rendering of findings; AGENTS.md as default filename (config value only).

Closes adhoc task task-mechanize-claude-md-byte-budget-check-in-pre-push-twice.

## Module Boundary

- Public API: `contextConfigSchema` + `resolveMemoryFileBudgets` (@lore/core config.ts); `lintMemoryFiles(files, budgets) → MemoryFileFinding[]` (`{path, role, kind, measured, ceiling, message}` — flat, serializable; rendering in CLI only); CLI `lore status --check-claude-md`, `lore governance claude-md`.
- AS-BUILT (SPEC-146): the sole composition entry consumed by production is now `runMemoryFileChecks` (`claude-md-admission.ts`), not the individual metric functions; `MemoryFileFindingKind` widened past `max_lines|max_bytes` to `eviction_required|slug_pointer_missing|emphasis_saturated`, and a separate `AdvisoryFindingKind` (`iso_date_density|status_word|headroom_warning|reference_missing|line_length|target_distance`) carries the never-exit-affecting half. `lore status --check-memory-pointers` is the corpus-LOADING sibling surface; D9's corpus-free guarantee still binds `--check-claude-md` alone.
- Internal: discovery walk, config plumbing, finding rendering.
- Dependencies: config loader (@lore/core/node), SPEC-083 resolveAssetsRoot. No store/DB dependency anywhere in the check path.

## Design Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|---|---|---|---|
| D1 | Numbers home | zod defaults ONLY; config.yaml overrides; prose cites the command | prose budget table / corpus-governed / hook-local | dual-write disease; CLAUDE.md is a repo file → team-config scope |
| D2 | Metric | max_lines primary + max_bytes backstop, per role | bytes-only | official guidance is line-based; each metric misses a bloat class the other catches |
| D3 | Defaults | root 300L/30KB, module 200L/16KB (ceiling ≠ 200L target) | official 200L as hard default | gate failing most repos on install kills adoption (domain metric ≥90% install-to-first-write) |
| D4 | Deterministic scope | lines+bytes only; marker check cut from v1 | marker check in v1 | constant ownership (core leaf invariant); own follow-up |
| D5 | Template role | pointer line only | embed contract | dual-write |
| D6 | Verb shape | positional topic + registry; conflict exit 2 | third boolean flag | `--seat-briefing --claude-md` silently picks one today |
| D7 | Lint layer | packages/lore service (prd-budget-check precedent) | @lore/core | browser barrel doesn't need it |
| D8 | Config seam | new top-level `context.*` | `workflow.*` | workflow is corpus-shape; per-surface top-level is the precedent; `filenames` makes AGENTS.md config-not-rework |
| D9 | Oracle home | `lore status` flag, pre-app short-circuit | new verb | shared exit precedence + one pre-push step shape |

## Risks

- New `.strict()` config key: older binary rejects newer config.yaml (inherent to all past key additions; document version floor).
- Monorepo single-oversized-module raises the module tier globally (no per-path overrides until real demand).
- MCP lore_status resolves budgets from corpus-cwd config like CLI; no extra threading.

## Acceptance Criteria

Typed ACs authored via `lore ac add` (script-mode). Coverage contract: pure-lint boundary fixtures at ceiling±1 for both metrics + UTF-8 multibyte; governance-verb compiled-binary stdout ≡ asset bytes + setup --project installs pointer; hook-trip e2e (oversized → non-zero, enabled:false → 0, no .lore → 0); pre-push parity pin extended; SKILL.md contract-consumption pin (contains both literal commands, own taxonomy heading gone).


## Acceptance Criteria (structured)

- [⚑] [script] AC-CMC-1: Pure lint boundary correctness: claude-md-check unit suite passes with fixtures at ceiling-1/ceiling+1 for BOTH max_lines and max_bytes per role, plus a UTF-8 multibyte fixture where byte count != string length
  script: test — bunx vitest run packages/lore/tests/unit/service/claude-md-check.test.ts
- [⚑] [script] AC-CMC-2: Compiled binary serves the contract verbatim: dist/lore governance claude-md stdout is byte-identical to assets/governance/claude-md-contract.md, and multi-topic invocation exits 2
  script: e2e — cd packages/lore && bun test tests/e2e/governance-claude-md-compiled.bun.test.ts
- [⚑] [script] AC-CMC-3: Hook trips end-to-end: in a temp repo, assets/project/pre-push exits non-zero on an over-ceiling CLAUDE.md, exits 0 when context.memory_files.enabled is false, and exits 0 when .lore is absent (fail-open)
  script: e2e — cd packages/lore && bun test tests/integration/pre-push-claude-md-trip.bun.test.ts
- [⚑] [script] AC-CMC-4: Distribution parity holds: hooks/pre-push and assets/project/pre-push remain byte-identical and both contain the check-claude-md invocation; assets manifest is regenerated (embed-assets-manifest --check exits 0)
  script: test — bunx vitest run packages/lore/tests/unit/assets/pre-push-parity.test.ts && node scripts/embed-assets-manifest.mjs --check
- [⚑] [script] AC-CMC-5: Skill consumes the SSOT: lore-init-context SKILL.md contains both literal commands (lore governance claude-md; lore status --check-claude-md) and no longer contains its own What-Goes-In taxonomy section; template contains the pointer line
  script: test — bunx vitest run packages/lore/tests/unit/assets/init-context-contract.test.ts

## Code anchors

- packages/lore/src/adapters/real-memory-file-probe.ts
- packages/lore/src/adapters/cli/commands/status.ts
- packages/lore/src/adapters/cli/commands/governance.ts
- packages/core/src/config.ts#contextConfigSchema
- assets/governance/claude-md-contract.md
- hooks/pre-push
- packages/lore/src/service/claude-md-budget.ts#lintMemoryFiles

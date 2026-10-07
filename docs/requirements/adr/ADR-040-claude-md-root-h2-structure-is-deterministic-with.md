---
id: ADR-040
type: adr
role: decision
title: "CLAUDE.md root H2 structure is deterministic, with one adoption switch for all memory-file checks"
status: approved
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: [claude-md, memory-files, governance, adoption]
parent: PRD-001
links:
  - {id: PLAN-149, type: informs}
---
## Context

SPEC-095 (`spec-project-claude-md-content-contract-governance-injected`) put "section-structure lint (semantics = AI-advisory only)" explicitly OUT of scope. The contract asset nonetheless prescribes a five-section root taxonomy ("exactly these headings, in this order"). Measured 2026-10-07: no code parses headings; this repo's own root CLAUDE.md carried an extra `## North Star` H2 plus three Architecture subsections the contract assigns to the corpus, and nothing reported it. The shipped template `assets/project/CLAUDE.md.template` has only `## Lore-governed workflow` + `## Module Index` — a fresh consumer install does not satisfy the contract it is told to read.

Separately, no adoption path exists: `lore setup` on an existing project neither detects nor reports a non-conforming CLAUDE.md, and the only relief valve is the global `memory_files.enabled: false`. A 355-line existing root file is blocked by the capacity ceiling on its first push.

## Decision

1. **Reverse SPEC-095's Out item for H2 structure only.** The PRESENCE and ORDER of the five required root H2 headings (`What This Is`, `Commands`, `Architecture`, `Module Index`, `Finding Live Project State`) is deterministic and exit-relevant. It is mechanically decidable (exact heading text, fenced code skipped), so the original "semantics" objection does not apply to it. Extra H2s are allowed (advisory). Content semantics stay advisory, as SPEC-095 decided.
2. **Module files: advisory only** (`## Purpose` expected).
3. **One adoption switch for all deterministic memory-file checks**: `context.memory_files.adoption: enforce | warn`. In `warn`, every would-be deterministic finding is emitted as advisory kind `downgraded` (carrying `downgraded_kind`), exit unaffected. An absent key resolves to `warn` (`mode_source: "default"`) so consumers upgrading the binary are not red on first push. `lore setup` writes the key only when absent: `enforce` if the project already passes, else `warn` plus a migration checklist.
4. **The shipped template conforms**: a new-file skeleton supplies sections 1-3 and the managed block becomes sections 4-5, so a fresh install starts in `enforce`, not `warn`.
5. **Warn is never silent**: HUMAN `--check-claude-md` output prints a WARN line every run; `lore bootstrap` carries `memory_file_health` while in warn or failing; a `promotable` flag says when the project could flip to `enforce`.

## Rejected

- **Exact-five-only**: forbids project-specific top-level sections (e.g. this repo's North Star) with no discriminating benefit.
- **Committed baseline/ratchet file**: a shared mutable file that concurrent branches conflict on — fails the "two sessions at once" question.
- **Setup-created corpus task**: makes setup write into the user's corpus and couples a corpus-free check to corpus state.
- **Structure-only switch (`structure.mode`)**: leaves the capacity half of adoption unsolved and costs a second `.strict()` schema version floor later.
- **Default `enforce` when absent**: every already-installed consumer goes red on binary upgrade without having re-run setup.

## Consequences

- `.strict()` schema: a binary older than this change refuses the `context` section of a config.yaml carrying `adoption` and substitutes schema-default memory-file budgets with a loud `SUBSTITUTED` warning (measured 2026-10-07; other commands unaffected). A repo with custom ceilings therefore gets LOOSER ceilings on an old binary until it upgrades (same accepted cost as `memory_files.emphasis`).
- The default is the weak setting; every enforce-side oracle must assert `adoption === "enforce"` in JSON, or a config-less fixture passes vacuously.
- Localized headings cannot pass; such projects remain in visible `warn`.

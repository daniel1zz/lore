---
id: SPEC-239
type: spec
role: spec
title: "Memory Hygiene (knowledge trustworthiness over time) (domain overview)"
status: deprecated
priority: medium
created: 2026-07-26
updated: 2026-10-10
tags: []
---
## 16. Memory Hygiene (knowledge trustworthiness over time)

**Vision (owner, 2026-07-10)**: the corpus must not silently rot. Landscape evidence (2026-07-10 tier-tagged research): bi-temporal invalidation (Zep/Graphiti, arXiv 2501.13956) is the strongest known explicit-signal mechanism; *silent* staleness (a fact changes with no contradicting signal) is an industry-open problem — and Lore has already been bitten (`knowledge-retro-stale-claude-md`: a stale doc produced a false 'SPEC-022 unimplemented' judgment). Three capabilities:

- **H1 Bi-temporal invalidation** — knowledge/ADR docs gain `valid_at`/`invalid_at` semantics; superseding marks the old doc invalid (never deletes — version history stays append-only); default queries/feeds filter invalidated knowledge; an `--include-invalid` escape shows history.
- **H2 Staleness probes** — `lore review --staleness` re-judges high-in-degree knowledge/ADR docs ("does this still hold?") on demand; result is escalation, never auto-invalidation (probabilistic zone, IoC ADR boundary 1). Probe priority: link in-degree × age.
- **H3 Doc-code drift oracle** — specs may declare code anchors (file paths / exported symbols); `lore status --check-drift` verifies anchor existence — deterministic, CI-runnable, zero LLM calls.

Non-goals: no vector store (NG8 unchanged — H1-H3 are metadata + FTS5 + judge verbs); no automatic deletion, ever.

## Acceptance Criteria (structured)

- [·] [script] AC-DOV-1: Content parity with source PRD section holds: lore migrate prd-to-outline --dry-run for this section exits 0 reporting already_migrated=true with 0 failed invariants (char-coverage, section-ref set equality, R-id set equality)
  script: e2e — lore migrate prd-to-outline --prd prd-lore-internal-first-ai-team-knowledge-platform --section memory-hygiene-knowledge-trustworthiness-over-time --dry-run

---
id: TASK-632
type: task
role: plan
title: "Mechanize CLAUDE.md byte-budget check in pre-push (twice-proven re-bloat, ingress-agnostic oracle)"
status: archived
priority: medium
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PRD-001
---
Add a root-CLAUDE.md byte-budget check to hooks/pre-push (same shape as 'lore status --check-prd-budget'). Context: knowledge-retro-claude-md-spec-index-re-bloat-boundary-adr — prose boundary rule failed twice (164.6KB pre-2026-07-22, 52.8KB on 2026-07-26). Design points to settle in-spec: (1) threshold — file is 28.3KB post-compression; propose 32000 bytes hard ceiling; (2) hooks/pre-push and assets/project/pre-push are a byte-identical parity-pinned pair — editing requires regenerating packages/lore/src/generated/assets-manifest.ts (scripts/embed-assets-manifest.mjs) and keeping pre-push-parity.test.ts green; (3) the pair ships to consumer repos via lore setup — decide warn-vs-fail for consumer projects (their CLAUDE.md budgets differ; consider corpus-governed threshold like SPEC-080's prd.extra.outline_budget, or hook-local default with env override); (4) fail-open when CLAUDE.md absent, consistent with the hook's existing preamble.

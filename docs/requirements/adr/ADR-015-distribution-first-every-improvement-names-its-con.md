---
id: ADR-015
type: adr
role: decision
title: "Distribution-first: every improvement names its consumer-delivery surface before it counts as landed"
status: draft
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: [distribution, governance, process]
parent: PRD-001
links:
  - {id: KN-387, type: relates-to}
---
# ADR: Distribution-first — every improvement must name its consumer-delivery surface

## Status
Accepted (owner directive, 2026-07-27)

## Context
Lore exists to serve OTHER projects: its value proposition is that governance, discipline, and mechanisms arrive at consumer repos through the distribution pipeline, not through any one machine's dotfiles. A live incident exposed the inverted default: a report-freshness fix was landed on (a) the operator's personal ~/.claude/CLAUDE.md — not a lore surface at all, invisible to every other user — and (b) the machine-installed skill copy at ~/.claude/skills/. Only a dev-machine symlink (installed skill → repo assets/) accidentally routed (b) into the SSOT. The thinking order was machine-first; distribution was an afterthought recovered by review.

## Decision
When adding or changing ANY discipline, mechanism, prose, hook, skill, or default in the lore ecosystem, the change MUST name its consumer-delivery surface before it is considered landed:

| Kind of change | Delivery surface |
|---|---|
| Session-resident discipline (every consumer session) | assets/governance/corpus-workflow.md (SPEC-083 runtime injection, versioned with the binary) |
| Authoring-time / on-demand prose | a `lore governance <topic>` asset (assets/governance/*.md + topic registry) |
| Skill behavior | assets/skills/** (SSOT) → embedded manifest → `lore setup` converge |
| Automated interception | assets/hooks/** + distribution-hooks roster (auto-registration) |
| Numbers / thresholds / defaults | @lore/core config schema (zod defaults; config.yaml overrides) |
| Deterministic behavior | binary verb / service code with AC-as-code |

Corollaries:
- Machine-local surfaces (~/.claude/*, installed copies) are shadows for dev convenience — editing them is NEVER the fix; parity flows FROM assets, and a dev symlink into assets/ is an accident of one machine, not a pipeline.
- Personal/global CLAUDE.md may additionally carry the operator's own copy of a discipline, but that is a second, optional landing — never the primary one.
- A change without a named delivery surface "works on my machine" by construction and does not exist for consumers.
- Definition of done for any governance/mechanism change includes: SSOT edited, manifest regenerated (--check green), and where applicable the install→visible end-to-end oracle (repo standing lesson: every distribution pipe needs one).

## Consequences
- Review question for every improvement PR/session: "which row of the table does this ride?" — no row, not done.
- The incident's fix itself was re-routed accordingly: reporter-freshness rule into assets/skills/lore-autopilot/SKILL.md (SSOT), shared-state re-evidencing discipline into assets/governance/corpus-workflow.md EXECUTE section.

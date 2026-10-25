---
id: TASK-1792
type: task
role: plan
title: "[Skill:fix] An owned-by site mapping that points at a leaf in the lease's scope is authorized on any leaf"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
links:
  - {id: TASK-1767, type: blocks}
---
Problem (reported 2026-10-19 by a peer session, observed in implementer runs): a claim lease keeps only the LAST `--corpus-scope` it was given. A branch that adds one shared refusal site (a config or store seam reached by many commands) must write `non-business:owned-by <leaf> BR-n` rows on 100+ leaves across ~10 baseline branches, so the implementer re-claims once per branch (one re-claimed 6 times). Another implementer changed its design (dropped a probe method) partly to avoid mapping 114 leaves: the authority model is steering code design.

Approach: a site-map write whose every row is `non-business:owned-by <L> ...` where leaf L lies inside the lease's corpus scope (and L maps that site to a live rule) is authorized on any leaf. Such a row only points coverage at the owning leaf; it cannot add, change or retire another leaf's rules or rule mappings. Any other row on an out-of-scope leaf is still refused, naming the leaf. Rejected alternative: a lease carrying several scopes — still one write per leaf and still a claim per branch.

AC: (a) from a worktree whose lease scope is branch B, `lore baseline map <leaf outside B> --sites-file rows.json` with only owned-by rows naming a leaf in B (which maps the site to a live rule) exits 0; (b) the same file with one rule row, or an owned-by row naming a leaf outside B, or naming a leaf that does not map the site, exits 4 naming the leaf and writes nothing. Runner-produced red.

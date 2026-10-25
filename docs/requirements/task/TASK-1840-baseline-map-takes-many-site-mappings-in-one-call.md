---
id: TASK-1840
type: task
role: plan
title: "baseline map takes many site mappings in one call so a mapping round writes one version per leaf, not one per site"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-230
plan: PLAN-230
links:
  - {id: TASK-1851, type: relates-to}
---
> ⚠ INVALIDATED 2026-10-19T04:16:01.525Z — superseded by task-baseline-map-sites-file-many-site-mappings-all-or-nothing; Duplicate draft: the same end state (batch map, one version per leaf) was implemented and landed by task-baseline-map-sites-file-many-site-mappings-all-or-nothing (merge 4a1b0f6b, AC-BMB-1..3 verified, plan archived).

Measured 2026-10-19: the restoration plan's mapping rounds wrote 8881 baseline version rows (306 MB of the 847 MB versions table; lore.db 1.1 GB) because lore baseline map accepts one --site per call and every call snapshots the whole leaf extra (a site_map of 100-250 entries). The integrate floor then failed with 'database or disk is full' (VACUUM INTO snapshot of a 1.1 GB corpus on a disk with 545 MB free). End state wanted: one map call can set and remove many site mappings for a leaf (e.g. a file of {site, rule|non-business} rows) as ONE version and ONE audit row naming every site, all-or-nothing validation (owned-by checks included), so routine coverage maintenance after a merge costs one version per touched leaf. Consider whether a version row needs the full site_map at all (delta or excluded from snapshot) — decide in the spec.

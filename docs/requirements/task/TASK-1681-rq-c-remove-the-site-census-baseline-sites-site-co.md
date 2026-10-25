---
id: TASK-1681
type: task
role: plan
title: "RQ-C: remove the site census, baseline sites, site coverage and @lore-site tags"
status: approved
priority: high
created: 2026-10-20
updated: 2026-10-20
tags: []
parent: PLAN-216
plan: PLAN-216
---
Plan task RQ-C. Runs on rq-integration after RQ-1. Also adds a schema migration that removes extra.site_map from every baseline document. Every consumer corpus holds the dead key, not only this repository's, and lore has no other route that deletes one extra key: lore set replaces extra wholesale. The migration takes the next free number after lore-21's 028. Apply it to this repository's corpus via integrate's migrate step, then verify AC-RIC-6 of spec-refusal-sites-declare-their-rule-in-code-baseline-leaf. The rows are preserved in knowledge-baseline-site-map-mappings-as-of-2026-10-20-labelling.

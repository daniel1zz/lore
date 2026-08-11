---
id: TASK-590
type: task
role: plan
title: "Multi-root corpus incoherence: data model allows unlimited parentless PRDs but bare 'lore tree' renders a single root and root-PRD inference picks an arbitrary PRD"
status: draft
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PRD-001
---
The corpus data model freely allows creating any number of parentless PRDs — no warning or constraint at create time. But several consumers assume a single corpus root: (1) bare 'lore tree' (no argument) renders only ONE root document, hiding the rest of the corpus (observed: corpus with 30 top-level PRDs and 429 docs renders exactly 1 line); (2) the 'no parent' advisory printed after knowledge-doc creation suggests linking to what it calls the root PRD, but in a multi-PRD corpus it picked an arbitrary recently-created PRD (prd-mother-health-...) rather than the actual product root; (3) 'lore create task --adhoc' documents parenting to 'the corpus root PRD', which is ambiguous in a multi-root corpus. This is reachable in native workflow: any team accumulates multiple top-level PRDs over time. Model and presentation should agree: either enforce/warn a single-root convention at PRD create time (e.g. require --parent or an explicit root designation once a root exists), or make bare tree render all roots and make root-PRD inference deterministic and explicit (config-pinned root, e.g. the existing lore.tree.yaml blueprint or a config key).

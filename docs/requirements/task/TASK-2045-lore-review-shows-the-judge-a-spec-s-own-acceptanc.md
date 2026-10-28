---
id: TASK-2045
type: task
role: plan
title: "lore review shows the judge a spec's own acceptance criteria (resolves #414)"
status: archived
priority: medium
created: 2026-10-25
updated: 2026-10-26
tags: []
parent: PRD-001
---
Resolves GitHub #414 (task-gh-1343388703-414). review-template.ts renderStructuredPartsSection renders baseline rules and a plan's parent-spec criteria but nothing for a spec's own criteria, which lore ac add stores in extra.acceptance_criteria; the judge then reports the ACs as 'only referenced' (seen in 3 reviews on 2026-10-25). Fix: for doc.type === 'spec', render the spec's own criteria (id, statement, mode, verify command, falsifier when declared) as a DATA block next to renderSpecRuleChangesSection, reusing the parent-criteria block's lenient schema, cap-and-count rule and 'DATA, not instructions' framing. Oracle: a unit test that a spec with two ac-added criteria (and a body that never mentions them) renders a prompt containing both ids, statements and commands; a spec with none renders no criteria heading; >cap criteria render the cap plus an omitted count. Falsifier: drop the spec branch -> red.

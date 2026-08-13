---
id: TASK-727
type: task
role: plan
title: "lore review truncates the parent spec before the judge sees it, so the judge scores absent text as a missing-definition defect and escalates the whole plan"
status: draft
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: PRD-001
---
Second judge surface with the same root cause already measured on lore assess (KD8 of knowledge-handoff-agent-main-orchestrator-102: 2 of 3 MAJORs were scored against files listed in the run's OWN truncation manifest, 445736 bytes vs an 80000 budget, and both were false). This report establishes the defect is NOT assess-specific: lore review's assembled parent context is truncated with no notice, and the judge treats the cut boundary as the end of the document. Any judge-backed verdict is therefore unsound in a way the output renders identically to a sound one. Fix at the mechanism root shared by both surfaces: a finding whose subject lies outside the supplied window must be emitted unverifiable, and the supplied-vs-available byte counts must appear in the report.

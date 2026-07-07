---
id: TASK-058
type: task
role: plan
title: "E calibration capture + stats CLI"
status: archived
priority: high
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-014
plan: PLAN-014
---
SPEC-035 §3/§4: approve.ts/reject.ts implicit calibration hook (pair human action vs latest judgment IFF judgment.doc_version==current version; table per spec; escalation outcomes; --calibration-note flag; partial-failure contract: warning to stderr + telemetry, exit 0), cli commands/calibration.ts (--stats per doc_type × prompt_version: n/agreement/wilson lower bound/window). DEPENDS ON B+D. Anchors: cli approve.ts/reject.ts/calibration.ts(new).

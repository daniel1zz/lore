---
id: KN-706
type: knowledge
role: knowledge
title: "EI-2 evidence v10 (expected-fail) is invalid: it ran against the new code"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
links:
  - {id: TASK-1538, type: relates-to}
---
Task task-skill-implement-ei-2-missing-oracle-detection-covers, evidence v10, result expected-fail, proves nothing red: per the implementer's report a failed reverse-apply left the new source in place, so the 'red' run executed the fixed code. The genuine red run is v11. Evidence rows are append-only, so this record is the correction. Lesson: a red run produced by reverse-applying source must assert the reversal took effect (e.g. git diff --stat non-empty) before recording.

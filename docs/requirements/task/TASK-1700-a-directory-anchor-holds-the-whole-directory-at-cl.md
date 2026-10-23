---
id: TASK-1700
type: task
role: plan
title: "A directory anchor holds the whole directory at claim and integrate, but only touched files at edit time: three gates, three meanings"
status: draft
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Observed 2026-10-20. task-skill-fix-an-unparsable-project-config-is-silently-ignored anchors the directory packages/lore/tests/ and holds a claim. Results: (1) claiming an unrelated task that anchors packages/lore/tests/unit/service/drift-check-service.test.ts is refused (gate:task-claim:anchor-overlap); (2) before D3b-B lands, integrate refused D3b-A for brand-new test files under that directory; (3) the edit-time gate holds only the files the holder touched (114cbd9a). The same declared anchor means three different things at three points, and the broad meaning serializes unrelated work across sessions. End state to design: one shared definition of 'what a task holds', used by the claim gate, the edit gate and integrate. Before any commit, a directory anchor holds nothing it has not touched. Once there are commits, the task holds what its branch changed (D3b-B's holder scope for integrate). Oracle: with task C holding the directory anchor tests/ and having changed only tests/a.test.ts, a claim, an edit and a landing for tests/b.test.ts all succeed, and all three are refused for tests/a.test.ts.

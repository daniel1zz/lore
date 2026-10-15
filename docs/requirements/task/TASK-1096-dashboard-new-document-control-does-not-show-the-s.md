---
id: TASK-1096
type: task
role: plan
title: "Dashboard new-document control does not show the selected project's name in multi-project mode"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"distribution","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"c130fd16-a046-41b7-a583-56a6583b0cdc"}
---

In multi-project mode, every dashboard write control is meant to show the selected project's name beside it (SPEC-078 R-13; ProjectIdentityLabel.tsx:4-9 says 'mounted adjacent to EVERY write control'). The badge is mounted in AdjudicationBar.tsx:170, DocDetail.tsx:588 (edit/delete/status/links/history share that page), IssueDetail.tsx:271, ConfigScopePanel.tsx:393 and TriageQueue.tsx:332. The library page's New document control (packages/dashboard/src/routes/library.tsx:297 mounting NewDocModal, which calls apiCreateDoc at library.tsx:181) has no ProjectIdentityLabel, so a person creating a document cannot see which project it will land in. Recorded on baseline rule BR-996 (baseline-launch-the-dashboard).

**Expected:** The new-document control (or its modal) shows the selected project's name, like every other dashboard write control
**Actual:** No project name is shown when creating a document from the library page; grep for ProjectIdentityLabel finds no use in routes/library.tsx or components/NewDocModal.tsx
**Repro command:** `grep -rn ProjectIdentityLabel packages/dashboard/src/routes/library.tsx packages/dashboard/src/components/NewDocModal.tsx`

Reported by: agent:blfix-J

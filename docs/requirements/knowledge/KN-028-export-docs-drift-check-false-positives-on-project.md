---
id: KN-028
type: knowledge
role: knowledge
title: "export-docs drift check false-positives on projected docs"
status: approved
priority: medium
created: 2026-07-07
updated: 2026-07-07
tags: [export, bug, dx]
parent: SPEC-037
---
# export-docs drift: diagnosis CORRECTED after fix (2026-07-07)

Original diagnosis claimed two defects; implementation review (bugfix F1) found only one was real:

1. ~~Permanent false positive on projected docs~~ — WRONG: the drift check already compares against the projected body (fixed earlier by SPEC-032 T3; ExportDocsService.resolveDocBody feeds both writer and drift check). The PRD drift warnings seen 2026-07-07 were TRUE positives: the on-disk file was a stale projection (children had changed). Regression coverage for 'projection changed -> drift' added by F1.
2. Warning recommended unimplemented --force — REAL, fixed by implementing --force for real (overwrite drifted files with fresh frontmatter + current resolved body, ExportReport.overwritten[], dry-run aware) + reworded warning. SPEC-021 Amendment A2 supersedes the 'deferred to v2' stance.

Operational takeaway: whenever the PRD's direct children change, the exported projection goes stale by design — run 'lore export-docs --force' (or delete + re-export) as part of closeout.

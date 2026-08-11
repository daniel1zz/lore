---
id: TASK-663
type: task
role: plan
title: "Compose the step-3 export-index reconcile via formatMirrorHumanId, pad the four report and rename fields while leaving new_display unpadded, and re-baseline AC-084-4 in place"
status: archived
priority: high
phase: "reconcile"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-125
plan: PLAN-125
---
D1/D2 of the governing spec. ordinal-migration-service.ts:743 currently composes with formatDocDisplayId (unpadded) and :758 writes it into index.mappings[doc.id].human_id, while export-docs-service.ts:1031 writes the padded formatMirrorHumanId and :1035 deletes any disagreeing mapping — an oscillation on every export/migrate cycle. Replace :743 with formatMirrorHumanId({ type: doc.type, ordinal: finalOrdinal.ordinal }) verbatim (AC-MIS-2's declared falsifier mutates that exact expression). old_human_id, new_human_id, suggested_file_path and rename_command all follow the padded value. The report's old_display/new_display fields MUST stay unpadded — they are formatDocDisplayId's CLI contract pinned by AC-084-3, and the file uses formatDocDisplayId legitimately at :584/:594/:611/:637/:652 for exactly that. Re-baseline the AC-084-4 pins in migrate-ordinals.bun.test.ts (SPEC-1 to SPEC-001, SPEC-1-alpha-decision.md to SPEC-001-alpha-decision.md, and the rename_command string) with an in-place RE-BASELINE comment citing the literal tokens ordinal.ts:133-145 and 2026-08-10.

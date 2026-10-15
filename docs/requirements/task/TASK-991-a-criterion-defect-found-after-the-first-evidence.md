---
id: TASK-991
type: task
role: plan
title: "A criterion defect found after the first evidence row has no audited fix: reopen is refused and ac set has no --correction"
status: draft
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"governance","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"8b9ad3ac-f621-4779-8c09-b378c52f9a4f"}
---

Landing spec-session-start-injection-carries-only-the-session-s-own, the task-1 implementer measured two criterion defects before merge: AC-SI-9 pins session-service.test.ts 'unedited' although it carries a retired AC-080-2 caps case (typecheck TS2345/TS2339 and the AC's own vitest command go red), and AC-SI-11 greps bootstrap-injection.test.ts, a file D10 retires whole (deleted -> grep exit 2 -> '!' makes the AC pass vacuously; its falsifier path vanishes). lore reopen refuses ('9 evidence rows already exist'), lore ac set|rm is refused by the record-edit gate, and lore set --correction rewrites only the body (criteria live in extra.acceptance_criteria). The only remaining exit is superseding the whole spec, which also orphans the plan's lineage. Generalises #162 (falsifiers) to every criterion field.

**Expected:** An audited, reason-carrying correction path for a locked spec's criteria (e.g. lore ac set --correction '<reason>'), writing one version + audit row and keeping status, so a criterion defect measured mid-implementation is fixed in place and visible
**Actual:** reopen refused once any evidence row exists; ac set refused; set --correction cannot reach criteria; only whole-spec supersession remains

Reported by: agent:session-cb37af5d

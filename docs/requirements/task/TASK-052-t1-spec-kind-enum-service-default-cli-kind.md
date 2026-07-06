---
id: TASK-052
type: task
role: plan
title: "T1 spec_kind enum + service default + CLI --kind"
status: archived
priority: high
phase: taxonomy
created: 2026-07-06
updated: 2026-07-06
tags: []
parent: PLAN-012
plan: PLAN-012
---
AC-1 (SPEC-032 §3.1, §5). New packages/core/src/spec-kind.ts (SPEC_KINDS enum SSOT); schemas.ts specExtraSchema gains spec_kind z.enum optional (validate+fail-loud only, existing 100+ specs stay valid); CorpusService._createImpl defaults extra.spec_kind='feature' for type=spec; CLI create spec --kind / set --kind. Anchors: packages/core/src/spec-kind.ts(new), packages/core/src/schemas.ts, packages/lore/src/service/corpus-service.ts, packages/lore/src/adapters/cli/commands/create.ts, set.ts. Oracle: --kind bogus exits VALIDATION_ERROR; no --kind persists feature; tsc+tests.

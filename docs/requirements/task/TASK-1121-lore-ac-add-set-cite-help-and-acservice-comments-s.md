---
id: TASK-1121
type: task
role: plan
title: "lore ac add|set|cite help and AcService comments still say citations are report-only, but the citation gate refuses them under enforce"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"doc-code-contradiction","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"071423d9-9f9c-41eb-8c4d-1804b197e984"}
---

Found while reconciling baseline leaf baseline-cite-a-baseline-rule with the code (2026-10-10). Help text a caller reads before writing a criterion tells them a dangling or retired citation is only warned, while this repository runs the gate in enforce on all 12 branches.

**Expected:** Help and comments say: where the citation gate enforces for the spec's branch, an added or revised criterion citing nothing (unless exempted) or citing a missing/deprecated/retired rule is refused; under report/off it is stored and warned
**Actual:** packages/lore/src/adapters/cli/commands/ac.ts:265, :434, :618 (help strings) and :79, and packages/lore/src/service/ac-service.ts:206, :458, :476 (comments) say report-only / never rejected; ac-write-chokepoint.ts::admitAcWrite + ac-cite-gate.ts::decideCiteGate refuse with AC_CITE_REQUIRED under enforce on an armed branch (baseline rules BR-86, BR-257, BR-959)

Reported by: agent:blfix-F

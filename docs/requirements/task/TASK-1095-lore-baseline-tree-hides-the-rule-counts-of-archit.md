---
id: TASK-1095
type: task
role: plan
title: "lore baseline tree hides the rule counts of architecture standard and debt-registry nodes; only business leaves show [rules: ...]"
status: draft
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"render","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"b1ed52dc-4125-495f-bb56-5b170cfac0fe"}
---

packages/lore/src/adapters/cli/commands/baseline.ts:637 renders '[rules: live N / ...]' only when entry.node === 'leaf'. Architecture standard (AS-n) and debt-registry (AD-n) nodes also hold rules, and --json carries their counts (measured 2026-10-10: standards hold 18 AS, the registry 13 AD), but the human tree shows them as rule-less. A reader (or an AI rubric such as AC-BLS3-9's, which reads lore baseline tree) cannot see that the standards and debt entries exist.

**Expected:** Every rule-holding node (ruleIdPrefixOfNode !== undefined: leaf, standard, debt-registry) shows its rule counts in the human tree.
**Actual:** Only business leaves show counts; standard and debt-registry rows print none.
**Repro command:** `lore baseline tree baseline-lore-architecture`

Reported by: agent:arch-author

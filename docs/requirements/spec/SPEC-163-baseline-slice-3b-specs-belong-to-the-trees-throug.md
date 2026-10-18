---
id: SPEC-163
type: spec
role: spec
title: "Baseline slice 3b: specs belong to the trees through citations, no parent; node size budgets; domain overviews into the architecture tree"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-17
tags: []
---
# Baseline slice 3b: specs belong to the trees through citations, no parent; node size budgets; domain overviews into the architecture tree

## Owner decisions (2026-10-10 night)

- D5 "spec是执行啊，肯定对应了业务或者技术架构" → **belonging through citations**: a spec has no parent; it relates to the business tree (BR-n) and the architecture tree (AS-n) only through its criteria's citations, many-to-many (ADR decision 5). Every live spec has at least one criterion citing a live BR or AS rule; a spec without one cannot be approved.
- D6 the 84 live specs that cite nothing are judged one by one by two independent mappers; disagreements are ruled by a third agent and every ruling is recorded: behaviour still live → its criteria are cited (`lore ac cite`, never demotes); pure history / superseded / never built, or no criteria while the baseline already states the behaviour → deprecated with a recorded destination; live behaviour no rule states → a rule is added first.
- D7 size budgets move from the PRD outline to baseline nodes, per kind: leaf <= 16000 chars and <= 30 rules, branch <= 16000 chars, standard <= 8000 chars; the PRD keeps its 24000-char whole-document cap and the long-prose check. The outline-based tier and detail-link checks are retired (the outline itself was retired in slice 3a).
- D8 the 4 domain overviews with no branch (dashboard x2, output contract, extension hooks) become architecture-tree content; the originals are deprecated with their destination.

## Overview/Goal

Finish ADR decisions 5 and 6: the PRD stops being a structural parent of specs. After this slice no live spec has a `parent_id`, every live spec cites at least one rule, "which rules does this spec implement" and "which specs implement this leaf / standard" are computed from citations, and every consumer that derived structure from a spec's parent (inventory: slice 3b design survey 2026-10-10, 19 site groups) uses citations or nothing.

## Scope

Contract: `spec` drops out of the required-parent rule (`packages/core/src/schemas.ts`), `parentLegal` admits no parent and REFUSES a parent on a spec (exit 4, message names citations as the relation); spec does NOT become a root type (`doc-type-rules.ts` — avoids the ad-hoc-task and link leaks). The spec-promote / approve path refuses a spec whose criteria cite no live BR/AS rule.

Consumers: tree-check (orphan / misplaced) treats a parentless spec as legal; `lore link <spec> <x> --type parent` refused; `lore get` navigation for a parentless spec does not list every spec as a sibling; outline orphan statistic excludes specs; markdown sync stops auto-parenting specs; requirement coverage and the requirement-removal guard scan every live spec, not the PRD's children; the stale comment at `corpus-service.ts` (~3834, "slice 3b re-parents specs under baseline leaves") is corrected.

Computed view: `lore get <spec>` shows "Implements" (cited rule ids with their node); `lore get <baseline node>` shows "Implemented by" (citing specs with criterion ids); both from citations, counts never filtered silently.

Migration: `lore migrate spec-parents` (dry-run default; `--apply`; `--revert`) clears `parent_id` on every spec, writing one audit entry per spec that holds the old parent, no version bump, no status change; idempotent; `--revert` restores from those audit entries.

Budgets: D7 caps, configurable under `budget.baseline.*`; `lore status` reports each breach with node, kind, measured size and cap; status `--json` also reports `specs_without_citation` (count + slugs) and `specs_with_parent` (count).

Distribution: no shipped skill or doc tells an agent to `create spec --parent`; the design skill tells it to cite rules; dashboard new-doc form no longer requires a parent for a spec; assets manifest regenerated.

Non-goals: plan → spec and task parenting are unchanged; ad-hoc tasks keep their PRD parent; issue intake unchanged.

## Acceptance Criteria

Structured criteria AC-BLS3B-1..11 (`lore ac add`), each citing the rule it falsifies.

## Code anchors

Declared after landing.


## Acceptance Criteria (structured)

- [⚑] [script] AC-BLS3B-1: Through CorpusService and the CLI, a spec created with no parent is created (exit 0, parent_id null); a spec created with --parent <prd> is refused with exit 4 whose message names criterion citations, and nothing is written; lore link <spec> <prd> --type parent is refused with exit 4 and leaves parent_id and the link table unchanged — asserted by spec-parent-contract.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/spec-parent-contract.bun.test.ts && echo 'AC-BLS3B-1 PASS: spec takes no parent; parent refused exit 4'
  other_command=2
- [⚑] [script] AC-BLS3B-2: lore approve on a spec none of whose criteria cite a live BR or AS rule is refused with exit 4 naming 'lore ac cite', leaving status and version unchanged; after lore ac cite of one criterion the same approve succeeds; a spec citing only a retired rule is still refused; a plan's approval is unaffected — asserted by spec-approve-requires-citation.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/spec-approve-requires-citation.bun.test.ts && echo 'AC-BLS3B-2 PASS: uncited spec approval refused'
  other_command=2
- [⚑] [script] AC-BLS3B-3: lore status --json reports specs_without_citation {count, slugs} counting live specs none of whose criteria cite a live rule, and specs_with_parent {count, slugs}; a seeded corpus with 2 uncited and 1 parented live spec reports exactly 2 and 1 with those slugs, and archived/deprecated specs are not counted — asserted by status-spec-citation-census.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/status-spec-citation-census.bun.test.ts && echo 'AC-BLS3B-3 PASS: census counts exact'
  other_command=3
- [⚑] [script] AC-BLS3B-4: lore get <spec> prints an Implements section listing each cited rule id with its node slug and the citing criterion ids; lore get <baseline leaf> prints Implemented by with each citing spec and criterion and a count line; --json carries the same lists; a rule cited by 3 criteria of 2 specs shows count 3 — asserted by spec-implements-view.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/spec-implements-view.bun.test.ts && echo 'AC-BLS3B-4 PASS: implements / implemented-by computed from citations'
  other_command=2
- [⊘] [script] AC-BLS3B-5: With a parentless spec: lore status --check-tree reports it neither orphan nor misplaced (exit 0 on an otherwise clean corpus); lore get on it lists zero siblings; the outline orphan statistic excludes it; lore import-spec-files creates specs with no parent; a parentless knowledge doc is still reported as before (control) — asserted by parentless-spec-consumers.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/parentless-spec-consumers.bun.test.ts && echo 'AC-BLS3B-5 PASS: consumers accept parentless specs'
  other_command=3
- [⚑] [script] AC-BLS3B-6: A parentless spec's criterion naming an unmigrated requirement R-x counts as covering it in lore status --check-requirements, and lore requirement withdraw R-x is refused while that criterion names it; with the criterion removed the withdrawal succeeds — asserted by requirement-coverage-corpus-wide.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/requirement-coverage-corpus-wide.bun.test.ts && echo 'AC-BLS3B-6 PASS: coverage and withdraw guard scan every spec'
  other_command=3
- [⚑] [script] AC-BLS3B-7: lore migrate spec-parents previews N parented specs and writes nothing; --apply clears every spec parent_id, writes exactly N audit entries each naming the old parent, no version entry, no status change (an approved spec stays approved); a second --apply writes nothing; --revert restores every parent_id from those entries — asserted by migrate-spec-parents.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/migrate-spec-parents.bun.test.ts && echo 'AC-BLS3B-7 PASS: spec-parents migration preview/apply/idempotent/revert'
  other_command=2
- [⚑] [script] AC-BLS3B-8: The size check reports a leaf of 16001 chars, a leaf with 31 rules, a branch of 16001 chars and a standard of 8001 chars each as a finding naming node, kind, size and cap (exit 3), passes the same nodes exactly at cap (exit 0), keeps the PRD 24000-char and free-text checks, and no longer reports outline tier or detail-link findings; caps are read from budget.baseline.* — asserted by baseline-node-budget.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/baseline-node-budget.bun.test.ts && echo 'AC-BLS3B-8 PASS: per-kind node budgets'
  other_command=3
- [⚑] [script] AC-BLS3B-9: No file under assets/ or .claude/ shipped by lore setup instructs 'create spec' with --parent (the test scans every asset file and fails naming each offender), the lore-design skill instructs citing rules with lore ac cite, the assets manifest is in sync, and the dashboard new-document form does not require a parent for a spec — asserted by spec-parent-distribution.test.ts and NewDocModal.spec-parent.test.tsx
  script: test — bunx vitest run packages/lore/tests/unit/assets/spec-parent-distribution.test.ts && cd packages/dashboard && bunx vitest run tests/component/NewDocModal.spec-parent.test.tsx && echo 'AC-BLS3B-9 PASS: distribution carries the no-parent contract'
- [⚑] [script] AC-BLS3B-10: The 4 domain overviews without a branch (dashboard console, dashboard multi-project, output contract, extension hooks) are deprecated on the live corpus, each carrying a supersedes link from an architecture-tree node (tree architecture) that exists and is not deleted; checked read-only by scripts/check-domain-overviews-retired.ts which prints each overview and its destination
  script: other — bun scripts/check-domain-overviews-retired.ts && echo 'AC-BLS3B-10 PASS: 4 overviews deprecated with architecture destinations'
  other_command=1
- [⚑] [script] AC-BLS3B-11: On the live corpus after migration and the uncited-spec mapping: lore status --json reports specs_with_parent.count == 0 and specs_without_citation.count == 0 (read-only check by scripts/check-spec-citation-census.ts, which prints both counts and fails naming any slug)
  script: other — bun scripts/check-spec-citation-census.ts && echo 'AC-BLS3B-11 PASS: no parented and no uncited live spec'
  other_command=1
- [⚑] [script] AC-BLS3B-12: The mapping ledger knowledge doc (knowledge-uncited-spec-mapping-ledger-slice-3b) holds one row per spec of the 84 uncited live specs measured 2026-10-10, each with mapper A's verdict, mapper B's verdict, agreement yes/no, and for every disagreement the third agent's ruling and reason; the final decision of every row matches the spec's live state (cited, deprecated, or rule added then cited) — checked read-only by scripts/check-uncited-spec-ledger.ts
  script: other — bun scripts/check-uncited-spec-ledger.ts && echo 'AC-BLS3B-12 PASS: ledger complete and matches live state'
  other_command=1

## Code anchors

- packages/lore/tests/integration/cli/baseline-node-budget.bun.test.ts
- packages/lore/tests/integration/cli/migrate-spec-parents.bun.test.ts
- packages/lore/tests/unit/assets/spec-parent-distribution.test.ts
- packages/lore/tests/integration/parentless-spec-consumers.bun.test.ts
- packages/lore/tests/integration/cli/requirement-coverage-corpus-wide.bun.test.ts
- packages/lore/tests/integration/cli/spec-approve-requires-citation.bun.test.ts
- packages/lore/tests/integration/cli/spec-implements-view.bun.test.ts
- packages/lore/tests/integration/cli/spec-parent-contract.bun.test.ts
- packages/lore/tests/integration/cli/status-spec-citation-census.bun.test.ts
- packages/dashboard/tests/component/NewDocModal.spec-parent.test.tsx
- scripts/check-spec-citation-census.ts
- scripts/check-uncited-spec-ledger.ts
- scripts/check-domain-overviews-retired.ts
- packages/lore/src/service/spec-relations.ts
- packages/lore/src/service/gate-predicates.ts
- packages/core/src/doc-type-rules.ts

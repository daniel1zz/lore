---
id: SPEC-194
type: spec
role: spec
title: "Round 0: main is green (every red test on e1878626 traced to a fixed root cause)"
status: approved
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
---
## Overview/Goal

Make main green so every later fix can prove "no new failure" with one full-suite run instead of a manual baseline comparison. Measured on main e1878626 (2026-10-16): bun run test:vitest exit 1 (17 failed in 11 files), bun run test:bun exit 1 (5 failed). Each failure is mapped to one root cause below; three of them are lore product defects and carry their own criterion.

## Scope

| Root cause | Failing tests | Report |
|---|---|---|
| Tests pin rewritten rules-fragment prose | setup-governance-retirement x2; context-fragments-compiled AC-CF-8; governance-compiled AC-083-1; context-provenance-compiled AC-CP-7 | #227 |
| lore setup records settings.json sha before writing the language (product) | setup.test AC-046-E.R1; setup-manifest-fields AC-076-6.S1 | #233 |
| Stale test-budget ledger / cases without timeouts | check-test-budgets | #170 |
| packages/lore/src/store/CLAUDE.md over its eviction floor | claude-md-eviction-floor | #10 |
| plan-close-cascade deep-equal misses the added issueClose field | plan-close-cascade AC-097-2 | #201 |
| Duplicate mirror human_ids (data) and an exporter that cannot see them (product); mirror-status-parity enumerates baseline mappings | migration-coverage; spec-mirror-export HAPPY(c) and AC-FR-6; mirror-status-parity | #210, #234, #32 |
| ac_scope resolution counts a deprecated spec (product) | check-ac-ref-integrity | #237 |
| Specs without code anchors and without a ledger row | anchor-coverage-ratchet x6; anchor-coverage-stale-exemption x2 | #32 |
| A test writes packages/dashboard/.vocab-probe into the repo tree while another test greps packages/ | phase-write-lifecycle-doc-parity (intermittent) | new |

Out of scope: every other upkeep and defect-backlog item.

## Acceptance Criteria

AC-R0-1..5 (`lore ac add`). AC-R0-1/2 are the round's exit; AC-R0-3..5 pin the three product fixes.


## Acceptance Criteria (structured)

- [⊘] [script] AC-R0-1: On main after the round's last merge, bun run test:vitest exits exactly 0
  script: test — bun run test:vitest
- [⊘] [script] AC-R0-2: On main after the round's last merge (dist/lore rebuilt), bun run test:bun exits exactly 0
  script: test — bun run test:bun
- [⚑] [script] AC-R0-3: With a user config that sets a reply language (isolated HOME and XDG_CONFIG_HOME), the first lore setup records in its manifest a settings.json sha256 equal to the file's final on-disk bytes, and a second --dry-run right after reports every file as would-skip
  script: test — bunx vitest run packages/lore/tests/integration/cli/setup-language-manifest-sha.test.ts
- [⚑] [script] AC-R0-4: An ac_scope id declared on one deprecated and one approved spec resolves to the approved spec only; declared on two live specs it is still reported ambiguous; when the only candidate is deprecated it is reported unresolved
  script: test — bunx vitest run packages/core/tests/unit/ac-scope-deprecated-spec.test.ts
- [⚑] [script] AC-R0-5: In a throwaway corpus where two live docs map to the same mirror human_id, the mirror --check exits exactly 2 and names both docs and the shared human_id; after the exporter's repair no two live docs share a human_id and --check exits 0
  script: test — bunx vitest run scripts/tests/mirror-human-id-collision.test.ts

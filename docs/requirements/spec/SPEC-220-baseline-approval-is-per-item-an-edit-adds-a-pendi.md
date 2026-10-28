---
id: SPEC-220
type: spec
role: spec
title: "Baseline approval is per item: an edit adds a pending revision while the approved version stays in force"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-24
tags: [baseline, approval]
---
## Overview/Goal

A baseline node's approval is held per item, and an edit never withdraws an approval: it adds a pending revision while the approved version stays in force.

Facts this corrects (2026-10-19):

- Adding or revising one rule takes the whole node back to draft (BR-627, BR-628, BR-648). Every other rule and the node's text then need a fresh review although nothing in them changed. On that day 23 nodes sat in draft for that reason alone.
- Almost nothing reads the approval. Coverage, criterion citations, governing-rule feeds, fidelity sampling, removal guards and the cite gate all read the node's current `extra`. A rule added or rewritten by `lore rule add|set` therefore governs at once, unreviewed. The corpus states as approved behaviour something nobody approved.
- Two sessions writing different rules of one node demote each other's approved work.

Site-map rows are not affected. They already keep approval (BR-658, `adr-mapping-a-census-site-does-not-demote-a-baseline-leaf-an`), and `plan-baseline-coverage-refuse-only-undeclared-commands-strip` reduces them to rule mappings that are checked when written.

## End state

1. **Items.** Each business rule of a node is an item. The node's own part (title, body, label, glossary, depends_on, commands) is one item. Each item has an approved version, which can be absent for a new item, and at most one pending revision.
2. **Writes add pending revisions.** These writes record a pending revision of the item they change:
   - `lore rule add` (a pending add: the rule is not live);
   - `lore rule set` (revise, retire or move);
   - `lore baseline set-label|depends|glossary`;
   - `lore baseline map --command|--remove-command`;
   - a body or title edit of a baseline node.

   No such write changes the approval of the node or of any other item. Two sessions writing different items never interfere: each item is guarded by its own version check. A second write to an item replaces its pending revision.
3. **A spec's change set is reviewed by the spec.** `lore rule apply` writes the approved version directly and demotes nothing. It is refused (exit 4) while a rule it changes holds a pending direct revision, and the refusal names that rule.
4. **Review and approve per item.**
   - `lore review <node>` judges only the node's pending revisions, each shown against its approved version.
   - `lore approve <node>` promotes exactly the revisions that judgment saw. A revision that changed after the review is refused (exit 4) and named.
   - `--item <BR-n|node>` approves one item.
   - `lore reject <node> --item <id>` discards that pending revision.
   - Items not named are untouched.
5. **Derived status.** A node is `approved` when its own part and every rule have an approved version and nothing is pending. Otherwise it is `draft`, reported with its pending item count. No command sets a baseline node's status directly.
6. **Readers read the approved version only.** These readers go through one accessor that returns approved versions:
   - coverage and the floor script;
   - criterion citations and the cite gate;
   - rule state;
   - governing-rule feeds and resume diffs;
   - fidelity sampling;
   - dependency checks;
   - removal guards;
   - export mirrors;
   - MCP, HTTP and dashboard reads.

   A pending add is not live: it is not citable and not counted. `lore baseline tree` and `lore rule show` also show pending revisions, labelled `pending`.
7. **Conversion, no compatibility layer.** The schema upgrade converts every baseline node once:
   - An approved node's current content becomes the approved version of each item.
   - A draft node takes each item's approved version from its last approved version, and each difference becomes a pending revision.
   - A node never approved has every item pending.

   The rule registry's lifecycle follows approved versions only: a pending add stays `proposed`. Old demotion versions and code paths are deleted.

## Rule changes

Modifies BR-626, BR-627, BR-648, BR-722, BR-1211; adds BR-1338 (review/approve per item), BR-1339 (derived status), BR-1340 (approved-version accessor), BR-1341 (upgrade conversion). Modifies BR-628: every other dedicated change, and a body or title edit, records a pending revision of the one item it changes; site-map changes keep following BR-658. (Proposed after `spec-baseline-coverage-refuses-only-undeclared-commands-a-site` landed on 2026-10-19.)

## Scope

In:
- `packages/core/src/baseline.ts`, `dedicated-extra-keys.ts`, `schemas.ts` (`resolveStatusAfterContractEdit` for baseline);
- the store's registry triggers and index rows, and the upgrade migration;
- the services `rule-service.ts`, `rule-change-service.ts`, `review-service.ts`, and `corpus-service.ts` (baseline body edits, review bundle);
- every reader listed in item 6;
- `ai/review-template.ts`;
- CLI (`baseline`, `rule`, `approve`, `review`, `reject`), MCP and HTTP surfaces;
- `assets/skills/lore-baseline/SKILL.md`;
- the root and module CLAUDE.md lines that state demotion for baseline nodes.

Out:
- site-map rows (owned by `plan-baseline-coverage-refuse-only-undeclared-commands-strip`, which lands first and deletes `owned-by.ts` and every owned-by branch; this spec assumes their absence);
- approval of non-baseline documents.

## Acceptance Criteria

Structured criteria are recorded with `lore ac add` (AC-BIA-1..7).


## Acceptance Criteria (structured)

- [·] [script] AC-BIA-1: On an approved leaf in a throwaway corpus: lore rule set BR-x --statement Y leaves the leaf's other rules and own part approved; rule show prints the approved statement and Y labelled pending; the cite gate, rule state and coverage read the approved statement; approving the leaf after review makes Y the approved version.
  script: test — bun run test:file packages/lore/tests/integration/baseline-item-pending-revision.bun.test.ts && echo 'AC-BIA-1 PASS: a revision is pending while the approved version governs'
  other_command=3
- [⚑] [script] AC-BIA-2: lore rule add on an approved leaf adds a pending add: the registry lifecycle is proposed, a criterion citing it is refused as not live at spec approval, coverage does not count it, the leaf's other items stay approved; lore approve --item BR-n without a review that saw it exits 4; after lore review and lore approve --item BR-n it is live.
  script: test — bun run test:file packages/lore/tests/integration/baseline-item-pending-add.bun.test.ts && echo 'AC-BIA-2 PASS: a direct add is not live until approved'
  other_command=4
- [·] [script] AC-BIA-3: Two sessions add one rule each to one leaf; review sees both; a third rule added after the review is not promoted by approve and stays pending; a second write to a reviewed item replaces its pending revision and approve then exits 4 naming it; reject --item discards one pending revision and leaves the other.
  script: test — bun run test:file packages/lore/tests/integration/baseline-item-approve-concurrent.bun.test.ts && echo 'AC-BIA-3 PASS: approval promotes exactly the reviewed revisions'
  other_command=3
- [·] [script] AC-BIA-4: lore rule apply of a spec modifying an approved rule writes the approved version and leaves the leaf approved; apply of a spec modifying a rule that holds a pending direct revision exits 4 naming the rule and writes nothing.
  script: test — bun run test:file packages/lore/tests/integration/baseline-item-rule-apply.bun.test.ts && echo 'AC-BIA-4 PASS: a landed change set is approved by its spec'
  other_command=3
- [·] [script] AC-BIA-5: set-label, depends, glossary, map --command, a body edit and a rule move each record a pending revision of exactly one item; the node prints draft (N pending); lore set --status approved on a baseline node exits 4; coverage uses the approved commands; a node with nothing pending prints approved.
  script: test — bun run test:file packages/lore/tests/integration/baseline-item-derived-status.bun.test.ts && echo 'AC-BIA-5 PASS: node status is derived from its items'
  other_command=3
- [·] [script] AC-BIA-6: No source file outside the approved-version accessor reads a baseline node's rules, commands, label, glossary or depends_on from extra directly: a scan of packages/core/src, packages/lore/src and scripts finds such reads only in the accessor and the write path.
  script: test — bun run test:file packages/lore/tests/unit/service/baseline-effective-reads.test.ts && echo 'AC-BIA-6 PASS: every reader goes through the approved-version accessor'
  other_command=5
- [·] [script] AC-BIA-7: On a throwaway corpus at the previous schema holding an approved node, a draft node with an approved past (one rule added, one revised since) and a never-approved node, lore migrate schema converts them per BR-1341, the registry marks the added rule proposed, and a second run changes nothing.
  script: test — bun run test:file packages/lore/tests/integration/baseline-item-upgrade.bun.test.ts && echo 'AC-BIA-7 PASS: the upgrade converts nodes to items once'
  other_command=6

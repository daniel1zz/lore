---
id: ADR-054
type: adr
role: decision
title: "A structural gate refuses only what an excuse cannot satisfy: undeclared commands refuse, the site census reports"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: [baseline, coverage, census, gates]
parent: PRD-001
links:
  - {id: ADR-041, type: implements}
  - {id: SPEC-207, type: relates-to}
  - {id: SPEC-199, type: relates-to}
  - {id: SPEC-157, type: relates-to}
  - {id: ADR-019, type: relates-to}
---
# A structural gate refuses only what an excuse cannot satisfy: undeclared commands refuse, the site census reports

## Status

Owner-decided 2026-10-19 (session 482f1e89). This document's lifecycle status is whatever `lore get` shows; the text does not assert it.

## Context

`adr-the-product-is-a-baseline-tree-specs-are-implementations` decision 3: technical structure (adapters, layering, schema, storage, sync, telemetry) lives in the architecture tree, never under a business leaf. The business baseline and the technical (architecture) baseline are independent trees.

The per-site coverage gate (BR-660, BR-661, BR-1248, wired into the integrate floor as `check:baseline-coverage`) contradicts it. For every business leaf it walks the code transitively reachable from the leaf's commands and requires every error exit it finds (storage, telemetry, autonomy calibration, trace recorder, the census's own code) to be mapped to a business rule or excused on that leaf. Measured on this corpus, 2026-10-19, after the debt ledger was burned to zero:

- 128 business leaves carry a `site_map`; 26,648 entries in total.
- 25,421 entries (95%) are `non-business:` excuses (11,881 infrastructure, 11,441 owned-by, 1,433 out-of-branch, 325 dispatch, 341 other); 1,227 are `BR-n` mappings.
- `baseline-accept-a-decision-record` carries 280 entries, all excuses, no rule mapping.
- 182 distinct sites produced ~3,500 (leaf, site) debt rows: one shared function counted once per leaf that reaches it. `site-census.ts` itself was "reached" by 98 leaves through an injected port.

Clearing the gate added no business description to the baseline. Its cheapest satisfying action was writing an excuse, so that is what was produced. Slice 3a (AC-BLS3-1) excluded the architecture tree from the census instead of letting it own technical sites, so a technical site had nowhere to go but an excuse on a business leaf.

## Decision

1. **A structural gate earns its refusal only if all three hold:** (a) the violation is a real loss that nothing else surfaces; (b) the cheapest way to satisfy the gate produces the very thing the gate protects (declaring a command on a leaf IS writing its business description), never an excuse that stands in for it; (c) its cost (runtime, write volume, cross-session contention) is bounded. A gate failing (b) is removed, not ledgered. A property that is not enforced is reported with a count and labelled not enforced.
2. **Kept as refusals:** a runnable command no business leaf declares (BR-1248, reworded to this alone; BR-656, BR-1316); a leaf declaring a command name that resolves to no product command (BR-664, exit 4); a declared command absent on main (BR-1308, BR-1309); the AC citation gate (an AC cites a live rule). Each is satisfied only by writing the business description itself.
3. **The site census becomes a read-only report.** `lore baseline coverage` exits non-zero only for undeclared commands; unmapped sites are listed (count by default, list on request) and never fail; a mapping whose site no longer exists or whose rule is retired is listed as stale (BR-1320, reworded), never refused. `check:baseline-coverage` gates only undeclared commands and, per 1(c), computes them from the command registry and the leaves' declarations alone: the integrate floor never runs the transitive site census (`computeUndeclaredCommands` needs no `listSitesMany`). The census itself (BR-659, BR-662, BR-663) is kept, as the report's behaviour.
4. **`site_map` is traceability only: site → `BR-n`.** The `non-business:` and `non-business:owned-by` grammar is retired; the write path refuses it. The existing excuse entries are removed by a one-shot, idempotent migration through the single write route (one version per leaf). `owned-by.ts` is deleted.
5. **Guards that existed only to protect completeness are retired:** refusing to remove a mapping while main still reaches the site (BR-1315, BR-1317), refusing to retire or move a rule a reachable mapping cites (BR-1318, BR-1319), sampling excuse fidelity (BR-967, AC-BLS2-23). A mapping to a retired rule is reported stale, not refused.
6. **The architecture tree gets no coverage gate.** It stays a current-state description; its standards are enforced by their own oracles (layering checks, tests). No per-file ownership declaration is introduced. The business census continues to ignore architecture nodes.

## Consequences

- Rules: BR-1248 reworded to the undeclared-command refusal alone; BR-660 retired; BR-661 and BR-1320 reworded to report semantics; BR-654, BR-655, BR-1288 reworded to BR-only mappings; BR-1315/1317/1318/1319 and BR-967 retired; AD-1 and AD-2 reworded as report-precision debt. BR-628 is reworded to agree with BR-658 and `RuleService.setSiteMap`'s `keepsApproval` (`packages/lore/src/service/rule-service.ts`): an edit that changes only a leaf's `site_map` keeps the leaf approved.
- Specs: `spec-baseline-coverage-cannot-silently-regress-one-program` (drop BCR-2, BCR-3; rewrite BCR-5 to undeclared commands only); `spec-site-map-maintenance-keeps-a-leaf-s-approval-an-owned-by` (drop SMM-2, SMM-3); `spec-baseline-slice-2-completeness-census-per-branch-citation` (drop BLS2-12, BLS2-23; rewrite BLS2-5 and BLS2-13 item 1).
- Work: `plan-baseline-completeness-restoration-every-verb-declared-0` phases P1 and P5 ("0 gaps") are retired; P2 (undeclared commands) stays. Census-precision drafts (gh-58, 60, 104, 112, 118) become report-quality defects; gh-73 (owned-by text) closes.
- `adr-a-newly-armed-structural-oracle-enforces-from-a-baseline` stays as general policy; it no longer has a baseline-coverage instance.

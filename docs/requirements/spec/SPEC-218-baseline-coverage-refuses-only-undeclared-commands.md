---
id: SPEC-218
type: spec
role: spec
title: "Baseline coverage refuses only undeclared commands; a site map holds rule mappings only"
status: approved
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: [baseline, coverage, census]
links:
  - {id: ADR-054, type: implements}
---
# Baseline coverage refuses only undeclared commands; a site map holds rule mappings only

## Overview/Goal

Implements `adr-a-structural-gate-refuses-only-what-an-excuse-cannot`. The per-site coverage gate made business leaves account for every code exit reachable from their commands, technical code included; 95% of the 26,648 `site_map` entries it produced are `non-business:` excuses. End state:

- The merge check refuses only a runnable command that no business leaf declares, computed without the site census.
- `lore baseline coverage` reports unmapped sites and stale mappings; they never change its outcome code.
- A `site_map` entry maps a site to unretired rules of its leaf and nothing else: the write path accepts only `BR-n` values, so the excuse grammar (`non-business:<reason>`, `non-business:owned-by <leaf> BR-n`) has no option, parser or reader in product source. Existing excuse entries are removed by `scripts/strip-site-map-excuses.ts`, a one-shot, idempotent script outside product source that writes only through `lore baseline map <leaf> --remove-site`.
- The guards that only protected completeness are gone: removing a mapping, or retiring or moving a rule a mapping cites, is no longer refused because main still reaches a site.

## Scope

In:
- `lore baseline coverage` outcome code; `scripts/check-baseline-coverage.ts` (floor step) computing undeclared commands from the command registry and leaf declarations alone.
- `lore baseline map` / `RuleService.setSiteMap`: rule-only entries; removal unguarded by reachability.
- `RuleService` retire / move: no site-map reachability refusal.
- Deleting `owned-by.ts` and every consumer branch (`leaf-coverage.ts`, `rule-service.ts`, `main-tree-guard.ts`).
- `scripts/strip-site-map-excuses.ts` and running it on this corpus, immediately after the code lands, in the same phase; AC-BCG-7 closes the phase. A stored non-BR value is read as corrupt (BR-654: coverage exits 2 naming it), never downgraded to "unmapped".
- Why the order is code first, then script, and cannot be one atomic change: the corpus is branchless and shared, so the script's writes take effect for every session the moment they run. Run before the code lands, main's old floor (per-site completeness) would refuse every other session's merge. Run after, nothing merges differently: the new floor reads only command declarations (BR-1248), so leftover entries make only the coverage report exit 2 until the script runs, which is the loud signal to run it.
- Rule change set below; retiring the criteria of other specs that cite retired rules (BCR-2, BCR-3, SMM-2, SMM-3, BLS2-12, BLS2-23) and rewording BCR-5, BLS2-5, BLS2-13 item 1.

Out:
- Census precision (depth bound, injected bindings): report quality only, tracked by the existing gh drafts.
- Any coverage or ownership gate for the architecture tree (ADR decision 6).
- Scoping the report to business refusal points: the report never refuses, so its breadth costs nothing at merge time.

Rule change set (deviation from the ADR, recorded here): BR-1317 is modified, not retired; its command-declaration half guards BR-1316, which the ADR keeps. BR-1288 is unchanged: it governs batch atomicity and names no excuse.

## Acceptance Criteria

Structured criteria are on this spec (`lore ac list`). Every script criterion runs on a throwaway corpus (`mkdtemp` + `lore init`), except AC-BCG-7, which reads this repository's corpus read-only.


## Acceptance Criteria (structured)

- [⚑] [script] AC-BCG-1: On a throwaway corpus whose leaves leave reached sites unmapped and declare every runnable command, 'lore baseline coverage <root>' exits exactly 0 and prints the unmapped-site count; adding one runnable command no leaf declares makes it exit exactly 1 naming that command; a leaf storing a non-BR value (e.g. 'non-business: x') makes it exit exactly 2 naming that leaf, site and value. Simplest failing case asserted: unmapped sites alone must not yield exit 1.
  script: test — bun run test:file packages/lore/tests/integration/cli/baseline-coverage-report-only.test.ts && echo 'AC-BCG-1 PASS: unmapped sites exit 0, an undeclared command exits 1, a non-BR value exits 2'
  other_command=1
- [⚑] [script] AC-BCG-2: scripts/check-baseline-coverage.ts exits exactly 1 naming the command when one runnable command is undeclared, exactly 0 when only sites are unmapped, and never invokes the site census (a recording stub of the census entry point records zero calls in both runs).
  script: test — bun run test:file scripts/tests/check-baseline-coverage-commands-only.test.ts && echo 'AC-BCG-2 PASS: floor gates undeclared commands only, census never run'
  other_command=2
- [⚑] [script] AC-BCG-3: 'lore baseline map --help' lists no non-business option; a map change carrying a site with no rule exits exactly 4 naming BR-655, and a sites-file row whose value is free text (e.g. 'non-business: storage'), a retired rule or another leaf's rule exits exactly 4 naming the value; in every refused case the leaf's version count is unchanged. A row mapping the site to an unretired rule of the leaf exits 0.
  script: test — bun run test:file packages/lore/tests/integration/cli/site-map-rules-only.test.ts && echo 'AC-BCG-3 PASS: only BR-n values are written'
- [⚑] [script] AC-BCG-4: scripts/strip-site-map-excuses.ts, run on a throwaway corpus whose leaves mix BR-n and free-text entries, removes every entry with no BR-n through 'lore baseline map <leaf> --remove-site' (one call, one version per changed leaf), keeps every BR-n entry byte-identical and approved leaves approved, and on a second run makes zero calls and writes zero versions.
  script: test — bun run test:file scripts/tests/strip-site-map-excuses.test.ts && echo 'AC-BCG-4 PASS: migration strips excuses once, idempotently, through the write route'
  other_command=1
- [⚑] [script] AC-BCG-5: packages/lore/src/service/owned-by.ts does not exist, and no line of a .ts file under packages/lore/src or packages/core/src names 'non-business' or 'owned-by', except the unrelated hook term 'lore-owned-by-path'. Measured 2026-10-19: 54 such lines in 10 files; the target is 0.
  script: other — test ! -e packages/lore/src/service/owned-by.ts && n=$(grep -rnE 'non-business|owned-by' packages/lore/src packages/core/src --include='*.ts' | grep -v 'lore-owned-by-path' | wc -l | tr -d ' ') && echo "residual lines: $n" && [ "$n" -eq 0 ] && echo 'AC-BCG-5 PASS: excuse grammar has no residual reader, writer or comment'
- [⚑] [script] AC-BCG-6: On a throwaway corpus whose main tree still reaches a mapped site: removing that mapping exits exactly 0; retiring a rule a mapping cites, and moving it to another leaf, each exit exactly 0, and coverage then lists the mapping as stale and exits 0; dropping a declared command main still has exits exactly 4 (BR-1316 kept), and with an unanalysable main exits exactly 4 (BR-1317).
  script: test — bun run test:file packages/lore/tests/unit/service/site-map-removal-unguarded.test.ts && echo 'AC-BCG-6 PASS: completeness guards gone, command guards kept'
- [⚑] [script] AC-BCG-7: Read-only over this repository's corpus: scripts/count-site-map-excuses.ts (a separate read-only check, never the strip script) prints the number of site_map values across all baseline nodes that are not a BR-n id and the BR-n count, and exits 1 when the first is non-zero; the target is exactly 0.
  script: other — bun scripts/count-site-map-excuses.ts && echo 'AC-BCG-7 PASS: corpus holds no excuse entries'

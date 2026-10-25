---
id: SPEC-221
type: spec
role: spec
title: "Refusal sites declare their rule in code; the rule-to-site index is computed and the corpus site map is retired"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-20
tags: []
---
## Overview/Goal

Implements D1 of `adr-facts-live-once-next-to-what-they-describe-corpus-changes`, narrowed to build on `spec-baseline-coverage-refuses-only-undeclared-commands-a-site`. That spec, which must land first, already does three things:
- makes site coverage report-only;
- deletes the excuse grammar (`non-business:`, `owned-by`);
- leaves `extra.site_map` holding only `BR-n` rule mappings, kept per leaf in the corpus.

This spec moves those remaining rule mappings out of the corpus and into the code at the refusal site. It also makes the rule-to-site relation queryable.

Why this matters: a corpus mapping does not follow its code.
- Renaming one function needed its mapping copied onto 115 leaves.
- Corpus rows removed before the code-removing branch landed turned main red three times on 2026-10-19.
- Nothing records which code enforces a rule, so a rule's statement can change with none of its code in view.

## Scope

**Declarations in code.** A refusal site names the rule it enforces where it is written. The census reads it from three forms:
1. **On the refusal object.** `LoreError` gains an optional `rule` member (a `BR-<n>` id).
2. **On a refusal helper.** The eight local `validationError` copies and `storeError` become one helper each in `@lore/core`. Each helper takes the rule as an argument, so a `dynamic:err(validationError(...))` site carries it at the call.
3. **On a call point.** An injected port, an interface method or a dynamic callee is tagged once, with `@lore-site BR-<n>` on the port type, interface, method or callee. Every call site of that member inherits the tag.

A site carries at most one rule. There are no non-business declarations: the predecessor spec removed excuses.

**Coverage reads the code.**
- `lore baseline sites <command> --json`, the existing census listing, reports each reached site with the rule it declares, as `unmapped`, or as a conflict naming both rules when one site declares two.
- `lore baseline coverage` reports, per leaf, the reached sites that declare one of the leaf's own live rules, and the reached sites that are unmapped. The report stays report-only, as the predecessor spec defines it.
- A declaration naming a retired or unknown rule is reported, naming the id.
- The leaf's declared commands stay in the corpus.

**Rule-to-site index.** The census computes, for every live rule, the sites that declare it (`file:line`).
- `lore rule show BR-<n>` lists them.
- `lore rule set BR-<n> --statement` and a landing spec rule change print them, so a text change always shows the code it governs.
- Coverage reports a rule enforced by the product (`enforced_by: guaranteed`) with no declaring site as `unenforced`.

**Retired.** `extra.site_map`, the options `--site`, `--sites-file` and `--remove-site` of `lore baseline map`, and the site-map reader in coverage are deleted outright. A removed option fails through the CLI's generic unknown-option handling (exit 2, `Unknown option`); no dedicated message is kept. No product code reads, writes or names `site_map` after this spec lands, with no exemption; no guard refuses the key, because nothing gives it meaning (an `extra` key no code reads changes no verdict). The migration note for consumers goes in the ADR consequences, not in the product.

**Conversion is not product code.** The existing `BR-n` mappings are written into code once, by a throwaway script run from the scratchpad, never committed under the source tree. It refuses, writing nothing, while any site is mapped by two leaves to different rules; each such site is resolved by an explicit choice with a reason, recorded on the converting task's evidence. The script prints the count of previously mapped (leaf, site, rule) triples and the count reported mapped from code; the two must match before the corpus mappings are removed in one pass. The script is deleted after it runs.

**Branch independence.** Coverage and the rule index read declarations from the tree they judge, and read only rule liveness and leaf commands from the corpus. A branch that adds, moves or renames a refusal site needs no corpus write.

## Acceptance Criteria

Structured criteria AC-RIC-1 and AC-RIC-3 to AC-RIC-7 (`lore ac list`).


## Acceptance Criteria (structured)

- [·] [script] AC-RIC-1: Throwaway TS root with one site of each form: a refusal literal carrying rule BR-1, a shared validationError helper call carrying rule BR-2, and an interface method tagged '@lore-site BR-3' called from a command. 'lore baseline sites <cmd> --json' reports each site with exactly that rule, and a fourth site with none as unmapped; a site carrying two rules is reported as a conflict naming both. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a census that reads only object-literal err() arguments passes the first site; the fixture's helper-call and tagged-interface sites must report their rules. Made red once by removing the doc-tag reader from the census.
  script: test — bun run test:file packages/lore/tests/integration/ric-declarations-read.bun.test.ts && echo 'AC-RIC-1 PASS: census reads all three declaration forms'
  other_command=5
- [·] [script] AC-RIC-3: Throwaway repo: a refusal site S declares BR-a. Then the function enclosing S is renamed and a second refusal S2 declaring BR-b is inserted above S in the same function. 'lore baseline coverage --json' lists S at its new file:line mapped to BR-a and S2 mapped to BR-b, and neither as unmapped; the corpus docs, versions and audit row counts are unchanged. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a rename with no inserted sibling keeps position-ordinal keys stable, so the fixture inserts S2 above S first. Made red once by keying declarations on the old ordinal site key.
  script: test — bun run test:file packages/lore/tests/integration/ric-rename-free.bun.test.ts && echo 'AC-RIC-3 PASS: a rename needs no corpus write'
  other_command=5
- [·] [script] AC-RIC-4: Throwaway corpus and repo: BR-a is declared at two sites. 'lore rule show BR-a --json' lists both as file:line. 'lore rule set BR-a --statement x' exits 0 and stdout lists both sites. A spec whose change set modifies BR-a, with its citing criterion attested, is landed with 'lore rule apply <spec>', which exits 0 and lists both sites. A guaranteed rule BR-c with no declaring site is reported by 'lore baseline coverage --json' under unenforced. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): an index built from comments mentioning BR-a would also list a comment line; the fixture has a comment naming BR-a that must not be listed. Made red once by dropping the site list from rule set output.
  script: test — bun run test:file packages/lore/tests/integration/ric-rule-site-index.bun.test.ts && echo 'AC-RIC-4 PASS: rule shows its enforcing sites; unenforced rules reported'
- [·] [script] AC-RIC-5: Throwaway corpus: 'lore baseline map L --site x --rule BR-a' exits 2 with 'Unknown option: --site' from the CLI's generic option handling, and likewise for --sites-file and --remove-site; no dedicated message exists. With BR-a declared at a code site S and a leaf L whose extra (seeded directly in the fixture store) still holds a site_map row mapping S to a different rule BR-z, 'lore baseline sites' and 'lore baseline coverage --json' report S as BR-a and never name BR-z. No product source file (packages/*/src, scripts/, assets/) contains the string site_map. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): hiding the options from help while coverage still reads site_map; the seeded stale row must not change the report. Made red once by restoring the site_map reader in coverage.
  script: test — bun run test:file packages/lore/tests/integration/ric-site-map-retired.bun.test.ts && echo 'AC-RIC-5 PASS: site_map retired; options gone; a stale row changes nothing'
  other_command=3
- [·] [script] AC-RIC-6: Live end state of this repository, read-only (no write to the repo .lore): no baseline leaf carries the key extra.site_map, asserted as key absence (an empty object fails). No product source file (packages/*/src, scripts/, assets/) names convert-site-map, so no converter ships. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a leaf keeping an empty extra.site_map object passes a 'no rows' check; the test asserts the key itself is absent. Made red once by running the check against a copy of the corpus with one site_map key restored.
  script: test — bun run test:file packages/lore/tests/integration/ric-site-map-gone-live.bun.test.ts && echo 'AC-RIC-6 PASS: no corpus site mappings remain and no converter ships'
  other_command=1
- [·] [script] AC-RIC-7: Throwaway repo with lore integrate configured and a trivial floor: branch A adds a refusal site declaring BR-a; branch B, cut from main before A, renames the function enclosing an existing site declaring BR-b. The test runs both orders on fresh copies (A then B, and B then A); in each, both land with zero corpus writes between claim and landing (the corpus audit table gains no mapping row), and afterwards 'lore baseline coverage --json' reports A's site mapped to BR-a and B's renamed site mapped to BR-b. SIMPLEST GREEN-BUT-BROKEN CASE (asserted): landing A after a corpus mapping write would also report it mapped; the audit assertion rules that out. Made red once by reading mappings from the corpus instead of the judged tree.
  script: test — bun run test:file packages/lore/tests/integration/ric-branch-independent.bun.test.ts && echo 'AC-RIC-7 PASS: a new site lands with no corpus write'
  other_command=5

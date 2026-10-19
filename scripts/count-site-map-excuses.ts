#!/usr/bin/env bun
/**
 * Read-only census of baseline site_map values (`bun scripts/count-site-map-excuses.ts [--lore <cmd>]`).
 *
 * Purpose: after the excuse grammar was retired (spec-baseline-coverage-refuses-only-undeclared-commands-a-site, BR-654) a
 *   site map takes BR-n ids only; this counts the values that are not (leftover free-text excuses) and the BR-n values.
 * Output: two lines, `non-BR values: N` and `BR-n values: M`. Exit codes: 0 no non-BR value, 1 at least one, 2 the corpus
 *   could not be read (never a silent 0).
 * Side-effect class: IO (spawns `lore` read verbs in the cwd corpus; writes nothing).
 */
import { SiteMapReadError, isRuleId, parseLoreCommand, readBaselineSiteMaps } from "./lib/baseline-site-maps.js";

function main(argv: readonly string[]): number {
  const i = argv.indexOf("--lore");
  const lore = parseLoreCommand(i >= 0 ? (argv[i + 1] ?? "") : "lore");
  let nonRule = 0;
  let rule = 0;
  for (const node of readBaselineSiteMaps(lore, process.cwd())) {
    for (const values of Object.values(node.siteMap)) {
      for (const v of values) {
        if (isRuleId(v)) rule += 1;
        else nonRule += 1;
      }
    }
  }
  console.log(`non-BR values: ${nonRule}`);
  console.log(`BR-n values: ${rule}`);
  return nonRule > 0 ? 1 : 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (e) {
  if (!(e instanceof SiteMapReadError)) throw e;
  console.error(`count-site-map-excuses: ${e.message}`);
  process.exit(2);
}

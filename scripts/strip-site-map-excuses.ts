#!/usr/bin/env bun
/**
 * One-shot, idempotent migration: strip every non-BR-n value from the baseline's `site_map` entries
 * (`bun scripts/strip-site-map-excuses.ts [--lore <cmd>] [--dry-run]`, run from the corpus's directory).
 *
 * Purpose: BR-654 (strict reading) makes a site map take unretired BR-n ids of its own leaf only; entries written under the
 *   retired excuse grammar (`non-business:...` free text) must go. A site whose values hold no BR-n is unmapped
 *   (`--remove-site`); a site mixing BR-n and free text is re-mapped to its BR-n values (mapping again replaces the entry).
 * Write route: ONLY `lore baseline map <leaf> [--sites-file <json>] [--remove-site <k>]...`, ONE call (so one version) per
 *   changed leaf — `--sites-file` and `--remove-site` combine in a single call.
 * Refusals: every kept BR-n is checked against its leaf's unretired rules BEFORE any write; if any would be refused, every
 *   refused leaf/site/value is printed and the script exits 1 with nothing written. A refusal the write path itself raises
 *   is printed the same way (the other leaves stay written; a re-run finishes them). Nothing is silently dropped.
 * Idempotence: a corpus with no non-BR value yields an empty plan, so a second run makes zero write calls.
 * Exit codes: 0 done (or nothing to do / dry run), 1 refused, 2 the corpus could not be read.
 * Side-effect class: IO (spawns `lore`; writes the cwd corpus unless --dry-run).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SiteMapReadError,
  type BaselineSiteMapNode,
  type LoreCommand,
  isRuleId,
  parseLoreCommand,
  readBaselineSiteMaps,
  runLoreCommand,
} from "./lib/baseline-site-maps.js";

/** What one leaf needs: sites to unmap, mixed sites re-mapped to their BR-n values, and refusals predicted up front. */
interface LeafPlan {
  readonly slug: string;
  readonly removeSites: string[];
  readonly remap: { site: string; rules: string[] }[];
  readonly refused: { site: string; value: string; reason: string }[];
}

/** Pure: derive a node's plan from its stored site map; an unchanged node has an empty plan. */
function planNode(node: BaselineSiteMapNode): LeafPlan {
  const plan: LeafPlan = { slug: node.slug, removeSites: [], remap: [], refused: [] };
  for (const [site, values] of Object.entries(node.siteMap)) {
    if (values.every(isRuleId)) continue;
    if (node.kind !== "leaf") {
      for (const v of values.filter((x) => !isRuleId(x))) plan.refused.push({ site, value: v, reason: `${node.kind} node: only a leaf's site map is writable` });
      continue;
    }
    const kept = values.filter(isRuleId);
    if (kept.length === 0) {
      plan.removeSites.push(site);
      continue;
    }
    for (const v of kept) {
      if (!node.unretiredRuleIds.has(v)) plan.refused.push({ site, value: v, reason: "kept BR-n is not an unretired rule of this leaf" });
    }
    plan.remap.push({ site, rules: kept });
  }
  return plan;
}

function isEmptyPlan(p: LeafPlan): boolean {
  return p.removeSites.length + p.remap.length + p.refused.length === 0;
}

function describePlan(p: LeafPlan): string {
  return `${p.slug}: remove ${p.removeSites.length} site(s), re-map ${p.remap.length} mixed site(s) to BR-n only`;
}

/** Command: write one leaf's plan through the single write route; returns the refusal text, or undefined on success. */
function applyLeafPlan(lore: LoreCommand, p: LeafPlan, cwd: string): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), "strip-site-map-"));
  try {
    const args = ["baseline", "map", p.slug];
    if (p.remap.length > 0) {
      const file = join(dir, "sites.json");
      writeFileSync(file, JSON.stringify(p.remap));
      args.push("--sites-file", file);
    }
    for (const site of p.removeSites) args.push("--remove-site", site);
    const r = runLoreCommand(lore, args, cwd);
    return r.status === 0 ? undefined : `exit ${r.status}: ${(r.stderr + r.stdout).trim()}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv: readonly string[]): number {
  const i = argv.indexOf("--lore");
  const lore = parseLoreCommand(i >= 0 ? (argv[i + 1] ?? "") : "lore");
  const dryRun = argv.includes("--dry-run");
  const cwd = process.cwd();
  const plans = readBaselineSiteMaps(lore, cwd)
    .map(planNode)
    .filter((p) => !isEmptyPlan(p));

  for (const p of plans) console.log(`${dryRun ? "plan " : ""}${describePlan(p)}`);
  const refused = plans.flatMap((p) => p.refused.map((r) => ({ leaf: p.slug, ...r })));
  if (refused.length > 0) {
    for (const r of refused) console.error(`REFUSED ${r.leaf} site ${r.site} value ${JSON.stringify(r.value)}: ${r.reason}`);
    console.error(`strip-site-map-excuses: ${refused.length} refusal(s); nothing written`);
    return 1;
  }
  if (dryRun || plans.length === 0) {
    console.log(`${plans.length} leaf/leaves ${dryRun ? "would change" : "to change; nothing to do"}`);
    return 0;
  }
  const failures: string[] = [];
  for (const p of plans) {
    const failure = applyLeafPlan(lore, p, cwd);
    if (failure !== undefined) failures.push(`REFUSED ${p.slug}: ${failure}`);
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(f);
    console.error(`strip-site-map-excuses: ${failures.length} leaf write(s) refused; the other leaves were written`);
    return 1;
  }
  console.log(`stripped ${plans.length} leaf/leaves`);
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (e) {
  if (!(e instanceof SiteMapReadError)) throw e;
  console.error(`strip-site-map-excuses: ${e.message}`);
  process.exit(2);
}

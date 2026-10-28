// @reads assets/project/lore-config-template.yaml
/**
 * @spec_ref spec-refusal-sites-declare-their-rule-in-code-baseline-leaf  AC-RIC-3 (BR-1344)
 *
 * Throwaway repo + corpus (never the repo's own `.lore/`): a refusal site S declares BR-a; the function enclosing S is then
 * renamed and a second refusal S2 declaring BR-b is inserted ABOVE S in the same function. `lore baseline coverage --json`
 * lists S at its new file:line mapped to BR-a and S2 mapped to BR-b, neither as unmapped, and the corpus (docs, versions, audit
 * rows) is byte-count unchanged: a rename needs no corpus write.
 *
 * SIMPLEST GREEN-BUT-BROKEN CASE (asserted): a rename with no inserted sibling keeps position-ordinal keys stable, so S2 is
 * inserted above S first; a declaration keyed on the old ordinal key would then name the wrong site or none.
 */
import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildMiniCorpus, MINI_CLI, type MiniCorpus } from "../helpers/coverage-mini-corpus.js";
import { DECIDED_FLAGS } from "../helpers/decision-flags.js";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const SHARED_REL = `${MINI_CLI}/lib/shared.ts`;

interface MappedSite {
  readonly key: string;
  readonly file: string;
  readonly line: number;
  readonly rule: string;
}
interface LeafReport {
  readonly slug: string;
  readonly mapped_sites: MappedSite[];
  readonly gaps: string[];
  readonly not_measured: string[];
}

let c: MiniCorpus;
let ruleA = "";
let ruleB = "";

async function mustRun(args: string[]): Promise<string> {
  const r = await c.run(args);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${r.exitCode}: ${r.stderr}${r.stdout}`);
  return r.stdout;
}

async function leafReport(): Promise<LeafReport> {
  const out = JSON.parse(await mustRun(["baseline", "coverage", c.leafA, "--json"])) as { data: { leaves: LeafReport[] } };
  const report = out.data.leaves.find((l) => l.slug === c.leafA);
  if (report === undefined) throw new Error("leaf A missing from the coverage report");
  return report;
}

/** Row counts of the corpus tables a mapping write would touch. */
function corpusCounts(): { docs: number; versions: number; audit: number; leafVersion: number } {
  const db = new Database(join(c.dir, ".lore", "lore.db"), { readonly: true });
  try {
    const n = (sql: string): number => (db.query(sql).get() as { n: number }).n;
    return {
      docs: n("select count(*) as n from docs"),
      versions: n("select count(*) as n from versions"),
      audit: n("select count(*) as n from audit"),
      leafVersion: (db.query("select version as n from docs where slug = ?").get(c.leafA) as { n: number }).n,
    };
  } finally {
    db.close();
  }
}

const lineOf = (text: string, needle: string): number => text.split("\n").findIndex((l) => l.includes(needle)) + 1;

beforeAll(async () => {
  c = await buildMiniCorpus();
  ruleA = c.ruleOf.get(c.leafA) as string;
  const added = await mustRun(["rule", "add", c.leafA, "--statement", "A second fixture rule of leaf A holds", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "fixture example", ...DECIDED_FLAGS]);
  ruleB = added.match(/BR-\d+/)?.[0] as string;
  c.writeSource(SHARED_REL, `import { err } from "./result.js";\nexport function checkShared() {\n  return err({ code: "ALPHA_BAD", rule: "${ruleA}" });\n}\n`);
});

afterAll(() => c?.dispose());

describe("AC-RIC-3 — a rename (with an inserted sibling) needs no corpus write", () => {
  it("(1) before the edit S is mapped to BR-a at its file:line", async () => {
    const report = await leafReport();
    const text = readFileSync(join(c.dir, SHARED_REL), "utf8");
    expect(report.gaps).toEqual([]);
    expect(report.mapped_sites).toEqual([expect.objectContaining({ file: SHARED_REL, line: lineOf(text, "ALPHA_BAD"), rule: ruleA })]);
  });

  it("(2) after the rename and an inserted S2 above S, both sit at their new lines with their own rules, none unmapped, corpus unchanged", async () => {
    const before = corpusCounts();
    const edited = [
      `import { err } from "./result.js";`,
      `export function checkSharedRenamed(flag: boolean) {`,
      `  if (flag) return err({ code: "ALPHA_FIRST", rule: "${ruleB}" });`,
      `  return err({ code: "ALPHA_BAD", rule: "${ruleA}" });`,
      `}`,
      ``,
    ].join("\n");
    c.writeSource(SHARED_REL, edited);
    writeFileSync(join(c.dir, `${MINI_CLI}/commands/alpha.ts`), `import { checkSharedRenamed } from "../lib/shared.js";\nexport default { run() { return checkSharedRenamed(false); } };\n`);

    const report = await leafReport();

    expect(report.gaps).toEqual([]);
    expect(report.not_measured).toEqual([]);
    const at = (rule: string): MappedSite | undefined => report.mapped_sites.find((m) => m.rule === rule);
    expect(at(ruleA)).toMatchObject({ file: SHARED_REL, line: lineOf(edited, "ALPHA_BAD") });
    expect(at(ruleB)).toMatchObject({ file: SHARED_REL, line: lineOf(edited, "ALPHA_FIRST") });
    expect(report.mapped_sites).toHaveLength(2);
    expect(corpusCounts()).toEqual(before);
  });
});

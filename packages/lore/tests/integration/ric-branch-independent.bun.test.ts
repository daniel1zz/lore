// @spawns packages/lore/src/index.ts
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-refusal-sites-declare-their-rule-in-code-baseline-leaf  AC-RIC-7 (BR-1344)
 *
 * Throwaway repo with `lore integrate` configured and a trivial floor (see helpers/own-diff-fixture.ts; never the repo's own
 * `.lore/`): branch A adds a refusal site declaring BR-a; branch B, cut from main before A, renames the function enclosing an
 * existing site declaring BR-b. Both orders (A then B, B then A) run on fresh copies; in each both land with ZERO corpus writes
 * between claim and landing (the leaf docs' version and audit rows are unchanged, no audit row names a mapping), and afterwards
 * `lore baseline coverage --json` reports A's site mapped to BR-a and B's renamed site mapped to BR-b, none unmapped.
 *
 * SIMPLEST GREEN-BUT-BROKEN CASE (asserted): landing A after a corpus mapping write would also report it mapped; the audit and
 * version assertions rule that out.
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OwnDiffFixture } from "../helpers/own-diff-fixture.js";
import { approveFixtureNodes } from "../helpers/cli-live-rule.js";

const CLI = "packages/lore/src/adapters/cli";

interface Mapped {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
}
interface Leaf {
  readonly slug: string;
  readonly mapped_sites: Mapped[];
  readonly gaps: string[];
  readonly not_measured: string[];
}

let fx: OwnDiffFixture | undefined;
afterEach(() => {
  fx?.dispose();
  fx = undefined;
});

const slugOf = (stdout: string): string => {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (m?.[1] === undefined) throw new Error(`no slug in: ${stdout}`);
  return m[1];
};

interface Setup {
  readonly f: OwnDiffFixture;
  readonly root: string;
  readonly leafA: string;
  readonly leafB: string;
  readonly ruleA: string;
  readonly ruleB: string;
  readonly taskA: string;
  readonly taskB: string;
}

function setup(): Setup {
  const f = new OwnDiffFixture();
  fx = f;
  const prd = slugOf(f.mustLore(["create", "prd", "--title", "RIC PRD", "--content", "root", "--no-ai"]).stdout);
  const root = slugOf(f.mustLore(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "RIC Root"]).stdout);
  const branch = slugOf(f.mustLore(["baseline", "add", root, "--node", "branch", "--label", "br", "--title", "RIC Branch"]).stdout);
  const leafA = slugOf(f.mustLore(["baseline", "add", branch, "--node", "leaf", "--label", "la", "--title", "RIC Leaf A"]).stdout);
  const leafB = slugOf(f.mustLore(["baseline", "add", branch, "--node", "leaf", "--label", "lb", "--title", "RIC Leaf B"]).stdout);
  const ruleArgs = ["--confidence", "established", "--enforced-by", "guaranteed", "--example", "fixture example"];
  const ruleOf = (leaf: string): string => f.mustLore(["rule", "add", leaf, "--statement", `Fixture rule of ${leaf} holds`, ...ruleArgs]).stdout.match(/BR-\d+/)?.[0] as string;
  const ruleA = ruleOf(leafA);
  const ruleB = ruleOf(leafB);
  f.mustLore(["baseline", "map", leafA, "--command", "alpha"]);
  f.mustLore(["baseline", "map", leafB, "--command", "beta"]);
  approveFixtureNodes(f.dir, "all"); // direct adds and command declarations are pending revisions: the census measures the approved tree

  f.commitOnMain(
    {
      "package.json": JSON.stringify({ name: "ric-checkout", private: true, scripts: { install: "true", build: "true", typecheck: "true" } }),
      [`${CLI}/index.ts`]: `export const COMMAND_LOADERS = {\n  alpha: () => import("./commands/alpha.js"),\n  beta: () => import("./commands/beta.js"),\n};\n`,
      [`${CLI}/lib/result.ts`]: `export const err = (e: { code: string; rule?: string }) => ({ ok: false as const, code: e.code });\n`,
      [`${CLI}/lib/alpha.ts`]: `export function checkAlpha(): undefined {\n  return undefined;\n}\n`,
      [`${CLI}/lib/shared.ts`]: `import { err } from "./result.js";\nexport function checkShared() {\n  return err({ code: "BETA_EXISTING", rule: "${ruleB}" });\n}\n`,
      [`${CLI}/commands/alpha.ts`]: `import { checkAlpha } from "../lib/alpha.js";\nexport default { run() { return checkAlpha(); } };\n`,
      [`${CLI}/commands/beta.ts`]: `import { checkShared } from "../lib/shared.js";\nexport default { run() { return checkShared(); } };\n`,
    },
    "base checkout",
  );
  f.makeBranch("branch-a", {
    [`${CLI}/lib/alpha.ts`]: `import { err } from "./result.js";\nexport function checkAlpha() {\n  return err({ code: "ALPHA_NEW", rule: "${ruleA}" });\n}\n`,
  });
  f.makeBranch("branch-b", {
    [`${CLI}/lib/shared.ts`]: `import { err } from "./result.js";\nexport function checkSharedRenamed() {\n  return err({ code: "BETA_EXISTING", rule: "${ruleB}" });\n}\n`,
    [`${CLI}/commands/beta.ts`]: `import { checkSharedRenamed } from "../lib/shared.js";\nexport default { run() { return checkSharedRenamed(); } };\n`,
  });
  const taskA = f.createTask("A", [`${CLI}/lib/alpha.ts`]);
  const taskB = f.createTask("B", [`${CLI}/lib/shared.ts`, `${CLI}/commands/beta.ts`]);
  f.claim(taskA, "branch-a");
  f.claim(taskB, "branch-b");
  return { f, root, leafA, leafB, ruleA, ruleB, taskA, taskB };
}

/** Leaf docs' versions and the audit rows naming them: what any mapping write would change. */
function leafCorpusState(f: OwnDiffFixture, leaves: readonly string[]): { versions: number[]; auditRows: number; mappingRows: number } {
  const db = new Database(join(f.dir, ".lore", "lore.db"), { readonly: true });
  try {
    const rows = leaves.map((slug) => db.query("select id, version from docs where slug = ?").get(slug) as { id: string; version: number });
    const ids = rows.map((r) => r.id);
    const marks = ids.map(() => "?").join(",");
    const auditRows = (db.query(`select count(*) as n from audit where doc_id in (${marks})`).get(...ids) as { n: number }).n;
    const mappingRows = (db.query("select count(*) as n from audit where action like '%map%'").get() as { n: number }).n;
    return { versions: rows.map((r) => r.version), auditRows, mappingRows };
  } finally {
    db.close();
  }
}

function runBothOrders(first: "branch-a" | "branch-b"): void {
  const { f, root, leafA, leafB, ruleA, ruleB } = setup();
  const before = leafCorpusState(f, [leafA, leafB]);
  const order = first === "branch-a" ? ["branch-a", "branch-b"] : ["branch-b", "branch-a"];
  for (const branch of order) {
    const landed = f.integrate(branch);
    expect(landed.exitCode, landed.text).toBe(0);
  }
  f.git(["checkout", "-q", "--detach", "main"]);

  expect(leafCorpusState(f, [leafA, leafB])).toEqual(before);

  const cov = f.mustLore(["baseline", "coverage", root, "--json"]);
  const leaves = (JSON.parse(cov.stdout) as { data: { leaves: Leaf[] } }).data.leaves;
  const a = leaves.find((l) => l.slug === leafA) as Leaf;
  const b = leaves.find((l) => l.slug === leafB) as Leaf;
  const alphaText = f.readFile(`${CLI}/lib/alpha.ts`);
  const sharedText = f.readFile(`${CLI}/lib/shared.ts`);
  const lineOf = (text: string, needle: string): number => text.split("\n").findIndex((l) => l.includes(needle)) + 1;
  expect(a.mapped_sites).toEqual([{ key: expect.stringContaining("ALPHA_NEW"), file: `${CLI}/lib/alpha.ts`, line: lineOf(alphaText, "ALPHA_NEW"), rule: ruleA }]);
  expect(b.mapped_sites).toEqual([{ key: expect.stringContaining("checkSharedRenamed"), file: `${CLI}/lib/shared.ts`, line: lineOf(sharedText, "BETA_EXISTING"), rule: ruleB }]);
  expect([...a.gaps, ...a.not_measured, ...b.gaps, ...b.not_measured]).toEqual([]);
}

describe("AC-RIC-7 — a new or renamed site lands with no corpus write, in either landing order", () => {
  it("(1) A then B", () => runBothOrders("branch-a"), 600_000);
  it("(2) B then A", () => runBothOrders("branch-b"), 600_000);
});

// @reads packages/core/src/code-anchors.ts
// @reads packages/core/src/code-references.ts
// @reads packages/lore/src/adapters/real-fs-probe.ts
// @reads packages/lore/src/flows/drift-flow.ts
/**
 * task-drift-check-decides-exported-names-by-parsing-the-file-not (BR-417): whether an anchored
 * symbol is exported is decided by parsing the file with the TypeScript compiler API, so a valid
 * export is never reported missing, and a file the check cannot parse is reported as not measured
 * for symbol anchors, never guessed.
 *
 * Every case runs through the production wiring: `DriftCheckService.checkDrift` over the real
 * filesystem probe (`buildRealFsProbe`) rooted at a throwaway directory under the gitignored
 * `.scratch/` of this worktree.
 *
 * Six-dimension coverage:
 *   HAPPY:      `export { a as b } from './x'` and `export * from './y'` are found; multi-line, decorated,
 *               destructured, `export type { T }`, `export default` and `export * as ns` forms are found
 *   NEGATIVE:   a name that is exported nowhere is still `symbol_missing`; commented-out and string-literal
 *               text that looks like an export is not an export
 *   BOUNDARY:   a star-export cycle terminates; a star chain two files deep is followed
 *   ERROR:      a Python file, a syntax-broken file, a star re-export of a package or of an unreadable
 *               module, and a CommonJS assignment are `probe_error` "not measured", never `symbol_missing`
 *   STATE:      a name found despite an unresolvable star re-export is still verified (no false alarm)
 *   REGRESSION: the false-positive footnote is gone; the lexical scanner is gone; a probe with no export
 *               reader reports not measured instead of guessing
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { collectAnchorProbes, computeDrift, type CreateDocInput, type DriftRow } from "@lore/core";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { DriftCheckService } from "../../../src/service/drift-check-service.js";
import { buildRealFsProbe } from "../../../src/adapters/real-fs-probe.js";
import { renderDriftSectionLines } from "../../../src/flows/drift-flow.js";
import { actedStore } from "../../live-invocation.js";
import { readFileSync } from "node:fs";

mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });
const roots: string[] = [];

/** Writes `files` under a fresh root and returns the drift rows for `anchors` declared on one spec. */
async function driftFor(files: Record<string, string>, anchors: string[]): Promise<DriftRow[]> {
  const root = mkdtempSync(join(process.cwd(), ".scratch", "export-names-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const created = await corpus.create({
    type: "spec",
    title: "Export names",
    content: "body",
    extra: { code_anchors: anchors },
  } as CreateDocInput);
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`);
  const result = await new DriftCheckService(store).checkDrift(buildRealFsProbe(root));
  if (!result.ok) throw new Error("checkDrift failed");
  return result.value.drifts;
}

const kinds = (rows: DriftRow[]): string[] => rows.map((row) => `${row.anchor}:${row.kind}`);

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("HAPPY — valid export forms are never reported missing", () => {
  it("finds a name exported only through `export { a as b } from` and `export * from`", async () => {
    const rows = await driftFor(
      {
        "src/index.ts": "export { a as b } from './x.js';\nexport * from './y.js';\n",
        "src/x.ts": "export const a = 1;\n",
        "src/y.ts": "export const fromStar = 2;\n",
      },
      ["src/index.ts#b", "src/index.ts#fromStar"],
    );
    expect(rows).toEqual([]);
  });

  it("finds multi-line, decorated, destructured, type-only, default and namespace exports", async () => {
    const rows = await driftFor(
      {
        "src/m.ts": [
          "@sealed()",
          "export class Decorated {}",
          "export const {",
          "  p,",
          "  q: renamed,",
          "} = source;",
          "export const [first, ...rest] = list;",
          "export type { Only } from './t.js';",
          "export * as ns from './t.js';",
          "export async function",
          "  spread() {}",
          "export default class {}",
          "export enum Mode { A }",
          "export declare namespace Space {}",
          "",
        ].join("\n"),
        "src/t.ts": "export type Only = 1;\n",
      },
      [
        "src/m.ts#Decorated",
        "src/m.ts#p",
        "src/m.ts#renamed",
        "src/m.ts#first",
        "src/m.ts#rest",
        "src/m.ts#Only",
        "src/m.ts#ns",
        "src/m.ts#spread",
        "src/m.ts#default",
        "src/m.ts#Mode",
        "src/m.ts#Space",
      ],
    );
    expect(rows).toEqual([]);
  });
});

describe("NEGATIVE — what is not exported is still missing", () => {
  it("reports a name exported nowhere as symbol_missing even when every star target resolves", async () => {
    const rows = await driftFor(
      { "src/index.ts": "export * from './y.js';\n", "src/y.ts": "export const here = 1;\n" },
      ["src/index.ts#gone"],
    );
    expect(kinds(rows)).toEqual(["src/index.ts#gone:symbol_missing"]);
  });

  it("does not take commented-out or string-literal text for an export", async () => {
    const rows = await driftFor(
      {
        "src/c.ts": [
          "// export const Hidden = 1;",
          "/*",
          "export const Block = 1;",
          "*/",
          "const text = `",
          "export const Faked = 1;",
          "`;",
          "export const real = text;",
          "",
        ].join("\n"),
      },
      ["src/c.ts#Hidden", "src/c.ts#Block", "src/c.ts#Faked", "src/c.ts#real"],
    );
    expect(kinds(rows)).toEqual([
      "src/c.ts#Hidden:symbol_missing",
      "src/c.ts#Block:symbol_missing",
      "src/c.ts#Faked:symbol_missing",
    ]);
  });

  it("does not let `export *` carry a default export", async () => {
    const rows = await driftFor(
      { "src/index.ts": "export * from './y.js';\n", "src/y.ts": "export default 1;\n" },
      ["src/index.ts#default"],
    );
    expect(kinds(rows)).toEqual(["src/index.ts#default:symbol_missing"]);
  });
});

describe("BOUNDARY — star chains", () => {
  it("terminates on a star-export cycle and still answers", async () => {
    const rows = await driftFor(
      {
        "src/a.ts": "export * from './b.js';\nexport const inA = 1;\n",
        "src/b.ts": "export * from './a.js';\nexport const inB = 1;\n",
      },
      ["src/a.ts#inB", "src/a.ts#inA", "src/a.ts#nowhere"],
    );
    expect(kinds(rows)).toEqual(["src/a.ts#nowhere:symbol_missing"]);
  });

  it("follows a star chain through a directory index two files deep", async () => {
    const rows = await driftFor(
      {
        "src/top.ts": "export * from './mid';\n",
        "src/mid/index.ts": "export * from '../leaf.js';\n",
        "src/leaf.tsx": "export const deep = 1;\n",
      },
      ["src/top.ts#deep"],
    );
    expect(rows).toEqual([]);
  });
});

describe("ERROR — a file that cannot be parsed is not measured, never guessed", () => {
  it("reports a symbol anchor on a Python file as not measured", async () => {
    const rows = await driftFor({ "tool/run.py": "def main():\n  pass\n" }, ["tool/run.py#main"]);
    expect(kinds(rows)).toEqual(["tool/run.py#main:probe_error"]);
    expect(rows[0]?.detail).toMatch(/not measured/);
    expect(rows[0]?.detail).toMatch(/\.py/);
  });

  it("reports a syntax-broken TypeScript file as not measured", async () => {
    const rows = await driftFor({ "src/broken.ts": "export const = ;\nexport function {\n" }, ["src/broken.ts#anything"]);
    expect(kinds(rows)).toEqual(["src/broken.ts#anything:probe_error"]);
    expect(rows[0]?.detail).toMatch(/not measured/);
  });

  it("reports a name absent behind a package star re-export as not measured", async () => {
    const rows = await driftFor({ "src/index.ts": "export * from 'some-package';\n" }, ["src/index.ts#thing"]);
    expect(kinds(rows)).toEqual(["src/index.ts#thing:probe_error"]);
    expect(rows[0]?.detail).toMatch(/some-package/);
  });

  it("reports a name absent behind a star re-export of an unreadable module as not measured", async () => {
    const rows = await driftFor({ "src/index.ts": "export * from './missing.js';\n" }, ["src/index.ts#thing"]);
    expect(kinds(rows)).toEqual(["src/index.ts#thing:probe_error"]);
    expect(rows[0]?.detail).toMatch(/missing/);
  });

  it("reports a name absent from a CommonJS module as not measured", async () => {
    const rows = await driftFor({ "lib/cjs.js": "module.exports = { a: 1 };\n" }, ["lib/cjs.js#b"]);
    expect(kinds(rows)).toEqual(["lib/cjs.js#b:probe_error"]);
    expect(rows[0]?.detail).toMatch(/CommonJS/);
  });
});

describe("STATE — a found name is verified despite an unresolvable star", () => {
  it("does not raise an alarm for a name the file itself exports", async () => {
    const rows = await driftFor(
      { "src/index.ts": "export * from 'some-package';\nexport const own = 1;\n" },
      ["src/index.ts#own"],
    );
    expect(rows).toEqual([]);
  });

  it("verifies a plain JavaScript ES module export and a CommonJS named assignment", async () => {
    const rows = await driftFor(
      { "lib/esm.js": "export function run() {}\n", "lib/cjs.js": "exports.helper = () => 1;\n" },
      ["lib/esm.js#run", "lib/cjs.js#helper"],
    );
    expect(rows).toEqual([]);
  });
});

describe("REGRESSION — the text scan and its disclaimer are gone", () => {
  it("prints no false-positive footnote under a symbol_missing row", () => {
    const lines = renderDriftSectionLines({
      armed: true,
      enabled: true,
      consistent: false,
      specs_checked: 1,
      knowledge_checked: 0,
      status_breakdown: { draft: 1 },
      drifts: [
        { doc_id: "x", doc_slug: "spec-x", doc_type: "spec", doc_status: "draft", anchor: "a.ts#Gone", kind: "symbol_missing" },
      ],
    });
    const text = lines.join("\n");
    expect(text).toContain("symbol_missing");
    expect(text).not.toMatch(/lexical|false positive/i);
  });

  it("no longer exports the lexical scanner", () => {
    const source = readFileSync(join(process.cwd(), "packages/core/src/code-anchors.ts"), "utf8");
    expect(source).not.toContain("scanExportedSymbols");
  });

  it("reports not measured when the probe has no export reader, instead of guessing", () => {
    const probe = {
      stat: () => "file" as const,
      readFile: () => "export const Foo = 1;\n",
      listDir: () => null,
    };
    const anchor = { raw: "a.ts#Foo", path: "a.ts", isDir: false, symbol: "Foo" };
    const probes = collectAnchorProbes([anchor], probe);
    const { drifts } = computeDrift(
      [{ doc_id: "1", doc_slug: "spec-x", doc_type: "spec", doc_status: "draft", anchor }],
      probes,
    );
    expect(drifts.map((d) => d.kind)).toEqual(["probe_error"]);
    expect(drifts[0]?.detail).toMatch(/not measured/);
  });
});

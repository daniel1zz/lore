// @reads packages/lore/tests/fixtures/site-census-fidelity/**
// @layer service-leaf-coverage AC-BLS2-15
/**
 * computeLeafCoverage treats a census with unresolved imports as INCOMPLETE (issue #94):
 * never a smaller site list presented as complete.
 * @spec_ref AC-BLS2-15
 */
import { describe, it, expect, afterAll } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeLeafCoverage } from "../../../src/service/leaf-coverage.js";

// a site whose code declares BR-1 (BR-1344)
const site = { key: "a.ts#f#X", file: "a.ts", symbol: "f", code: "X", dynamic: false, line: 3, column: 10, rules: ["BR-1"], predicates: [] } as const;

describe("computeLeafCoverage with unresolved imports (#94)", () => {
  it("is NOT ok and names the specifier and importing file, even when every site is mapped", () => {
    const r = computeLeafCoverage({
      sites: [site],
      liveRuleIds: ["BR-1"],
      unresolvedImports: [{ specifier: "@lore/core", from: "x/y.ts" }],
    });
    expect(r.ok).toBe(false);
    expect(r.unresolvedImports).toEqual(["@lore/core (from x/y.ts)"]);
    expect(r.gaps).toEqual([]);
    expect(r.mapped).toEqual([{ key: "a.ts#f#X", file: "a.ts", line: 3, rule: "BR-1" }]);
  });

  it("stays ok, with no unresolvedImports key, when none are reported (control)", () => {
    const r = computeLeafCoverage({ sites: [site], liveRuleIds: ["BR-1"], unresolvedImports: [] });
    expect(r).toEqual({ mapped: [{ key: "a.ts#f#X", file: "a.ts", line: 3, rule: "BR-1" }], gaps: [], notMeasured: [], conflicts: [], invalid: [], generic: [], ok: true });
  });
});

// Census side: a relative import of a missing NON-CODE asset (build artefact such as dashboard/dist/index.html)
// holds no error sites, so it must not make coverage incomplete; a missing relative CODE import still must.
describe("census unresolved-import report vs missing relative assets (#94 follow-up)", () => {
  const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/site-census-fidelity");
  const ENTRY = { file: "packages/app/src/cli.ts", symbol: "runCli" };
  const scratch: string[] = [];
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  async function unresolvedWith(importLines: string[]): Promise<string[]> {
    // realpath: macOS /var -> /private/var; a symlinked tmp root would drop sites for reasons unrelated to the census.
    const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "leaf-unresolved-")));
    scratch.push(base);
    const root = path.join(base, "repo");
    cpSync(FIXTURE, root, { recursive: true });
    mkdirSync(path.join(root, "node_modules/@fx"), { recursive: true });
    symlinkSync(path.join(root, "packages/core"), path.join(root, "node_modules/@fx/core"), "dir");
    const cli = path.join(root, ENTRY.file);
    writeFileSync(cli, `${importLines.join("\n")}\n${readFileSync(cli, "utf8")}`);
    const census = await import("../../../src/service/site-census.js");
    const trace = census.traceCensus({ rootDir: root, entry: ENTRY });
    return (trace.unresolvedImports ?? []).map((u: { specifier: string }) => u.specifier);
  }

  it("does not report a missing relative .html / .css import", async () => {
    expect(await unresolvedWith(['import "./missing.html";', 'import "./x.css";'])).toEqual([]);
  }, 120_000);

  it("still reports a missing relative code import (.js and extensionless)", async () => {
    const got = await unresolvedWith(['import "./gone.js";', 'import "./nope";']);
    expect([...got].sort()).toEqual(["./gone.js", "./nope"]);
  }, 120_000);

  it("still reports a missing dotted code name and an unknown extension (no silent drop)", async () => {
    const got = await unresolvedWith(['import "./foo.service";', 'import "./thing.weird";']);
    expect([...got].sort()).toEqual(["./foo.service", "./thing.weird"]);
  }, 120_000);

  it("still reports a missing bare package specifier", async () => {
    expect(await unresolvedWith(['import "left-pad-nonexistent";'])).toEqual(["left-pad-nonexistent"]);
  }, 120_000);
});

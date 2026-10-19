// @reads package.json
// @reads packages/**
// @reads tsconfig.json
/**
 * RED-first test: the many-entry census equals the per-command census (AC-BCR-1).
 *
 * `traceCensusMany` / `listSitesMany` build ONE program for many entries and walk each entry within its own import
 * closure. For every entry the result must equal the per-entry program's: sites, bootstrap, unresolvedImports and
 * reached. The fixture binds `Service.deps.now` differently in the two entries' closures, so a shared program WITHOUT
 * closure scoping must visibly differ (the falsifying case).
 *
 * @spec_ref AC-BCR-1
 */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSites, listSitesMany, resolveCommandEntry, traceCensus, traceCensusMany } from "../../../src/service/site-census.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../../..");
const FIXTURE_ROOT = path.resolve(HERE, "../../fixtures/site-census-many");
const ENTRIES = [
  { file: "cmd-a.ts", symbol: "runA" },
  { file: "cmd-b.ts", symbol: "runB" },
];

const keysOf = (sites: readonly { key: string }[]): string[] => sites.map((s) => s.key);

describe("AC-BCR-1: many-entry census over the fixture workspace", () => {
  const single = ENTRIES.map((entry) => traceCensus({ rootDir: FIXTURE_ROOT, entry }));

  it("the per-entry census sees each closure's own binding (premise of the fixture)", () => {
    expect(keysOf(single[0]!.sites)).toContain("lib.ts#Service.run#SHARED_REFUSAL");
    expect(keysOf(single[0]!.sites)).toContain("impl-a.ts#nowA#A_ONLY");
    expect(keysOf(single[0]!.sites)).not.toContain("impl-b.ts#nowB#B_ONLY");
    expect(keysOf(single[1]!.sites)).toContain("impl-b.ts#nowB#B_ONLY");
    expect(keysOf(single[1]!.sites)).not.toContain("impl-a.ts#nowA#A_ONLY");
    expect(single[0]!.unresolvedImports).toEqual([]);
    expect(single[1]!.unresolvedImports.map((u) => u.specifier)).toEqual(["./missing-module.js"]);
  });

  it("closure-scoped many-entry census returns exactly the per-entry traces", () => {
    const many = traceCensusMany({ rootDir: FIXTURE_ROOT, entries: ENTRIES });
    expect(many).toEqual(single);
  });

  it("a shared program WITHOUT closure scoping differs on the fixture (falsifying case)", () => {
    const unscoped = traceCensusMany({ rootDir: FIXTURE_ROOT, entries: ENTRIES, closureScoped: false });
    expect(unscoped).not.toEqual(single);
    // entry A leaks entry B's binding when the whole program is visible
    expect(keysOf(unscoped[0]!.sites)).toContain("impl-b.ts#nowB#B_ONLY");
    // and the unresolved import of B's closure leaks into A
    expect(unscoped[0]!.unresolvedImports.map((u) => u.specifier)).toEqual(["./missing-module.js"]);
  });

  it("an unknown entry file or symbol fails loudly, as the per-entry census does", () => {
    expect(() => traceCensusMany({ rootDir: FIXTURE_ROOT, entries: [{ file: "nope.ts", symbol: "x" }] })).toThrow(/entry-file-missing/);
    expect(() => traceCensusMany({ rootDir: FIXTURE_ROOT, entries: [{ file: "cmd-a.ts", symbol: "nope" }] })).toThrow(/entry-symbol-missing/);
    expect(traceCensusMany({ rootDir: FIXTURE_ROOT, entries: [] })).toEqual([]);
  });
});

describe("AC-BCR-1: listSitesMany over the real commands", () => {
  const commands = ["claim", "done", "verify", "approve", "baseline map"];

  it("returns, per command, the sites, bootstrap and unresolvedImports listSites returns", () => {
    const many = listSitesMany({ rootDir: REPO_ROOT, commands: [...commands, "claim"] });
    expect([...many.keys()]).toEqual(commands); // a repeated command is censused once
    for (const command of commands) {
      const alone = listSites({ rootDir: REPO_ROOT, entry: resolveCommandEntry({ rootDir: REPO_ROOT, command }) });
      const shared = many.get(command)!;
      expect(keysOf(shared), command).toEqual(keysOf(alone));
      expect([...shared], command).toEqual([...alone]);
      expect(shared.bootstrap, command).toEqual(alone.bootstrap);
      expect(shared.unresolvedImports, command).toEqual(alone.unresolvedImports);
    }
  }, 240_000);
});

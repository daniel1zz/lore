/**
 * RED test: the site census follows functions passed by dependency injection (issue #104).
 *
 * Spec (SPEC-157 AC-BLS2-20, BR-659, BR-660):
 *   - a refusal site reachable from a command through an injected function is LISTED, or
 *   - when the injected call cannot be resolved to one implementation it is reported as NOT
 *     MEASURED (a dynamic site -> `notMeasured` in leaf coverage), which makes coverage incomplete.
 *   - never a silent omission.
 *
 * Site-key format (see site-census-fidelity.test.ts): `file#symbol#code#field`; a dynamic site is
 * `file#symbol#dynamic:<label>` with `dynamic: true`.
 *
 * Fixtures are written inline into a scratch dir (single package, relative imports, no workspaces).
 * Case 1 runs against the real repo source: `uat record` reaches CorpusService.createUatDoc /
 * store.addLink only through UatServiceDeps function-typed properties bound in app.ts.
 *
 * @spec_ref AC-BLS2-20
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeLeafCoverage } from "../../../src/service/leaf-coverage.js";
import { resolveCommandEntry, traceCensus, type Site } from "../../../src/service/site-census.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Write `files` (relative path -> content) under a fresh realpath'd scratch root and return the root. */
function fixture(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "site-census-injection-")));
  scratch.push(root);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "injection-fixture", private: true }));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  return root;
}

function census(root: string): ReturnType<typeof traceCensus> {
  return traceCensus({ rootDir: root, entry: { file: "cmd.ts", symbol: "runCmd" } });
}

const RESULT_PRELUDE = `export type Res = { ok: boolean; code?: string };
export const err = (e: { code: string; field?: string }): Res => ({ ok: false, code: e.code });
`;

describe("census follows injected functions (#104)", () => {
  // --- case 1: real repo source -------------------------------------------------------------
  describe("real repo: `uat record`", () => {
    const keys = (): string[] => {
      const entry = resolveCommandEntry({ rootDir: REPO_ROOT, command: "uat record" });
      return traceCensus({ rootDir: REPO_ROOT, entry }).sites.map((s) => s.key);
    };

    it("lists CorpusService._createImpl's extra.sub_type refusal reached via injected createUatDoc", () => {
      const hits = keys().filter((k) =>
        k.startsWith("packages/lore/src/service/corpus-service.ts#CorpusService._createImpl#VALIDATION_ERROR#extra.sub_type"),
      );
      expect(hits.length).toBeGreaterThanOrEqual(1);
    }, 120_000);

    it("lists a store insertWithProvenance refusal site reached via injected createUatDoc", () => {
      const hits = keys().filter((k) => /^packages\/lore\/src\/store\/[^#]+#[^#]*insertWithProvenance#[A-Z_]+/.test(k));
      expect(hits.length).toBeGreaterThanOrEqual(1);
    }, 120_000);

    it("lists a store addLink refusal site reached via injected addLink", () => {
      const hits = keys().filter((k) => /^packages\/lore\/src\/store\/[^#]+#[^#]*addLink#[A-Z_]+/.test(k));
      expect(hits.length).toBeGreaterThanOrEqual(1);
    }, 120_000);

    it("still lists the directly-called UatService.record plan refusal (control: the walk was not broken)", () => {
      expect(keys()).toContain("packages/lore/src/service/uat-service.ts#UatService.record#VALIDATION_ERROR#plan");
    }, 120_000);
  });

  // --- case 2: fixture, injected function resolves to ONE implementation ---------------------
  describe("fixture: injected function with a single implementation", () => {
    // The service only sees a function-typed property; the one function ever bound to it lives in impl.ts.
    const service = `import type { Res } from "./res.js";
export interface Deps { readonly create: (n: number) => Res }
export class Svc {
  constructor(private readonly deps: Deps) {}
  go(n: number): Res { return this.deps.create(n); }
}
`;
    const cmdFor = (wiring: string): string => `import { Svc } from "./svc.js";
${wiring}
export function runCmd(n: number) { return svc.go(n); }
`;

    it("lists the implementation's err site when the property is bound via `obj.method.bind(obj)`", () => {
      const root = fixture({
        "res.ts": RESULT_PRELUDE,
        "svc.ts": service,
        "impl.ts": `import { err, type Res } from "./res.js";
export class Creator {
  create(n: number): Res {
    if (n < 0) return err({ code: "NEG_REFUSED", field: "n" });
    return { ok: true };
  }
}
`,
        "cmd.ts": cmdFor(`import { Creator } from "./impl.js";
const creator = new Creator();
const svc = new Svc({ create: creator.create.bind(creator) });`),
      });
      expect(census(root).sites.map((s) => s.key)).toEqual(["impl.ts#Creator.create#NEG_REFUSED#n"]);
    });

    it("lists the implementation's err site when the property is bound to a plain function reference", () => {
      const root = fixture({
        "res.ts": RESULT_PRELUDE,
        "svc.ts": service,
        "impl.ts": `import { err, type Res } from "./res.js";
export function makeThing(n: number): Res {
  if (n > 9) return err({ code: "TOO_BIG_REFUSED", field: "n" });
  return { ok: true };
}
`,
        "cmd.ts": cmdFor(`import { makeThing } from "./impl.js";
const svc = new Svc({ create: makeThing });`),
      });
      expect(census(root).sites.map((s) => s.key)).toEqual(["impl.ts#makeThing#TOO_BIG_REFUSED#n"]);
    });

    it("yields a different site list for a different implementation (not a baked-in answer)", () => {
      const root = fixture({
        "res.ts": RESULT_PRELUDE,
        "svc.ts": service,
        "impl.ts": `import { err, type Res } from "./res.js";
export function otherThing(n: number): Res {
  if (n === 7) return err({ code: "SEVEN_REFUSED" });
  return { ok: true };
}
`,
        "cmd.ts": cmdFor(`import { otherThing } from "./impl.js";
const svc = new Svc({ create: otherThing });`),
      });
      expect(census(root).sites.map((s) => s.key)).toEqual(["impl.ts#otherThing#SEVEN_REFUSED"]);
    });
  });

  // --- case 3: fixture, no single resolvable implementation ----------------------------------
  describe("fixture: injected function with no single resolvable implementation", () => {
    // Two different functions are bound to the same injected property in two places, and the
    // command picks at run time: the declared type does not resolve to ONE implementation.
    const files = (): Record<string, string> => ({
      "res.ts": RESULT_PRELUDE,
      "svc.ts": `import type { Res } from "./res.js";
export interface Deps { readonly create: (n: number) => Res }
export class Svc {
  constructor(private readonly deps: Deps) {}
  go(n: number): Res { return this.deps.create(n); }
}
`,
      "impl.ts": `import { err, type Res } from "./res.js";
export function createA(n: number): Res { return n < 0 ? err({ code: "A_REFUSED" }) : { ok: true }; }
export function createB(n: number): Res { return n > 0 ? err({ code: "B_REFUSED" }) : { ok: true }; }
`,
      "cmd.ts": `import { Svc } from "./svc.js";
import { createA, createB } from "./impl.js";
export function runCmd(n: number, useA: boolean) {
  const svc = useA ? new Svc({ create: createA }) : new Svc({ create: createB });
  return svc.go(n);
}
`,
    });

    it("reports the unresolvable injected call as a dynamic (not measured) site in svc.ts, never silently absent", () => {
      const sites: Site[] = census(fixture(files())).sites;
      const dyn = sites.filter((s) => s.dynamic && s.file === "svc.ts" && s.symbol === "Svc.go");
      expect(dyn).toHaveLength(1);
    });

    it("makes leaf coverage incomplete: the unresolved injected call lands in notMeasured", () => {
      const trace = census(fixture(files()));
      const cov = computeLeafCoverage({
        sites: trace.sites,
        bootstrap: trace.bootstrap,
        unresolvedImports: trace.unresolvedImports,
        siteMap: Object.fromEntries(trace.sites.filter((s) => !s.dynamic).map((s) => [s.key, ["non-business:fixture"]])),
        liveRuleIds: [],
      });
      expect({ ok: cov.ok, notMeasuredInSvc: cov.notMeasured.filter((k) => k.startsWith("svc.ts#Svc.go#dynamic:")).length }).toEqual({
        ok: false,
        notMeasuredInSvc: 1,
      });
    });

    it("does not guess: neither candidate implementation's refusal is claimed as a measured site", () => {
      const keys = census(fixture(files())).sites.filter((s) => !s.dynamic).map((s) => s.key);
      // Either both are listed (every candidate is reachable) or neither is guessed; listing exactly one would be a guess.
      expect(keys.filter((k) => k.startsWith("impl.ts#create")).length % 2).toBe(0);
    });
  });
});

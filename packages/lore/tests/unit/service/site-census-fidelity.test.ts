/**
 * RED test: census fidelity — completeness (non-err refusals, field-distinct keys) and
 * determinism (keys independent of node_modules layout). Issues #59 and #60.
 *
 * Pinned site-key format (the contract these tests encode):
 *   `file#symbol#code#field`
 *   - file    : source file relative to rootDir, `/`-separated; for a workspace package it is the
 *               file's path INSIDE the analysed repo (packages/<dir>/...), never a node_modules or
 *               out-of-root path.
 *   - symbol  : enclosing named function (unchanged), e.g. `Service.check`.
 *   - code    : the error code literal.
 *   - field   : the literal `field` of the refusal when it is a string literal; an ORDINAL
 *               (decimal digits, distinct per site inside one symbol+code) when `field` is
 *               non-literal. A refusal with no `field` key carries no 4th segment.
 *
 * Fixture: packages/lore/tests/fixtures/site-census-fidelity/ — a mini workspace repo whose
 * @fx/core package refuses with a plain `{ ok: false, error: { code, field } }` literal (no err()),
 * whose CLI handler builds a USAGE_ERROR object typed as the product error, and whose service has
 * two same-code err() calls with fields "a" / "b".
 *
 * Covers HAPPY (sites seen) / NEGATIVE (no collapse) / STATE (layout independence).
 * @spec_ref AC-BLS2-15
 */
import { describe, it, expect, afterAll } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Site {
  key: string;
  file: string;
  symbol: string;
  code?: string;
  dynamic: boolean;
}
interface CensusApi {
  listSites(input: { rootDir: string; entry: { file: string; symbol: string } }): Site[];
}

// Variable specifier: keeps the file typecheck-clean regardless of the module's export surface.
const CENSUS_MODULE = "../../../src/service/site-census.js";
async function loadCensus(): Promise<CensusApi> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ CENSUS_MODULE)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`MISSING BEHAVIOUR: ${CENSUS_MODULE} not loadable (${String(e)})`);
  }
  if (typeof mod["listSites"] !== "function") {
    throw new Error(`MISSING BEHAVIOUR: ${CENSUS_MODULE} does not export listSites`);
  }
  return mod as unknown as CensusApi;
}

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures/site-census-fidelity");
const ENTRY = { file: "packages/app/src/cli.ts", symbol: "runCli" };

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  // realpath: macOS /var -> /private/var; a symlinked tmp root would drop sites for reasons unrelated to the census.
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "site-census-fidelity-")));
  scratch.push(dir);
  return dir;
}

/** Layout (a): node_modules/@fx/core -> the workspace package INSIDE the analysed root. */
function layoutInsideRoot(): string {
  const root = path.join(tmp(), "repo");
  cpSync(FIXTURE, root, { recursive: true });
  mkdirSync(path.join(root, "node_modules/@fx"), { recursive: true });
  symlinkSync("../../packages/fxcore", path.join(root, "node_modules/@fx/core"));
  return root;
}

/** Layout (b): node_modules/@fx/core -> a COPY of the package OUTSIDE the analysed root (a worktree whose links point at main). */
function layoutOutsideRoot(): string {
  const base = tmp();
  const root = path.join(base, "repo");
  cpSync(FIXTURE, root, { recursive: true });
  const outside = path.join(base, "elsewhere", "fxcore");
  cpSync(path.join(FIXTURE, "packages/fxcore"), outside, { recursive: true });
  mkdirSync(path.join(root, "node_modules/@fx"), { recursive: true });
  symlinkSync(outside, path.join(root, "node_modules/@fx/core"));
  return root;
}

async function keysAt(root: string): Promise<string[]> {
  const { listSites } = await loadCensus();
  return listSites({ rootDir: root, entry: ENTRY }).map((s) => s.key);
}

describe("census completeness (#59)", () => {
  it("reports the non-err refusal literal in a core pure function as a site", async () => {
    const keys = await keysAt(layoutInsideRoot());
    expect(keys).toContain("packages/fxcore/src/validate.ts#validateX#VALIDATION_ERROR#x");
  });

  it("reports the CLI usage-error object typed as the product error as a site", async () => {
    const keys = await keysAt(layoutInsideRoot());
    expect(keys.filter((k) => k.startsWith("packages/app/src/cli.ts#runCli#USAGE_ERROR"))).toHaveLength(1);
  });

  it("gives two same-code err() calls with fields a and b two distinct keys ending #a and #b", async () => {
    const keys = (await keysAt(layoutInsideRoot())).filter((k) =>
      k.startsWith("packages/app/src/service.ts#Service.check#VALIDATION_ERROR"),
    );
    expect(keys.map((k) => k.slice(k.lastIndexOf("#"))).sort()).toEqual(["#a", "#b"]);
  });

  it("keys the core err() site with its literal field, so literal fields are read from core too", async () => {
    const keys = await keysAt(layoutInsideRoot());
    expect(keys).toContain("packages/fxcore/src/validate.ts#validateY#RANGE_ERROR#y");
  });

  it("gives two same-code err() calls with NON-literal fields two distinct ordinal-suffixed keys", async () => {
    const keys = (await keysAt(layoutInsideRoot())).filter((k) =>
      k.startsWith("packages/app/src/service.ts#Service.checkDynamic#VALIDATION_ERROR#"),
    );
    const ordinals = keys.map((k) => k.split("#")[3]);
    expect(ordinals.every((o) => o !== undefined && /^\d+$/.test(o))).toBe(true);
    expect(new Set(ordinals).size).toBe(2);
  });

  it("does not collapse the three distinct VALIDATION_ERROR refusals of different symbols/fields into one key", async () => {
    const keys = (await keysAt(layoutInsideRoot())).filter((k) => k.includes("#VALIDATION_ERROR"));
    // x (core literal), a, b (service.check), two ordinals (service.checkDynamic)
    expect(keys).toHaveLength(5);
  });
});

describe("census determinism across node_modules layouts (#60)", () => {
  it("yields byte-identical key lists when @fx/core resolves inside vs outside the analysed root", async () => {
    const inside = await keysAt(layoutInsideRoot());
    const outside = await keysAt(layoutOutsideRoot());
    expect(JSON.stringify(outside)).toBe(JSON.stringify(inside));
  });

  it("still lists the core sites when @fx/core resolves outside the analysed root (no silent drop)", async () => {
    const outside = await keysAt(layoutOutsideRoot());
    expect(outside).toContain("packages/fxcore/src/validate.ts#validateX#VALIDATION_ERROR#x");
  });

  it("never emits a key whose file escapes the analysed root or sits under node_modules", async () => {
    const outside = await keysAt(layoutOutsideRoot());
    const file = (k: string): string => k.split("#")[0] ?? "";
    expect(outside.filter((k) => file(k).startsWith("..") || file(k).includes("node_modules") || path.isAbsolute(file(k)))).toEqual([]);
  });
});

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
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

// ---------------------------------------------------------------------------------------------
// Issue #94: the census must reach standalone-const subcommands and must not present an
// unresolved cross-package import as a complete (smaller) site list.
// Real repo root = this checkout (the worktree); commands are the real CLI command files.
// ---------------------------------------------------------------------------------------------
interface TraceApi {
  resolveCommandEntry(input: { rootDir: string; command: string }): { file: string; symbol: string };
  traceCensus(input: { rootDir: string; entry: { file: string; symbol: string } }): {
    sites: Site[];
    unresolvedImports?: unknown;
  };
}
async function loadTrace(): Promise<TraceApi> {
  const mod = (await import(/* @vite-ignore */ CENSUS_MODULE)) as Record<string, unknown>;
  return mod as unknown as TraceApi;
}
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

async function sitesOfCommand(command: string): Promise<Site[]> {
  const api = await loadTrace();
  const entry = api.resolveCommandEntry({ rootDir: REPO_ROOT, command });
  return api.traceCensus({ rootDir: REPO_ROOT, entry }).sites;
}

describe("census reaches standalone-const subcommands (#94)", () => {
  // Each subcommand's `run` is on a top-level const (recordCommand, syncSetup, agentCreate, ...),
  // not an inline `default.subCommands.<x>.run`. The census must still return its refusal sites
  // rather than throwing census:entry-symbol-missing.
  // `sync push`, not `sync status`: status has no business refusal site (only bootstrap sites), so "> 0" was unsatisfiable.
  it.each(["uat record", "uat show", "eval migration", "sync setup", "sync push", "agent create"])(
    "`%s` resolves to a measurable entry and reports > 0 refusal sites",
    async (command) => {
      const sites = await sitesOfCommand(command);
      expect(sites.length).toBeGreaterThan(0);
    },
    120_000,
  );

  it("`uat record` includes the known UatService VALIDATION_ERROR field=plan refusal (non-plan target)", async () => {
    const keys = (await sitesOfCommand("uat record")).map((s) => s.key);
    expect(keys.filter((k) => k.startsWith("packages/lore/src/service/uat-service.ts#") && k.endsWith("#VALIDATION_ERROR#plan"))).toHaveLength(1);
  }, 120_000);

  it("different standalone-const subcommands yield different site sets (not one shared stub)", async () => {
    const uat = (await sitesOfCommand("uat record")).map((s) => s.key);
    const agent = (await sitesOfCommand("agent create")).map((s) => s.key);
    expect(JSON.stringify(uat)).not.toBe(JSON.stringify(agent));
  }, 120_000);

  it("`issue adopt` (inline subcommand, no standalone const) still resolves with sites", async () => {
    const sites = await sitesOfCommand("issue adopt");
    expect(sites.length).toBeGreaterThan(0);
  }, 120_000);

  it("a subcommand that does not exist is still refused, not silently measured as empty", async () => {
    await expect(sitesOfCommand("uat nosuchsub")).rejects.toMatchObject({ reason: "entry-symbol-missing" });
  }, 120_000);
});

describe("unresolved cross-package imports are reported as not measured (#94)", () => {
  /** A root whose workspace manifest declares no workspaces and has no node_modules: `@fx/core` cannot resolve. */
  function layoutUnresolvable(): string {
    const root = path.join(tmp(), "repo");
    cpSync(FIXTURE, root, { recursive: true });
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "no-workspaces-fixture", private: true }));
    return root;
  }

  it("never returns a bare smaller site list: it throws a SiteCensusError or lists the unresolved import", async () => {
    const api = await loadTrace();
    const full = api.traceCensus({ rootDir: layoutInsideRoot(), entry: ENTRY });
    let outcome: { sites: Site[]; unresolvedImports?: unknown } | undefined;
    let thrown: unknown;
    try {
      outcome = api.traceCensus({ rootDir: layoutUnresolvable(), entry: ENTRY });
    } catch (e) {
      thrown = e;
    }
    // Sanity: the unresolvable layout really loses the core sites (otherwise the test proves nothing).
    if (outcome !== undefined) expect(outcome.sites.length).toBeLessThan(full.sites.length);
    const reported =
      thrown !== undefined
        ? (thrown as { name?: string }).name === "SiteCensusError"
        : Array.isArray(outcome?.unresolvedImports) && (outcome?.unresolvedImports as unknown[]).length > 0;
    expect(reported).toBe(true);
  });

  it("names the unresolved specifier `@fx/core` in the report", async () => {
    const api = await loadTrace();
    let text: string;
    try {
      text = JSON.stringify(api.traceCensus({ rootDir: layoutUnresolvable(), entry: ENTRY }).unresolvedImports ?? null);
    } catch (e) {
      text = String(e) + JSON.stringify((e as { context?: unknown }).context ?? {});
    }
    expect(text).toContain("@fx/core");
  });

  it("reports an EMPTY unresolved list when every cross-package import resolves", async () => {
    const api = await loadTrace();
    const trace = api.traceCensus({ rootDir: layoutInsideRoot(), entry: ENTRY });
    expect(trace.unresolvedImports).toEqual([]);
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

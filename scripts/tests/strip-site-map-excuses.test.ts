// @spawns scripts/strip-site-map-excuses.ts
// @spawns scripts/count-site-map-excuses.ts
// @spawns packages/lore/src/index.ts
/**
 * AC-BCG-4 (spec-baseline-coverage-refuses-only-undeclared-commands-a-site): `scripts/strip-site-map-excuses.ts` removes every
 * non-BR site_map value through `lore baseline map` (one version per changed leaf), keeps BR-n values byte-identical and approved
 * leaves approved, makes zero write calls on a second run, and refuses (exit 1, naming leaf/site/value, nothing written) a mixed
 * entry whose BR-n is retired. `scripts/count-site-map-excuses.ts` exits 1 before the strip and 0 after.
 *
 * Fixture: the throwaway mini corpus of coverage-mini-corpus (never this repo's `.lore/`). Free text is seeded straight into the
 * throwaway db (seed-site-map-value) because the write verb refuses it. The scripts run as real processes with cwd = the
 * fixture and `--lore` pointing at a logging wrapper, so "zero calls" and "one call per leaf" are measured from the log.
 * Dimensions: HAPPY (strip + count), BOUNDARY (clean leaf untouched, mixed entry kept as its BR-n), STATE (approved stays
 * approved, version +1 per changed leaf), ERROR (retired kept BR-n), REGRESSION (second run is a no-op).
 *
 * @spec_ref spec-baseline-coverage-refuses-only-undeclared-commands-a-site#AC-BCG-4
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMiniCorpus, type MiniCorpus } from "../../packages/lore/tests/helpers/coverage-mini-corpus";
import { seedSiteMapValue } from "../../packages/lore/tests/helpers/seed-site-map-value";
import { sessionEnvFor } from "../../packages/lore/tests/helpers/session-actor";

const REPO_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const STRIP = join(REPO_ROOT, "scripts", "strip-site-map-excuses.ts");
const COUNT = join(REPO_ROOT, "scripts", "count-site-map-excuses.ts");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const RULE_ARGS = ["--confidence", "established", "--enforced-by", "guaranteed", "--example", "fixture example"];

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn();
});

interface Fixture {
  readonly c: MiniCorpus;
  readonly lore: string;
  readonly callLog: string;
  readonly env: NodeJS.ProcessEnv;
}

/** A logging `lore` wrapper: appends its argv to the call log, then runs the source entry. */
function makeWrapper(): { lore: string; callLog: string } {
  const dir = mkdtempSync(join(tmpdir(), "strip-wrapper-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const callLog = join(dir, "calls.log");
  const lore = join(dir, "lore-wrapper.sh");
  writeFileSync(lore, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${callLog}"\nexec bun run "${LORE_ENTRY}" "$@"\n`);
  chmodSync(lore, 0o755);
  return { lore, callLog };
}

async function fixture(): Promise<Fixture> {
  const c = await buildMiniCorpus();
  cleanup.push(() => c.dispose());
  const { lore, callLog } = makeWrapper();
  const env = { ...process.env, HOME: join(c.dir, ".home"), CLAUDECODE: "1", ...sessionEnvFor("bcg") };
  return { c, lore, callLog, env };
}

function runScript(f: Fixture, script: string, extra: string[] = []): { status: number; out: string } {
  const r = spawnSync("bun", [script, "--lore", f.lore, ...extra], { cwd: f.c.dir, env: f.env, encoding: "utf8" });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

function writeCalls(f: Fixture): string[] {
  if (!existsSync(f.callLog)) return [];
  return readFileSync(f.callLog, "utf8").split("\n").filter((l) => l.startsWith("baseline map"));
}

interface Node {
  version: number;
  status: string;
  siteMap: Record<string, string[]>;
  ruleIds: string[];
}

async function nodeOf(c: MiniCorpus, slug: string): Promise<Node> {
  const r = await c.run(["get", slug, "--json"]);
  if (r.exitCode !== 0) throw new Error(r.stderr + r.stdout);
  const doc = (JSON.parse(r.stdout) as { data: { doc: { version: number; status: string; extra: { site_map?: Record<string, string[]>; rules: { id: string }[] } } } }).data.doc;
  return { version: doc.version, status: doc.status, siteMap: doc.extra.site_map ?? {}, ruleIds: doc.extra.rules.map((x) => x.id) };
}

async function must(c: MiniCorpus, args: string[]): Promise<string> {
  const r = await c.run(args);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

/** Leaf A: clean site, pure-excuse site, mixed site (approved). Leaf B: one clean site only. Returns the BR ids used. */
async function seedCorpus(f: Fixture): Promise<{ ruleA: string; ruleA2: string; ruleB: string }> {
  const { c } = f;
  const a = await nodeOf(c, c.leafA);
  const b = await nodeOf(c, c.leafB);
  const ruleA = a.ruleIds[0] as string;
  const ruleB = b.ruleIds[0] as string;
  const added = await must(c, ["rule", "add", c.leafA, "--statement", "Second fixture rule of leaf A holds", ...RULE_ARGS]);
  const ruleA2 = added.match(/BR-\d+/)?.[0] as string;
  await must(c, ["baseline", "map", c.leafA, "--site", "a.ts#clean#E", "--rule", ruleA]);
  await must(c, ["baseline", "map", c.leafB, "--site", "b.ts#clean#E", "--rule", ruleB]);
  seedSiteMapValue(c, c.leafA, "a.ts#excuse#E", "non-business: seeded excuse");
  seedSiteMapValue(c, c.leafA, "a.ts#mixed#E", [ruleA, ruleA2, "non-business: mixed excuse"]);
  return { ruleA, ruleA2, ruleB };
}

describe("AC-BCG-4 strip-site-map-excuses", () => {
  it("strips every non-BR value, keeps BR-n values, one write call and one version per changed leaf, approval kept", async () => {
    const f = await fixture();
    const { ruleA, ruleA2, ruleB } = await seedCorpus(f);
    await must(f.c, ["approve", f.c.leafA]);
    const beforeA = await nodeOf(f.c, f.c.leafA);
    const beforeB = await nodeOf(f.c, f.c.leafB);
    expect(beforeA.status).toBe("approved");

    expect(runScript(f, COUNT).status).toBe(1);

    const r = runScript(f, STRIP);
    expect(r.status, r.out).toBe(0);

    const afterA = await nodeOf(f.c, f.c.leafA);
    const afterB = await nodeOf(f.c, f.c.leafB);
    expect(afterA.siteMap).toEqual({ "a.ts#clean#E": [ruleA], "a.ts#mixed#E": [ruleA, ruleA2] });
    expect(afterA.siteMap["a.ts#clean#E"]).toEqual(beforeA.siteMap["a.ts#clean#E"]);
    expect(afterA.version).toBe(beforeA.version + 1);
    expect(afterA.status).toBe("approved");
    expect(afterB.version).toBe(beforeB.version);
    expect(afterB.siteMap).toEqual({ "b.ts#clean#E": [ruleB] });
    expect(writeCalls(f)).toHaveLength(1);

    expect(runScript(f, COUNT).status).toBe(0);
  }, 240_000);

  it("a second run makes zero write calls and writes zero versions", async () => {
    const f = await fixture();
    await seedCorpus(f);
    expect(runScript(f, STRIP).status).toBe(0);
    const mid = await nodeOf(f.c, f.c.leafA);
    const callsAfterFirst = writeCalls(f).length;
    const r = runScript(f, STRIP);
    expect(r.status, r.out).toBe(0);
    expect(writeCalls(f)).toHaveLength(callsAfterFirst);
    expect((await nodeOf(f.c, f.c.leafA)).version).toBe(mid.version);
  }, 240_000);

  it("--dry-run prints the plan and writes nothing", async () => {
    const f = await fixture();
    await seedCorpus(f);
    const before = await nodeOf(f.c, f.c.leafA);
    const r = runScript(f, STRIP, ["--dry-run"]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain(f.c.leafA);
    expect(writeCalls(f)).toHaveLength(0);
    expect(await nodeOf(f.c, f.c.leafA)).toEqual(before);
  }, 240_000);

  it("a mixed entry whose kept BR-n is retired -> exit 1 naming leaf, site and value, nothing written", async () => {
    const f = await fixture();
    const { c } = f;
    await seedCorpus(f);
    const added = await must(c, ["rule", "add", c.leafB, "--statement", "Second fixture rule of leaf B holds", ...RULE_ARGS]);
    const retired = added.match(/BR-\d+/)?.[0] as string;
    await must(c, ["rule", "set", retired, "--lifecycle", "retired", "--note", "fixture retirement"]);
    seedSiteMapValue(c, c.leafB, "b.ts#retired#E", [retired, "non-business: stale excuse"]);
    const beforeA = await nodeOf(c, c.leafA);
    const beforeB = await nodeOf(c, c.leafB);

    const r = runScript(f, STRIP);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(c.leafB);
    expect(r.out).toContain("b.ts#retired#E");
    expect(r.out).toContain(retired);
    expect(writeCalls(f)).toHaveLength(0);
    expect(await nodeOf(c, c.leafB)).toEqual(beforeB);
    expect(await nodeOf(c, c.leafA)).toEqual(beforeA);
  }, 240_000);
});

/**
 * BR-1562: the typecheck reuses incremental build info from the last verified landing.
 * Drives scripts/typecheck-cache.ts against a throwaway three-file TypeScript project (never the repo's own tree or .lore).
 *
 * @spawns scripts/typecheck-cache.ts
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "../../../..");
const SCRIPT = join(REPO, "scripts/typecheck-cache.ts");
const REAL_TS = dirname(createRequire(import.meta.url).resolve("typescript/package.json"));
const L1 = "a".repeat(40);
const L2 = "b".repeat(40);

let root: string;
let extraArgs: string[];

function run(cmd: string, args: string[], env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}
function cache(args: string[], env: Record<string, string> = {}): { status: number; out: string } {
  return run("bun", [SCRIPT, ...args, "--root", root, "--project", "app=tsconfig.json", ...extraArgs], env);
}
function tscIncremental(): { status: number; out: string } {
  return run(process.execPath, [join(REAL_TS, "bin/tsc"), "--noEmit", "-p", "tsconfig.json", "--incremental", "--tsBuildInfoFile", ".cache/typecheck/app.tsbuildinfo"]);
}
function tscFull(): { status: number; out: string } {
  return run(process.execPath, [join(REAL_TS, "bin/tsc"), "--noEmit", "-p", "tsconfig.json"]);
}
const lines = (s: string): string => s.split("\n").map((l) => l.trimEnd()).filter(Boolean).sort().join("\n");
const write = (f: string, c: string): void => writeFileSync(join(root, f), c);
const cacheRoot = (): string => join(root, ".git", "lore-typecheck-cache");
const envKey = (): string => cache(["key"]).out.trim();
const envDir = (): string => join(cacheRoot(), envKey());
const current = (): string => readFileSync(join(envDir(), "current"), "utf8").trim();

const GOOD_A = "export type A = { n: number };\nexport const a: A = { n: 1 };\n";
const BAD_A = "export type A = { n: string };\nexport const a: A = { n: 'x' };\n";
const B = "import { a } from './a';\nexport const b: number = a.n;\n";
const C = "export const c = 3;\n";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "typecheck-cache-"));
  extraArgs = [];
  write("a.ts", GOOD_A);
  write("b.ts", B);
  write("c.ts", C);
  write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler" }, include: ["*.ts"] }));
  write("bun.lock", "lock v1\n");
  write(".gitignore", ".cache/\n");
  run("git", ["init", "-q"]);
  run("git", ["add", "-A"]);
  run("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A verified build of the current tree, installed as `landing`, exactly what integrate does after its CAS. */
function landVerified(landing: string): void {
  cache(["seed"]);
  expect(tscIncremental().status).toBe(0);
  const p = cache(["publish", landing]);
  expect(p.status, p.out).toBe(0);
}

describe("AC-TC-1 incremental equals full, including dependents", () => {
  it("a seeded build info still reports the dependent's error exactly as a full check does", () => {
    landVerified(L1);
    write("a.ts", BAD_A); // b no longer typechecks
    const seeded = cache(["seed"]);
    expect(seeded.out).toContain(`seeded from landing ${L1}`);
    const inc = tscIncremental();
    const full = tscFull();
    expect(full.status).not.toBe(0);
    expect(inc.status).not.toBe(0); // false green guard: skipping dependent b would exit 0
    expect(inc.out).toContain("b.ts");
    expect(lines(inc.out)).toBe(lines(full.out));
  });
  it("with no cache entry the run is cold and gives the same result", () => {
    write("a.ts", BAD_A);
    const seeded = cache(["seed"]);
    expect(seeded.status).toBe(0);
    expect(seeded.out).toContain("cold");
    expect(existsSync(join(root, ".cache/typecheck"))).toBe(false);
    const inc = tscIncremental();
    expect(inc.status).not.toBe(0);
    expect(lines(inc.out)).toBe(lines(tscFull().out));
  });
  it("changing bun.lock, a tsconfig or the TypeScript version gives a new env key and a cold run", () => {
    landVerified(L1);
    const base = envKey();
    expect(base).toMatch(/^[0-9a-f]{16,}$/);
    write("bun.lock", "lock v2\n");
    const k1 = envKey();
    expect(k1).not.toBe(base);
    expect(cache(["seed"]).out).toContain("cold");
    write("bun.lock", "lock v1\n");
    expect(envKey()).toBe(base);
    write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: false, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler" }, include: ["*.ts"] }));
    expect(envKey()).not.toBe(base);
    expect(cache(["seed"]).out).toContain("cold");
    write("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "bundler" }, include: ["*.ts"] }));
    expect(envKey()).toBe(base);
    const fake = join(root, "fake-ts");
    mkdirSync(join(fake, "bin"), { recursive: true });
    writeFileSync(join(fake, "package.json"), JSON.stringify({ name: "typescript", version: "0.0.0-other" }));
    writeFileSync(join(fake, "bin/tsc"), `require(${JSON.stringify(join(REAL_TS, "bin/tsc"))});\n`);
    extraArgs = ["--typescript-dir", fake];
    expect(envKey()).not.toBe(base);
    expect(cache(["seed"]).out).toContain("cold");
  });
  it("adding a source file does not change the env key (tsc re-checks by content)", () => {
    const base = envKey();
    write("d.ts", "export const d = 4;\n");
    expect(envKey()).toBe(base);
  });
  it("fails loud (exit 2) when bun.lock is missing instead of keying on nothing", () => {
    rmSync(join(root, "bun.lock"));
    const r = cache(["seed"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("bun.lock");
  });
});

describe("AC-TC-2 only verified landings write, atomically", () => {
  it("a worktree typecheck (seed + tsc + compare) never writes the machine cache", () => {
    cache(["seed"]);
    tscIncremental();
    cache(["compare"], { LORE_TYPECHECK_SAMPLE: "1" });
    expect(existsSync(cacheRoot())).toBe(false);
  });
  it("publish writes entries/<landing> with meta.json naming it, and points current at it", () => {
    landVerified(L1);
    const dir = join(envDir(), "entries", L1);
    expect(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")).landing).toBe(L1);
    expect(existsSync(join(dir, "app.tsbuildinfo"))).toBe(true);
    expect(current()).toBe(L1);
    expect(readdirSync(envDir()).filter((n) => n.startsWith("tmp-") || n.startsWith("current.tmp"))).toEqual([]);
  });
  it("a publish without every project's build info writes nothing and keeps current", () => {
    landVerified(L1);
    rmSync(join(root, ".cache/typecheck/app.tsbuildinfo"));
    const r = cache(["publish", L2]);
    expect(r.status).toBe(2);
    expect(current()).toBe(L1);
    expect(existsSync(join(envDir(), "entries", L2))).toBe(false);
  });
  it("rejects a non-sha landing argument", () => {
    cache(["seed"]);
    tscIncremental();
    expect(cache(["publish", "../evil"]).status).toBe(2);
  });
  it("seeding replaces the checkout's own earlier build info with the entry", () => {
    landVerified(L1);
    writeFileSync(join(root, ".cache/typecheck/stale.txt"), "mine");
    writeFileSync(join(root, ".cache/typecheck/app.tsbuildinfo"), "{ stale }");
    cache(["seed"]);
    expect(existsSync(join(root, ".cache/typecheck/stale.txt"))).toBe(false);
    expect(readFileSync(join(root, ".cache/typecheck/app.tsbuildinfo"), "utf8")).toBe(readFileSync(join(envDir(), "entries", L1, "app.tsbuildinfo"), "utf8"));
    // and a cold seed removes it too
    write("bun.lock", "lock v9\n");
    writeFileSync(join(root, ".cache/typecheck/stale.txt"), "mine");
    cache(["seed"]);
    expect(existsSync(join(root, ".cache/typecheck"))).toBe(false);
  });
  it("a reader running while a writer swaps entries copies one complete landing, never a mix", async () => {
    landVerified(L1);
    const key = envKey();
    const sha = (f: string): string => createHash("sha256").update(readFileSync(f)).digest("hex");
    const entry1 = sha(join(cacheRoot(), key, "entries", L1, "app.tsbuildinfo"));
    write("a.ts", "export type A = { n: number; m: number };\nexport const a: A = { n: 1, m: 2 };\n");
    cache(["seed"]);
    expect(tscIncremental().status).toBe(0);
    const writer = spawnSyncAsync(["bun", SCRIPT, "publish", L2, "--root", root, "--project", "app=tsconfig.json"]);
    const seen = new Set<string>();
    const readers: Array<Promise<void>> = [];
    for (let i = 0; i < 4; i++) {
      const rroot = mkdtempSync(join(tmpdir(), "typecheck-cache-reader-"));
      cpSync(root, rroot, { recursive: true });
      rmSync(join(rroot, ".cache"), { recursive: true, force: true });
      readers.push(
        spawnSyncAsync(["bun", SCRIPT, "seed", "--root", rroot, "--project", "app=tsconfig.json"]).then(() => {
          const meta = JSON.parse(readFileSync(join(rroot, ".cache/typecheck/meta.json"), "utf8")) as { landing: string };
          seen.add(`${meta.landing}:${sha(join(rroot, ".cache/typecheck/app.tsbuildinfo")) === entry1 ? "e1" : "e2"}`);
          rmSync(rroot, { recursive: true, force: true });
        }),
      );
    }
    await Promise.all([writer, ...readers]);
    for (const s of seen) expect([`${L1}:e1`, `${L2}:e2`]).toContain(s);
  }, 60000);
  it("after a write only the 3 most recent env keys remain, and only 3 entries per key (never current, never one under 10 minutes)", () => {
    const old = new Date(Date.now() - 3600_000);
    const keys: string[] = [];
    for (let i = 0; i < 4; i++) {
      write("bun.lock", `lock ${i}\n`);
      landVerified(`${String(i + 1).repeat(40)}`);
      keys.push(envKey());
      // age every env key so far past the 10 minute floor, oldest first
      for (const [j, k] of keys.entries()) {
        const f = join(cacheRoot(), k, "current");
        if (existsSync(f)) utimesSync(f, new Date(old.getTime() + j * 1000), new Date(old.getTime() + j * 1000));
      }
      if (i < 3) continue;
    }
    // the 5th key is written now: the 2 oldest aged keys must go beyond 3
    write("bun.lock", "lock 4\n");
    landVerified("5".repeat(40));
    const remaining = readdirSync(cacheRoot());
    expect(remaining).toHaveLength(3);
    expect(remaining).toContain(envKey());
    expect(remaining).not.toContain(keys[0]);
    // entries: 4 aged landings in one env key -> 3 remain, current kept
    write("bun.lock", "lock entries\n");
    const dirs: string[] = [];
    for (const n of ["6", "7", "8", "9"]) {
      landVerified(n.repeat(40));
      const d = join(envDir(), "entries", n.repeat(40));
      dirs.push(d);
      const t = new Date(Date.now() - 3600_000 + Number(n) * 1000);
      utimesSync(d, t, t);
    }
    landVerified("c".repeat(40)); // the write that evicts
    const entries = readdirSync(join(envDir(), "entries"));
    expect(entries).toHaveLength(3);
    expect(entries).toContain("c".repeat(40));
    expect(entries).not.toContain("6".repeat(40));
  }, 120000);
  it("a younger-than-10-minutes entry beyond the keep count is not evicted", () => {
    for (const n of ["1", "2", "3", "4"]) landVerified(n.repeat(40));
    expect(readdirSync(join(envDir(), "entries"))).toHaveLength(4);
  }, 60000);
});

describe("AC-TC-3 the sampled full check catches a stale cache", () => {
  /** After this the build info lies: a.ts changed in a way that breaks b, but the build info records the new content as already checked. */
  function plantStale(): void {
    landVerified(L1);
    const dir = join(envDir(), "entries", L1);
    const info = join(dir, "app.tsbuildinfo");
    const oldHash = createHash("sha256").update(GOOD_A).digest("hex");
    const newHash = createHash("sha256").update(BAD_A).digest("hex");
    const text = readFileSync(info, "utf8");
    expect(text).toContain(oldHash);
    writeFileSync(info, text.split(oldHash).join(newHash));
    write("a.ts", BAD_A);
    cache(["seed"]);
  }
  it("planted stale build info: the incremental run misses b's error, the comparison exits 1 naming both outputs and deletes both caches", () => {
    plantStale();
    expect(tscIncremental().status, "precondition: the planted build info must make the incremental run miss the error").toBe(0);
    expect(tscFull().status).not.toBe(0);
    const key = envKey();
    const r = cache(["compare"], { LORE_TYPECHECK_SAMPLE: "1" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("incremental output");
    expect(r.out).toContain("full output");
    expect(r.out).toContain("b.ts");
    expect(existsSync(join(root, ".cache/typecheck"))).toBe(false);
    expect(existsSync(join(cacheRoot(), key, "current"))).toBe(false);
    expect(existsSync(join(cacheRoot(), key, "entries", L1))).toBe(false);
    expect(existsSync(join(cacheRoot(), key, `current.invalid-${L1}`))).toBe(true);
    // the next run is cold and now reports the error, instead of the retry failing the same way again
    expect(cache(["seed"]).out).toContain("cold");
    expect(tscIncremental().status).not.toBe(0);
  });
  it("same exit code but different diagnostics still fails (not an exit-code-only comparison)", () => {
    write("c.ts", "export const c: number = 'x';\n"); // a standing error in c: both runs exit 1
    cache(["seed"]);
    tscIncremental();
    expect(cache(["publish", L1]).status).toBe(0);
    const info = join(envDir(), "entries", L1, "app.tsbuildinfo");
    const oldHash = createHash("sha256").update(GOOD_A).digest("hex");
    const newHash = createHash("sha256").update(BAD_A).digest("hex");
    writeFileSync(info, readFileSync(info, "utf8").split(oldHash).join(newHash));
    write("a.ts", BAD_A);
    cache(["seed"]);
    const inc = tscIncremental();
    expect(inc.status).not.toBe(0);
    expect(inc.out).not.toContain("b.ts");
    expect(tscFull().out).toContain("b.ts");
    const r = cache(["compare"], { LORE_TYPECHECK_SAMPLE: "1" });
    expect(r.status).toBe(1);
  });
  it("an honest cache passes the comparison and leaves the entry alone", () => {
    landVerified(L1);
    write("c.ts", "export const c = 5;\n");
    cache(["seed"]);
    expect(tscIncremental().status).toBe(0);
    const r = cache(["compare"], { LORE_TYPECHECK_SAMPLE: "1" });
    expect(r.status).toBe(0);
    expect(current()).toBe(L1);
    expect(existsSync(join(root, ".cache/typecheck"))).toBe(true);
  });
  it("an unsampled tree skips the comparison (forced off) and the stale cache passes unnoticed", () => {
    plantStale();
    const r = cache(["compare"], { LORE_TYPECHECK_SAMPLE: "0" });
    expect(r.status).toBe(0);
    expect(r.out).toContain("not sampled");
  });
  it("sampling by tree hash picks about one tree in twenty when not forced", () => {
    // the decision is a pure function of the committed tree: the same tree answers the same way twice
    const a = cache(["compare"]).out;
    const b = cache(["compare"]).out;
    expect(a).toBe(b);
  });
  it("a mismatch leaves a newer landing's current alone when this checkout was seeded from an older one", () => {
    plantStale();
    // another landing replaces current while this checkout still holds L1's build info
    const key = envKey();
    cpSync(join(cacheRoot(), key, "entries", L1), join(cacheRoot(), key, "entries", L2), { recursive: true });
    writeFileSync(join(cacheRoot(), key, "current"), `${L2}\n`);
    const r = cache(["compare"], { LORE_TYPECHECK_SAMPLE: "1" });
    expect(r.status).toBe(1);
    expect(current()).toBe(L2);
    expect(existsSync(join(root, ".cache/typecheck"))).toBe(false);
  });
  it("the seed output says cold or from the cache, with env key and landing commit", () => {
    expect(cache(["seed"]).out).toMatch(/cold.*env key [0-9a-f]+/);
    landVerified(L1);
    expect(cache(["seed"]).out).toMatch(new RegExp(`seeded from landing ${L1} \\(env key [0-9a-f]+\\)`));
  });
});

function spawnSyncAsync(argv: string[]): Promise<void> {
  return new Promise((res) => {
    const p = spawn(argv[0] as string, argv.slice(1), { cwd: root, stdio: "ignore" });
    p.on("close", () => res());
  });
}

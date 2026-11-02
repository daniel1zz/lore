#!/usr/bin/env bun
/**
 * Typecheck build-info cache (BR-1562, spec-typecheck-reuses-incremental-build-info-from-the-last).
 *
 * `bun run typecheck` runs every tsc project with `--incremental --tsBuildInfoFile <root>/.cache/typecheck/<project>.tsbuildinfo`.
 * This script owns the machine cache those files are seeded from:
 *
 *   <git common dir>/lore-typecheck-cache/<env key>/current            text: the landing commit of the live entry
 *   <git common dir>/lore-typecheck-cache/<env key>/entries/<landing>/ every project's .tsbuildinfo + meta.json
 *
 * Commands (all take --root <dir> [--project name=tsconfig ...] [--typescript-dir <dir>]):
 *   key                     print the env key
 *   seed                    replace <root>/.cache/typecheck with a copy of the current entry (cold when there is none)
 *   publish <landing>       install <root>/.cache/typecheck as entries/<landing>, repoint `current`, evict (integrate only)
 *   compare                 when this tree is sampled (1 in 20 by tree hash, LORE_TYPECHECK_SAMPLE=1|0 forces), run every
 *                           project incrementally AND without build info; a different exit code or different sorted
 *                           diagnostics exits 1, deletes <root>/.cache/typecheck and invalidates the cache entry
 *
 * Every write to the machine cache is a rename of a complete directory/file, so a concurrent reader sees the old or the
 * new entry, never a mix. Env key = sha256(bun.lock, TypeScript version, each project's `tsc --showConfig` without its
 * expanded `files` list): content changes are tsc's own per-file hashes' job, the key only guards what they cannot see.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

/** The seven projects of `bun run typecheck`, in order. */
const DEFAULT_PROJECTS: ReadonlyArray<readonly [string, string]> = [
  ["core", "packages/core/tsconfig.json"],
  ["lore", "packages/lore/tsconfig.json"],
  ["lore-tests", "packages/lore/tsconfig.tests.json"],
  ["scripts", "tsconfig.json"],
  ["dashboard", "packages/dashboard/tsconfig.json"],
  ["dashboard-tests", "packages/dashboard/tsconfig.tests.json"],
  ["dashboard-e2e", "packages/dashboard/tsconfig.e2e.json"],
];

const KEEP_ENTRIES = 3;
const KEEP_ENV_KEYS = 3;
const MIN_AGE_MS = 10 * 60 * 1000;
const SAMPLE_ONE_IN = 20;
const SEED_ATTEMPTS = 2;

interface Context {
  readonly root: string;
  readonly projects: ReadonlyArray<readonly [string, string]>;
  readonly tsDir: string;
  readonly localDir: string;
  readonly cacheRoot: string;
}

interface EntryMeta {
  readonly landing: string;
  readonly env_key: string;
  readonly written_at: string;
}

class CacheError extends Error {}

function fail(message: string): never {
  throw new CacheError(message);
}

function parseArgs(argv: readonly string[]): { readonly command: string; readonly positional: readonly string[]; readonly ctx: Context } {
  const [command, ...rest] = argv;
  if (command === undefined) fail("usage: typecheck-cache.ts <key|seed|publish <landing>|compare> [--root dir] [--project name=tsconfig] [--typescript-dir dir]");
  let root = resolve(dirname(new URL(import.meta.url).pathname), "..");
  let tsDir: string | undefined;
  const projects: Array<readonly [string, string]> = [];
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    const value = (): string => {
      const v = rest[++i];
      if (v === undefined) fail(`${arg} needs a value`);
      return v;
    };
    if (arg === "--root") root = resolve(value());
    else if (arg === "--typescript-dir") tsDir = resolve(value());
    else if (arg === "--project") {
      const [name, config] = value().split("=");
      if (name === undefined || name === "" || config === undefined || config === "") fail("--project takes name=tsconfig");
      projects.push([name, config]);
    } else positional.push(arg);
  }
  const resolvedTsDir = tsDir ?? dirname(createRequire(import.meta.url).resolve("typescript/package.json"));
  const common = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return {
    command,
    positional,
    ctx: {
      root,
      projects: projects.length > 0 ? projects : DEFAULT_PROJECTS,
      tsDir: resolvedTsDir,
      localDir: join(root, ".cache", "typecheck"),
      cacheRoot: join(common, "lore-typecheck-cache"),
    },
  };
}

function git(cwd: string, args: readonly string[]): string {
  const ran = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  if (ran.status !== 0) fail(`git ${args.join(" ")} failed in ${cwd} (exit ${String(ran.status)}): ${(ran.stderr || ran.stdout).trim()}`);
  return ran.stdout.trim();
}

function tscBin(ctx: Context): string {
  return join(ctx.tsDir, "bin", "tsc");
}

function runTsc(ctx: Context, args: readonly string[]): { readonly status: number; readonly output: string } {
  const ran = spawnSync(process.execPath, [tscBin(ctx), ...args], { cwd: ctx.root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (ran.error !== undefined) fail(`cannot run tsc (${tscBin(ctx)}): ${ran.error.message}`);
  return { status: ran.status ?? 1, output: `${ran.stdout}${ran.stderr}` };
}

function tsVersion(ctx: Context): string {
  const pkg = JSON.parse(readFileSync(join(ctx.tsDir, "package.json"), "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string") fail(`${ctx.tsDir}/package.json has no version`);
  return pkg.version;
}

function envKey(ctx: Context): string {
  const lock = join(ctx.root, "bun.lock");
  if (!existsSync(lock)) fail(`no bun.lock in ${ctx.root}: the env key cannot be computed`);
  const hash = createHash("sha256");
  hash.update(readFileSync(lock));
  hash.update(`\0ts ${tsVersion(ctx)}`);
  for (const [name, config] of ctx.projects) {
    const shown = runTsc(ctx, ["--showConfig", "-p", config]);
    if (shown.status !== 0) fail(`tsc --showConfig -p ${config} failed: ${shown.output.trim()}`);
    const parsed = JSON.parse(shown.output) as Record<string, unknown>;
    // reason: `files` is the expanded include list; a new source file must not change the key (tsc re-checks by content hash).
    delete parsed["files"];
    hash.update(`\0${name} ${JSON.stringify(parsed)}`);
  }
  return hash.digest("hex").slice(0, 32);
}

function readMeta(dir: string): EntryMeta | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as EntryMeta;
  } catch {
    return undefined;
  }
}

function readCurrent(envDir: string): string | undefined {
  try {
    const text = readFileSync(join(envDir, "current"), "utf8").trim();
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}

function seed(ctx: Context): void {
  const key = envKey(ctx);
  const envDir = join(ctx.cacheRoot, key);
  const scratch = join(ctx.root, ".cache", `typecheck.seed-${process.pid}`);
  mkdirSync(join(ctx.root, ".cache"), { recursive: true });
  for (let attempt = 0; attempt < SEED_ATTEMPTS; attempt++) {
    const landing = readCurrent(envDir);
    if (landing === undefined) break;
    rmSync(scratch, { recursive: true, force: true });
    try {
      cpSync(join(envDir, "entries", landing), scratch, { recursive: true });
    } catch {
      continue; // evicted or replaced mid-copy: re-read current
    }
    const meta = readMeta(scratch);
    if (meta !== undefined && meta.landing === landing && readCurrent(envDir) === landing) {
      rmSync(ctx.localDir, { recursive: true, force: true });
      renameSync(scratch, ctx.localDir);
      console.log(`typecheck cache: seeded from landing ${landing} (env key ${key})`);
      return;
    }
  }
  rmSync(scratch, { recursive: true, force: true });
  rmSync(ctx.localDir, { recursive: true, force: true });
  console.log(`typecheck cache: cold, no usable entry (env key ${key})`);
}

function copyTree(from: string, to: string): void {
  cpSync(from, to, { recursive: true });
}

function ageMs(path: string): number {
  return Date.now() - statSync(path).mtimeMs;
}

function evict(ctx: Context, envDir: string): void {
  const entriesDir = join(envDir, "entries");
  const current = readCurrent(envDir);
  const entries = readdirSync(entriesDir)
    .map((name) => ({ name, mtime: statSync(join(entriesDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const entry of entries.slice(KEEP_ENTRIES)) {
    if (entry.name === current || ageMs(join(entriesDir, entry.name)) < MIN_AGE_MS) continue;
    rmSync(join(entriesDir, entry.name), { recursive: true, force: true });
  }
  const envs = readdirSync(ctx.cacheRoot)
    .filter((name) => existsSync(join(ctx.cacheRoot, name, "current")))
    .map((name) => ({ name, mtime: statSync(join(ctx.cacheRoot, name, "current")).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const env of envs.slice(KEEP_ENV_KEYS)) {
    if (join(ctx.cacheRoot, env.name) === envDir || ageMs(join(ctx.cacheRoot, env.name, "current")) < MIN_AGE_MS) continue;
    rmSync(join(ctx.cacheRoot, env.name), { recursive: true, force: true });
  }
}

function publish(ctx: Context, landing: string): void {
  if (!/^[0-9a-f]{7,64}$/.test(landing)) fail(`publish needs a landing commit sha, got "${landing}"`);
  const missing = ctx.projects.map(([name]) => `${name}.tsbuildinfo`).filter((file) => !existsSync(join(ctx.localDir, file)));
  if (missing.length > 0) fail(`${ctx.localDir} lacks ${missing.join(", ")}: nothing published (an entry always carries every project)`);
  const key = envKey(ctx);
  const envDir = join(ctx.cacheRoot, key);
  const entriesDir = join(envDir, "entries");
  mkdirSync(entriesDir, { recursive: true });
  const tmp = join(envDir, `tmp-${landing}-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  for (const [name] of ctx.projects) copyTree(join(ctx.localDir, `${name}.tsbuildinfo`), join(tmp, `${name}.tsbuildinfo`));
  const meta: EntryMeta = { landing, env_key: key, written_at: new Date().toISOString() };
  writeFileSync(join(tmp, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  const target = join(entriesDir, landing);
  if (existsSync(target)) rmSync(tmp, { recursive: true, force: true }); // immutable per landing: the first complete write stays
  else renameSync(tmp, target);
  const pointer = join(envDir, `current.tmp-${process.pid}`);
  writeFileSync(pointer, `${landing}\n`);
  renameSync(pointer, join(envDir, "current"));
  evict(ctx, envDir);
  console.log(`typecheck cache: published landing ${landing} (env key ${key})`);
}

function sampled(ctx: Context): boolean {
  const forced = process.env["LORE_TYPECHECK_SAMPLE"];
  if (forced === "1") return true;
  if (forced === "0") return false;
  const tree = git(ctx.root, ["rev-parse", "HEAD^{tree}"]);
  return Number.parseInt(tree.slice(0, 8), 16) % SAMPLE_ONE_IN === 0;
}

function diagnostics(output: string): string {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .sort()
    .join("\n");
}

function compare(ctx: Context): number {
  if (!sampled(ctx)) {
    console.log("typecheck cache: full comparison not sampled for this tree");
    return 0;
  }
  const mismatches: string[] = [];
  for (const [name, config] of ctx.projects) {
    const incremental = runTsc(ctx, ["--noEmit", "-p", config, "--incremental", "--tsBuildInfoFile", join(ctx.localDir, `${name}.tsbuildinfo`)]);
    const full = runTsc(ctx, ["--noEmit", "-p", config]);
    const a = diagnostics(incremental.output);
    const b = diagnostics(full.output);
    if (incremental.status !== full.status || a !== b) {
      mismatches.push(
        `project ${name}: incremental exit ${incremental.status}, full exit ${full.status}\n--- incremental output ---\n${a}\n--- full output ---\n${b}`,
      );
    }
  }
  if (mismatches.length === 0) {
    console.log("typecheck cache: sampled full comparison matched the incremental run");
    return 0;
  }
  const seeded = readMeta(ctx.localDir);
  console.error(`typecheck cache: MISMATCH between the incremental and the full typecheck\n${mismatches.join("\n")}`);
  rmSync(ctx.localDir, { recursive: true, force: true });
  if (seeded !== undefined) invalidate(ctx, seeded);
  return 1;
}

/** Drops the machine entry this checkout was seeded from, unless a newer landing already replaced `current`. */
function invalidate(ctx: Context, seeded: EntryMeta): void {
  const envDir = join(ctx.cacheRoot, envKey(ctx));
  if (readCurrent(envDir) !== seeded.landing) return;
  try {
    renameSync(join(envDir, "current"), join(envDir, `current.invalid-${seeded.landing}`));
  } catch {
    return; // someone else replaced or invalidated it first
  }
  rmSync(join(envDir, "entries", seeded.landing), { recursive: true, force: true });
  console.error(`typecheck cache: invalidated landing ${seeded.landing}; the next run starts cold`);
}

function main(): number {
  const { command, positional, ctx } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "key":
      console.log(envKey(ctx));
      return 0;
    case "seed":
      seed(ctx);
      return 0;
    case "publish": {
      const landing = positional[0];
      if (landing === undefined) fail("publish needs the landing commit");
      publish(ctx, landing);
      return 0;
    }
    case "compare":
      return compare(ctx);
    default:
      return fail(`unknown command "${command}"`);
  }
}

try {
  process.exit(main());
} catch (error) {
  console.error(`typecheck-cache: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

/**
 * Run-time record of the repository files a test reads and the programs it spawns
 * (task-skill-implement-tg-13, AC-TG-7), plus the check that fails a test whose reads are not declared.
 *
 * Purpose: the selector can only select a test for a non-imported file if the test DECLARED it
 * (scripts/test-declared-inputs.ts); this module is the enforcement half: it records every
 * repo-relative path a test touches through the fs and child_process modules and, at the end of each
 * test, compares them with the test file's declarations.
 *
 * Mechanism (measured 2026-10-17, vitest 3.2.6): monkey-patching the `fs` default object works in
 * Node (with syncBuiltinESMExports) but under the Bun runtime a named import (`import { readFileSync }
 * from "node:fs"`) keeps the original function. So the recorder is installed as a vite ALIAS
 * (scripts/test-read-aliases.ts): `fs`, `fs/promises` and `child_process` resolve, for every module
 * vite transforms (tests and the repo code they import), to the wrapper modules
 * scripts/test-recorded-*.ts, which delegate to the real module obtained through `createRequire`
 * (never through an aliased specifier) and record the path argument first.
 *
 * What is SEEN: in-process fs calls made by the test or by repo code it imports; the program path and
 * script-looking arguments of every child_process spawn that resolve to a file in the repository.
 * What is NOT seen, by construction: reads made by a spawned child (dist/lore, bun, git ...) and reads
 * made by packages loaded natively from node_modules. A child's reads are covered only by the
 * `@spawns` declaration, which selects the test through the spawned program's source closure; the
 * author is responsible for any other file the child reads and declares it with `@reads`.
 *
 * Public surface: recordRepoPath, recordSpawn, wrapFsModule, wrapFsPromisesModule,
 * wrapChildProcessModule, takeUndeclaredInputs, UndeclaredTestInputError, REPO_ROOT.
 * Side-effect class: stateful (module-level event list, per test worker); never writes to disk.
 */
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPILED_BINARY_INPUTS, matchesAnyPattern, parseDeclaredInputs, type DeclaredInputs } from "./test-declared-inputs";

const nodeRequire = createRequire(import.meta.url);
// reason: the REAL fs, reached without an aliased specifier — `import "node:fs"` here would resolve
// to the recorder wrapper that imports this module (infinite recursion).
const realFs = nodeRequire("node:fs") as {
  readFileSync(path: string, encoding: "utf8"): string;
  statSync(path: string, options: { throwIfNoEntry: false }): { isFile(): boolean } | undefined;
  realpathSync(path: string): string;
};
// reason: same as realFs — the aliased "node:child_process" would resolve to the recorder wrapper.
const realChildProcess = nodeRequire("node:child_process") as {
  spawnSync(
    command: string,
    args: readonly string[],
    options: { cwd: string; input: string; encoding: "utf8"; maxBuffer: number },
  ): { status: number | null; stdout: string; stderr: string; error?: Error };
};

/**
 * Absolute path of the repository whose files tests must declare: this checkout (the directory above
 * scripts/), or `LORE_TEST_READS_ROOT` when a fixture project (scripts/tests/changed-tests-declared-inputs.test.ts)
 * runs the real recorder against its own throwaway root.
 */
// reason: realpath, because process.cwd() and fs report real paths (macOS: /private/var/... for a /var/... temp dir),
// and a root that differs only by a symlink prefix would make every in-repo read look outside the repository.
export const REPO_ROOT = realFs.realpathSync(process.env["LORE_TEST_READS_ROOT"] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));

/** One observed access: `kind` read = fs call, spawn = child process start. */
export interface InputEvent {
  readonly kind: "read" | "spawn";
  /** Repo-relative posix path. */
  readonly path: string;
  /** Test name when recorded during a test, otherwise `<module load>` or `<hook>`. */
  readonly label: string;
}

/** Typed failure: a test touched repository inputs its file does not declare. */
export class UndeclaredTestInputError extends Error {
  constructor(
    public readonly testFile: string,
    public readonly label: string,
    public readonly undeclared: readonly { readonly kind: "read" | "spawn"; readonly path: string }[],
  ) {
    const lines = undeclared.map((u) => `  ${u.kind === "read" ? "@reads" : "@spawns"} ${u.path}`);
    super(
      `test "${label}" in ${testFile} used repository inputs it does not declare:\n${lines.join("\n")}\n` +
        "Add the lines above to the leading comment block of the test file (a glob covering them also works), " +
        "so `bun run test:changed` selects this test when those files change.",
    );
    this.name = "UndeclaredTestInputError";
  }
}

let events: InputEvent[] = [];
let currentLabel = "<module load>";

/** Set the label attached to events recorded from now on (the running test's name, or a phase marker). */
export function setCurrentLabel(label: string): void {
  currentLabel = label;
}

/** Discard events recorded so far (harness/setup-file reads that are not the test's own inputs). */
export function clearEvents(): void {
  events = [];
}

/** Convert an fs path-like argument to a repo-relative posix path, or `undefined` when it is outside the repository, a file descriptor, node_modules or VCS metadata. */
export function toRepoRelative(arg: unknown, cwd: string = process.cwd()): string | undefined {
  let raw: string;
  if (typeof arg === "string") raw = arg;
  else if (arg instanceof URL) raw = arg.protocol === "file:" ? fileURLToPath(arg) : "";
  else if (arg instanceof Uint8Array) raw = Buffer.from(arg).toString("utf8");
  else return undefined;
  if (raw === "") return undefined;
  const absolute = isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw);
  const rel = relative(REPO_ROOT, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  const posixRel = rel.split(sep).join("/");
  if (/(^|\/)(node_modules|\.git)(\/|$)/.test(posixRel)) return undefined;
  return posixRel;
}

/** Record that the running test read (stat/exists/readdir/open ...) `arg`. */
export function recordRepoPath(arg: unknown): void {
  const path = toRepoRelative(arg);
  if (path !== undefined) events.push({ kind: "read", path, label: currentLabel });
}

const SCRIPT_ARG_RE = /\.(?:ts|tsx|js|mjs|cjs|sh)$/;

function unquote(token: string): string {
  return token.replace(/^["']|["']$/g, "");
}

/** Program-position tokens are always candidates; other tokens only when they look like a script path. */
function candidateTokens(command: string, args: readonly unknown[]): string[] {
  const tokens: string[] = [command];
  for (const arg of args) {
    if (typeof arg !== "string") continue;
    if (/\s/.test(arg)) {
      // a whole command line (exec, or a string handed to `sh -c`): its first word is a program, later words only count as scripts
      const [first, ...rest] = arg.split(/\s+/).map(unquote);
      if (first !== undefined) tokens.push(first);
      tokens.push(...rest.filter((t) => SCRIPT_ARG_RE.test(t)));
    } else if (SCRIPT_ARG_RE.test(arg)) {
      tokens.push(arg);
    }
  }
  return tokens;
}

/** Record the repository files a child-process start names: the program itself and script-looking arguments, resolved against the child's cwd, when they exist as files. `shell` marks exec/execSync, whose single string is a whole command line. */
export function recordSpawn(command: unknown, args: readonly unknown[], cwd: unknown, shell = false): void {
  if (typeof command !== "string") return;
  const base = typeof cwd === "string" ? resolve(cwd) : process.cwd();
  const tokens = shell ? candidateTokens("", [`${command} `]).slice(1) : candidateTokens(command, args);
  for (const token of tokens) {
    if (token === "") continue;
    const rel = toRepoRelative(token, base);
    if (rel === undefined) continue;
    const absolute = resolve(REPO_ROOT, rel);
    if (realFs.statSync(absolute, { throwIfNoEntry: false })?.isFile() === true) {
      events.push({ kind: "spawn", path: rel, label: currentLabel });
    }
  }
}

type AnyFn = (...args: unknown[]) => unknown;

/** fs functions whose FIRST argument is a path the call reads, stats, lists or opens (callback, sync and promise forms share names). */
const FS_PATH_READERS = [
  "readFile", "readFileSync", "readdir", "readdirSync", "stat", "statSync", "lstat", "lstatSync",
  "exists", "existsSync", "access", "accessSync", "open", "openSync", "createReadStream", "readlink",
  "readlinkSync", "realpath", "realpathSync", "opendir", "opendirSync", "openAsBlob", "statfs", "statfsSync",
  "cp", "cpSync", "copyFile", "copyFileSync",
] as const;

function wrapPathReaders<T extends object>(real: T, names: readonly string[]): T {
  const wrapped: Record<string, unknown> = { ...(real as Record<string, unknown>) };
  for (const name of names) {
    const original = (real as Record<string, unknown>)[name];
    if (typeof original !== "function") continue;
    const fn = original as AnyFn;
    const replacement: AnyFn = function (this: unknown, ...args: unknown[]) {
      recordRepoPath(args[0]);
      return fn.apply(this === wrapped ? real : this, args);
    };
    // reason: keep `util.promisify.custom` and similar own properties (exists/readFile) on the wrapper.
    Object.defineProperties(replacement, Object.getOwnPropertyDescriptors(fn));
    wrapped[name] = replacement;
  }
  return wrapped as T;
}

/** Wrapper for the `fs` module: path readers record, everything else passes through; `promises` is wrapped too. */
export function wrapFsModule<T extends { promises: object }>(real: T): T {
  const wrapped = wrapPathReaders(real, FS_PATH_READERS) as T & Record<string, unknown>;
  wrapped.promises = wrapFsPromisesModule(real.promises);
  return wrapped;
}

/** Wrapper for the `fs/promises` module. */
export function wrapFsPromisesModule<T extends object>(real: T): T {
  return wrapPathReaders(real, FS_PATH_READERS);
}

/** Wrapper for the `child_process` module: every start records the repository files it names. */
export function wrapChildProcessModule<T extends object>(real: T): T {
  const wrapped: Record<string, unknown> = { ...(real as Record<string, unknown>) };
  const hook = (name: string, shell: boolean): void => {
    const original = (real as Record<string, unknown>)[name];
    if (typeof original !== "function") return;
    const fn = original as AnyFn;
    const replacement: AnyFn = function (this: unknown, ...args: unknown[]) {
      const [command, second, third] = args;
      const argv = Array.isArray(second) ? (second as unknown[]) : [];
      const options = Array.isArray(second) ? third : second;
      const cwd = typeof options === "object" && options !== null ? (options as { cwd?: unknown }).cwd : undefined;
      recordSpawn(command, argv, cwd, shell);
      return fn.apply(this === wrapped ? real : this, args);
    };
    Object.defineProperties(replacement, Object.getOwnPropertyDescriptors(fn));
    wrapped[name] = replacement;
  };
  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "fork"]) hook(name, false);
  for (const name of ["exec", "execSync"]) hook(name, true);
  return wrapped as T;
}

const declarationCache = new Map<string, DeclaredInputs>();

function declarationsOf(testFileAbsolute: string): DeclaredInputs {
  const cached = declarationCache.get(testFileAbsolute);
  if (cached !== undefined) return cached;
  const parsed = parseDeclaredInputs(realFs.readFileSync(testFileAbsolute, "utf8"));
  declarationCache.set(testFileAbsolute, parsed);
  return parsed;
}

/** A test that declares `@spawns dist/lore` also covers reads of the binary's build inputs (see COMPILED_BINARY_INPUTS.buildInputReadGlobs). */
function binaryBuildInputs(declared: DeclaredInputs): readonly string[] {
  return declared.spawns.includes(COMPILED_BINARY_INPUTS.declaration)
    ? [...COMPILED_BINARY_INPUTS.buildInputReadGlobs, ...COMPILED_BINARY_INPUTS.embeddedGlobs]
    : [];
}

/** Typed failure: git could not say which paths are ignored, so an undeclared read cannot be classified. */
export class GitIgnoreQueryError extends Error {
  constructor(
    public readonly root: string,
    public readonly paths: readonly string[],
    public readonly reason: string,
  ) {
    super(`test-read-log: \`git check-ignore\` failed in ${root} for ${paths.join(", ")}: ${reason}`);
    this.name = "GitIgnoreQueryError";
  }
}

/**
 * The subset of `paths` (repo-relative posix) that git ignores in REPO_ROOT. One batched
 * `git check-ignore --stdin -z` call; tracked files are never reported (git's own rule), so a tracked
 * undeclared read still fails. Exit 0 = some ignored, 1 = none, anything else = git cannot answer: throw.
 */
function findGitIgnoredPaths(paths: readonly string[]): Set<string> {
  const result = realChildProcess.spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: REPO_ROOT,
    input: `${paths.join("\0")}\0`,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) throw new GitIgnoreQueryError(REPO_ROOT, paths, result.error.message);
  if (result.status === 1) return new Set();
  if (result.status !== 0) throw new GitIgnoreQueryError(REPO_ROOT, paths, `exit ${String(result.status)}: ${result.stderr.trim()}`);
  return new Set(result.stdout.split("\0").filter((p) => p !== ""));
}

/** One group of undeclared accesses, keyed by the label (test name) they were recorded under. */
export interface UndeclaredGroup {
  readonly label: string;
  readonly undeclared: readonly { readonly kind: "read" | "spawn"; readonly path: string }[];
}

/**
 * Drain the recorded events and return those the test file at `testFileAbsolute` does not declare,
 * grouped by label. A read is covered by an `@reads` or `@spawns` pattern; a spawn only by `@spawns`.
 * The test file itself is always covered.
 */
export function takeUndeclaredInputs(testFileAbsolute: string): UndeclaredGroup[] {
  const taken = events;
  events = [];
  if (taken.length === 0) return [];
  const declared = declarationsOf(testFileAbsolute);
  const own = toRepoRelative(testFileAbsolute);
  const groups = new Map<string, Map<string, { kind: "read" | "spawn"; path: string }>>();
  const uncovered: InputEvent[] = [];
  for (const event of taken) {
    if (event.path === own) continue;
    const covered =
      event.kind === "spawn"
        ? matchesAnyPattern(event.path, declared.spawns)
        : matchesAnyPattern(event.path, [...declared.reads, ...declared.spawns, ...binaryBuildInputs(declared)]);
    if (!covered) uncovered.push(event);
  }
  // reason: a git-ignored path never appears in a git diff, so the selector can never use a declaration of it
  // (task-skill-fix-tg-34). Only undeclared READS are classified, in one batch, and only when there are any.
  const readPaths = [...new Set(uncovered.filter((e) => e.kind === "read").map((e) => e.path))];
  const ignored = readPaths.length === 0 ? new Set<string>() : findGitIgnoredPaths(readPaths);
  for (const event of uncovered) {
    if (event.kind === "read" && ignored.has(event.path)) continue;
    const group = groups.get(event.label) ?? new Map();
    group.set(`${event.kind}:${event.path}`, { kind: event.kind, path: event.path });
    groups.set(event.label, group);
  }
  return [...groups].map(([label, group]) => ({ label, undeclared: [...group.values()] }));
}

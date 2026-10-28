/**
 * Test identity: gives a test's `lore` run a KNOWN PARTY, the way an installed agent integration does, now that a
 * write with no attested run and no human session is refused (spec-every-write-is-made-by-a-known-party-an-attested-agent-run,
 * BR-1351).
 *
 * Purpose: a test that drives the CLI in a throwaway corpus needs its writes to be made by someone. This helper does
 * what the Claude Code hooks do in production: it names an AGENT RUN (`cc:<session>`), REGISTERS that run in the
 * corpus's registry with THIS test process as the run's harness process, and hands back the per-call `LORE_HARNESS_RUN`
 * value. The writer's name is then derived from the run exactly as production derives it (`agent:session-<8>`), so
 * `sessionActorFor(label)` still predicts the name.
 *
 * Public surface: {@link DEFAULT_TEST_RUN}, {@link HARNESS_RUN_ENV}, {@link testRunIdFor}, {@link registerTestRun},
 * {@link withTestRunEnv}, {@link scrubIdentityEnv}.
 *
 * Invariants:
 *   - Registration writes ONLY the `runs` registry of the corpus at the project root found from `cwd`
 *     (`INSERT OR IGNORE`, first registration wins, like `lore run register`); a directory with no corpus, or a corpus
 *     older than the runs table, is left alone (the command under test then reports its own error).
 *   - A test that proves a REFUSAL must not use this helper: it spawns with {@link scrubIdentityEnv} and no flag.
 *
 * Side-effect class: IO (one SQLite insert under the corpus found from `cwd`).
 */

import { createRequire } from "node:module";
import type { RunId } from "@lore/core";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

// reason: the REAL `fs`, reached through `createRequire`, never `import "node:fs"`: that specifier is aliased to the test
// run's recording wrapper (scripts/test-recorded-fs.ts -> scripts/test-read-log.ts), and this module is imported by
// scripts/test-known-party-spawn.ts which test-read-log.ts itself imports, so an aliased import here is a load cycle.
const { existsSync, readFileSync, statSync } = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");

// reason: spelled out here, NOT imported from `@lore/core`: this module is loaded by the test run's own child_process
// wrapper (scripts/test-read-log.ts -> scripts/test-known-party-spawn.ts), and `@lore/core` itself imports
// `child_process` through that wrapper, so importing it here would be a load cycle.
/** The per-call environment value that carries a lore call's run (same spelling as core's `HARNESS_RUN_ENV`; spelled out for the cycle reason above). */
export const HARNESS_RUN_ENV = "LORE_HARNESS_RUN";

/** What one `ps -o lstart= -p <pid>` read says: a start time, the process is gone, or the table could not be read. */
type LstartRead = { readonly kind: "ok"; readonly iso: string } | { readonly kind: "gone" } | { readonly kind: "unreadable"; readonly reason: string };

// Same rule as adapters/process-table-port.ts (#418), duplicated on purpose: that adapter imports `child_process`, which
// this module's importer wraps, so importing it here would be a load cycle.
const PS_TIMEOUT_MS = 5000;
const PS_EMPTY_READ_ATTEMPTS = 3;

function isProcessAlive(pid: number): boolean | "unknown" {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    return code === "EPERM" ? true : "unknown";
  }
}

/**
 * Read the start time of `pid`: up to 3 reads while `ps` exits 0 with empty output, 5s SIGKILL timeout per read; still
 * empty -> `kill(pid, 0)` decides: ESRCH is "gone", anything else is "unreadable" (never "gone").
 */
function readLstart(pid: number): LstartRead {
  for (let attempt = 0; attempt < PS_EMPTY_READ_ATTEMPTS; attempt += 1) {
    const run = realSpawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      timeout: PS_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    if (run.error !== undefined) return { kind: "unreadable", reason: `ps could not run (${run.error.message})` };
    const text = (run.stdout ?? "").trim();
    if (run.status === 0 && text !== "") {
      const parsed = new Date(text);
      return Number.isNaN(parsed.getTime()) ? { kind: "unreadable", reason: `lstart "${text}" did not parse` } : { kind: "ok", iso: parsed.toISOString() };
    }
    if (run.status !== 0 && (run.stderr ?? "").trim() === "" && text === "") return { kind: "gone" }; // ps exit 1, no output: no such pid
    if (run.status !== 0) return { kind: "unreadable", reason: `ps exited ${String(run.status)}` };
  }
  return isProcessAlive(pid) === false ? { kind: "gone" } : { kind: "unreadable", reason: `ps printed nothing for live pid ${String(pid)}` };
}

/** True when `pid` still is the process that started at `registeredStart` (a reused pid, or a gone one, is not). An unreadable table never displaces a recorded harness. */
function isSameLiveProcess(pid: number, registeredStart: string | null): boolean {
  const read = readLstart(pid);
  if (read.kind === "unreadable") return true;
  return read.kind === "ok" && (registeredStart === null || read.iso === registeredStart);
}

/**
 * The session id of the OUTER Claude Code session this test process was started from, captured at load. It is never a
 * test's own writer: a test run's identity must not derive from the session that happens to be running the suite.
 */
const OUTER_SESSION_ID = (process.env["CLAUDE_CODE_SESSION_ID"] ?? process.env["CLAUDE_SESSION_ID"] ?? "").trim();

/**
 * The session id `env` names for a TEST writer (how fixtures name one: `sessionEnvFor`), or `null` when it names none.
 * The outer session's own id (inherited through `process.env`) counts as none.
 */
export function testSessionOf(env: Readonly<Record<string, string | undefined>>): string | null {
  const session = (env["CLAUDE_CODE_SESSION_ID"] ?? env["CLAUDE_SESSION_ID"] ?? "").trim();
  return session === "" || session === OUTER_SESSION_ID ? null : session;
}

// reason: the REAL `child_process` through `createRequire`, like `fs` above (the aliased module is this file's importer).
const { spawnSync: realSpawnSync } = createRequire(import.meta.url)("node:child_process") as typeof import("node:child_process");

let ownStartTime: string | null | undefined;

/**
 * The start time of THIS process as lore's process-table port reads it (`ps -o lstart=`, ISO-8601, second precision),
 * or `null` when `ps` cannot say. A test process registers itself as the harness of its runs: every `lore` it spawns
 * descends from it, and an in-process run starts its ancestry walk at it.
 */
function startTimeOfThisProcess(): string | null {
  if (ownStartTime !== undefined) return ownStartTime;
  const read = readLstart(process.pid);
  // reason: an unreadable table is never cached as "no start time" (and this process is alive, so "gone" is also a read failure).
  if (read.kind !== "ok") throw new Error(`test-run-identity: cannot read this process's start time: ${read.kind === "unreadable" ? read.reason : "ps reports it gone"}`);
  ownStartTime = read.iso;
  return ownStartTime;
}

// reason: `bun:sqlite` is required LAZILY, inside the one function that writes the registry: this module is imported by
// the spawn shim of EVERY test run (scripts/test-known-party-spawn.ts), including the few files vitest runs under Node,
// where a top-level `import "bun:sqlite"` would fail at load. Under Node, registering is simply unavailable.
type BunDatabase = import("bun:sqlite").Database;
function openRegistry(dbPath: string): BunDatabase {
  const { Database } = createRequire(import.meta.url)("bun:sqlite") as typeof import("bun:sqlite");
  return new Database(dbPath);
}

/** The run every live-process test helper writes as (`liveWriteContext()`, `liveInvocation()` with no session set). */
export const LIVE_TEST_RUN = "cc:live-test-session";

/** The run a test uses when it names no writer: an agent run of a fixed fake session. */
export const DEFAULT_TEST_RUN = "cc:lore-test-default";

/** Environment variables that can carry an identity or mark an agent harness; a refusal test removes all of them. */
const IDENTITY_ENV_VARS = ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "LORE_ACTOR"] as const;

type EnvBag = Readonly<Record<string, string | undefined>>;

/**
 * The run a test's command runs as: the per-call value its env already carries, else the run of the session its env
 * names (`CLAUDE_CODE_SESSION_ID`, how fixtures name a writer: `sessionEnvFor`), else {@link DEFAULT_TEST_RUN}.
 *
 * @param _args - the command's argv; kept so every caller keeps one call shape (the argv no longer names a run)
 */
export function testRunIdFor(_args: readonly string[], env: EnvBag): string {
  const carried = env[HARNESS_RUN_ENV];
  if (carried !== undefined && carried.trim() !== "") return carried;
  const session = testSessionOf(env);
  return session !== null ? `cc:${session}` : DEFAULT_TEST_RUN;
}

/** Nearest ancestor of `cwd` (itself included) holding `.lore/lore.db`, or `null`. */
function findCorpusRoot(cwd: string): string | null {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, ".lore", "lore.db"))) return dir;
    // reason: never hop from the protected checkout (itself a linked worktree in an agent session) to ITS main checkout's
    // live corpus: a test whose cwd is this repository must not register a run in the team's own `.lore/`.
    const protectedRepo = process.env["LORE_TEST_SANDBOX_REPO"];
    const insideProtected = protectedRepo !== undefined && protectedRepo !== "" && (dir === protectedRepo || isInside(protectedRepo, dir));
    const mainCheckout = insideProtected ? null : mainCheckoutOfLinkedWorktree(dir);
    if (mainCheckout !== null && existsSync(join(mainCheckout, ".lore", "lore.db"))) return mainCheckout;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The main checkout a LINKED worktree at `dir` belongs to (its `.git` FILE says `gitdir: <main>/.git/worktrees/<name>`), or
 * `null`: a linked worktree has no corpus of its own, and `lore` resolves the main checkout's (git-common-dir), so a run
 * registered for a spawn in the worktree belongs in THAT corpus. Filesystem only, never a git subprocess.
 */
function mainCheckoutOfLinkedWorktree(dir: string): string | null {
  try {
    const gitPath = join(dir, ".git");
    if (!existsSync(gitPath) || !statSync(gitPath).isFile()) return null;
    const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitPath, "utf8"));
    if (pointer?.[1] === undefined) return null;
    const gitDir = resolve(dir, pointer[1].trim());
    const commonDir = dirname(dirname(gitDir)); // <main>/.git/worktrees/<name> -> <main>/.git
    return basename(commonDir) === ".git" ? dirname(commonDir) : null;
  } catch {
    return null;
  }
}

/**
 * Register `runId` (an agent run `cc:<session>[:<agent>]`) in the corpus holding `cwd`, like `lore run register`.
 *
 * @returns `true` when a corpus with a runs table was found (the run is registered, newly or already), else `false`
 */
export function registerTestRun(cwd: string, runId: string): boolean {
  const root = findCorpusRoot(cwd);
  if (root === null) return false;
  return registerRunInDb(join(root, ".lore", "lore.db"), runId);
}

/**
 * Register `runId` (an agent run `cc:<session>[:<agent>]`) in the corpus file at `dbPath` (first registration wins).
 *
 * @returns `true` when the file has a runs table (the run is registered, newly or already), else `false`
 */
export function registerRunInDb(dbPath: string, runId: string): boolean {
  const [, session, agent] = runId.split(":");
  if (session === undefined) throw new Error(`registerRunInDb: ${runId} is not a cc:<session>[:<agent>] run id`);
  // reason: NEVER the protected repository's own corpus (`LORE_TEST_SANDBOX_REPO`, root CLAUDE.md "never write the repo's
  // own .lore/ corpus from tests"): a spawn whose cwd is the checkout must not gain a registry row there.
  const protectedRepo = process.env["LORE_TEST_SANDBOX_REPO"];
  if (protectedRepo !== undefined && protectedRepo !== "" && isInside(protectedRepo, dbPath)) return false;
  const memoKey = `${dbPath}\0${runId}\0${inodeOf(dbPath)}`;
  if (REGISTERED.has(memoKey)) return true;
  let db: BunDatabase;
  try {
    db = openRegistry(dbPath);
  } catch {
    // reason: a path that is not (yet) a SQLite file is not a corpus to register in; the command under test reports its own error.
    return false;
  }
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const hasRuns = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get() !== null;
    if (!hasRuns) return false;
    db.query(
      `INSERT OR IGNORE INTO runs (id, kind, harness, session_ref, agent_ref, agent_type, parent_run_id, branch, composition, registered_at)
       VALUES (?, ?, 'claude-code', ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      runId,
      agent === undefined ? "main" : "subagent",
      session,
      agent ?? null,
      agent === undefined ? null : "lore-implementer",
      agent === undefined ? null : `cc:${session}`,
      JSON.stringify({ schemaVersion: 1, fragments: [] }),
      new Date().toISOString(),
    );
    // reason: the run's harness process is THIS test process: a spawned `lore` descends from it and verifies by ancestry.
    // But a registration NEVER moves a run whose recorded harness is still a live process other than this one: a
    // short-lived subprocess (a `bun -e` seed script calling `liveInvocation()`) that re-registered the shared run
    // with its own pid would leave every later spawn of the long-lived worker pointing at a dead pid (the worker's
    // memo skips re-registering). Only an unset, own, dead or pid-reused harness is replaced.
    // A corpus older than migration 021 has no columns; the registry row alone is then all there is.
    const startTime = startTimeOfThisProcess();
    if (startTime !== null && db.query("SELECT 1 FROM pragma_table_info('runs') WHERE name = 'harness_pid'").get() !== null) {
      const current = db.query("SELECT harness_pid, harness_pid_start FROM runs WHERE id = ?").get(runId) as
        | { harness_pid: number | null; harness_pid_start: string | null }
        | null;
      const heldByOtherLiveProcess =
        current !== null &&
        current.harness_pid !== null &&
        current.harness_pid !== process.pid &&
        isSameLiveProcess(current.harness_pid, current.harness_pid_start);
      if (!heldByOtherLiveProcess) {
        db.query("UPDATE runs SET harness_pid = ?, harness_pid_start = ? WHERE id = ?").run(process.pid, startTime, runId);
      }
    }
    REGISTERED.add(memoKey);
    return true;
  } catch (error) {
    // reason: a corrupt file ("file is not a database") is not a corpus to register in: the command under test reports it.
    if (error instanceof Error && /not a database|malformed/i.test(error.message)) return false;
    throw error;
  } finally {
    db.close();
  }
}

/** `(db file, run, inode)` triples already registered by this process: the same file is not reopened per call (a recreated file has a new inode). */
const REGISTERED = new Set<string>();

function inodeOf(path: string): number {
  try {
    return statSync(path).ino;
  } catch {
    return -1;
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * `env` as a known party runs: carrying the per-call run value (`LORE_HARNESS_RUN`, unless the caller already set one),
 * the run registered in the corpus holding `cwd` with this test process as its harness.
 *
 * @param args - argv after the program name
 * @param env - the run's environment (a session id in it names the writer)
 * @param cwd - the run's working directory (where the corpus is found)
 */
export function withTestRunEnv(args: readonly string[], env: EnvBag, cwd: string): Record<string, string | undefined> {
  const runId = testRunIdFor(args, env);
  registerTestRun(cwd, runId);
  return (env[HARNESS_RUN_ENV] ?? "") !== "" ? { ...env } : { ...env, [HARNESS_RUN_ENV]: runId };
}

/** `env` with every variable that could name a writer or mark an agent harness removed (a refusal test spawns with this). */
export function scrubIdentityEnv(env: EnvBag): Record<string, string | undefined> {
  const scrubbed: Record<string, string | undefined> = { ...env };
  for (const name of IDENTITY_ENV_VARS) delete scrubbed[name];
  return scrubbed;
}

/**
 * The run a unit test gives a writer it names only by display name (`claim(slug, { by: "alice" })`): one stable run per
 * name, so a test that models "the same actor again" and "a different actor" keeps meaning exactly that now that claims
 * compare RUNS, never names (BR-1040). Two names are two runs; one name is one run.
 *
 * @param by - the writer's display name
 * @returns a run id of the shape an agent integration derives (`cc:<session>`), unique per name
 */
export function runOfName(by: string): RunId {
  return `cc:test-${by.replace(/[^A-Za-z0-9._-]/g, "-")}` as RunId;
}

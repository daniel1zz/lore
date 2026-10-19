/**
 * Test identity: gives a test's `lore` run a KNOWN PARTY, the way an installed agent integration does, now that a
 * write with no attested run and no human session is refused (spec-every-write-is-made-by-a-known-party-an-attested-agent-run,
 * BR-1351).
 *
 * Purpose: a test that drives the CLI in a throwaway corpus needs its writes to be made by someone. This helper does
 * what the Claude Code hooks do in production: it names an AGENT RUN (`cc:<session>`), REGISTERS that run in the
 * corpus's registry, and hands back the `--harness-run <id>` flag. The writer's name is then derived from the run
 * exactly as production derives it (`agent:session-<8>`), so `sessionActorFor(label)` still predicts the name.
 *
 * Public surface: {@link DEFAULT_TEST_RUN}, {@link hasHarnessRunFlag}, {@link testRunIdFor}, {@link registerTestRun},
 * {@link withTestRun}, {@link scrubIdentityEnv}.
 *
 * Invariants:
 *   - Registration writes ONLY the `runs` registry of the corpus at the project root found from `cwd`
 *     (`INSERT OR IGNORE`, first registration wins, like `lore run register`); a directory with no corpus, or a corpus
 *     older than the runs table, is left alone (the command under test then reports its own error).
 *   - A test that proves a REFUSAL must not use this helper: it spawns with {@link scrubIdentityEnv} and no flag.
 *
 * Side-effect class: IO (one SQLite insert under the corpus found from `cwd`).
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { HARNESS_RUN_FLAG } from "@lore/core";

/** The run a test uses when it names no writer: an agent run of a fixed fake session. */
export const DEFAULT_TEST_RUN = "cc:lore-test-default";

/** Environment variables that can carry an identity or mark an agent harness; a refusal test removes all of them. */
const IDENTITY_ENV_VARS = ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "LORE_ACTOR"] as const;

type EnvBag = Readonly<Record<string, string | undefined>>;

/** Whether `args` already carry a harness run (flag form `--harness-run <id>` or `--harness-run=<id>`). */
export function hasHarnessRunFlag(args: readonly string[]): boolean {
  return args.some((token) => token === HARNESS_RUN_FLAG || token.startsWith(`${HARNESS_RUN_FLAG}=`));
}

/**
 * The run a test's command runs as: its own `--harness-run`, else the run of the session its env names
 * (`CLAUDE_CODE_SESSION_ID`, how fixtures name a writer: `sessionEnvFor`), else {@link DEFAULT_TEST_RUN}.
 */
export function testRunIdFor(args: readonly string[], env: EnvBag): string {
  for (let i = 0; i < args.length; i++) {
    const token = args[i] as string;
    if (token === HARNESS_RUN_FLAG) return args[i + 1] ?? DEFAULT_TEST_RUN;
    if (token.startsWith(`${HARNESS_RUN_FLAG}=`)) return token.slice(HARNESS_RUN_FLAG.length + 1);
  }
  const session = env["CLAUDE_CODE_SESSION_ID"] ?? env["CLAUDE_SESSION_ID"];
  return session !== undefined && session.trim() !== "" ? `cc:${session}` : DEFAULT_TEST_RUN;
}

/** Nearest ancestor of `cwd` (itself included) holding `.lore/lore.db`, or `null`. */
function findCorpusRoot(cwd: string): string | null {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, ".lore", "lore.db"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
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
  const [, session, agent] = runId.split(":");
  if (session === undefined) throw new Error(`registerTestRun: ${runId} is not a cc:<session>[:<agent>] run id`);
  const db = new Database(join(root, ".lore", "lore.db"));
  try {
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
    return true;
  } finally {
    db.close();
  }
}

/**
 * `args` as a known party runs them: with `--harness-run <run>` in front (unless the caller already gave one), the run
 * registered in the corpus holding `cwd`.
 *
 * @param args - argv after the program name
 * @param env - the run's environment (a session id in it names the writer)
 * @param cwd - the run's working directory (where the corpus is found)
 */
export function withTestRun(args: readonly string[], env: EnvBag, cwd: string): string[] {
  const runId = testRunIdFor(args, env);
  registerTestRun(cwd, runId);
  return hasHarnessRunFlag(args) ? [...args] : [HARNESS_RUN_FLAG, runId, ...args];
}

/** `env` with every variable that could name a writer or mark an agent harness removed (a refusal test spawns with this). */
export function scrubIdentityEnv(env: EnvBag): Record<string, string | undefined> {
  const scrubbed: Record<string, string | undefined> = { ...env };
  for (const name of IDENTITY_ENV_VARS) delete scrubbed[name];
  return scrubbed;
}

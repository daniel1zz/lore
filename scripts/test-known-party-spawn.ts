/**
 * Known-party spawn rewrite for the test run (spec-every-write-is-made-by-a-known-party-an-attested-agent-run, BR-1351).
 *
 * Purpose: a write made by `lore` needs a known party and an unregistered run is refused. The tests that start `lore`
 * (`bun run packages/lore/src/index.ts`, `dist/lore`) to drive a throwaway corpus are not an agent session with hooks, so
 * the installed hooks' job is done here, once, for every such start: the start gets `LORE_HARNESS_RUN=cc:<session>` in
 * its env (the session id its env names, else {@link DEFAULT_TEST_RUN}) and that run is registered in the corpus under its
 * `cwd` with the test process as its harness process, exactly as the SessionStart hook registers a real run. The writer's name then derives from the run (`agent:session-<8>`), so a
 * test that named its writer through `CLAUDE_CODE_SESSION_ID` still sees the same name.
 *
 * Public surface: {@link rewriteLoreStart}, {@link KNOWN_PARTY_OPT_OUT_ENV}.
 *
 * Invariants:
 *   - Opt-out: a start whose env carries `LORE_TEST_IDENTITY=none` is left exactly as written (the variable is removed from
 *     the child's env). A test of the REFUSAL, of a human session, or of the unregistered-run rule uses it.
 *   - A start whose env already carries a run value, or is not a `lore` start is never touched.
 *   - Only under the Bun runtime (registration needs `bun:sqlite`); the few files vitest runs under Node are untouched.
 *   - Registration writes only the `runs` registry of the corpus found from `cwd`, and nothing when there is no corpus yet.
 *
 * Side-effect class: IO (one `INSERT OR IGNORE` into the registry of the corpus under `cwd`).
 */
import { DEFAULT_TEST_RUN, HARNESS_RUN_ENV, registerTestRun, testSessionOf } from "../packages/lore/tests/helpers/test-run-identity";

/** Env variable a test sets to `none` to start `lore` with no run injected. */
export const KNOWN_PARTY_OPT_OUT_ENV = "LORE_TEST_IDENTITY";

/**
 * The `lore` entry as a spawn names it: the source entry of any checkout, the compiled binary, or an operator script that
 * resolves its identity through `resolveEntryInvocation` exactly as `lore` does (and so reads the per-call run value).
 */
const LORE_ENTRY = /(?:packages\/lore\/src\/index\.ts|\/dist\/lore|\/scripts\/seed-write-spec-rule\.ts)$/;

/** How far into an argv the entry may sit (`bun run --preload X --bun ENTRY`). */
const ENTRY_SEARCH_DEPTH = 8;

type EnvBag = Readonly<Record<string, string | undefined>>;

/** What {@link rewriteLoreStart} hands back: the argv to start and the env to start it with (when one was given). */
export interface RewrittenStart {
  readonly argv: string[];
  readonly env: EnvBag | undefined;
}

function isEnvBag(value: unknown): value is EnvBag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * {@link rewriteLoreStart} for the argument list of a `node:child_process` start (`spawn`/`spawnSync`/`execFile`/`execFileSync`:
 * `(file, args?, options?, ...rest)`). Shell-string starts (`exec`/`execSync`) are never rewritten.
 *
 * @returns the argument list to call the real function with, or `undefined` to call it with the original
 */
export function rewriteNodeSpawnArgs(args: readonly unknown[]): unknown[] | undefined {
  const [command, second, third, ...rest] = args;
  if (typeof command !== "string" || typeof second === "function" || typeof third === "function") return undefined;
  const hasArgsArray = Array.isArray(second);
  const options = hasArgsArray ? third : second;
  const optionBag = typeof options === "object" && options !== null ? (options as { cwd?: unknown; env?: unknown }) : {};
  const original = hasArgsArray ? (second as unknown[]).map(String) : [];
  const rewritten = rewriteLoreStart([command, ...original], optionBag);
  if (rewritten === undefined) return undefined;
  // reason: the opt-out variable is stripped from the env the child gets; an options value that is not an object (an
  // encoding string, undefined) carries no env to strip and is passed on as it was.
  // reason: the rewritten start always carries an env (the run value rides in it), also when the test passed no options.
  const nextOptions = rewritten.env === undefined ? options : { ...optionBag, env: rewritten.env };
  const tail = hasArgsArray ? rest : args.slice(2);
  return [rewritten.argv[0], rewritten.argv.slice(1), ...(nextOptions === undefined && tail.length === 0 ? [] : [nextOptions]), ...tail];
}

/**
 * @param argv - the command and its arguments as the test passed them
 * @param options - the spawn options the test passed (`cwd`, `env`)
 * @returns the rewritten start, or `undefined` when the start is not a `lore` start this shim acts on (use the original)
 */
export function rewriteLoreStart(argv: readonly string[], options: { cwd?: unknown; env?: unknown }): RewrittenStart | undefined {
  if ((globalThis as { Bun?: unknown }).Bun === undefined) return undefined;
  const entryIndex = argv.slice(0, ENTRY_SEARCH_DEPTH).findIndex((token) => LORE_ENTRY.test(token));
  if (entryIndex === -1) return undefined;

  const env: EnvBag = isEnvBag(options.env) ? options.env : process.env;
  const providedEnv = isEnvBag(options.env) ? options.env : undefined;
  if (env[KNOWN_PARTY_OPT_OUT_ENV] === "none") {
    if (providedEnv === undefined) return undefined;
    const { [KNOWN_PARTY_OPT_OUT_ENV]: _removed, ...rest } = providedEnv;
    return { argv: [...argv], env: rest };
  }

  const loreArgs = argv.slice(entryIndex + 1);
  // reason: a start that already carries a run value is the test's own business and is never touched.
  if ((env[HARNESS_RUN_ENV] ?? "") !== "") return undefined;

  // reason: the outer Claude Code session's own id (inherited in process.env) never names a test writer.
  const session = testSessionOf(env);
  const run = session !== null ? `cc:${session}` : DEFAULT_TEST_RUN;
  const cwd = typeof options.cwd === "string" ? options.cwd : process.cwd();
  registerTestRun(cwd, run);
  // reason: the run travels as the per-call environment value, exactly as the Bash hook hands it to a real agent call
  // (spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and); the spawned lore descends from this test process,
  // which `registerTestRun` recorded as the run's harness process, so ancestry verification accepts it.
  return { argv: [...argv], env: { ...env, [HARNESS_RUN_ENV]: run } };
}

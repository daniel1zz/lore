/**
 * Test-run marker, shared half (task-skill-implement-tg-23, AC-TG-2 under the one runner).
 *
 * Purpose: arm `LORE_TEST_SANDBOX=1` + `LORE_TEST_SANDBOX_REPO=<protected checkout>` for a
 * vitest run and PROVE the arming reaches spawned children.
 * Why two steps: under the Bun runtime (`bunx --bun vitest`) a child spawned WITHOUT an explicit
 * `env` (node:child_process spawnSync/execFileSync AND Bun.spawnSync) inherits the process's
 * STARTUP environment, not later `process.env` mutations (measured 2026-10-16). A setupFiles
 * mutation therefore arms the test process but not its children. `armSandboxEnv` runs at
 * vitest CONFIG load, in the main runner process, before any worker is forked; the workers are
 * forked with that environment as their startup environment, so their children inherit it.
 * `assertChildrenInheritSandbox` (called from the setup file, inside each worker) is the
 * fail-loud consistency check: it spawns a probe child with no env and refuses to run any
 * test when the marker did not arrive.
 *
 * Public surface: `armSandboxEnv`, `assertChildrenInheritSandbox`, `resolveProtectedRepo` (pure).
 * Consistency rule for the protected repository (LORE_TEST_SANDBOX_REPO):
 *   - unset -> this checkout's root (`checkoutRoot`);
 *   - set   -> must be an absolute path to a lore checkout (contains `scripts/test-isolation-env.ts`
 *              and `vitest.config.ts`) and is KEPT, normalised: a nested run (the sandbox falsifier
 *              runs vitest inside a scratch worktree under $TMPDIR) legitimately inherits the OUTER
 *              repo as the protected one, and replacing it would un-protect the outer repo;
 *   - set but relative, empty, or not a lore checkout -> throws (never silently replaced).
 * An inherited LORE_TEST_SANDBOX that is not "1" is overwritten: the marker is always armed.
 * Side-effect class: stateful (`armSandboxEnv` mutates the env object it is given); the probe spawns a process.
 */
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const MARKER = "LORE_TEST_SANDBOX";
const REPO = "LORE_TEST_SANDBOX_REPO";

type EnvBag = Record<string, string | undefined>;

function isLoreCheckout(dir: string): boolean {
  return existsSync(join(dir, "scripts", "test-isolation-env.ts")) && existsSync(join(dir, "vitest.config.ts"));
}

/** The protected repository for a run started in `checkoutRoot`, given the inherited REPO value. Throws on an untrustworthy value. */
export function resolveProtectedRepo(checkoutRoot: string, inherited: string | undefined): string {
  if (inherited === undefined) return realpathSync(checkoutRoot);
  if (inherited === "" || !isAbsolute(inherited)) {
    throw new Error(
      `test-isolation: ${REPO} is ${JSON.stringify(inherited)}; it must be an absolute path to the protected lore checkout (or unset).`,
    );
  }
  if (!isLoreCheckout(inherited)) {
    throw new Error(
      `test-isolation: ${REPO}=${JSON.stringify(inherited)} is not a lore checkout (no scripts/test-isolation-env.ts and vitest.config.ts); ` +
        `refusing to treat it as the protected repository.`,
    );
  }
  return realpathSync(inherited);
}

/** Arms the marker in `env` (default `process.env`). Call at vitest config load so forked workers inherit it as startup env. */
export function armSandboxEnv(checkoutRoot: string, env: EnvBag = process.env): void {
  const repo = resolveProtectedRepo(checkoutRoot, env[REPO]);
  env[MARKER] = "1";
  env[REPO] = repo;
}

/** The slice of `spawnSync` the probe reads; injectable so the verdict logic is testable without a real child. */
export type ProbeSpawn = (
  command: string,
  args: string[],
) => { status: number | null; stdout?: string | null; error?: Error | undefined };

const EXIT_MARKER_UNARMED = 3;
const EXIT_REPO_MISMATCH = 4;

/** What a child spawned with no explicit env reports about the sandbox marker, read from its EXIT STATUS. */
export type ChildSandboxVerdict = "armed" | "marker-unarmed" | "repo-mismatch";

const DEFAULT_PROBE_SPAWN: ProbeSpawn = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });

/**
 * Spawns a child with NO explicit env and reports whether it saw the armed marker and `expectedRepo`.
 * The verdict is the child's EXIT STATUS, never its stdout: under the Bun runtime a spawnSync call
 * intermittently returns stdout "" with status 0 (about 1 in 18000 under load, measured 2026-10-19,
 * TG-49), which a stdout-reading probe misreported as an unarmed environment (TG-51 applies this to every
 * test-infrastructure env probe). A spawn error or an unexpected status throws: not measured is never a verdict.
 * @throws {Error} when the probe child fails to run.
 */
export function childSandboxVerdict(expectedRepo: string, spawn: ProbeSpawn = DEFAULT_PROBE_SPAWN): ChildSandboxVerdict {
  const script = `[ "$${MARKER}" = 1 ] || exit ${EXIT_MARKER_UNARMED}; [ -n "$${REPO}" ] && [ "$${REPO}" = "$1" ] || exit ${EXIT_REPO_MISMATCH}`;
  const probe = spawn("sh", ["-c", script, "sh", expectedRepo]);
  if (probe.error !== undefined) {
    throw new Error(`test-isolation: the child-environment probe failed to run: ${probe.error.message}`);
  }
  if (probe.status === EXIT_MARKER_UNARMED) return "marker-unarmed";
  if (probe.status === EXIT_REPO_MISMATCH) return "repo-mismatch";
  if (probe.status !== 0) {
    throw new Error(`test-isolation: the child-environment probe failed to run: exit ${String(probe.status)}`);
  }
  return "armed";
}

/** Throws unless a child spawned with no explicit env sees the armed marker and this process's recorded repository. */
export function assertChildrenInheritSandbox(spawn: ProbeSpawn = DEFAULT_PROBE_SPAWN): void {
  const expectedRepo = process.env[REPO] ?? "";
  const verdict = childSandboxVerdict(expectedRepo, spawn);
  if (verdict === "marker-unarmed") {
    throw new Error(
      `test-isolation: a child spawned with no explicit env saw ${MARKER} is not "1". Under the Bun runtime children inherit only the STARTUP environment; ` +
        `vitest.config.ts must arm it at config load (scripts/test-isolation-env.ts) and the run must go through that config. ` +
        `Without it spawned children would run unguarded against this repository's corpus.`,
    );
  }
  if (verdict === "repo-mismatch") {
    throw new Error(
      `test-isolation: a child spawned with no explicit env saw a ${REPO} that is empty or differs from this process's ${JSON.stringify(expectedRepo)}; ` +
        `the run's environment is inconsistent.`,
    );
  }
}

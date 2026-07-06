/**
 * Shared hermeticity helper — fail-fast stub `claude` binary + PATH shim.
 *
 * Extracted from `tests/integration/cli/assess.test.ts`'s original `beforeEach` (SPEC-034
 * §"Hermeticity (MANDATORY, learned from assess.test.ts N3 incident 2026-07-06)") so every
 * integration test that spawns the real CLI on an AI-intent command (`assess`, `review`)
 * shares ONE stub-binary implementation instead of re-copying the shell-script literal.
 *
 * Without this shim, a negative-space assertion like "AI provider fails → exit 6" would
 * silently resolve the REAL `claude` binary on any dev machine that has one on PATH —
 * slow, non-deterministic, and burns a real API call. That is a defect in the test, not
 * an environment quirk: `installStubClaude` + `stubClaudeEnv` make the CLI's AI-provider
 * spawn (`claude-cli-provider.ts`) always hit a deterministic exit-1 failure instead.
 *
 * Public surface:
 *   - installStubClaude(tmpDir) — writes a `stub-bin/claude` fail-fast script under tmpDir
 *   - stubClaudeEnv(cwd, stubBinDir) — env object for `spawnSync`, PATH-prepended with
 *     stubBinDir so `claude` resolves to the stub before any real installation
 *
 * Side-effect class: IO (writes one file to disk per call)
 *
 * Source: SPEC-034 §"Hermeticity (MANDATORY...)"
 */

import { mkdirSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";

/** Result of {@link installStubClaude} — the directory the stub `claude` binary lives in. */
export interface StubClaudeSetup {
  /** Absolute path to the directory containing the stub `claude` executable. */
  stubBinDir: string;
}

/**
 * Write a fail-fast stub `claude` binary under `<tmpDir>/stub-bin/claude`. The stub always
 * exits 1 with a stderr message identifying itself as the hermetic test shim — any test
 * relying on this stub being invoked can assert on that message to prove the REAL `claude`
 * binary was never reached.
 *
 * @param tmpDir - Root temp directory for the test (same dir passed as `cwd` to `runLore`)
 * @returns `{stubBinDir}` — pass to {@link stubClaudeEnv} to build the spawn env
 */
export function installStubClaude(tmpDir: string): StubClaudeSetup {
  const stubBinDir = join(tmpDir, "stub-bin");
  mkdirSync(stubBinDir, { recursive: true });
  const stubClaudePath = join(stubBinDir, "claude");
  writeFileSync(stubClaudePath, '#!/bin/sh\necho "stub claude: refusing (hermetic test shim)" >&2\nexit 1\n');
  chmodSync(stubClaudePath, 0o755);
  return { stubBinDir };
}

/**
 * Build the environment object for `spawnSync("bun", ["run", INDEX_TS, ...args], {env})` —
 * `PATH` is prepended with `stubBinDir` so `claude` resolves to the stub before any real
 * installation on the host machine's PATH.
 *
 * @param cwd - The test's isolated HOME/cwd (also used as `HOME`, mirroring the original
 *   assess.test.ts idiom — an isolated HOME keeps ~/.claude config out of the loop)
 * @param stubBinDir - `stubBinDir` from {@link installStubClaude}
 * @returns Env object suitable for `spawnSync`'s `env` option
 */
export function stubClaudeEnv(cwd: string, stubBinDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: cwd,
    EDITOR: "true",
    CLAUDECODE: "1",
    PATH: `${stubBinDir}:${process.env.PATH ?? ""}`,
  };
}

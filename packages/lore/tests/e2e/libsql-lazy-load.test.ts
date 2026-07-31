/**
 * @spec_ref spec-eager-libsql-load-makes-every-command-depend-on-a-healthy
 *   AC-LL-1, AC-LL-2, AC-LL-3, AC-LL-4, AC-LL-8, AC-LL-9
 *
 * RED oracle (T1 of the "lazy libsql load + TMPDIR diagnostic" plan): proves
 * the defect described by the governing spec is observable on the CURRENT
 * (unfixed) `dist/lore` binary, before T2's implementation lands.
 *
 * AC-LL-8 and AC-LL-9 (T3 of the same plan) are NOT RED-before-GREEN oracles
 * — they mechanize two coverage gaps `lore assess` found in the ALREADY
 * CORRECT T2 implementation:
 *
 *   - AC-LL-8 turns a one-time hand audit ("every `createApp` call site was
 *     enumerated and none passes a sync-bearing config to a CLI-reachable
 *     path") into a standing oracle. `adapters/cli/loader.ts::loadLoreApp`
 *     strips `config.sync` unconditionally BEFORE calling `createApp`
 *     (loader.ts's own "Strip sync section" comment) — so a sync-enabled
 *     corpus run through ANY `loadLoreApp`-routed command (`lore status`)
 *     behaves identically to a SQLite-only corpus, even under a hostile
 *     `TMPDIR`. `app.ts`'s Turso branch holds a synchronous `createRequire`
 *     fallback for the no-injected-client case that is KNOWN to throw
 *     `Cannot find module` from a compiled binary (see that branch's own
 *     header comment) — today nothing but this strip keeps that branch
 *     unreached from the CLI. If the strip is ever removed, this AC goes red
 *     the moment `bun run build` + this test run.
 *   - AC-LL-9 is the untested half of AC-LL-4's pinned ordering (credential
 *     validation FIRST, TMPDIR probe SECOND, native load LAST). AC-LL-4's own
 *     fixture supplies a VALID token, so it cannot distinguish
 *     credential-first from probe-first — both orderings produce the same
 *     "fails at TMPDIR" observable under a valid credential. Only a fixture
 *     with credentials MISSING under the same bad `TMPDIR` can tell them
 *     apart: credential-first must report the missing-credential error
 *     (naming the credential, first line silent on `TMPDIR`); probe-first
 *     would report the TMPDIR error instead.
 *
 * Defect: `packages/lore/src/app.ts` statically imports `TursoStore`, which
 * statically imports `@libsql/client` — so EVERY compiled-binary invocation
 * that pulls in `app.ts` (any corpus command) or `commands/sync.ts` (the
 * `sync` subcommand group) unpacks the embedded native `.node` module to
 * `$TMPDIR` at process-import time, regardless of whether the corpus actually
 * uses Turso sync. An unusable `TMPDIR` makes the unpack fail, `dlopen` falls
 * back to the bunfs virtual path, and the process dies with a trace that
 * never names `TMPDIR` — the operator has no way to diagnose it.
 *
 * These four ACs spawn the COMPILED `dist/lore` binary as a subprocess
 * (never `bun run dev`) because the defect is specifically about the
 * embedded-native-module unpack path, which only exists in a `bun build
 * --compile` binary — running from source under `bun run dev` resolves
 * `@libsql/client` straight from `node_modules` and would never reproduce
 * the failure. `bun run build` MUST have been run in THIS worktree before
 * this file is executed, or these tests measure a stale binary (this repo's
 * documented false-oracle vector #4 — see root CLAUDE.md's dogfood log).
 *
 * Runner: vitest (never bun test) — this file touches no `bun:sqlite`
 * itself, only spawns a subprocess; `bun:sqlite` is a vitest SSR external,
 * which is exactly why the in-process `createApp` ACs (AC-LL-5, AC-LL-7)
 * live in the SIBLING `.bun.test.ts` file instead of here.
 *
 * Fixture discipline: every corpus is a fresh `mkdtempSync` directory
 * initialised via `lore init` — this repo's own `.lore/` corpus is NEVER
 * touched by a test (root CLAUDE.md).
 *
 * AC-LL-4 command choice (`lore sync push`, not `lore status`): `lore
 * status` (and every other corpus-level command reached via
 * `adapters/cli/loader.ts::loadLoreApp`) unconditionally STRIPS the `sync`
 * section of config before calling `createApp` (see that file's own "Strip
 * sync section" comment) — so no corpus-level command can ever reach the
 * credential-resolution / TursoStore-construction path `createApp`'s Turso
 * branch documents, regardless of this spec's fix. `lore sync push`
 * (`adapters/cli/commands/sync.ts`) is the one CLI surface that reads
 * `config.sync` UNSTRIPPED and calls `resolveSyncCredentials` before ever
 * attempting to load `@libsql/client` — exactly the "credential validation
 * FIRST, TMPDIR probe SECOND, native load LAST" ordering AC-LL-4 pins, and
 * the literal command already exercised (RED, pre-fix) by this repo's own
 * `tests/e2e/sync-cli.bun.test.ts`. See this file's closing report for the
 * flip side: `sync.ts` module-level-imports `@libsql/client` too (line 8),
 * so a fix that only touches `app.ts`/`turso-store.ts` and leaves
 * `sync.ts`'s import eager would leave AC-LL-4 permanently RED — this is
 * exactly why the governing spec's Scope section calls out `sync.ts` by
 * name for audit, not an oversight in this oracle.
 */

import { afterEach, describe, expect, it } from "vitest";
import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// packages/lore/tests/e2e -> tests -> lore -> packages -> <repo root>
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

const SPAWN_TIMEOUT_MS = 15_000;

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  /** stdout + stderr concatenated — AC-LL-2 requires a COMBINED-channel check. */
  combined: string;
}

/** Fresh throwaway corpora created by this file's tests — swept in afterEach. */
const scratchDirs: string[] = [];

function makeCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-libsql-lazy-"));
  scratchDirs.push(dir);
  const init = spawnSync(LORE_BIN, ["init", "--author", "libsql-lazy-load-oracle"], {
    cwd: dir,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  if (init.status !== 0) {
    throw new Error(
      `fixture setup failed: \`lore init\` exited ${String(init.status)}\n` +
        `stdout: ${init.stdout}\nstderr: ${init.stderr}`,
    );
  }
  return dir;
}

/**
 * Overwrites the fixture's `.lore/config.yaml` with a sync-enabled section.
 * `remote_url` is deliberately DNS-invalid (`.invalid` TLD, RFC 2606) so no
 * real network call can ever succeed — AC-LL-4 explicitly requires "no
 * reachable network required — the run must fail at TMPDIR, earlier than
 * any connection attempt". Same convention this repo's own
 * `tests/e2e/sync-cli.bun.test.ts` already uses.
 */
function writeSyncEnabledConfig(dir: string, tokenEnvName: string): void {
  writeFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "project:",
      "  name: libsql-lazy-load-oracle",
      "  author: libsql-lazy-load-oracle",
      "sync:",
      "  enabled: true",
      '  remote_url: "libsql://nonexistent-host-for-tests.invalid"',
      `  auth_token_env: ${tokenEnvName}`,
      "  interval: 60",
      "",
    ].join("\n"),
  );
}

function runLore(
  args: string[],
  cwd: string,
  envOverrides: Record<string, string | undefined> = {},
): RunResult {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const result: SpawnSyncReturns<string> = spawnSync(LORE_BIN, args, {
    cwd,
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { status: result.status ?? -1, stdout, stderr, combined: stdout + stderr };
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe("libsql lazy load — compiled binary e2e (spec-eager-libsql-load-makes-every-command-depend-on-a-healthy)", () => {
  // No-regression control (NOT probe-liveness evidence, per the spec text):
  // this run drives no TMPDIR probe at all. Its only job is to exclude
  // "AC-LL-1 was satisfied by breaking the command outright" — see AC-LL-4
  // for the actual probe-liveness evidence.
  it(
    "AC-LL-3: lore status under a normal writable TMPDIR exits 0 and reports Total documents",
    () => {
      const dir = makeCorpus();
      const result = runLore(["status"], dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Total documents");
    },
    SPAWN_TIMEOUT_MS,
  );

  // The RED->GREEN pin. Currently: the compiled binary's static TursoStore
  // import forces a native-module unpack at process-import time regardless
  // of config, so a bad TMPDIR crashes the process (dlopen) before `lore
  // status` ever gets to run. Exit 0 alone would also be produced by a
  // command that silently does nothing — the stdout content check rules
  // that out.
  it(
    "AC-LL-1: lore status on a SQLite-only corpus under TMPDIR=/nonexistent-tmpdir-probe exits 0 and reports Total documents",
    () => {
      const dir = makeCorpus();
      const result = runLore(["status"], dir, { TMPDIR: "/nonexistent-tmpdir-probe" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Total documents");
    },
    SPAWN_TIMEOUT_MS,
  );

  // Same run as AC-LL-1, reproduced independently (each AC's `-t` filter
  // must be able to select and evaluate it standalone) — combined-channel
  // negative check. The forbidden literal is the narrow "$bunfs" (virtual
  // path form), not a bare "bunfs", so prose merely explaining the
  // mechanism could never trip it.
  it(
    "AC-LL-2: that bad-TMPDIR run's combined stdout+stderr names neither dlopen nor $bunfs",
    () => {
      const dir = makeCorpus();
      const result = runLore(["status"], dir, { TMPDIR: "/nonexistent-tmpdir-probe" });
      expect(result.combined).not.toContain("dlopen");
      expect(result.combined).not.toContain("$bunfs");
    },
    SPAWN_TIMEOUT_MS,
  );

  // Probe-liveness evidence for a corpus that GENUINELY needs libsql.
  // Fixture literals are pinned by the spec exactly (see header comment for
  // why `lore sync push` is the chosen CLI surface). Ordering pinned on the
  // implementation: credential validation first (this fixture supplies a
  // non-empty token, so credential validation must PASS), TMPDIR usability
  // probe second, native load last — the run must fail at the TMPDIR probe,
  // never reaching the network.
  it(
    "AC-LL-4: lore sync push on a sync-enabled corpus under a bad TMPDIR fails loud naming TMPDIR, not a raw dlopen trace",
    () => {
      const dir = makeCorpus();
      const tokenEnvName = "LORE_SYNC_TOKEN";
      writeSyncEnabledConfig(dir, tokenEnvName);
      const result = runLore(["sync", "push"], dir, {
        [tokenEnvName]: "probe-token-not-a-real-credential",
        TMPDIR: "/nonexistent-tmpdir-probe",
      });
      // STORE_ERROR exit-code mapping (adapters/cli/utils.ts::exitCode) — pinned
      // explicitly because the four substring rules below are independently
      // satisfiable by a run that prints the right diagnostic and still exits 0.
      expect(result.status).toBe(1);
      // (a) the literal token TMPDIR
      expect(result.stderr).toContain("TMPDIR");
      // (b) the literal fixture value /nonexistent-tmpdir-probe
      expect(result.stderr).toContain("/nonexistent-tmpdir-probe");
      // (c) a remediation line containing the literal substring "export TMPDIR="
      expect(result.stderr).toContain("export TMPDIR=");
      // (d) a FIRST line containing the token TMPDIR — the actionable diagnostic
      // must lead, not sit buried under a native-loader trace. A later `dlopen`
      // mention is explicitly PERMITTED by the spec once libsql genuinely is
      // required — only the first line is pinned.
      const firstLine = result.stderr.split("\n")[0] ?? "";
      expect(firstLine).toContain("TMPDIR");
    },
    SPAWN_TIMEOUT_MS,
  );

  // Unreachability guard (Gap 1 from the plan's `lore assess`, task
  // T3). Fixture mirrors AC-LL-4's sync-enabled corpus, but the invocation
  // is `lore status` — a command routed through `loadLoreApp`, which strips
  // `config.sync` unconditionally (loader.ts:160) before ever calling
  // `createApp`. That strip is the ONLY reason a sync-enabled corpus behaves
  // identically to a SQLite-only one here: `app.ts`'s Turso branch (holding
  // the synchronous `createRequire` fallback known to throw `Cannot find
  // module` from a compiled binary — see that branch's own header comment)
  // is never reached. Remove the strip and this test goes red immediately,
  // regardless of which specific failure inside that branch fires first —
  // the point of this AC is standing proof the branch stays unreached from
  // the CLI, not a specific crash signature.
  it(
    "AC-LL-8: lore status on a sync-enabled corpus under TMPDIR=/nonexistent-tmpdir-probe still exits 0 and reports Total documents (createApp Turso-branch unreachability guard)",
    () => {
      const dir = makeCorpus();
      const tokenEnvName = "LORE_SYNC_TOKEN";
      writeSyncEnabledConfig(dir, tokenEnvName);
      const result = runLore(["status"], dir, {
        [tokenEnvName]: "probe-token-not-a-real-credential",
        TMPDIR: "/nonexistent-tmpdir-probe",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Total documents");
    },
    SPAWN_TIMEOUT_MS,
  );

  // The untested half of AC-LL-4's pinned ordering (Gap 2 from the plan's
  // `lore assess`, task T3). AC-LL-4 supplies a VALID token, so it cannot
  // distinguish "credential validation runs first" from "TMPDIR probe runs
  // first" — both orderings fail at TMPDIR under that fixture. Flipping
  // credentials to MISSING under the SAME bad TMPDIR is the one observation
  // that separates them: `lore sync push` calls `resolveSyncCredentials`
  // before it ever calls `performPush` (which is what runs the TMPDIR
  // probe) — see `commands/sync.ts`'s `syncPushCmd.run()`. A credential-first
  // implementation must report the missing-credential failure; a
  // probe-first implementation would report the TMPDIR failure instead.
  it(
    "AC-LL-9: lore sync push on a sync-enabled corpus with credentials MISSING under a bad TMPDIR reports the credential failure, not TMPDIR, first",
    () => {
      const dir = makeCorpus();
      const tokenEnvName = "LORE_SYNC_TOKEN";
      writeSyncEnabledConfig(dir, tokenEnvName);
      const result = runLore(["sync", "push"], dir, {
        // Explicitly absent — the runLore helper deletes any ambient value
        // for this key from the child's env when the override is undefined.
        [tokenEnvName]: undefined,
        TMPDIR: "/nonexistent-tmpdir-probe",
      });
      // Credential resolution failure is a hard CLI exit, same as AC-LL-4's
      // TMPDIR failure — sanity check that the process didn't silently
      // succeed past the missing-credential state.
      expect(result.status).not.toBe(0);
      // stderr names the missing credential (the env var name).
      expect(result.stderr).toContain(tokenEnvName);
      // The distinguishing assertion: the FIRST line must not mention
      // TMPDIR at all — a probe-first implementation would lead with the
      // TMPDIR diagnostic instead of the credential one.
      const firstLine = result.stderr.split("\n")[0] ?? "";
      expect(firstLine).not.toContain("TMPDIR");
    },
    SPAWN_TIMEOUT_MS,
  );
});

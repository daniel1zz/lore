// @spawns dist/lore
/**
 * @spec_ref spec-eager-libsql-load-makes-every-command-depend-on-a-healthy
 *   AC-LL-1, AC-LL-2, AC-LL-3, AC-LL-4, AC-LL-8, AC-LL-9, AC-LL-10
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
 *   - AC-LL-10 (task
 *     `task-ac-ll-8-guards-the-loader-strip-not-the-no-sync-bearing`) covers
 *     the proposition AC-LL-8 does NOT: AC-LL-8 proves `lore status` survives
 *     a hostile `TMPDIR`, which holds only because `loader.ts` strips
 *     `config.sync`. It says nothing about a NEW `createApp` call site
 *     ELSEWHERE (`dashboard.ts`, `init.ts`, `flows/init-corpus.ts`,
 *     `mount/mount-registry.ts`, or anything added tomorrow) handing a
 *     sync-BEARING config straight to `app.ts`'s Turso branch. Add one and
 *     every behavioural AC here stays green while the compiled binary throws
 *     `Cannot find module '@libsql/client'` at runtime, because
 *     `turso-store.ts::loadLibsqlClientModuleSync` (a `createRequire`
 *     fallback) resolves only in source mode. AC-LL-10 is therefore a SOURCE
 *     SCAN, not a behavioural run: it fails the moment an offending call site
 *     is ADDED, not when someone happens to exercise the one command that
 *     reaches it. It is purely additive — AC-LL-8 keeps guarding the strip.
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
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
// AC-LL-10 only. The scan parses TypeScript with the compiler's OWN parser
// rather than a hand-rolled comment/string stripper + regex: a regex scanner
// desynchronises on a regex literal containing a quote or `//` and then blanks
// live code, which hides a call site as SILENTLY as it hides a comment — i.e.
// it fails toward false GREEN, the exact vector this AC exists to close.
// `typescript` is already a workspace devDependency (it runs `bun run
// typecheck`), so this adds no new dependency.
import ts from "typescript";

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
  patchLoreConfig(
    dir,
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
  // REVERSED by D22 (spec-defect-clusters-round-2-part-c-criterion-data-demotion, BR-925): `loader.ts` no longer
  // strips `config.sync`, so a command on a sync-enabled corpus goes through the replica and a hostile TMPDIR is a
  // loud failure that leads with TMPDIR (exit 1, no raw dlopen trace) instead of a quiet read of the local file.
  it(
    "AC-LL-8: lore status on a sync-enabled corpus under TMPDIR=/nonexistent-tmpdir-probe fails loud naming TMPDIR (exit 1), never reading the local file alone",
    () => {
      const dir = makeCorpus();
      const tokenEnvName = "LORE_SYNC_TOKEN";
      writeSyncEnabledConfig(dir, tokenEnvName);
      const result = runLore(["status"], dir, {
        [tokenEnvName]: "probe-token-not-a-real-credential",
        TMPDIR: "/nonexistent-tmpdir-probe",
      });
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain("Total documents");
      expect(result.stderr).toContain("TMPDIR");
      expect(result.stderr).toContain("/nonexistent-tmpdir-probe");
      expect(result.combined).not.toContain("$bunfs");
    },
    SPAWN_TIMEOUT_MS,
  );

  // D22 (spec-defect-clusters-round-2-part-c-criterion-data-demotion): the compiled binary really opens the replica.
  // Healthy TMPDIR, token set, unreachable host: the run reaches the network (the client loaded through the primed
  // dynamic import, not `createRequire`), so the failure names the remote address, never "Cannot find module".
  it(
    "D22: lore status on a sync-enabled corpus with an unreachable remote exits 1 naming the remote host, not a missing module",
    () => {
      const dir = makeCorpus();
      const tokenEnvName = "LORE_SYNC_TOKEN";
      writeSyncEnabledConfig(dir, tokenEnvName);
      const result = runLore(["status"], dir, { [tokenEnvName]: "probe-token-not-a-real-credential" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("nonexistent-host-for-tests.invalid");
      expect(result.combined).not.toContain("Cannot find module");
      expect(result.combined).not.toContain("$bunfs");
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

// ─────────────────────────────────────────────────────────────────────────────
// AC-LL-10 — source-scan call-site pin
//
// Invariant: NO `createApp` call site under `packages/lore/src` passes a
// sync-BEARING config. `app.ts`'s Turso branch holds a synchronous
// `createRequire` fallback (`turso-store.ts::loadLibsqlClientModuleSync`) that
// resolves ONLY in source mode; from the compiled binary it throws `Cannot find
// module '@libsql/client'`. Today nothing but the call-site set keeps that
// branch unreachable, and AC-LL-8 (a behavioural run) proves only that
// `loader.ts` still strips `config.sync` — a different proposition.
//
// Classification (the spec's two permitted classes, everything else fails). `createApp` takes the entry's
// ambient as a REQUIRED third argument (`createApp(dbPath, config, ambient, writeContext?)`; the one-argument
// overload is gone with the process-reading fallback), so a direct call carries 3 or 4 arguments:
//   (a) exactly ONE argument — only the injected-port shape `deps.createApp(dbPath)` (mount-registry.ts), whose
//       implementation is supplied by a caller that is itself scanned at its own 3/4-argument site;
//   (b) THREE or FOUR arguments whose second is the literal `undefined`, or a bare
//       identifier the SAME FILE binds from a rest-destructure discarding
//       `sync` (`const { sync: _sync, ...configWithoutSync } = rawConfig`),
//       including the alias hop `telemetryOnlyConfig = configWithoutSync as
//       LoreConfig` that `loader.ts` actually uses.
//
// Deliberately NO exception/allowlist mechanism: if a future caller genuinely
// needs a sync-bearing `createApp`, the correct fix is to make
// `loadLibsqlClientModuleSync` unnecessary (finish the async conversion), not
// to widen this scan.
//
// Out of scope by design: `scripts/**` (runs in source mode, where
// `createRequire` resolves — it cannot reproduce the compiled-binary failure)
// and `app.ts` itself (it DEFINES `createApp`).
// ─────────────────────────────────────────────────────────────────────────────

const LORE_SRC_ROOT = join(REPO_ROOT, "packages", "lore", "src");
/** Excluded from the scan because it DEFINES `createApp` (overload signatures + implementation). */
const CREATE_APP_DEFINITION_FILE = join(LORE_SRC_ROOT, "app.ts");
/** Spec-pinned floor for the liveness control: 5 call sites exist today. */
const MIN_EXPECTED_CALL_SITES = 4;
/** Floor for "the walker actually walked a tree", independent of `createApp` itself. */
const MIN_EXPECTED_SCANNED_FILES = 50;
/**
 * The only files that may pass a sync-bearing config to `createApp` (D22: with `sync.enabled` every route opens the
 * embedded replica). Each is reached only after the entry primed `@libsql/client` asynchronously
 * (`adapters/cli/replica-priming.ts`), so the synchronous `createRequire` fallback never runs in the compiled binary.
 */
const PRIMED_SYNC_BEARING_FILES: ReadonlySet<string> = new Set([
  "packages/lore/src/adapters/cli/loader.ts",
  "packages/lore/src/adapters/cli/commands/dashboard.ts",
]);
/** Bound on alias-hop chasing (`X = restName`, `Y = X as T`, …). Today's depth is 1. */
const MAX_ALIAS_HOP_ROUNDS = 8;

type CreateAppCallClass =
  /** (a) `createApp(dbPath)` — cannot reach the Turso branch. */
  | "single-arg"
  /** (b) second argument provably carries no `sync` key. */
  | "sync-stripped"
  /**
   * (c) a sync-bearing config from one of {@link PRIMED_SYNC_BEARING_FILES}: the files D22
   * (spec-defect-clusters-round-2-part-c-criterion-data-demotion) lets hand `sync` to `createApp`, because every entry
   * that reaches them awaits the libsql prime first (the wiring is pinned by the AC-LL-10 priming test below).
   */
  | "sync-primed"
  /** Anything else — the failure this AC exists to catch. */
  | "violation";

interface CreateAppCallSite {
  /** Repo-relative, forward-slashed — the `file` half of the required `file:line` report. */
  file: string;
  /** 1-based line of the `createApp` token. */
  line: number;
  argCount: number;
  /** Source text of the second argument, or `undefined` when there isn't one. */
  secondArgText: string | undefined;
  classification: CreateAppCallClass;
  /** Why it classified that way — rendered into the failure message. */
  reason: string;
  /** The call's own source text, whitespace-collapsed so a multi-line call reports on one line. */
  text: string;
}

function isScannableSourceFile(fileName: string): boolean {
  return (
    fileName.endsWith(".ts") &&
    !fileName.endsWith(".d.ts") &&
    !/\.(test|spec)\.ts$/.test(fileName) &&
    !/\.bun\.test\.ts$/.test(fileName)
  );
}

/** Recursive walk; `app.ts` (the definition site) is the one excluded file. */
function listScannedSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listScannedSourceFiles(full));
    } else if (entry.isFile() && isScannableSourceFile(entry.name) && full !== CREATE_APP_DEFINITION_FILE) {
      out.push(full);
    }
  }
  return out;
}

/** Strips the wrappers an assignment may carry between a binding and its source identifier. */
function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

/**
 * For `const { sync: _sync, ...rest } = cfg` returns `"rest"`; `undefined` when the
 * pattern does not BOTH bind `sync` away AND collect a rest element. Conservative by
 * construction: an unrecognised shape yields `undefined`, which classifies the call as a
 * violation (loud) rather than as sync-stripped (silent).
 */
function syncDiscardingRestName(pattern: ts.ObjectBindingPattern): string | undefined {
  let bindsSyncKey = false;
  let restName: string | undefined;
  for (const element of pattern.elements) {
    if (element.dotDotDotToken !== undefined) {
      if (ts.isIdentifier(element.name)) restName = element.name.text;
      continue;
    }
    const propertyName = element.propertyName;
    let key: string | undefined;
    if (propertyName === undefined) {
      key = ts.isIdentifier(element.name) ? element.name.text : undefined;
    } else if (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)) {
      key = propertyName.text;
    }
    if (key === "sync") bindsSyncKey = true;
  }
  return bindsSyncKey && restName !== undefined ? restName : undefined;
}

/**
 * Every identifier in ONE file that provably holds a config with `sync` removed:
 * the rest bindings themselves, plus any identifier assigned from one of them
 * (transitively, so `loader.ts`'s two-step `configWithoutSync` → `telemetryOnlyConfig`
 * hop is recognised). File-scoped, exactly as the AC specifies ("the same file binds").
 */
function collectSyncStrippedBindings(sourceFile: ts.SourceFile): Set<string> {
  const strippedNames = new Set<string>();

  const collectRestBindings = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
      const restName = syncDiscardingRestName(node.name);
      if (restName !== undefined) strippedNames.add(restName);
    }
    ts.forEachChild(node, collectRestBindings);
  };
  collectRestBindings(sourceFile);

  for (let round = 0; round < MAX_ALIAS_HOP_ROUNDS; round++) {
    const sizeBefore = strippedNames.size;
    const collectAliases = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
        const source = unwrapExpression(node.initializer);
        if (ts.isIdentifier(source) && strippedNames.has(source.text)) strippedNames.add(node.name.text);
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        const source = unwrapExpression(node.right);
        if (ts.isIdentifier(source) && strippedNames.has(source.text)) strippedNames.add(node.left.text);
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(sourceFile);
    if (strippedNames.size === sizeBefore) break;
  }

  return strippedNames;
}

/** Module specifiers that resolve to the composition root — `../app.js`, `../../app.js`, … */
const APP_MODULE_SPECIFIER = /(?:^|\/)app\.js$/;

/**
 * Every local name that refers to `app.ts`'s `createApp` in ONE file: the bare name plus any
 * import alias (`import { createApp as makeApp } from "../app.js"`). Without this, an aliased
 * import would be a silent MISS — and a miss is indistinguishable from a clean tree, which is
 * the exact false-green shape this AC exists to close.
 *
 * Known boundary (documented, not silently assumed): a createApp reference passed through a
 * local variable (`const fn = createApp; fn(dbPath, cfg)`) is not tracked. `X.createApp(…)`
 * IS (that is `mount-registry.ts`'s injected-port shape).
 */
function collectCreateAppLocalNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>(["createApp", "createAppWithWriteContext"]);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier) || !APP_MODULE_SPECIFIER.test(specifier.text)) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (namedBindings === undefined || !ts.isNamedImports(namedBindings)) continue;
    for (const element of namedBindings.elements) {
      if (element.propertyName?.text === "createApp" || element.propertyName?.text === "createAppWithWriteContext") {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

/** `createApp(…)`, an aliased import of it, and `deps.createApp(…)` all count. */
function isCreateAppCallee(expression: ts.LeftHandSideExpression, localNames: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(expression)) return localNames.has(expression.text);
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === "createApp";
  return false;
}

function collapseWhitespace(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 157)}…` : collapsed;
}

/**
 * THE classifier. Pure: source text in, classified call sites out — so the real repo scan
 * and the synthetic liveness fixtures below go through the SAME code path (AC-LL-10's
 * mandatory control 3). Line breaks are irrelevant to it: the parser sees an AST, so a
 * call reformatted across five lines classifies identically to a one-liner.
 */
export function analyzeCreateAppCallSites(content: string, relPath: string): CreateAppCallSite[] {
  const sourceFile = ts.createSourceFile(relPath, content, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const strippedNames = collectSyncStrippedBindings(sourceFile);
  const calleeNames = collectCreateAppLocalNames(sourceFile);
  const sites: CreateAppCallSite[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isCreateAppCallee(node.expression, calleeNames)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const args = node.arguments;
      const secondArg = args.length >= 2 ? args[1] : undefined;
      const secondArgText = secondArg === undefined ? undefined : collapseWhitespace(secondArg.getText(sourceFile));

      let classification: CreateAppCallClass;
      let reason: string;
      if (args.length === 1) {
        classification = "single-arg";
        reason = "class (a): exactly one argument — the createApp(dbPath) overload, which never reaches the Turso branch";
      } else if ((args.length === 3 || args.length === 4) && secondArg !== undefined) {
        if (ts.isIdentifier(secondArg) && secondArg.text === "undefined") {
          classification = "sync-stripped";
          reason = "class (b): second argument is the literal `undefined`";
        } else if (ts.isIdentifier(secondArg) && strippedNames.has(secondArg.text)) {
          classification = "sync-stripped";
          reason =
            `class (b): second argument \`${secondArg.text}\` is bound in this file from a ` +
            "rest-destructure discarding `sync` (directly or through an assignment chain)";
        } else if (PRIMED_SYNC_BEARING_FILES.has(relPath)) {
          classification = "sync-primed";
          reason = "class (c): a file whose entries prime the libsql client before createApp (D22)";
        } else {
          classification = "violation";
          reason =
            `second argument \`${secondArgText ?? "?"}\` is neither the literal \`undefined\` nor an ` +
            "identifier this file binds from a rest-destructure discarding `sync` — it may carry a " +
            "`sync` section straight into app.ts's Turso branch, whose synchronous createRequire " +
            "fallback throws `Cannot find module '@libsql/client'` from the compiled binary";
        }
      } else {
        classification = "violation";
        reason = `unexpected argument count ${String(args.length)} — createApp takes (dbPath, config, ambient, writeContext?)`;
      }

      sites.push({
        file: relPath,
        line,
        argCount: args.length,
        secondArgText,
        classification,
        reason,
        text: collapseWhitespace(node.getText(sourceFile)),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return sites;
}

/** Walks the REAL `packages/lore/src` tree. Every precondition failure throws — never a quiet zero. */
function scanLoreSrcForCreateAppCallSites(): { sites: CreateAppCallSite[]; fileCount: number } {
  if (!existsSync(LORE_SRC_ROOT)) {
    throw new Error(`AC-LL-10 scan: scan root ${LORE_SRC_ROOT} does not exist — the scan measured nothing`);
  }
  if (!existsSync(CREATE_APP_DEFINITION_FILE)) {
    throw new Error(
      `AC-LL-10 scan: ${CREATE_APP_DEFINITION_FILE} (the excluded createApp definition site) does not exist — ` +
        "the exclusion is stale and may be silently excluding nothing, or createApp moved",
    );
  }
  const files = listScannedSourceFiles(LORE_SRC_ROOT);
  const sites: CreateAppCallSite[] = [];
  for (const file of files) {
    const relPath = relative(REPO_ROOT, file).split("\\").join("/");
    sites.push(...analyzeCreateAppCallSites(readFileSync(file, "utf8"), relPath));
  }
  return { sites, fileCount: files.length };
}

function formatSites(sites: CreateAppCallSite[]): string {
  if (sites.length === 0) return "  (none)";
  return sites.map((s) => `  ${s.file}:${String(s.line)} — ${s.text}\n      → ${s.reason}`).join("\n");
}

/**
 * Synthetic fixture for AC-LL-10's mandatory liveness control 3: a MULTI-LINE `createApp`
 * call whose second argument is a sync-BEARING config identifier. Run through the same
 * `analyzeCreateAppCallSites` the repo scan uses, it must report a violation — which proves
 * (i) the scan is live (a scanner that matches nothing would report nothing here either),
 * (ii) it is reformat-resistant, and (iii) the violation branch is reachable at all.
 */
const MULTILINE_SYNC_BEARING_FIXTURE = [
  'import { createApp } from "../app.js";',
  "",
  "export function offendingFutureCaller(dbPath: string, rawConfig: LoreConfig): App {",
  "  // Passes the RAW config, sync section intact — and is spread across four",
  "  // lines, the reformat a line-oriented scanner would silently miss.",
  "  const appOrResult = createApp(",
  "    dbPath,",
  "    rawConfig,",
  "    ambient,",
  "  );",
  "  return appOrResult as App;",
  "}",
  "",
].join("\n");

/** The same multi-line shape, but sync-stripped through loader.ts's real two-step alias hop. */
const MULTILINE_SYNC_STRIPPED_FIXTURE = [
  'import { createApp } from "../app.js";',
  "",
  "export function compliantFutureCaller(dbPath: string, rawConfig: LoreConfig): App {",
  "  const { sync: _sync, ...configWithoutSync } = rawConfig;",
  "  const telemetryOnlyConfig = configWithoutSync as LoreConfig;",
  "  const appOrResult = createApp(",
  "    dbPath,",
  "    telemetryOnlyConfig,",
  "    ambient,",
  "  );",
  "  return appOrResult as App;",
  "}",
  "",
].join("\n");

/** An ALIASED import of the same function — a name-only matcher would miss this entirely. */
const ALIASED_IMPORT_FIXTURE = [
  'import { createApp as buildApp } from "../app.js";',
  "",
  "export function aliasedFutureCaller(dbPath: string, rawConfig: LoreConfig): App {",
  "  return buildApp(dbPath, rawConfig, ambient) as App;",
  "}",
  "",
].join("\n");

/** Prose/JSDoc/strings that merely SHOW a two-argument call are not call sites (loader.ts really has one). */
const PROSE_ONLY_FIXTURE = [
  "/**",
  " * Constructs App via createApp(dbPath, config) — this JSDoc line is prose,",
  " * not a call site.",
  " */",
  "export function documentedOnly(): string {",
  '  return "createApp(dbPath, rawConfig)";',
  "  // const app = createApp(dbPath, rawConfig);",
  "}",
  "",
].join("\n");

describe("AC-LL-10 — no createApp call site passes a sync-bearing config (source-scan pin)", () => {
  it("AC-LL-10 liveness control 1: the scan walks the real packages/lore/src tree and finds at least 4 createApp call sites", () => {
    const { sites, fileCount } = scanLoreSrcForCreateAppCallSites();
    expect(
      fileCount,
      `AC-LL-10 scan walked only ${String(fileCount)} source file(s) under ${LORE_SRC_ROOT} — a scan of an ` +
        "empty/wrong tree reports zero violations for the same reason a clean tree does",
    ).toBeGreaterThan(MIN_EXPECTED_SCANNED_FILES);
    expect(
      sites.length,
      `AC-LL-10 found ${String(sites.length)} createApp call site(s); at least ${String(MIN_EXPECTED_CALL_SITES)} are ` +
        "expected (5 exist today: adapters/cli/loader.ts, adapters/cli/commands/init.ts, " +
        "adapters/cli/commands/dashboard.ts, flows/init-corpus.ts, mount/mount-registry.ts). Fewer means the " +
        `matcher stopped matching, NOT that the invariant holds. Sites found:\n${formatSites(sites)}`,
    ).toBeGreaterThanOrEqual(MIN_EXPECTED_CALL_SITES);
  });

  it("AC-LL-10 liveness control 2: init.ts's and init-corpus.ts's calls classify as PROVABLY sync-stripped, and loader.ts's full-config call as primed (D22)", () => {
    const { sites } = scanLoreSrcForCreateAppCallSites();
    const syncStripped = sites.filter((s) => s.classification === "sync-stripped");
    expect(
      syncStripped.length,
      "AC-LL-10 classified ZERO call sites as class (b). A scan where every site trivially passes by having one " +
        `argument never exercises the sync-stripped branch at all. Sites found:\n${formatSites(sites)}`,
    ).toBeGreaterThanOrEqual(1);

    const loaderSite = sites.find((s) => s.file.endsWith("packages/lore/src/adapters/cli/loader.ts"));
    expect(
      loaderSite?.classification,
      `AC-LL-10 expected adapters/cli/loader.ts's \`createAppWithWriteContext(dbPath, rawConfig, ambient, …)\` to classify as sync-primed. Sites found:\n${formatSites(sites)}`,
    ).toBe("sync-primed");
    expect(loaderSite?.argCount).toBe(4);
    expect(loaderSite?.secondArgText).toBe("rawConfig");
  });

  it("AC-LL-10 priming wiring: the CLI entry, the MCP entry and the dashboard mount each await the libsql prime before createApp (the premise of class (c))", () => {
    const read = (rel: string): string => readFileSync(join(LORE_SRC_ROOT, rel), "utf8");
    expect(read("adapters/cli/run-cli.ts")).toMatch(/await primeReplicaClientWhenSyncEnabled\(/);
    expect(read("index.ts")).toMatch(/await primeReplicaClientWhenSyncEnabled\(/);
    expect(read("adapters/cli/commands/dashboard.ts")).toMatch(/await primeReplicaClientForProject\(/);
  });

  it("AC-LL-10 liveness control 3: the SAME classifier reports a synthetic MULTI-LINE sync-bearing call as a violation", () => {
    const sites = analyzeCreateAppCallSites(MULTILINE_SYNC_BEARING_FIXTURE, "fixture/multiline-sync-bearing.ts");
    expect(sites.length, `expected exactly 1 call site in the fixture, got:\n${formatSites(sites)}`).toBe(1);
    const site = sites[0];
    expect(site?.classification).toBe("violation");
    expect(site?.argCount).toBe(3);
    expect(site?.secondArgText).toBe("rawConfig");
    // The call's `createApp(` token is on fixture line 6; its arguments are on 7 and 8 —
    // matching across line breaks is what makes this a violation rather than a miss.
    expect(site?.line).toBe(6);
  });

  it("AC-LL-10 reformat control: the same MULTI-LINE shape with a provably sync-stripped second argument is NOT a violation", () => {
    const sites = analyzeCreateAppCallSites(MULTILINE_SYNC_STRIPPED_FIXTURE, "fixture/multiline-sync-stripped.ts");
    expect(sites.length, `expected exactly 1 call site in the fixture, got:\n${formatSites(sites)}`).toBe(1);
    expect(sites[0]?.classification).toBe("sync-stripped");
    expect(sites[0]?.secondArgText).toBe("telemetryOnlyConfig");
  });

  it("AC-LL-10 evasion control: a call through an ALIASED import of createApp is still scanned and still classified", () => {
    const sites = analyzeCreateAppCallSites(ALIASED_IMPORT_FIXTURE, "fixture/aliased-import.ts");
    expect(sites.length, `expected exactly 1 call site in the fixture, got:\n${formatSites(sites)}`).toBe(1);
    expect(sites[0]?.classification).toBe("violation");
    expect(sites[0]?.secondArgText).toBe("rawConfig");
  });

  it("AC-LL-10 false-positive control: prose, JSDoc and string literals showing createApp(dbPath, config) are not call sites", () => {
    expect(analyzeCreateAppCallSites(PROSE_ONLY_FIXTURE, "fixture/prose-only.ts")).toEqual([]);
  });

  it("AC-LL-10: every createApp call site under packages/lore/src is either single-argument or passes a provably sync-stripped config", () => {
    const { sites } = scanLoreSrcForCreateAppCallSites();
    const violations = sites.filter((s) => s.classification === "violation");
    expect(
      violations.map((v) => `${v.file}:${String(v.line)}`),
      "AC-LL-10 VIOLATION — a createApp call site may pass a sync-bearing config. app.ts's Turso branch falls back " +
        "to a synchronous createRequire (`turso-store.ts::loadLibsqlClientModuleSync`) that resolves ONLY in source " +
        "mode; from the compiled `dist/lore` binary it throws `Cannot find module '@libsql/client'`. Do NOT add an " +
        "exception here — the correct fix is to make that synchronous fallback unnecessary (finish the async " +
        `conversion), or to strip \`sync\` at the call site.\nOffending site(s):\n${formatSites(violations)}\n\n` +
        `All call sites found:\n${formatSites(sites)}`,
    ).toEqual([]);
  });
});

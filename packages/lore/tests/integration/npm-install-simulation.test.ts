/**
 * Registry-FREE npm install simulation (SPEC-048 AC-048-C, task
 * `task-skill-test-registry-free-npm-i-install-simulation`).
 *
 * Proves the packed npm tarball installs and works end-to-end through a REAL
 * `npm install` — no registry involved — exercising exactly the layout a real
 * `npm i @scope/lore-cli` install would produce: a `node_modules/.bin/lore`
 * SYMLINK pointing into the installed package's own `dist/lore`. This is the
 * one scenario this spec's whole pipeline exists to prove safe (D5/D8/Risks
 * "npm exec-bit drop" + "execPath symlink breaks asset resolution") — the
 * OTHER e2e oracle (AC-048-B, `scripts/publish-npm.ts` bare) only verifies
 * the STAGED directory directly, which never goes through an npm bin-link at
 * all.
 *
 * Flow (single narrative, shared across every `it` via one `beforeAll` —
 * building + packing the tarball is the slow part of this suite, real `bun
 * run build` included, so it runs exactly ONCE and every assertion below
 * reads from its already-captured results):
 *   1. `bun run scripts/publish-npm.ts --pack-only` (repo root) — builds,
 *      stages, verifies, and packs a REAL `.tgz` via `npm pack` (D2 beta
 *      artifact). The produced tarball's absolute path is parsed from the
 *      pipeline's own stdout (`[publish-npm] packed artifact: <path> (...)`)
 *      rather than assumed/reconstructed, so a target/version change never
 *      desyncs this test from the real filename.
 *   2. `npm install --prefix <mkdtemp> <tarball> --no-audit --fund=false
 *      --foreground-scripts` into a THROWAWAY prefix — no registry reachable,
 *      no package.json pre-seeded (npm synthesizes one, matching a genuine
 *      first-time consumer install). `--foreground-scripts` is REQUIRED to
 *      observe the postinstall nudge at all: npm >=7 backgrounds lifecycle
 *      scripts by default and only surfaces their output on failure or under
 *      this flag (empirically confirmed against this repo's pinned npm
 *      11.9.0 while writing this test — a bare install's combined
 *      stdout+stderr contains NOTHING from postinstall.mjs even though it
 *      ran and exited 0; SPEC-048's postinstall-contract doc already predicts
 *      "stdio is piped, isTTY falsy" for the ordinary case, this just adds
 *      the one flag needed to CAPTURE that already-happening output for the
 *      oracle).
 *   3. Assertions run against the captured install output + the real
 *      installed `node_modules` tree — see the per-`it` doc comments below
 *      for which AC-048-C clause each one proves.
 *
 * SAFETY: never touches the repo's own `.lore/`/`~/.claude` (project
 * CLAUDE.md hard rule) — the npm install prefix and the `lore setup
 * --dry-run --claude-dir` target are both fresh `mkdtemp` directories,
 * removed in `afterAll`. The npm-install subprocess env is the ambient
 * `process.env` with any token/secret/key/credential/password-shaped
 * variable name stripped (never full-env passthrough of this session's
 * ambient secrets into a spawned `npm install` + its lifecycle script).
 *
 * Import note (postinstall message SSOT): rather than hardcoding a
 * duplicate copy of the nudge string, this file dynamically `import()`s
 * `npm-pkg/postinstall.mjs` itself (a runtime-COMPUTED specifier, same
 * "sidesteps tsconfig rootDir" trick `platform-map.test.ts`/
 * `publish-pipeline.test.ts` already use for repo-root `scripts/*.ts` — here
 * it is not even a rootDir issue since `.mjs` is untyped, but the technique
 * is identical) and calls its pure, side-effect-free `decide()` export to
 * compute the exact expected message. `postinstall.mjs`'s own
 * `isMainModule()` guard (checked against `process.argv[1]`) is false under
 * a plain `import()`, so importing it here triggers zero process-exit /
 * stdout-write side effects.
 *
 * Coverage dimensions: HAPPY (full pack -> install -> verify simulation,
 * covering all three AC-048-C clauses) / BOUNDARY (the installed binary is
 * genuinely reached THROUGH a real symlink, not a copy — the scenario this
 * whole test exists to exercise) / STATE (`--dry-run` leaves its target
 * directory untouched even from the installed npm layout, SPEC-046 I4) /
 * REGRESSION (installed `dist/lore` retained its owner-execute bit — the
 * npm#1808 exec-bit-drop hazard D5 exists to prevent) / NEGATIVE (the
 * captured install output carries no `npm error`/`ERR!` marker despite
 * `--foreground-scripts` verbosity — proves the whole simulation is a clean
 * run, not an error path that happens to still exit 0).
 *
 * @spec_ref AC-048-C
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// ─── Path setup ─────────────────────────────────────────────────────────────

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

/**
 * Resolves `bun`/`npm` to their ABSOLUTE paths via this test runner's OWN
 * inherited `PATH`, mirroring `tests/integration/cli/setup.test.ts`'s
 * `BUN_BIN` convention (`bunx vitest` runs test files under `node`, and this
 * suite's `npm install` subprocess env below strips some vars — an absolute
 * binary path sidesteps needing either resolvable via a possibly-narrowed
 * child `PATH`).
 */
function resolveBinOrThrow(name: string): string {
  const resolved = execSync(`command -v ${name}`, { encoding: "utf8" }).trim();
  if (!resolved) {
    throw new Error(`npm-install-simulation.test.ts: could not resolve the \`${name}\` binary via \`command -v ${name}\` — is it installed?`);
  }
  return resolved;
}

const BUN_BIN = resolveBinOrThrow("bun");
const NPM_BIN = resolveBinOrThrow("npm");

// ─── Env hygiene ────────────────────────────────────────────────────────────

/** Matches env-var NAMES this suite never forwards into a spawned subprocess (ambient session secrets — see module doc). */
const SECRET_LIKE_ENV_NAME = /token|secret|key|password|credential/i;

/**
 * `NODE_ENV`/`TEST` MUST be stripped, never merely a hygiene nicety: vitest's
 * own worker process sets both, and — empirically confirmed while writing
 * this suite — the compiled `dist/lore` binary's `--version` output (routed
 * through `consola`, same as `setup.test.ts`'s documented `--help` gotcha)
 * goes SILENT under either var, producing a false "exit 0, empty stdout"
 * verify failure inside `scripts/publish-npm.ts`'s own staged-binary smoke
 * check. This is not limited to `--help` as that file's comment suggests —
 * it reproduces on the real compiled binary's `--version` flag too.
 */
const ALWAYS_STRIPPED_ENV_NAMES = ["NODE_ENV", "TEST"];

/**
 * The ambient `process.env` with every token/secret/key/credential/password-shaped
 * variable name stripped (plus `NODE_ENV`/`TEST`, see above), and `overrides`
 * applied last. Never a bare `{...process.env}` passthrough — see module
 * doc's SAFETY note.
 */
function sanitizedEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (SECRET_LIKE_ENV_NAME.test(key)) continue;
    if (ALWAYS_STRIPPED_ENV_NAMES.includes(key)) continue;
    env[key] = value;
  }
  return { ...env, ...overrides };
}

// ─── RunResult type (mirrors setup.test.ts) ────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function run(bin: string, args: string[], cwd: string, env: Record<string, string>): RunResult {
  // reason: `spawnSync`'s default maxBuffer is 1 MiB — `lore setup --dry-run --json`'s
  // asset-manifest payload is ~1.76 MB (grows with the vendored skill/hook tree), so the
  // default silently truncated stdout at ~1 MB and the downstream JSON.parse threw
  // "Unterminated string". Raise to 64 MiB so the whole payload is captured (the binary
  // itself emits valid JSON — verified directly; this was purely a test-harness capture cap).
  const result = spawnSync(bin, args, { cwd, env, encoding: "utf8", timeout: 570_000, maxBuffer: 64 * 1024 * 1024 });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

// ─── Shared fixture state (populated once by beforeAll) ────────────────────

let tarballPath = "";
let installPrefix = "";
let installResult: RunResult;
let binSymlinkPath = "";
let versionResult: RunResult;
let setupDryRunResult: RunResult;
let setupDryRunJson: { ok: boolean; data: { targetDir: string; binPath: string; plan: { writes: Array<{ path: string }> } } };
let setupDryRunTargetDir = "";
let expectedNudgeMessage = "";

const scratchDirs: string[] = [];

function makeScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

beforeAll(async () => {
  // reason: `npm-pkg/postinstall.mjs` is a zero-dep, untyped .mjs file — a plain
  // dynamic import with a runtime-computed specifier loads and executes the
  // REAL shipped file (not a copy), giving this suite a single-source-of-truth
  // expected message instead of a hand-duplicated string that could drift.
  const postinstallModule = (await import(pathToFileURL(join(REPO_ROOT, "npm-pkg", "postinstall.mjs")).href)) as {
    decide: (input: { isTTY: boolean; env: Record<string, string | undefined> }) => { action: string; message: string };
  };
  expectedNudgeMessage = postinstallModule.decide({ isTTY: false, env: {} }).message;

  // ── Stage 1: build + stage + verify + pack (real `npm pack`, D2 beta artifact) ──
  const packResult = run(BUN_BIN, ["run", "scripts/publish-npm.ts", "--pack-only"], REPO_ROOT, sanitizedEnv());
  if (packResult.exitCode !== 0) {
    throw new Error(
      `npm-install-simulation.test.ts: \`bun run scripts/publish-npm.ts --pack-only\` failed (exit ${packResult.exitCode}).\n` +
        `stdout:\n${packResult.stdout}\nstderr:\n${packResult.stderr}`,
    );
  }
  const packedMatch = /\[publish-npm\] packed artifact: (\S+) \(/.exec(packResult.stdout);
  if (!packedMatch) {
    throw new Error(
      `npm-install-simulation.test.ts: could not find a "packed artifact:" line in publish-npm's stdout:\n${packResult.stdout}`,
    );
  }
  tarballPath = packedMatch[1] as string;
  if (!existsSync(tarballPath)) {
    throw new Error(`npm-install-simulation.test.ts: publish-npm reported tarball ${tarballPath}, but it does not exist on disk`);
  }

  // ── Stage 2: registry-free `npm i <tarball>` into a throwaway prefix ──
  installPrefix = makeScratchDir("lore-npm-install-sim-");
  installResult = run(
    NPM_BIN,
    ["install", "--prefix", installPrefix, tarballPath, "--no-audit", "--fund=false", "--foreground-scripts"],
    installPrefix,
    sanitizedEnv(),
  );

  binSymlinkPath = join(installPrefix, "node_modules", ".bin", "lore");

  // ── Stage 3: `--version` THROUGH the installed bin symlink (T4 realpath fix) ──
  versionResult = run(binSymlinkPath, ["--version"], installPrefix, sanitizedEnv());

  // ── Stage 4: `lore setup --dry-run --claude-dir <mkdtemp>/.claude` from the installed location ──
  // reason: `--claude-dir` must point at a NOT-YET-EXISTING nested path (mirrors
  // `setup.test.ts`'s own convention) — `mkdtempSync` itself always creates its
  // returned directory, so passing THAT path directly would make the "dry-run
  // leaves the target dir untouched" (I4) assertion below trivially true for the
  // wrong reason (it existed before the command ever ran).
  const setupDryRunScratchParent = makeScratchDir("lore-npm-install-sim-setup-dryrun-");
  setupDryRunTargetDir = join(setupDryRunScratchParent, ".claude");
  setupDryRunResult = run(
    binSymlinkPath,
    ["setup", "--dry-run", "--claude-dir", setupDryRunTargetDir, "--json"],
    installPrefix,
    sanitizedEnv({ PATH: "" }), // forces `claude` ENOENT deterministically; --dry-run never reaches McpRegistrar anyway (setup.test.ts convention)
  );
  setupDryRunJson = JSON.parse(setupDryRunResult.stdout);
}, 600_000);

afterAll(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
});

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("registry-free npm install simulation — HAPPY", () => {
  it(
    "AC-048-C.H1: npm install of the packed tarball exits 0",
    () => {
      expect(installResult.exitCode).toBe(0);
    },
    600_000,
  );

  it(
    "AC-048-C.H2: node_modules/.bin/lore --version works THROUGH the symlink (realpath fix proven)",
    () => {
      expect(versionResult.exitCode).toBe(0);
      expect(versionResult.stdout.trim().length).toBeGreaterThan(0);
      expect(versionResult.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    },
    600_000,
  );

  it(
    "AC-048-C.H3: `lore setup --dry-run` from the installed location resolves the shipped assets/ tree",
    () => {
      expect(setupDryRunResult.exitCode).toBe(0);
      expect(setupDryRunJson.ok).toBe(true);
      expect(setupDryRunJson.data.targetDir).toBe(setupDryRunTargetDir);
      expect(setupDryRunJson.data.plan.writes.length).toBeGreaterThan(0);
      // A specific, stable governance asset — proves the STAGED assets/ tree (not an
      // empty/missing one) was actually walked from the real installed package dir.
      expect(setupDryRunJson.data.plan.writes.some((w) => w.path.includes("corpus-workflow.md"))).toBe(true);
    },
    600_000,
  );

  it(
    "AC-048-C.H4: postinstall ran and emitted the one-line nudge (non-TTY branch) with install exit 0",
    () => {
      expect(expectedNudgeMessage.length).toBeGreaterThan(0);
      const combinedOutput = `${installResult.stdout}\n${installResult.stderr}`;
      expect(combinedOutput).toContain(expectedNudgeMessage);
      expect(installResult.exitCode).toBe(0);
    },
    600_000,
  );
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("registry-free npm install simulation — BOUNDARY", () => {
  it(
    "AC-048-C.B1: node_modules/.bin/lore is a genuine symlink (not a copy) into the installed package's dist/lore",
    () => {
      expect(existsSync(binSymlinkPath)).toBe(true);
      expect(lstatSync(binSymlinkPath).isSymbolicLink()).toBe(true);
      const realBinPath = realpathSync(binSymlinkPath);
      expect(realBinPath).not.toBe(binSymlinkPath);
      expect(realBinPath.endsWith(join("dist", "lore"))).toBe(true);
      // setup's own realpath resolution (T4 fix) must land on the SAME real path.
      expect(setupDryRunJson.data.binPath).toBe(realBinPath);
    },
    600_000,
  );
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("registry-free npm install simulation — STATE", () => {
  it(
    "AC-048-C.S1: `--dry-run` leaves its --claude-dir target directory completely untouched (SPEC-046 I4)",
    () => {
      expect(existsSync(setupDryRunTargetDir)).toBe(false);
    },
    600_000,
  );
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("registry-free npm install simulation — REGRESSION", () => {
  it(
    "AC-048-C.R1: installed dist/lore retained its owner-execute bit (npm#1808 exec-bit-drop did not reoccur)",
    () => {
      const realBinPath = realpathSync(binSymlinkPath);
      const mode = statSync(realBinPath).mode;
      expect((mode & 0o100) !== 0).toBe(true);
    },
    600_000,
  );
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("registry-free npm install simulation — NEGATIVE", () => {
  it(
    "AC-048-C.N1: the captured install output carries no npm error marker (this is a clean run, not an error path)",
    () => {
      const combinedOutput = `${installResult.stdout}\n${installResult.stderr}`;
      expect(combinedOutput).not.toMatch(/npm error/i);
      expect(combinedOutput).not.toMatch(/ERR!/);
    },
    600_000,
  );
});

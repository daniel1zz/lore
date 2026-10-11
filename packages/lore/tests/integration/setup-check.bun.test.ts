/**
 * @spec_ref SPEC-076 §C3 (five-state classification, `--check` CLI contract),
 *   §C6 (`SetupCheckCache` shape) — task
 *   task-skill-implement-t4-lore-setup-check-read-only-projection, AC-076-2.
 *
 * Integration tests for `lore setup --check` (read-only asset-freshness
 * projection). Spawns the REAL CLI via subprocess (`bun run <index.ts> setup
 * --check ...`), same pattern as `tests/integration/cli/setup.test.ts` — the
 * AC explicitly requires reachability THROUGH the registered command (real
 * `RealAssetSource`/embedded-manifest wiring), not just unit coverage of
 * `../../src/adapters/cli/setup-check.ts`'s pieces.
 *
 * SAFETY — every mutating step (the initial `lore setup --yes` convergence
 * that seeds each scenario's target dir) sets the CHILD process's `PATH: ""`
 * (mirrors `cli/setup.test.ts`'s own "never let a subprocess reach the real
 * `claude` CLI on PATH" convention) via an absolute, pre-resolved `bun`
 * binary path (`Bun.which("bun")`) — an empty `PATH` would otherwise also
 * make the child unable to locate a bare `"bun"` command. Every scenario
 * targets a fresh `mkdtemp` `--claude-dir` — never the real `~/.claude`
 * (project CLAUDE.md's 2026-07-07 pollution-incident hard rule).
 *
 * GH STUB — `--check` ALSO runs a read-only GitHub-channel health probe
 * (`setup-github-health.ts`) that can override a clean exit `0` to `8` when
 * it can't resolve `gh` on PATH. `--check` never touches `claude`/MCP, so
 * the `PATH: ""` convention above buys it nothing, but the empty PATH
 * collaterally starves that probe too. Every `--check` call in a scenario
 * that asserts a clean exit `0` therefore passes `healthy-gh-stub.ts`'s
 * stub directory as its own `PATH` instead — deterministic regardless of
 * the HOST machine's real `gh` install/auth state (see that helper's own
 * module doc for the full derivation). A scenario whose expected exit code
 * is already nonzero for an unrelated reason (freshness stale/missing/
 * corrupted-manifest) is UNAFFECTED either way — the channel probe never
 * downgrades an already-nonzero exit — and is left on the plain `PATH: ""`
 * default.
 *
 * Coverage:
 *   HAPPY:      a fresh `--yes` converge followed by `--check` exits 0,
 *               `--json`'s `files` buckets are all empty, and the check
 *               cache file exists with `status: "sync"`.
 *   NEGATIVE:   mutating ONE managed file's on-disk bytes flips `--check` to
 *               exit 3 with `--json`'s `files.diverged` containing EXACTLY
 *               that one path; `--check --uninstall` / `--check --dry-run` /
 *               `--check --project` each exit 2, naming the rejected
 *               combination (never a silent global-only check for the
 *               `--project` case — SPEC-076 Scope-Alt).
 *   BOUNDARY:   `--check` against a target directory that was NEVER
 *               installed classifies every managed entry as `missing`
 *               (install-equivalent, SPEC-076 §C3), exit 3.
 *   ERROR:      a corrupted installed manifest (unparsable JSON) fails LOUD
 *               (`VALIDATION_ERROR`, exit 4) rather than being silently
 *               treated as a fresh target.
 *   STATE:      running `--check` twice in a row leaves the setup manifest's
 *               and a managed file's mtimes COMPLETELY unchanged — the check
 *               cache file is the sole write exception (SPEC-076 Invariant
 *               I4 / D-PLAN-4).
 *   REGRESSION: the `--json` payload's `files` object carries exactly the
 *               four documented buckets (`outdated`/`diverged`/`missing`/
 *               `orphaned` — no `sync` list leaking into the wire shape).
 */

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupHealthyGhStubDir, healthyGhStubDir } from "./helpers/healthy-gh-stub";

// ─── Path / spawn setup ─────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

/** Resolves the `bun` binary's absolute path once — a named function (not an inline `if`-throw) so its `string` return type narrows correctly for every closure below that captures it (a top-level `const` narrowed only by a sibling `if` does NOT propagate into later function bodies). */
function resolveBunBin(): string {
  const resolved = Bun.which("bun");
  if (resolved === null) {
    throw new Error("setup-check.bun.test.ts: could not resolve the `bun` binary via Bun.which — is Bun installed?");
  }
  return resolved;
}
const BUN_BIN = resolveBunBin();

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns `bun run <INDEX_TS> setup ...args` in `cwd`. `PATH` defaults to `""`
 * (forces `claude` ENOENT deterministically during a seeding `--yes` install
 * — see file header) unless overridden.
 */
function runSetup(args: string[], cwd: string, envOverrides: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync([BUN_BIN, "run", INDEX_TS, "setup", ...args], {
    cwd,
    env: { ...process.env, PATH: "", ...envOverrides },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

// ─── Fixture cleanup ────────────────────────────────────────────────────────

const scratchDirs: string[] = [];

function makeScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
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

afterAll(() => {
  cleanupHealthyGhStubDir();
});

/** Converges a fresh `--claude-dir` via a real `--yes` install. `PATH=""` makes MCP registration fail (exit 1) — file writes still land. */
function seedConvergedTarget(scratch: string, targetDir: string): void {
  const install = runSetup(["--claude-dir", targetDir, "--yes"], scratch);
  if (install.exitCode !== 1) {
    throw new Error(
      `seedConvergedTarget: expected the seeding install to exit 1 (files written, MCP registration ` +
        `fails under PATH=""), got ${install.exitCode}.\nstdout: ${install.stdout}\nstderr: ${install.stderr}`,
    );
  }
  if (!existsSync(join(targetDir, "agents", "lore-implementer.md"))) {
    throw new Error("seedConvergedTarget: expected agents/lore-implementer.md to exist after seeding install");
  }
}

const MANIFEST_FILENAME = ".lore-setup-manifest.json";
const CHECK_CACHE_FILENAME = ".lore-setup-check.json";
/** A single managed file's POSIX-relative path — mirrors `EmbeddedAssetEntry.path`'s own POSIX-separator convention (never `node:path.join`, which would emit backslashes on Windows). */
const WATCHED_MANAGED_FILE = "agents/lore-implementer.md";

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("lore setup --check — HAPPY", () => {
  it("AC-076-2.H1: a fresh converged install checks sync (exit 0), --json files are all empty, cache written status=sync", () => {
    const scratch = makeScratchDir("lore-setup-check-happy-");
    const targetDir = join(scratch, ".claude");
    seedConvergedTarget(scratch, targetDir);

    // See file header's "GH STUB" note — this scenario asserts a clean exit 0, so it needs the
    // GitHub-channel health probe to resolve `gh` as healthy rather than being starved by PATH="".
    const check = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch, { PATH: healthyGhStubDir() });
    expect(check.exitCode).toBe(0);

    const payload = JSON.parse(check.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.data.summary).toBe("sync");
    expect(payload.data.files.outdated).toEqual([]);
    expect(payload.data.files.diverged).toEqual([]);
    expect(payload.data.files.missing).toEqual([]);
    expect(typeof payload.data.binary_version).toBe("string");
    expect(payload.data.binary_version.length).toBeGreaterThan(0);

    const cachePath = join(targetDir, CHECK_CACHE_FILENAME);
    expect(existsSync(cachePath)).toBe(true);
    const cache = JSON.parse(readFileSync(cachePath, "utf8"));
    expect(cache.status).toBe("sync");
    expect(typeof cache.checked_at).toBe("string");
    expect(typeof cache.binary_version).toBe("string");
    expect(cache.stale_counts).toBeUndefined();
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("lore setup --check — NEGATIVE", () => {
  it("AC-076-2.N1: mutating one managed file's bytes flips --check to exit 3, --json lists exactly that path under files.diverged", () => {
    const scratch = makeScratchDir("lore-setup-check-diverged-");
    const targetDir = join(scratch, ".claude");
    seedConvergedTarget(scratch, targetDir);

    // SPEC-076 T5 byproduct fix (task-skill-implement-t5-converge-hardening-diverged-skip-force):
    // `seedConvergedTarget`'s install now stamps `assets_digest` on a fully-synced converge
    // (§C4) — since the compiled binary here is the SAME process/build for both the seeding
    // install and this test's own `--check` call, `assets_digest` trivially still matches
    // the embedded `tree_digest`, which arms `planUpdate`'s digest-equality short-circuit
    // (§C3 "Performance": whole-tree digest match -> skip all 292 per-file comparisons,
    // report "sync" with ZERO probe calls) — an INTENTIONAL, approved trade-off: a fully
    // converged, unmodified-since manifest is trusted without a fresh per-file scan. That
    // trust is exactly what a real out-of-band edit (the very thing this test simulates)
    // invalidates, so this scenario strips the just-stamped `assets_digest` from the
    // on-disk manifest FIRST — representing "no full converge has re-verified this target
    // since it was last known-good" (a legacy manifest, a manifest predating this exact
    // build, or simply a target whose freshness has never been re-attested), the realistic
    // precondition under which `--check` is expected to fall through to full per-entry
    // classification. `lore setup` itself (SetupService.install's own converge decision)
    // does NOT rely on this field for correctness — it always classifies fresh, precisely
    // to guarantee a real `lore setup --yes` run reliably self-heals/reports a diverged
    // file regardless of what's cached here; only this READ-ONLY `--check` projection's
    // digest fast-path is sensitive to it.
    const manifestPath = join(targetDir, MANIFEST_FILENAME);
    const manifestBeforeMutation = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    delete manifestBeforeMutation["assets_digest"];
    writeFileSync(manifestPath, `${JSON.stringify(manifestBeforeMutation, null, 2)}\n`);

    const mutatedFullPath = join(targetDir, WATCHED_MANAGED_FILE);
    writeFileSync(mutatedFullPath, "MUTATED BYTES — not the embedded content, this is a user-made edit\n");

    const check = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch);
    expect(check.exitCode).toBe(3);

    const payload = JSON.parse(check.stdout);
    expect(payload.data.summary).toBe("stale");
    expect(payload.data.files.diverged).toEqual([WATCHED_MANAGED_FILE]);
    expect(payload.data.files.outdated).toEqual([]);
    expect(payload.data.files.missing).toEqual([]);

    const cache = JSON.parse(readFileSync(join(targetDir, CHECK_CACHE_FILENAME), "utf8"));
    expect(cache.status).toBe("stale");
    expect(cache.stale_counts).toEqual({ outdated: 0, diverged: 1, missing: 0 });
  });

  it("AC-076-2.N2: --check + --uninstall exits 2, naming --uninstall", () => {
    const scratch = makeScratchDir("lore-setup-check-mutex-uninstall-");
    const result = runSetup(["--check", "--uninstall"], scratch);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--uninstall");
  });

  it("AC-076-2.N3: --check + --dry-run exits 2, naming --dry-run", () => {
    const scratch = makeScratchDir("lore-setup-check-mutex-dryrun-");
    const result = runSetup(["--check", "--dry-run"], scratch);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--dry-run");
  });

  it("AC-076-2.N4: --check + --project exits 2, naming the unsupported combination (Scope-Alt, never a silent global-only check)", () => {
    const scratch = makeScratchDir("lore-setup-check-mutex-project-");
    const result = runSetup(["--check", "--project"], scratch);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--project");
    expect(result.stderr.toLowerCase()).toContain("not supported");
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("lore setup --check — BOUNDARY", () => {
  it("AC-076-2.B1: --check against a NEVER-installed target classifies every managed entry as missing (exit 3)", () => {
    const scratch = makeScratchDir("lore-setup-check-empty-");
    const targetDir = join(scratch, ".claude"); // deliberately never seeded

    const result = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch);
    expect(result.exitCode).toBe(3);

    const payload = JSON.parse(result.stdout);
    expect(payload.data.summary).toBe("stale");
    expect(payload.data.files.missing.length).toBeGreaterThan(0);
    expect(payload.data.files.diverged).toEqual([]);
    expect(payload.data.files.outdated).toEqual([]);
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("lore setup --check — ERROR", () => {
  it("AC-076-2.E1: a corrupted installed manifest fails LOUD (VALIDATION_ERROR, exit 4), never silently treated as fresh", () => {
    const scratch = makeScratchDir("lore-setup-check-corrupt-");
    const targetDir = join(scratch, ".claude");
    seedConvergedTarget(scratch, targetDir);

    writeFileSync(join(targetDir, MANIFEST_FILENAME), "{ this is not valid json");

    const result = runSetup(["--check", "--claude-dir", targetDir], scratch);
    expect(result.exitCode).toBe(4);
    expect(result.stderr.toLowerCase()).toContain("manifest");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("lore setup --check — STATE (zero-write invariant)", () => {
  it("AC-076-2.S1: running --check twice leaves the manifest and a managed file's mtimes unchanged — the cache file is the sole write exception", () => {
    const scratch = makeScratchDir("lore-setup-check-zerowrite-");
    const targetDir = join(scratch, ".claude");
    seedConvergedTarget(scratch, targetDir);

    const manifestPath = join(targetDir, MANIFEST_FILENAME);
    const watchedFile = join(targetDir, WATCHED_MANAGED_FILE);
    const manifestMtimeBefore = statSync(manifestPath).mtimeMs;
    const fileMtimeBefore = statSync(watchedFile).mtimeMs;

    // See file header's "GH STUB" note — both calls assert a clean exit 0.
    const ghStubPath = { PATH: healthyGhStubDir() };
    const first = runSetup(["--check", "--claude-dir", targetDir], scratch, ghStubPath);
    expect(first.exitCode).toBe(0);
    const second = runSetup(["--check", "--claude-dir", targetDir], scratch, ghStubPath);
    expect(second.exitCode).toBe(0);

    expect(statSync(manifestPath).mtimeMs).toBe(manifestMtimeBefore);
    expect(statSync(watchedFile).mtimeMs).toBe(fileMtimeBefore);
    // The check cache file itself is the documented sole write exception — it must exist,
    // but its own mtime is deliberately NOT asserted unchanged (it IS rewritten every run).
    expect(existsSync(join(targetDir, CHECK_CACHE_FILENAME))).toBe(true);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("lore setup --check — REGRESSION", () => {
  it("AC-076-2.R1: --json's files object carries exactly the four documented buckets (no leaked sync list)", () => {
    const scratch = makeScratchDir("lore-setup-check-shape-");
    const targetDir = join(scratch, ".claude");
    seedConvergedTarget(scratch, targetDir);

    const result = runSetup(["--check", "--claude-dir", targetDir, "--json"], scratch);
    const payload = JSON.parse(result.stdout);

    expect(Object.keys(payload.data.files).sort()).toEqual(["diverged", "missing", "orphaned", "outdated"]);
    // `installed_binary_version`/`installed_at` are OPTIONAL on `SetupCheckReport` (absent
    // when the installed manifest doesn't carry them, e.g. a pre-SPEC-076 manifest) but ARE
    // now populated (SPEC-076 T5, task-skill-implement-t5-converge-hardening-diverged-skip-force)
    // — `seedConvergedTarget`'s install stamps both on every successful converge (§C4), so
    // this run's manifest carries both and both surface here.
    //
    // RE-BASELINE (2026-08-24, `--check --json` single-document fix): this closed set used to
    // list exactly the five `SetupCheckReport` fields. Original command: the same `runSetup` call
    // above; original (pre-fix) failure at this exact assertion was `JSON.parse` throwing
    // "Unable to parse JSON string", because `--check --json` printed the GitHub-channel health
    // probe's report as a SECOND, independent top-level JSON value on the same stdout stream —
    // invalid JSON to any parser. The fix (commands/setup.ts::runCheckDispatch) composes both
    // reports into ONE document, adding `github_channel` as a NEW, INTENDED sibling key inside
    // `data` (AC1 of that fix: "the github-channel report is reachable inside it ... under
    // `data.github_channel`"). Adding it here is a correction, not a weakening: the assertion's
    // original purpose — catching an UNINTENDED leaked key (e.g. a stray `sync` bucket) — is
    // fully preserved, since the set below is still closed and still rejects any OTHER surprise
    // key; only the one key this fix deliberately adds is now expected.
    expect(Object.keys(payload.data).sort()).toEqual([
      "binary_version",
      "files",
      "github_channel",
      "installed_at",
      "installed_binary_version",
      "summary",
    ]);
  });
});

// ─── Double registration (task-gh-1343388703-157) ───────────────────────────

/**
 * A hook file registered for the same event at BOTH the user layer (`<claude-dir>/settings.json`,
 * where `lore setup` installs it) and the project layer (`<project>/.claude/settings.json`) fires
 * twice per event. `--check` must name hook, event and both settings paths, and exit 3 (the
 * code `--check` already uses for drift). Every dir is a mkdtemp scratch dir.
 */
function writeProjectSettings(
  projectDir: string,
  hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ type: "command"; command: string }> }>>,
  filename = "settings.json",
): string {
  mkdirSync(join(projectDir, ".claude"), { recursive: true });
  const path = join(projectDir, ".claude", filename);
  writeFileSync(path, JSON.stringify({ hooks }, null, 2));
  return path;
}

function seedUserAndProject(prefix: string): { scratch: string; userDir: string; projectDir: string } {
  const scratch = makeScratchDir(prefix);
  const userDir = join(scratch, "user", ".claude");
  // realpath: the CLI resolves its project dir from process.cwd(), which is symlink-resolved (macOS /var -> /private/var).
  mkdirSync(join(scratch, "proj"), { recursive: true });
  const projectDir = realpathSync(join(scratch, "proj"));
  mkdirSync(projectDir, { recursive: true });
  seedConvergedTarget(scratch, userDir);
  const userSettings = JSON.parse(readFileSync(join(userDir, "settings.json"), "utf8"));
  const stopCommands = JSON.stringify(userSettings.hooks?.Stop ?? []);
  if (!stopCommands.includes("stop-handoff-coverage.mjs")) {
    throw new Error("seedUserAndProject: setup did not register stop-handoff-coverage.mjs on Stop at the user layer");
  }
  return { scratch, userDir, projectDir };
}

describe("lore setup --check — double registration", () => {
  it("AC1: same hook file + same event at user and project layer => finding naming file, event, both paths; exit 3", () => {
    const { userDir, projectDir } = seedUserAndProject("lore-setup-check-dbl-ac1-");
    const projectSettings = writeProjectSettings(projectDir, {
      Stop: [{ hooks: [{ type: "command", command: "node $CLAUDE_PROJECT_DIR/assets/hooks/stop-handoff-coverage.mjs" }] }],
    });

    const check = runSetup(["--check", "--claude-dir", userDir, "--json"], projectDir, { PATH: healthyGhStubDir() });
    expect(check.exitCode).toBe(3);
    const payload = JSON.parse(check.stdout);
    expect(payload.data.summary).toBe("stale");
    expect(payload.data.double_registrations).toEqual([
      {
        file: "stop-handoff-coverage.mjs",
        event: "Stop",
        user_settings: join(userDir, "settings.json"),
        project_settings: projectSettings,
      },
    ]);

    const human = runSetup(["--check", "--claude-dir", userDir], projectDir, { PATH: healthyGhStubDir() });
    expect(human.exitCode).toBe(3);
    expect(human.stdout).toContain("stop-handoff-coverage.mjs");
    expect(human.stdout).toContain("Stop");
    expect(human.stdout).toContain(join(userDir, "settings.json"));
    expect(human.stdout).toContain(projectSettings);
  });

  it("AC1b: the project layer's settings.local.json is also checked", () => {
    const { userDir, projectDir } = seedUserAndProject("lore-setup-check-dbl-local-");
    const local = writeProjectSettings(
      projectDir,
      { Stop: [{ hooks: [{ type: "command", command: "bash ./x/stop-handoff-coverage.mjs" }] }] },
      "settings.local.json",
    );
    const check = runSetup(["--check", "--claude-dir", userDir, "--json"], projectDir, { PATH: healthyGhStubDir() });
    expect(check.exitCode).toBe(3);
    expect(JSON.parse(check.stdout).data.double_registrations[0].project_settings).toBe(local);
  });

  it("AC2: user-layer-only registration, or a project-only hook outside HOOK_REGISTRATIONS => no finding, exit 0", () => {
    const { userDir, projectDir } = seedUserAndProject("lore-setup-check-dbl-ac2-");
    const userOnly = runSetup(["--check", "--claude-dir", userDir, "--json"], projectDir, { PATH: healthyGhStubDir() });
    expect(userOnly.exitCode).toBe(0);
    expect(JSON.parse(userOnly.stdout).data.double_registrations).toBeUndefined();

    writeProjectSettings(projectDir, {
      Stop: [{ hooks: [{ type: "command", command: "node $CLAUDE_PROJECT_DIR/scripts/my-own-stop-hook.mjs" }] }],
    });
    const projectOnly = runSetup(["--check", "--claude-dir", userDir, "--json"], projectDir, { PATH: healthyGhStubDir() });
    expect(projectOnly.exitCode).toBe(0);
    expect(JSON.parse(projectOnly.stdout).data.double_registrations).toBeUndefined();
  });

  it("AC3: same basename under a different event => no finding, exit 0", () => {
    const { userDir, projectDir } = seedUserAndProject("lore-setup-check-dbl-ac3-");
    writeProjectSettings(projectDir, {
      SessionEnd: [{ hooks: [{ type: "command", command: "node $CLAUDE_PROJECT_DIR/assets/hooks/stop-handoff-coverage.mjs" }] }],
    });
    const check = runSetup(["--check", "--claude-dir", userDir, "--json"], projectDir, { PATH: healthyGhStubDir() });
    expect(check.exitCode).toBe(0);
    expect(JSON.parse(check.stdout).data.double_registrations).toBeUndefined();
  });

  it("ERROR: a malformed project settings.json fails loud (exit 4), never read as 'no registration'", () => {
    const { userDir, projectDir } = seedUserAndProject("lore-setup-check-dbl-bad-");
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(join(projectDir, ".claude", "settings.json"), "{ not json");
    const check = runSetup(["--check", "--claude-dir", userDir], projectDir, { PATH: healthyGhStubDir() });
    expect(check.exitCode).toBe(4);
    expect(check.stderr).toContain("settings.json");
  });
});

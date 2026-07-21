/**
 * Integration tests for `lore setup` (SPEC-046 §Design, task AC-046-E — the
 * FINAL CLI-wiring task). Runs the real CLI via subprocess (`bun run
 * <index.ts> setup ...`), same pattern as
 * `tests/integration/cli/verify.test.ts` — the ACs for this task explicitly
 * require reachability THROUGH the registered command (`--help` lists every
 * flag; a `--dry-run` run must leave its target directory untouched), not
 * just unit coverage of the pieces it wires together.
 *
 * SAFETY — this file NEVER lets a subprocess reach the real `claude` CLI on
 * PATH: every mutating (non-`--dry-run`) test that would call
 * `McpRegistrar.add`/`remove` sets `PATH: ""` (mirrors
 * `real-setup-ports.test.ts`'s own "claude absent from PATH" convention) —
 * this repo's own dev machine actually registers a REAL `claude mcp add -s
 * user lore` entry if that guard is missing (discovered empirically while
 * writing this suite; cleaned up via `claude mcp remove -s user lore`
 * afterward). Every test also targets a fresh `mkdtemp` directory via
 * `--claude-dir` (or an overridden `$HOME` for the one default-resolution
 * boundary test) — never the real `~/.claude` (2026-07-07 pollution-incident
 * convention).
 *
 * Coverage:
 *   HAPPY:      `--dry-run --claude-dir <mktemp>` prints a plan receipt AND
 *               leaves the mktemp dir completely empty afterward (I4,
 *               observable from the entry point); `--help` lists all six
 *               declared flags (command is registered + reachable); a real
 *               `--yes` install into a mktemp dir actually writes the asset
 *               tree; `--project` in a throwaway git repo completes the
 *               scaffold (delegates to AC-046-C, wiring proof only)
 *   NEGATIVE:   a mutating run with no TTY and no `--yes` exits 2 naming
 *               `--yes`; every STILL-rejected flag combination
 *               (`--project`+`--dry-run`, `--project`+`--claude-dir`,
 *               `--dry-run`+`--uninstall`) exits 2 — `--project`+`--uninstall`
 *               is NO LONGER in this list (SPEC-060 §Design D2 made it a
 *               valid, distinct mode; see its own coverage below)
 *   BOUNDARY:   `--claude-dir` wins over `$CLAUDE_CONFIG_DIR`; `$CLAUDE_CONFIG_DIR`
 *               wins over the `homedir()` default
 *   ERROR:      `--uninstall` against a directory with no setup manifest
 *               exits 4 (VALIDATION_ERROR, "nothing to uninstall");
 *               (SPEC-060 D2) `--project --uninstall` against a repo with no
 *               project install ledger exits 4 the same way
 *   STATE:      install (--yes) → uninstall (--yes) round-trips — the
 *               manifest and every written file are gone afterward
 *   REGRESSION: a second `--dry-run` immediately after a real install reports
 *               every file as "would skip" (byte-identical convergence,
 *               `SetupService`'s I2 invariant, observable end-to-end)
 *
 * @spec_ref AC-046-E
 */

import { describe, it, expect, afterEach } from "vitest";
import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Path setup ───────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

/**
 * Resolves the real `bun` binary's ABSOLUTE path once, via the test runner's
 * OWN inherited (unmodified) `PATH` — this file's `runSetup` helper then
 * spawns that absolute path directly rather than the bare string `"bun"`.
 * This matters because `bunx vitest` runs THIS test file under `node`, not
 * `bun` (empirically confirmed — `process.execPath` inside a vitest test is
 * the Node binary, not Bun's), and every mutating test below sets the CHILD
 * process's `PATH: ""` (to force `claude` ENOENT deterministically, never
 * touching the real system `claude` CLI) — an absolute `bun` path sidesteps
 * needing `PATH` to locate `bun` itself in that child.
 */
const BUN_BIN = execSync("command -v bun", { encoding: "utf8" }).trim();
if (!BUN_BIN) {
  throw new Error("setup.test.ts: could not resolve the `bun` binary via `command -v bun` — is Bun installed?");
}

// ─── RunResult type ───────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> setup ...args` in `cwd`. NEVER touches the real
 * `claude` CLI unless `allowRealClaudePath` is explicitly set — every caller
 * that mutates (install/uninstall/project) MUST either pass `--dry-run`
 * (never reaches `McpRegistrar`) or accept the default `PATH: ""` override.
 *
 * @param envOverrides - additional env vars merged onto the subprocess's own
 *   environment. `PATH` defaults to `""` (forces `claude` ENOENT
 *   deterministically, same convention as `real-setup-ports.test.ts`) unless
 *   overridden here.
 */
function runSetup(args: string[], cwd: string, envOverrides: Record<string, string> = {}): RunResult {
  // reason: spawn the bun BINARY by its resolved absolute path (BUN_BIN), never the bare
  // "bun" command string — PATH is deliberately emptied below (forces `claude` ENOENT
  // deterministically), and a bare "bun" would then be unresolvable too.
  const result = spawnSync(BUN_BIN, ["run", INDEX_TS, "setup", ...args], {
    cwd,
    env: { ...process.env, PATH: "", ...envOverrides },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

// ─── Fixture cleanup ──────────────────────────────────────────────────────────

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

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("lore setup — HAPPY", () => {
  it("AC-046-E.H1: --dry-run prints a plan receipt AND leaves --claude-dir completely empty", () => {
    const scratch = makeScratchDir("lore-setup-dryrun-");
    const targetDir = join(scratch, ".claude");

    const result = runSetup(["--dry-run", "--claude-dir", targetDir], scratch);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("dry-run: nothing written");
    expect(result.stdout).toContain(targetDir);
    // I4 — zero writes: the target directory must not even have been created.
    expect(existsSync(targetDir)).toBe(false);
  });

  it("AC-046-E.H2: --help lists all six declared flags (command is registered + reachable)", () => {
    const scratch = makeScratchDir("lore-setup-help-");
    // reason: citty's `--help` usage text is rendered via `consola.log(...)` (not plain
    // `console.log`) — consola's OWN default log level drops to "warn" whenever
    // NODE_ENV==="test" or $TEST is truthy (consola/dist/index.mjs's `_getDefaultLogLevel`),
    // silently swallowing that `--help` output. Vitest sets BOTH of those in its own worker
    // process env, and a spawned child inherits them by default — empirically confirmed
    // while writing this test (a bare `env: {...process.env}` spawn produced empty stdout
    // for `--help` alone; every OTHER command output in this file, which goes through this
    // adapter's own `console.log`, is unaffected and needs no such override). Do not remove
    // this deletion — it is NOT dead code cleanup.
    const helpEnv = { ...process.env };
    delete helpEnv.NODE_ENV;
    delete helpEnv.TEST;
    const result = spawnSync(BUN_BIN, ["run", INDEX_TS, "setup", "--help"], {
      cwd: scratch,
      env: helpEnv,
      encoding: "utf8",
    });

    const stdout = result.stdout ?? "";
    for (const flag of ["--dry-run", "--uninstall", "--project", "--claude-dir", "--yes", "--json"]) {
      expect(stdout).toContain(flag);
    }
  });

  it("AC-046-E.H3: a real --yes install into a mktemp --claude-dir writes the asset tree", () => {
    const scratch = makeScratchDir("lore-setup-install-");
    const targetDir = join(scratch, ".claude");

    const result = runSetup(["--claude-dir", targetDir, "--yes"], scratch);

    // PATH="" forces `claude` ENOENT — mcp registration fails, exit 1 (files still write).
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("lore setup complete");
    expect(existsSync(join(targetDir, "skills", "lore", "SKILL.md"))).toBe(true);
    expect(existsSync(join(targetDir, "agents", "lore-implementer.md"))).toBe(true);
    expect(existsSync(join(targetDir, ".lore-setup-manifest.json"))).toBe(true);
    // §M2-style manual-recovery guidance must be visible when mcp registration fails.
    expect(result.stdout).toContain("claude mcp add");
  });

  it("AC-046-E.H4: --project scaffolds a throwaway git repo end-to-end (wiring proof)", () => {
    const repoDir = makeScratchDir("lore-setup-project-");
    spawnSync("git", ["init"], { cwd: repoDir, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir, encoding: "utf8" });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: repoDir, encoding: "utf8" });

    const result = runSetup(["--project", "--yes"], repoDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("lore project scaffold");
    // initCorpusAt actually ran (the SAME logic commands/init.ts runs, generalized to repoDir).
    expect(existsSync(join(repoDir, ".lore", "config.yaml"))).toBe(true);
    expect(existsSync(join(repoDir, ".lore", "lore.db"))).toBe(true);
    // Real ProjectFsPort/ExecPort/ProjectAssetSource wiring reached disk.
    expect(existsSync(join(repoDir, "hooks", "g1-spec-create.sh"))).toBe(true);
    expect(existsSync(join(repoDir, "lore.tree.yaml"))).toBe(true);
    const hooksPath = spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd: repoDir, encoding: "utf8" });
    expect(hooksPath.stdout.trim()).toBe("hooks");
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("lore setup — NEGATIVE", () => {
  it("AC-046-E.N1: a mutating run with no --yes (non-interactive subprocess) exits 2 naming --yes", () => {
    const scratch = makeScratchDir("lore-setup-noyes-");
    const targetDir = join(scratch, ".claude");

    const result = runSetup(["--claude-dir", targetDir], scratch);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--yes");
    expect(existsSync(targetDir)).toBe(false);
  });

  it("AC-046-E.N2: --project + --dry-run is rejected (exit 2)", () => {
    const scratch = makeScratchDir("lore-setup-conflict-");
    const result = runSetup(["--project", "--dry-run"], scratch);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--project");
  });

  it("AC-046-E.N4: --project + --claude-dir is rejected (exit 2)", () => {
    const scratch = makeScratchDir("lore-setup-conflict-");
    const result = runSetup(["--project", "--claude-dir", join(scratch, ".claude")], scratch);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--claude-dir");
  });

  it("AC-046-E.N5: --dry-run + --uninstall is rejected (exit 2)", () => {
    const scratch = makeScratchDir("lore-setup-conflict-");
    const result = runSetup(["--dry-run", "--uninstall"], scratch);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--uninstall");
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("lore setup — BOUNDARY", () => {
  it("AC-046-E.B1: --claude-dir wins over $CLAUDE_CONFIG_DIR", () => {
    const scratch = makeScratchDir("lore-setup-precedence-");
    const flagTarget = join(scratch, "flag-target");
    const envTarget = join(scratch, "env-target");

    const result = runSetup(["--dry-run", "--claude-dir", flagTarget], scratch, {
      CLAUDE_CONFIG_DIR: envTarget,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(flagTarget);
    expect(result.stdout).not.toContain(envTarget);
  });

  it("AC-046-E.B2: $CLAUDE_CONFIG_DIR wins over the homedir() default", () => {
    const scratch = makeScratchDir("lore-setup-precedence-");
    const fakeHome = join(scratch, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    const envTarget = join(scratch, "env-target");

    const result = runSetup(["--dry-run"], scratch, {
      HOME: fakeHome,
      CLAUDE_CONFIG_DIR: envTarget,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(envTarget);
    expect(result.stdout).not.toContain(join(fakeHome, ".claude"));
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────────

describe("lore setup — ERROR", () => {
  it("AC-046-E.E1: --uninstall with no setup manifest exits 4 (VALIDATION_ERROR)", () => {
    const scratch = makeScratchDir("lore-setup-nomanifest-");
    const targetDir = join(scratch, ".claude");
    mkdirSync(targetDir, { recursive: true });

    const result = runSetup(["--uninstall", "--claude-dir", targetDir, "--yes"], scratch);

    expect(result.exitCode).toBe(4);
    expect(result.stderr.toLowerCase()).toContain("uninstall");
  });

  it("AC-060-D2.E1: --project + --uninstall against a repo with no project install ledger exits 4 (VALIDATION_ERROR) — no longer the exit-2 flag-conflict this combination used to produce pre-SPEC-060", () => {
    const scratch = makeScratchDir("lore-setup-project-nomanifest-");

    const result = runSetup(["--project", "--uninstall", "--yes"], scratch);

    expect(result.exitCode).toBe(4);
    expect(result.stderr.toLowerCase()).toContain("uninstall");
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("lore setup — STATE", () => {
  it("AC-046-E.S1: install (--yes) then uninstall (--yes) round-trips — files and manifest gone", () => {
    const scratch = makeScratchDir("lore-setup-roundtrip-");
    const targetDir = join(scratch, ".claude");

    const installResult = runSetup(["--claude-dir", targetDir, "--yes"], scratch);
    expect(installResult.exitCode).toBe(1); // mcp fails under PATH="", files still write
    expect(existsSync(join(targetDir, "skills", "lore", "SKILL.md"))).toBe(true);

    // reason: the preceding install's OWN mcp registration attempt already failed (PATH=""),
    // so it never wrote a `kind: "mcp"` manifest entry to reverse (SetupService only tracks
    // an mcp entry after a SUCCESSFUL add) — uninstall therefore finds no tracked mcp entry
    // and reports `mcp: "skipped"` (exit 0), not "failed" (exit 1). This is SetupService's
    // own documented "no previously registered entry to de-register" case, not a test bug.
    const uninstallResult = runSetup(["--uninstall", "--claude-dir", targetDir, "--yes"], scratch);
    expect(uninstallResult.exitCode).toBe(0);
    expect(uninstallResult.stdout).toContain("lore setup uninstalled");
    expect(existsSync(join(targetDir, ".lore-setup-manifest.json"))).toBe(false);
    expect(existsSync(join(targetDir, "skills", "lore", "SKILL.md"))).toBe(false);
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("lore setup — REGRESSION", () => {
  it("AC-046-E.R1: a second --dry-run right after a real install reports every file as 'would skip'", () => {
    const scratch = makeScratchDir("lore-setup-idempotent-");
    const targetDir = join(scratch, ".claude");

    const installResult = runSetup(["--claude-dir", targetDir, "--yes"], scratch);
    expect(installResult.exitCode).toBe(1);

    const dryRunResult = runSetup(["--dry-run", "--claude-dir", targetDir], scratch);
    expect(dryRunResult.exitCode).toBe(0);
    expect(dryRunResult.stdout).toContain("Would write: none");
    expect(dryRunResult.stdout).toMatch(/Would skip: \d+/);
    expect(dryRunResult.stdout).not.toMatch(/Would skip: 0\b/);

    // I2 — a byte-identical re-run issues zero writes; the manifest content is untouched.
    const manifestPath = join(targetDir, ".lore-setup-manifest.json");
    const manifestBefore = readFileSync(manifestPath, "utf-8");
    runSetup(["--claude-dir", targetDir, "--yes"], scratch);
    const manifestAfter = readFileSync(manifestPath, "utf-8");
    expect(manifestAfter).toBe(manifestBefore);
  });
});

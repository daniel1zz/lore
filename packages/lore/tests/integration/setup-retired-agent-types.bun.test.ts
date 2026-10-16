/**
 * @spec_ref spec-two-helper-agent-types-lore-reader-and-lore-implementer
 *   AC-AT-6 (BR-975) — task task-t1-agent-definitions-dispatch-hooks-setup-retirement-test.
 *
 * `lore-explorer` and `lore-reviewer` were shipped helper agent types that the
 * catalog collapsed into `lore-reader`. An existing install tracks them in its
 * `.lore-setup-manifest.json`; `lore setup` converge must remove them (they are
 * tracked, and the payload no longer ships them), report them as removals, and
 * leave an untracked user agent file alone.
 *
 * This test builds BOTH ends of that diff in a throwaway dir: the "old install"
 * (retired files on disk + tracked in the manifest) and the CURRENT embedded
 * payload (the real `RealAssetSource` wiring via the real CLI subprocess).
 *
 * SAFETY — child `PATH: ""` (never reaches the real `claude` CLI); every run
 * targets a fresh `mkdtemp` `--claude-dir` (never the real `~/.claude`).
 *
 * Coverage: HAPPY (retired files removed, reader present), STATE (second
 * converge reports no further removals), REGRESSION (untracked control file
 * untouched, current agent kept).
 */

import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const MANIFEST_FILENAME = ".lore-setup-manifest.json";
const RETIRED = ["agents/lore-explorer.md", "agents/lore-reviewer.md"] as const;
const CONTROL = "agents/my-own-agent.md";
const CONTROL_BYTES = "# my own agent — not tracked by lore, must survive converge\n";

function resolveBunBin(): string {
  const resolved = Bun.which("bun");
  if (resolved === null) {
    throw new Error("setup-retired-agent-types.bun.test.ts: could not resolve the `bun` binary via Bun.which");
  }
  return resolved;
}
const BUN_BIN = resolveBunBin();

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runSetup(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([BUN_BIN, "run", INDEX_TS, "setup", ...args], { cwd, env: { ...process.env, PATH: "" } });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

const scratchDirs: string[] = [];
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

interface ManifestEntry {
  path: string;
  kind: string;
  sha256: string;
  written_at: string;
  ownership?: string;
}
interface Manifest {
  entries: ManifestEntry[];
  [key: string]: unknown;
}

/** Builds the OLD install: a current converge, then the retired files written to disk and tracked in the manifest. */
function seedOldInstall(): { scratch: string; claudeDir: string } {
  const scratch = mkdtempSync(join(tmpdir(), "lore-setup-retired-agents-"));
  scratchDirs.push(scratch);
  const claudeDir = join(scratch, ".claude");

  const seed = runSetup(["--claude-dir", claudeDir, "--yes"], scratch);
  if (seed.exitCode !== 1) {
    throw new Error(`seed install: expected exit 1 (MCP fails under PATH=""), got ${seed.exitCode}\n${seed.stdout}\n${seed.stderr}`);
  }

  const manifestPath = join(claudeDir, MANIFEST_FILENAME);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const template = manifest.entries.find((e) => e.path === "agents/lore-implementer.md");
  if (template === undefined) throw new Error("seed install manifest has no agents/lore-implementer.md entry");

  for (const rel of RETIRED) {
    const bytes = `retired agent ${rel}\n`;
    writeFileSync(join(claudeDir, rel), bytes);
    manifest.entries.push({ ...template, path: rel, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(claudeDir, CONTROL), CONTROL_BYTES);
  return { scratch, claudeDir };
}

describe("lore setup converge — retired agent types — HAPPY / REGRESSION / STATE", () => {
  it("AC-AT-6: tracked lore-explorer + lore-reviewer are removed and reported; lore-reader lands; an untracked agent is untouched", () => {
    const { scratch, claudeDir } = seedOldInstall();
    for (const rel of RETIRED) expect(existsSync(join(claudeDir, rel))).toBe(true);

    // The dry run reports both as removals (the plan the converge then executes).
    const check = runSetup(["--claude-dir", claudeDir, "--dry-run"], scratch);
    expect(check.stdout).toContain("Would remove");
    for (const rel of RETIRED) expect(check.stdout).toContain(rel);

    const converge = runSetup(["--claude-dir", claudeDir, "--yes"], scratch);
    expect(converge.exitCode).toBe(1); // MCP registration fails under PATH=""

    for (const rel of RETIRED) expect(existsSync(join(claudeDir, rel))).toBe(false);
    expect(existsSync(join(claudeDir, "agents/lore-reader.md"))).toBe(true);
    expect(existsSync(join(claudeDir, "agents/lore-implementer.md"))).toBe(true);
    expect(readFileSync(join(claudeDir, CONTROL), "utf8")).toBe(CONTROL_BYTES);

    const manifest = JSON.parse(readFileSync(join(claudeDir, MANIFEST_FILENAME), "utf8")) as Manifest;
    const tracked = manifest.entries.map((e) => e.path);
    for (const rel of RETIRED) expect(tracked).not.toContain(rel);
    expect(tracked).toContain("agents/lore-reader.md");
    expect(tracked).not.toContain(CONTROL);

    // STATE: converged — nothing further to remove.
    const again = runSetup(["--claude-dir", claudeDir, "--dry-run"], scratch);
    expect(again.stdout).not.toContain("Would remove");
  }, 60_000);
});

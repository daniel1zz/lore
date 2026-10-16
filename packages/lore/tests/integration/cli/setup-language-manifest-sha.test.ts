/**
 * Integration test: `lore setup` records each manifest sha from the file's FINAL on-disk bytes
 * even when a user config sets a reply language (task R0-2, AC-R0-3, report #233).
 *
 * Regression: the install wrote the manifest, THEN applyLanguageProjections merged `language`
 * into settings.json, so the recorded sha pointed at pre-language bytes and the next
 * --dry-run reported a change instead of "would skip".
 *
 * Isolation: HOME and XDG_CONFIG_HOME point at mkdtemp dirs; PATH is empty so the real
 * `claude` CLI is never reached.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execSync, spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const BUN_BIN = execSync("command -v bun", { encoding: "utf8" }).trim();

const scratchDirs: string[] = [];
afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function makeScratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function runSetup(args: string[], cwd: string, env: Record<string, string>) {
  const result = spawnSync(BUN_BIN, ["run", INDEX_TS, "setup", ...args], {
    cwd,
    env: { ...process.env, PATH: "", ...env },
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

describe("lore setup manifest sha with a configured reply language", () => {
  it("AC-R0-3: manifest sha of settings.json equals its final bytes and a second --dry-run would-skip everything", () => {
    const scratch = makeScratch("lore-setup-lang-sha-");
    const home = join(scratch, "home");
    const xdg = join(scratch, "xdg");
    const cwd = join(scratch, "cwd");
    const claudeDir = join(scratch, ".claude");
    mkdirSync(join(xdg, "lore"), { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(xdg, "lore", "config.yaml"), "context:\n  language: zh\n");
    const env = { HOME: home, XDG_CONFIG_HOME: xdg };

    runSetup(["--claude-dir", claudeDir, "--yes"], cwd, env);

    const settingsBytes = readFileSync(join(claudeDir, "settings.json"));
    expect(JSON.parse(settingsBytes.toString("utf8")).language).toBe("Chinese");
    const manifest = JSON.parse(readFileSync(join(claudeDir, ".lore-setup-manifest.json"), "utf8")) as {
      entries: { path: string; sha256: string }[];
    };
    const entry = manifest.entries.find((e) => e.path === "settings.json");
    expect(entry).toBeDefined();
    expect(entry?.sha256).toBe(createHash("sha256").update(settingsBytes).digest("hex"));

    // The language-only settings.json written before the install must not be backed up as user data.
    expect(existsSync(join(claudeDir, ".lore-backups"))).toBe(false);

    const dryRun = runSetup(["--dry-run", "--claude-dir", claudeDir], cwd, env);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout).toContain("Would write: none");
    expect(dryRun.stdout).not.toMatch(/Would skip: 0\b/);
  });
});

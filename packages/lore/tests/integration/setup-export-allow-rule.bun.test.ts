// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and AC-RV-8 (permission half), BR-1218, BR-840
 *
 * `lore setup` writes exactly one allow rule for the per-call export line into settings.json, lists it in the
 * setup manifest, and `lore setup --uninstall` removes exactly that rule and keeps every user rule.
 * Spawns the real CLI against a throwaway `--claude-dir` (PATH empty: never reaches a real `claude`).
 *
 * Coverage:
 *   HAPPY:      fresh install adds the rule once; the manifest lists it; no other permission key appears.
 *   NEGATIVE:   uninstall leaves user rules/deny/other keys intact and removes only the lore rule.
 *   BOUNDARY:   a user who already had the identical rule keeps it after uninstall (lore never added it).
 *   STATE:      a second install does not duplicate the rule and keeps it listed in the manifest.
 *   ERROR:      a settings.json whose permissions.allow is not an array fails the install loud (exit non-zero).
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const BUN_BIN = Bun.which("bun") ?? "bun";
const RULE = "Bash(export LORE_HARNESS_RUN=*)";
/** PATH="" makes the MCP registration step fail, which is exit 1; file and manifest work still completes. */
const MCP_FAILS_EXIT = 1;

function runSetup(args: string[], cwd: string): { exitCode: number; stderr: string } {
  const proc = Bun.spawnSync([BUN_BIN, "run", INDEX_TS, "setup", ...args], {
    cwd,
    env: { ...process.env, PATH: "" },
  });
  return { exitCode: proc.exitCode ?? 1, stderr: proc.stderr.toString() };
}

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "lore-allow-rule-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const settingsOf = (dir: string): Record<string, any> => JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
const manifestOf = (dir: string): Record<string, any> =>
  JSON.parse(readFileSync(join(dir, ".lore-setup-manifest.json"), "utf8"));

describe("lore setup export allow rule (AC-RV-8)", () => {
  it("HAPPY: fresh install adds exactly one allow rule and records it in the manifest", () => {
    const dir = scratch();
    expect(runSetup(["--yes", "--claude-dir", dir], dir).exitCode).toBe(MCP_FAILS_EXIT);
    const s = settingsOf(dir);
    expect(s.permissions).toEqual({ allow: [RULE] });
    expect(manifestOf(dir).permissions).toEqual({ allow: [RULE] });
  });

  it("NEGATIVE: uninstall removes only the lore rule and keeps user rules", () => {
    const dir = scratch();
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({ permissions: { allow: ["Bash(lore get:*)"], deny: ["Bash(rm:*)"] }, theme: "dark" }),
    );
    expect(runSetup(["--yes", "--claude-dir", dir], dir).exitCode).toBe(MCP_FAILS_EXIT);
    expect(settingsOf(dir).permissions.allow).toEqual(["Bash(lore get:*)", RULE]);
    expect(runSetup(["--uninstall", "--yes", "--claude-dir", dir], dir).exitCode).toBe(0);
    const s = settingsOf(dir);
    expect(s.permissions).toEqual({ allow: ["Bash(lore get:*)"], deny: ["Bash(rm:*)"] });
    expect(s.theme).toBe("dark");
    expect(existsSync(join(dir, ".lore-setup-manifest.json"))).toBe(false);
  });

  it("BOUNDARY: a rule the user already had is not lore's and survives uninstall", () => {
    const dir = scratch();
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ permissions: { allow: [RULE] } }));
    expect(runSetup(["--yes", "--claude-dir", dir], dir).exitCode).toBe(MCP_FAILS_EXIT);
    expect(settingsOf(dir).permissions.allow).toEqual([RULE]);
    expect(manifestOf(dir).permissions).toBeUndefined();
    expect(runSetup(["--uninstall", "--yes", "--claude-dir", dir], dir).exitCode).toBe(0);
    expect(settingsOf(dir).permissions.allow).toEqual([RULE]);
  });

  it("STATE: a second install keeps one copy and keeps it listed", () => {
    const dir = scratch();
    expect(runSetup(["--yes", "--claude-dir", dir], dir).exitCode).toBe(MCP_FAILS_EXIT);
    expect(runSetup(["--yes", "--claude-dir", dir], dir).exitCode).toBe(MCP_FAILS_EXIT);
    expect(settingsOf(dir).permissions.allow).toEqual([RULE]);
    expect(manifestOf(dir).permissions).toEqual({ allow: [RULE] });
  });

  it("ERROR: a non-array permissions.allow fails the install loud and writes no manifest", () => {
    const dir = scratch();
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ permissions: { allow: "Bash(x)" } }));
    const r = runSetup(["--yes", "--claude-dir", dir], dir);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("permissions.allow");
    expect(existsSync(join(dir, ".lore-setup-manifest.json"))).toBe(false);
  });
});

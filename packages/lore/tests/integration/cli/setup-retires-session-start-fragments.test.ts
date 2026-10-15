/**
 * Integration tests for the `session-start-fragments.mjs` hook retirement (spec-one-upgrade-reminder-
 * at-session-start-covers-the-global, AC-UR-5; BR-823 / BR-975 converge). Real `lore setup` via
 * subprocess against a throwaway `--claude-dir` — never the real `~/.claude`.
 *
 * The "installed by a build that shipped it" state is reproduced by installing with THIS build, then
 * planting what the older build left behind: the hook file, its two SessionStart settings entries
 * (the plain one and the `compact` matcher) and the ledger (manifest) entry for the file.
 *
 * Coverage:
 *   HAPPY:      converge removes the retired file and BOTH of its settings entries
 *   REGRESSION: session-start-resume.mjs + its entry survive; a user-owned SessionStart entry
 *               pointing elsewhere is untouched
 *   BOUNDARY:   a fresh install of this build never writes the retired file or entry
 *   STATE:      a second converge after the retirement is a no-op (idempotent)
 *
 * @spec_ref AC-UR-5
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const BUN_BIN = execSync("command -v bun", { encoding: "utf8" }).trim();

const RETIRED_HOOK = "session-start-fragments.mjs";
const KEPT_HOOK = "session-start-resume.mjs";
const USER_COMMAND = "node /opt/user-owned/my-session-hook.mjs";

interface SettingsHook {
  type: string;
  command: string;
}
interface SettingsGroup {
  matcher?: string;
  hooks: SettingsHook[];
}
interface Settings {
  hooks: Record<string, SettingsGroup[]>;
}
interface ManifestEntry {
  path: string;
  kind: string;
  sha256: string;
  written_at: string;
  ownership: string;
}
interface Manifest {
  entries: ManifestEntry[];
  [key: string]: unknown;
}

let sandbox: string;

function runSetup(claudeDir: string, args: string[] = []): { stdout: string; stderr: string; exitCode: number } {
  // reason: PATH is emptied so the MCP registration step can never reach a real `claude` CLI; bun is spawned by absolute path.
  const result = spawnSync(BUN_BIN, ["run", INDEX_TS, "setup", "--claude-dir", claudeDir, "--yes", ...args], {
    cwd: sandbox,
    env: { ...process.env, PATH: "", HOME: join(sandbox, "home"), XDG_CONFIG_HOME: join(sandbox, "xdg") },
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

function readSettings(claudeDir: string): Settings {
  return JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8")) as Settings;
}

function sessionStartCommands(claudeDir: string): { matcher: string | undefined; command: string }[] {
  return (readSettings(claudeDir).hooks["SessionStart"] ?? []).flatMap((group) =>
    group.hooks.map((hook) => ({ matcher: group.matcher, command: hook.command })),
  );
}

/** A claude dir installed by THIS build, then rewound to the state a build that shipped the retired hook left. */
function installWithLegacyHook(): string {
  const claudeDir = mkdtempSync(join(sandbox, "claude-"));
  const install = runSetup(claudeDir);
  if (install.exitCode !== 0) throw new Error(`install failed (${install.exitCode}): ${install.stderr}\n${install.stdout}`);

  const hookPath = join(claudeDir, "hooks", RETIRED_HOOK);
  const content = "#!/usr/bin/env node\n// legacy session-start-fragments hook planted by AC-UR-5\n";
  writeFileSync(hookPath, content, "utf8");

  const command = `node ${hookPath}`;
  const settingsPath = join(claudeDir, "settings.json");
  const settings = readSettings(claudeDir);
  const groups = settings.hooks["SessionStart"] ?? [];
  const plain = groups.find((group) => group.matcher === undefined);
  if (plain === undefined) throw new Error("no matcher-less SessionStart group in the fresh install");
  plain.hooks.push({ type: "command", command });
  groups.push({ matcher: "compact", hooks: [{ type: "command", command }] });
  // A user-owned entry that points OUTSIDE <claudeDir>/hooks/ — converge must never touch it.
  groups.push({ hooks: [{ type: "command", command: USER_COMMAND }] });
  settings.hooks["SessionStart"] = groups;
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  const manifestPath = join(claudeDir, ".lore-setup-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const writtenAt = manifest.entries[0]?.written_at ?? new Date().toISOString();
  manifest.entries.push({
    path: `hooks/${RETIRED_HOOK}`,
    kind: "hook",
    sha256: createHash("sha256").update(content).digest("hex"),
    written_at: writtenAt,
    ownership: "managed",
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return claudeDir;
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "lore-ur5-"));
  for (const dir of ["home", "xdg"]) mkdirSync(join(sandbox, dir), { recursive: true });
}, 60_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("lore setup retires session-start-fragments.mjs (AC-UR-5)", () => {
  it("AC-UR-5.H1: the hook is absent from the shipped roster and from assets/hooks", async () => {
    const { HOOK_REGISTRATIONS } = await import("@lore/core");
    expect(HOOK_REGISTRATIONS.map((entry) => entry.file)).not.toContain(RETIRED_HOOK);
    expect(HOOK_REGISTRATIONS.map((entry) => entry.file)).toContain(KEPT_HOOK);
    expect(existsSync(join(REPO_ROOT, "assets", "hooks", RETIRED_HOOK))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "assets", "hooks", KEPT_HOOK))).toBe(true);
  });

  it("AC-UR-5.H2: converge removes the retired file and both of its settings entries, keeps the resume hook and the user entry", () => {
    const claudeDir = installWithLegacyHook();
    // Precondition: the planted legacy state really has the file and both entries (otherwise the assertions below prove nothing).
    expect(existsSync(join(claudeDir, "hooks", RETIRED_HOOK))).toBe(true);
    expect(sessionStartCommands(claudeDir).filter((e) => e.command.includes(RETIRED_HOOK))).toHaveLength(2);

    const converge = runSetup(claudeDir);
    expect(converge.exitCode).toBe(0);

    expect(existsSync(join(claudeDir, "hooks", RETIRED_HOOK))).toBe(false);
    const after = sessionStartCommands(claudeDir);
    expect(after.filter((e) => e.command.includes(RETIRED_HOOK))).toEqual([]);
    expect(JSON.stringify(readSettings(claudeDir))).not.toContain(RETIRED_HOOK);

    // The resume hook and its entry stay.
    expect(existsSync(join(claudeDir, "hooks", KEPT_HOOK))).toBe(true);
    expect(after.some((e) => e.command.includes(KEPT_HOOK))).toBe(true);
    // The user-owned entry pointing elsewhere is untouched.
    expect(after.some((e) => e.command === USER_COMMAND)).toBe(true);

    const manifest = JSON.parse(readFileSync(join(claudeDir, ".lore-setup-manifest.json"), "utf8")) as Manifest;
    expect(manifest.entries.map((entry) => entry.path)).not.toContain(`hooks/${RETIRED_HOOK}`);
  });

  it("AC-UR-5.B1: a fresh install of this build never writes the retired file or entry", () => {
    const claudeDir = mkdtempSync(join(sandbox, "claude-fresh-"));
    expect(runSetup(claudeDir).exitCode).toBe(0);
    expect(existsSync(join(claudeDir, "hooks", RETIRED_HOOK))).toBe(false);
    expect(JSON.stringify(readSettings(claudeDir))).not.toContain(RETIRED_HOOK);
    expect(sessionStartCommands(claudeDir).some((e) => e.command.includes(KEPT_HOOK))).toBe(true);
  });

  it("AC-UR-5.S1: a second converge after the retirement changes nothing", () => {
    const claudeDir = installWithLegacyHook();
    expect(runSetup(claudeDir).exitCode).toBe(0);
    const settingsBefore = readFileSync(join(claudeDir, "settings.json"), "utf8");
    const manifestBefore = readFileSync(join(claudeDir, ".lore-setup-manifest.json"), "utf8");
    expect(runSetup(claudeDir).exitCode).toBe(0);
    expect(readFileSync(join(claudeDir, "settings.json"), "utf8")).toBe(settingsBefore);
    expect(readFileSync(join(claudeDir, ".lore-setup-manifest.json"), "utf8")).toBe(manifestBefore);
  });
});

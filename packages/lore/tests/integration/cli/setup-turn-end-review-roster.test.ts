/**
 * Integration tests for the turn-end-review roster swap (spec-interception-moves-off-every-tool-call-
 * one-turn-end-review, AC-TE-5; BR-823 / BR-975 converge, BR-1092). Real `lore setup` via subprocess
 * against a throwaway `--claude-dir` — never the real `~/.claude`.
 *
 * The "installed by a build that shipped the retired hooks" state is reproduced by installing with THIS
 * build, then planting what the older build left behind: the hook files, their settings entries (Stop,
 * PostToolUse Edit|Write, and the Bash + mcp__ PreToolUse entries of lore-gate-g1..g4) and the ledger
 * (manifest) entries for the files.
 *
 * Coverage:
 *   HAPPY:      roster registers stop-turn-review.mjs on Stop; converge removes every retired file and entry
 *   NEGATIVE:   no registered PreToolUse/PostToolUse hook except pre-bash-git-safety-gate.mjs can deny/block
 *   REGRESSION: a user-owned Stop entry pointing elsewhere survives; the surviving producers stay registered
 *   BOUNDARY:   a fresh install never writes a retired file; this repo's .claude/settings.json drops pre-subagent-gate
 *   STATE:      a second converge after the retirement is a no-op
 *
 * @spec_ref AC-TE-5
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

const NEW_HOOK = "stop-turn-review.mjs";
const USER_COMMAND = "node /opt/user-owned/my-stop-hook.mjs";
const GIT_SAFETY = "pre-bash-git-safety-gate.mjs";

interface LegacyRegistration {
  file: string;
  runner: "node" | "bash";
  event: string;
  matcher?: string;
}

/** What the older builds registered: stop-doc-sync, claude-md-guard and lore-gate-g1..g4 (Bash + mcp__ entries). */
const LEGACY: readonly LegacyRegistration[] = [
  { file: "stop-doc-sync.mjs", runner: "node", event: "Stop" },
  { file: "claude-md-guard.sh", runner: "bash", event: "PostToolUse", matcher: "Edit|Write" },
  { file: "lore-gate-g1-spec-create.sh", runner: "bash", event: "PreToolUse", matcher: "Bash" },
  { file: "lore-gate-g1-spec-create.sh", runner: "bash", event: "PreToolUse", matcher: "mcp__.*lore_create.*" },
  { file: "lore-gate-g2-spec-promote.sh", runner: "bash", event: "PreToolUse", matcher: "Bash" },
  { file: "lore-gate-g2-spec-promote.sh", runner: "bash", event: "PreToolUse", matcher: "mcp__.*lore_approve.*" },
  { file: "lore-gate-g2-spec-promote.sh", runner: "bash", event: "PreToolUse", matcher: "mcp__.*lore_set.*" },
  { file: "lore-gate-g3-plan-promote.sh", runner: "bash", event: "PreToolUse", matcher: "Bash" },
  { file: "lore-gate-g3-plan-promote.sh", runner: "bash", event: "PreToolUse", matcher: "mcp__.*lore_approve.*" },
  { file: "lore-gate-g3-plan-promote.sh", runner: "bash", event: "PreToolUse", matcher: "mcp__.*lore_set.*" },
  { file: "lore-gate-g4-task-claim.sh", runner: "bash", event: "PreToolUse", matcher: "Bash" },
  { file: "lore-gate-g4-task-claim.sh", runner: "bash", event: "PreToolUse", matcher: "mcp__.*lore_claim.*" },
];
const LEGACY_FILES = [...new Set(LEGACY.map((reg) => reg.file))];

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

function runSetup(claudeDir: string): { stdout: string; stderr: string; exitCode: number } {
  // reason: PATH is emptied so the MCP registration step can never reach a real `claude` CLI; bun is spawned by absolute path.
  const result = spawnSync(BUN_BIN, ["run", INDEX_TS, "setup", "--claude-dir", claudeDir, "--yes"], {
    cwd: sandbox,
    env: { ...process.env, PATH: "", HOME: join(sandbox, "home"), XDG_CONFIG_HOME: join(sandbox, "xdg") },
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

/** With PATH emptied the MCP registration step cannot find `claude`; the files-written line is the success signal. */
function expectConverged(run: { stdout: string; stderr: string; exitCode: number }): void {
  expect(run.stdout, run.stderr).toContain("lore setup complete");
  expect(run.exitCode).toBe(1);
}

function readSettings(claudeDir: string): Settings {
  return JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8")) as Settings;
}

function commandsFor(claudeDir: string, event: string): string[] {
  return (readSettings(claudeDir).hooks[event] ?? []).flatMap((group) => group.hooks.map((hook) => hook.command));
}

/** A claude dir installed by THIS build, then rewound to the state a build that shipped the retired hooks left. */
function installWithLegacyHooks(): string {
  const claudeDir = mkdtempSync(join(sandbox, "claude-"));
  expectConverged(runSetup(claudeDir));

  const settings = readSettings(claudeDir);
  const manifestPath = join(claudeDir, ".lore-setup-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  const writtenAt = manifest.entries[0]?.written_at ?? new Date().toISOString();

  for (const file of LEGACY_FILES) {
    const content = `#!/usr/bin/env node\n// legacy ${file} planted by AC-TE-5\n`;
    writeFileSync(join(claudeDir, "hooks", file), content, "utf8");
    manifest.entries.push({
      path: `hooks/${file}`,
      kind: "hook",
      sha256: createHash("sha256").update(content).digest("hex"),
      written_at: writtenAt,
      ownership: "managed",
    });
  }
  for (const reg of LEGACY) {
    const groups = settings.hooks[reg.event] ?? [];
    groups.push({
      ...(reg.matcher !== undefined ? { matcher: reg.matcher } : {}),
      hooks: [{ type: "command", command: `${reg.runner} ${claudeDir}/hooks/${reg.file}` }],
    });
    settings.hooks[reg.event] = groups;
  }
  // A user-owned Stop entry that points OUTSIDE <claudeDir>/hooks/ — converge must never touch it.
  (settings.hooks["Stop"] ??= []).push({ hooks: [{ type: "command", command: USER_COMMAND }] });

  writeFileSync(join(claudeDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return claudeDir;
}

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), "lore-te5-"));
  for (const dir of ["home", "xdg"]) mkdirSync(join(sandbox, dir), { recursive: true });
}, 60_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("turn-end-review roster swap (AC-TE-5)", () => {
  it("AC-TE-5.H1: the roster registers stop-turn-review.mjs on Stop and lists none of the retired hooks; their files are gone from assets/hooks", async () => {
    const { HOOK_REGISTRATIONS } = await import("@lore/core");
    const stop = HOOK_REGISTRATIONS.filter((reg) => reg.event === "Stop").map((reg) => reg.file);
    expect(stop).toContain(NEW_HOOK);
    const files = HOOK_REGISTRATIONS.map((reg) => reg.file);
    for (const retired of LEGACY_FILES) expect(files).not.toContain(retired);
    expect(files.some((file) => file.startsWith("lore-gate-g"))).toBe(false);
    for (const retired of [...LEGACY_FILES, "pre-subagent-gate.mjs"]) {
      expect(existsSync(join(REPO_ROOT, "assets", "hooks", retired)), retired).toBe(false);
    }
    expect(existsSync(join(REPO_ROOT, "assets", "hooks", NEW_HOOK))).toBe(true);
    // The producers stop-turn-review reads stay registered.
    expect(files).toContain("user-prompt-turn-start.mjs");
    expect(files).toContain("post-edit-mark.mjs");
  });

  it("AC-TE-5.N1: no registered PreToolUse/PostToolUse hook other than pre-bash-git-safety-gate.mjs can emit a deny/block (BR-1092)", async () => {
    const { HOOK_REGISTRATIONS } = await import("@lore/core");
    const perCall = [
      ...new Set(
        HOOK_REGISTRATIONS.filter((reg) => reg.event === "PreToolUse" || reg.event === "PostToolUse").map((reg) => reg.file),
      ),
    ];
    expect(perCall).toContain(GIT_SAFETY);
    const DENY_SHAPES: readonly RegExp[] = [
      /permissionDecision["']?\s*:\s*["']deny/,
      /decision["']?\s*:\s*["']block/,
      /process\.exit\(\s*2\s*\)/,
      /^\s*exit\s+2\b/m,
    ];
    for (const file of perCall) {
      const source = readFileSync(join(REPO_ROOT, "assets", "hooks", file), "utf8");
      const hits = DENY_SHAPES.filter((shape) => shape.test(source)).length;
      if (file === GIT_SAFETY) {
        // Positive control: the scan really detects a refusal, so a zero elsewhere is not vacuous.
        expect(hits, "the git safety gate must still be detected as a refuser").toBeGreaterThan(0);
      } else {
        expect(hits, `${file} can emit a deny/block`).toBe(0);
      }
    }
  });

  it("AC-TE-5.H2: converge removes every retired file and settings entry, adds stop-turn-review, keeps the user's Stop entry", () => {
    const claudeDir = installWithLegacyHooks();
    // Precondition: the planted state really has the files and entries (otherwise the assertions below prove nothing).
    for (const file of LEGACY_FILES) expect(existsSync(join(claudeDir, "hooks", file)), file).toBe(true);
    const planted = JSON.stringify(readSettings(claudeDir));
    for (const file of LEGACY_FILES) expect(planted).toContain(file);

    expectConverged(runSetup(claudeDir));

    for (const file of LEGACY_FILES) expect(existsSync(join(claudeDir, "hooks", file)), file).toBe(false);
    const after = JSON.stringify(readSettings(claudeDir));
    for (const file of LEGACY_FILES) expect(after, file).not.toContain(file);

    const stop = commandsFor(claudeDir, "Stop");
    expect(stop.some((command) => command.includes(NEW_HOOK))).toBe(true);
    expect(stop).toContain(USER_COMMAND);
    expect(existsSync(join(claudeDir, "hooks", NEW_HOOK))).toBe(true);
    expect(commandsFor(claudeDir, "PreToolUse").some((command) => command.includes(GIT_SAFETY))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(claudeDir, ".lore-setup-manifest.json"), "utf8")) as Manifest;
    for (const file of LEGACY_FILES) expect(manifest.entries.map((entry) => entry.path)).not.toContain(`hooks/${file}`);
  });

  it("AC-TE-5.B1: a fresh install writes none of the retired files or entries and registers stop-turn-review", () => {
    const claudeDir = mkdtempSync(join(sandbox, "claude-fresh-"));
    expectConverged(runSetup(claudeDir));
    for (const file of LEGACY_FILES) expect(existsSync(join(claudeDir, "hooks", file)), file).toBe(false);
    const settings = JSON.stringify(readSettings(claudeDir));
    for (const file of LEGACY_FILES) expect(settings, file).not.toContain(file);
    expect(commandsFor(claudeDir, "Stop").some((command) => command.includes(NEW_HOOK))).toBe(true);
  });

  it("AC-TE-5.S1: a second converge after the retirement changes nothing", () => {
    const claudeDir = installWithLegacyHooks();
    expectConverged(runSetup(claudeDir));
    const settingsBefore = readFileSync(join(claudeDir, "settings.json"), "utf8");
    const manifestBefore = readFileSync(join(claudeDir, ".lore-setup-manifest.json"), "utf8");
    expectConverged(runSetup(claudeDir));
    expect(readFileSync(join(claudeDir, "settings.json"), "utf8")).toBe(settingsBefore);
    expect(readFileSync(join(claudeDir, ".lore-setup-manifest.json"), "utf8")).toBe(manifestBefore);
  });

  it("AC-TE-5.B2: this repo's .claude/settings.json no longer references pre-subagent-gate.mjs but keeps the Agent|Task gates", () => {
    const raw = readFileSync(join(REPO_ROOT, ".claude", "settings.json"), "utf8");
    expect(raw).not.toContain("pre-subagent-gate");
    expect(raw).toContain("pre-no-general-agent-gate.mjs");
    expect(raw).toContain("pre-dispatch-isolation-gate.mjs");
  });
});

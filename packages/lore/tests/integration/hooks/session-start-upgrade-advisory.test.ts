// @spawns assets/hooks/session-start-resume.mjs
/**
 * session-start-upgrade-advisory.test.ts — AC-UR-2 (spec-one-upgrade-reminder-at-session-start-covers-the-global).
 *
 * Runs the REAL `assets/hooks/session-start-resume.mjs` as a child process against throwaway
 * claude-dir / project dirs holding pre-written check caches (global `.lore-setup-check.json`,
 * project `.lore/.lore-project-check.json`) and a PATH-stubbed `lore`. Never touches ~/.claude
 * or this repo's `.lore/`.
 *
 * Coverage: HAPPY (both in sync -> silent; project behind -> one directive line), STATE (binary
 * version vs settings reason; both sides behind -> still one line), NEGATIVE (diverged files named,
 * never advised to be replaced; no rule text), ERROR/BOUNDARY (corrupt or expired project cache ->
 * detached project refresh, no advisory; reminder disabled / kill-switch -> silent).
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir } from "./hook-harness";

const HOOK = join(__dirname, "../../../../../assets/hooks/session-start-resume.mjs");
const ADVISORY_MARKER = "lore assets outdated";
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

interface Fixture {
  claudeDir: string;
  project: string;
  logPath: string;
  binDir: string;
}

function fixture(): Fixture {
  const root = makeTmpDir("upgrade-advisory-");
  dirs.push(root);
  const claudeDir = join(root, "claude");
  const project = join(root, "project");
  const binDir = join(root, "bin");
  mkdirSync(join(claudeDir, "agents"), { recursive: true });
  mkdirSync(join(project, ".lore"), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  const logPath = join(root, "lore-calls.log");
  writeFileSync(join(binDir, "lore"), `#!/bin/bash\nprintf '%s\\n' "$*" >> "${logPath}"\nexit 0\n`);
  chmodSync(join(binDir, "lore"), 0o755);
  return { claudeDir, project, logPath, binDir };
}

const nowIso = (): string => new Date().toISOString();
const files = (over: Record<string, string[]> = {}) => ({ outdated: [], diverged: [], missing: [], orphaned: [], ...over });

function syncCache(scope: "global" | "project", extra: Record<string, unknown> = {}) {
  return { checked_at: nowIso(), binary_version: "2.0.0", status: "sync", scope, files: files(), reasons: [], ...extra };
}

function staleCache(scope: "global" | "project", f: Record<string, string[]>, reasons: string[], extra: Record<string, unknown> = {}) {
  const ff = files(f);
  return {
    checked_at: nowIso(),
    binary_version: "2.0.0",
    status: "stale",
    scope,
    files: ff,
    reasons,
    stale_counts: { outdated: ff.outdated.length, diverged: ff.diverged.length, missing: ff.missing.length },
    ...extra,
  };
}

function writeCaches(fx: Fixture, global: unknown | null, project: unknown | null | string): void {
  if (global !== null) writeFileSync(join(fx.claudeDir, ".lore-setup-check.json"), JSON.stringify(global));
  if (project !== null) {
    writeFileSync(join(fx.project, ".lore", ".lore-project-check.json"), typeof project === "string" ? project : JSON.stringify(project));
  }
}

function runHook(fx: Fixture, env: Record<string, string> = {}): { status: number | null; stdout: string; context: string } {
  const r = spawnSync("node", [HOOK], {
    cwd: fx.project,
    input: JSON.stringify({ session_id: `adv-${Math.random().toString(36).slice(2)}`, cwd: fx.project }),
    encoding: "utf8",
    timeout: 20000,
    env: {
      ...process.env,
      HOME: fx.claudeDir,
      CLAUDE_CONFIG_DIR: fx.claudeDir,
      CLAUDE_AGENTS_DIR_OVERRIDE: join(fx.claudeDir, "agents"),
      CLAUDE_STATE_BASE_OVERRIDE: join(fx.claudeDir, "state"),
      PATH: `${fx.binDir}:${process.env.PATH ?? ""}`,
      ...env,
    },
  });
  const context = JSON.parse(r.stdout)?.hookSpecificOutput?.additionalContext ?? "";
  return { status: r.status, stdout: r.stdout, context };
}

function advisoryLines(context: string): string[] {
  return context.split("\n").filter((l) => l.includes(ADVISORY_MARKER));
}

function loreCalls(fx: Fixture): string[] {
  return existsSync(fx.logPath) ? readFileSync(fx.logPath, "utf8").split("\n").filter(Boolean) : [];
}

function waitForCall(fx: Fixture, prefix: string): boolean {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (loreCalls(fx).some((l) => l.startsWith(prefix))) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return false;
}

function expectNoRuleText(stdout: string): void {
  expect(stdout).not.toContain("FRAGMENTS_STALE");
  expect(stdout).not.toContain("fragments");
}

describe("AC-UR-2 session-start upgrade advisory", () => {
  it("both sides in sync -> no advisory line", () => {
    const fx = fixture();
    writeCaches(fx, syncCache("global"), syncCache("project"));
    const r = runHook(fx);
    expect(r.status).toBe(0);
    expect(advisoryLines(r.context)).toHaveLength(0);
    expectNoRuleText(r.stdout);
    expect(loreCalls(fx).filter((l) => l.startsWith("setup"))).toHaveLength(0);
  });

  it("project outdated, binary version changed -> one line naming project side, reason and lore setup --project", () => {
    const fx = fixture();
    writeCaches(fx, syncCache("global"), staleCache("project", { outdated: [".claude/hooks/x.mjs"] }, ["binary_version_changed"], { binary_version: "1.9.0" }));
    const r = runHook(fx);
    const lines = advisoryLines(r.context);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("project");
    expect(lines[0]).toContain("binary version changed");
    expect(lines[0]).toContain("`lore setup --project`");
    expect(lines[0]).not.toContain("global");
    expectNoRuleText(r.stdout);
  });

  it("project outdated after a settings change under the same binary -> settings reason, not binary reason", () => {
    const fx = fixture();
    writeCaches(fx, syncCache("global"), staleCache("project", { missing: [".claude/settings.json#hooks.SessionStart"] }, ["settings_changed"]));
    const lines = advisoryLines(runHook(fx).context);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("settings changed");
    expect(lines[0]).toContain(".claude/settings.json#hooks.SessionStart");
    expect(lines[0]).not.toContain("binary version changed");
    expect(lines[0]).toContain("`lore setup --project`");
  });

  it("global and project both behind -> still exactly one line naming both commands", () => {
    const fx = fixture();
    writeCaches(
      fx,
      staleCache("global", { outdated: ["hooks/a.mjs"] }, ["binary_version_changed"]),
      staleCache("project", { outdated: [".claude/hooks/x.mjs"] }, ["binary_version_changed"]),
    );
    const r = runHook(fx);
    const lines = advisoryLines(r.context);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("global");
    expect(lines[0]).toContain("project");
    expect(lines[0]).toContain("`lore setup`");
    expect(lines[0]).toContain("`lore setup --project`");
    expect(r.context.split("\n").filter((l) => l.includes("lore setup"))).toHaveLength(1);
  });

  it("diverged file -> named with the hand-edit reason, never advised to be replaced", () => {
    const fx = fixture();
    writeCaches(fx, syncCache("global"), staleCache("project", { diverged: [".claude/rules/mine.md"] }, ["hand_edited"]));
    const r = runHook(fx);
    const lines = advisoryLines(r.context);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(".claude/rules/mine.md");
    expect(lines[0]).toContain("edited by hand");
    expect(lines[0]).not.toContain("--force-diverged");
    expect((lines[0] ?? "").toLowerCase()).not.toContain("overwrite");
    expectNoRuleText(r.stdout);
  });

  it("corrupt project cache is not read as in sync -> detached project refresh, no advisory", () => {
    const fx = fixture();
    writeCaches(fx, syncCache("global"), "{not json");
    const r = runHook(fx);
    expect(advisoryLines(r.context)).toHaveLength(0);
    expect(waitForCall(fx, "setup --project --check --json")).toBe(true);
  });

  it("expired project cache -> detached project refresh, no advisory from it", () => {
    const fx = fixture();
    writeCaches(fx, syncCache("global"), staleCache("project", { outdated: ["a"] }, ["binary_version_changed"], { checked_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString() }));
    const r = runHook(fx);
    expect(advisoryLines(r.context)).toHaveLength(0);
    expect(waitForCall(fx, "setup --project --check --json")).toBe(true);
  });

  it("reminder disabled on a side, or LORE_SETUP_NO_CHECK=1 -> silent and no refresh", () => {
    const fx = fixture();
    writeCaches(fx, syncCache("global"), staleCache("project", { outdated: ["a"] }, ["binary_version_changed"], { reminder_enabled: false }));
    expect(advisoryLines(runHook(fx).context)).toHaveLength(0);
    writeCaches(fx, null, staleCache("project", { outdated: ["a"] }, ["binary_version_changed"]));
    const killed = runHook(fx, { LORE_SETUP_NO_CHECK: "1" });
    expect(advisoryLines(killed.context)).toHaveLength(0);
    expect(loreCalls(fx).filter((l) => l.startsWith("setup"))).toHaveLength(0);
  });
});

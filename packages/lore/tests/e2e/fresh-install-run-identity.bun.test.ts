// @spawns dist/lore
// @spawns assets/hooks/pre-tool-harness-run.mjs
/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and AC-RV-8 (BR-1218, BR-1093, BR-815)
 *
 * A fresh consumer install injects the per-call run. `lore setup` (the compiled `dist/lore`) runs into a throwaway
 * HOME / Claude config directory; then:
 *   - settings.json registers the Bash PreToolUse hook, once, pointing at the INSTALLED `pre-tool-harness-run.mjs`;
 *   - that installed file (run exactly as the registered command string runs it, never the repo copy) turns a Bash payload
 *     into `updatedInput.command` = the export line + the unchanged command, with no permission decision;
 *   - settings.json gains exactly ONE allow rule, it matches the export line the hook prints, and no other permission key
 *     appears; `lore setup --uninstall` removes the rule, the hook registration and the installed file.
 * The setup task's own unit tests (setup-export-allow-rule.bun.test.ts) cover the rule merge in depth; this file proves
 * the shipped pieces work together from a fresh install.
 *
 * Whether Claude Code's permission matcher accepts the two-line command is NOT asserted here: that is the live-session
 * human criterion AC-RV-12.
 *
 * Coverage:
 *   HAPPY:      install -> registration + hook output + one allow rule matching the printed export line.
 *   NEGATIVE:   a non-Bash payload prints nothing (exit 0); the hook is fail-open when `lore` is not on PATH.
 *   STATE:      uninstall removes the rule, the Bash registration and the installed hook file.
 *   REGRESSION: the installed hook is byte-identical to the shipped asset (the shipped registration is what is tested).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const SHIPPED_HOOK = join(REPO_ROOT, "assets", "hooks", "pre-tool-harness-run.mjs");
const HOOK_FILE = "pre-tool-harness-run.mjs";
const ALLOW_RULE = "Bash(export LORE_HARNESS_RUN=*)";
const SESSION = "e2e-fresh-install-session";
/** `lore setup` with PATH="" cannot reach a real `claude` to register the tool server: it writes every file, then exits 1. */
const SETUP_MCP_UNREGISTERED_EXIT = 1;

let root = "";
let project = "";
let claudeDir = "";

type HookEntry = { matcher?: string; hooks: Array<{ type: string; command: string }> };
type Settings = { hooks?: { PreToolUse?: HookEntry[] }; permissions?: { allow?: string[]; [key: string]: unknown } };

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env, HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "xdg"), CLAUDECODE: "1", EDITOR: "true" };
  for (const k of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "LORE_HARNESS_RUN", "LORE_TEST_IDENTITY"]) delete e[k];
  return { ...e, ...extra };
}

function setup(args: string[]): number {
  // PATH="" keeps the MCP registration step from reaching a real `claude`.
  const p = spawnSync(LORE_BIN, ["setup", ...args, "--claude-dir", claudeDir, "--yes"], { cwd: project, env: env({ PATH: "" }), encoding: "utf8" });
  return p.status ?? -1;
}

const settings = (): Settings => JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8")) as Settings;

/** Every registered command of the PreToolUse entries with exactly this matcher that name the harness-run hook. */
function registrations(matcher: string): string[] {
  return (settings().hooks?.PreToolUse ?? [])
    .filter((entry) => entry.matcher === matcher)
    .flatMap((entry) => entry.hooks.map((h) => h.command))
    .filter((command) => command.includes(HOOK_FILE));
}

/** Runs the REGISTERED command string the way Claude Code does (a shell), payload JSON on stdin. */
function runRegistered(command: string, payload: Record<string, unknown>, path: string): { exitCode: number; stdout: string } {
  const p = spawnSync("sh", ["-c", command], { cwd: project, env: env({ PATH: path }), input: JSON.stringify(payload), encoding: "utf8" });
  return { exitCode: p.status ?? -1, stdout: p.stdout };
}

const bashPayload = (command: string): Record<string, unknown> => ({ hook_event_name: "PreToolUse", tool_name: "Bash", session_id: SESSION, tool_input: { command } });

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  root = realpathSync(mkdtempSync(join(tmpdir(), "fresh-install-run-identity-")));
  if (root.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  project = join(root, "project");
  claudeDir = join(root, "home", ".claude");
  mkdirSync(project, { recursive: true });
  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  expect(setup([])).toBe(SETUP_MCP_UNREGISTERED_EXIT);
});

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

describe("AC-RV-8: a fresh install injects the per-call run (installed hook, written settings)", () => {
  it("REGRESSION: the installed hook file is byte-identical to the shipped asset", () => {
    const installed = join(claudeDir, "hooks", HOOK_FILE);
    expect(existsSync(installed)).toBe(true);
    expect(readFileSync(installed, "utf8")).toBe(readFileSync(SHIPPED_HOOK, "utf8"));
  });

  it("HAPPY: settings.json registers the Bash PreToolUse hook exactly once, at the installed file", () => {
    const commands = registrations("Bash");
    expect(commands.length).toBe(1);
    expect(commands[0]).toContain(join(claudeDir, "hooks", HOOK_FILE));
  });

  it("HAPPY: the installed hook prints the export line and the unchanged command, with no permission decision", () => {
    const [command] = registrations("Bash");
    const original = "cd src && lore get x | head -1\nfor t in a b; do lore get $t; done";
    const result = runRegistered(command as string, bashPayload(original), `${dirname(LORE_BIN)}${delimiter}${process.env["PATH"] ?? ""}`);
    expect(result.exitCode).toBe(0);
    const out = JSON.parse(result.stdout) as { hookSpecificOutput: Record<string, unknown> & { updatedInput: { command: string } } };
    expect(out.hookSpecificOutput.updatedInput.command).toBe(`export LORE_HARNESS_RUN='cc:${SESSION}'\n${original}`);
    expect(Object.keys(out.hookSpecificOutput).sort()).toEqual(["hookEventName", "updatedInput"]);
  });

  it("HAPPY: settings.json gains exactly one allow rule, no other permission, and it matches the printed export line", () => {
    const { permissions } = settings();
    expect(permissions).toEqual({ allow: [ALLOW_RULE] });
    const prefix = ALLOW_RULE.slice("Bash(".length, ALLOW_RULE.indexOf("*"));
    const [command] = registrations("Bash");
    const result = runRegistered(command as string, bashPayload("lore get x"), `${dirname(LORE_BIN)}${delimiter}${process.env["PATH"] ?? ""}`);
    const printed = (JSON.parse(result.stdout) as { hookSpecificOutput: { updatedInput: { command: string } } }).hookSpecificOutput.updatedInput.command;
    expect(printed.split("\n")[0]?.startsWith(prefix)).toBe(true);
  });

  it("NEGATIVE: a non-Bash payload prints nothing", () => {
    const [command] = registrations("Bash");
    const result = runRegistered(command as string, { hook_event_name: "PreToolUse", tool_name: "Read", session_id: SESSION, tool_input: { file_path: "x" } }, `${dirname(LORE_BIN)}${delimiter}${process.env["PATH"] ?? ""}`);
    expect(result).toEqual({ exitCode: 0, stdout: "" });
  });

  it("NEGATIVE: with `lore` absent from PATH the hook is fail-open (exit 0, nothing printed)", () => {
    const [command] = registrations("Bash");
    const node = spawnSync("sh", ["-c", "command -v node"], { env: process.env, encoding: "utf8" }).stdout.trim();
    expect(node).not.toBe("");
    const result = runRegistered(command as string, bashPayload("lore get x"), `${dirname(node)}${delimiter}/usr/bin${delimiter}/bin`);
    expect(result).toEqual({ exitCode: 0, stdout: "" });
  });

  it("STATE: uninstall removes the allow rule, the Bash registration and the installed hook", () => {
    expect(setup(["--uninstall"])).toBe(0);
    expect(existsSync(join(claudeDir, "hooks", HOOK_FILE))).toBe(false);
    if (existsSync(join(claudeDir, "settings.json"))) {
      expect(settings().permissions?.allow ?? []).not.toContain(ALLOW_RULE);
      expect(registrations("Bash")).toEqual([]);
    }
  });
});

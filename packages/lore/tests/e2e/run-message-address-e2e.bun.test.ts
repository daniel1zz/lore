// @spawns assets/hooks/run-register.mjs
// @spawns dist/lore
/**
 * @spec_ref spec-runs-carry-their-messaging-address-holder-listings-show-it (AC-MA-4; BR-1360, BR-1363)
 *
 * End to end with the built `dist/lore` and NO live Claude Code session: in a mkdtemp project after `lore init` and
 * `lore setup`, the INSTALLED run-register hook is fed a SessionStart payload with CLAUDE_CODE_MESSAGING_SOCKET, a
 * task is claimed under that run, and `lore bootstrap --json` lists that session with `message_address`
 * `uds:<socket>`; a resume SessionStart payload for the same session with another socket changes it.
 *
 * Six dimensions: HAPPY (fresh install -> address shown), STATE (resume replaces it), NEGATIVE (a session whose
 * SessionStart carried no socket lists null), BOUNDARY (a SubagentStart payload with the variable set stores none
 * and does not disturb the main run's address), ERROR (n/a: the hook is fail-open; asserted by exit 0),
 * REGRESSION (the session is listed exactly once after the resume).
 *
 * No mocks: real hook from the installed copy (node), real `dist/lore`, throwaway git repo + corpus + HOME. The
 * repo's own `.lore/` is never touched.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

// reason: the claim actor name is `agent:session-<first 8 chars>`, so the two sessions must differ inside those 8 characters
// or their claims group into one session row (the grouping key is by/machine/worktree/session_id).
const SESSION = "5c1daaaa-e2e-address-session";
const OTHER_SESSION = "9e44bbbb-e2e-address-session";
const MAIN_RUN = `cc:${SESSION}`;
const OTHER_RUN = `cc:${OTHER_SESSION}`;

interface Out {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

let root = "";
let corpus = "";
let claudeDir = "";
let installedHook = "";

/** Hermetic child env: identity sources scrubbed, `dist/lore` first on PATH so the hook's `lore` is the built binary. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    CLAUDECODE: "1",
    EDITOR: "true",
    PATH: `${dirname(LORE_BIN)}${delimiter}${process.env["PATH"] ?? ""}`,
  };
  for (const k of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET"]) delete e[k];
  return { ...e, ...extra };
}

/** `run` is the per-call run value (`LORE_HARNESS_RUN`), as the Bash hook hands it to a real call; its harness is this test process. */
function lore(args: string[], run?: string): Out {
  const p = spawnSync(LORE_BIN, args, { cwd: corpus, env: childEnv(run === undefined ? {} : { LORE_HARNESS_RUN: run }), encoding: "utf8" });
  return { stdout: p.stdout, stderr: p.stderr, exitCode: p.status ?? 1 };
}

function mustLore(args: string[], run?: string): Out {
  const r = lore(args, run);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

/** Runs the INSTALLED hook as Claude Code would: payload JSON on stdin, cwd = project, socket in the environment. */
function runHook(payload: Record<string, unknown>, socket?: string): Out {
  const env = childEnv(socket === undefined ? {} : { CLAUDE_CODE_MESSAGING_SOCKET: socket });
  const p = spawnSync("node", [installedHook], { cwd: corpus, env, input: JSON.stringify(payload), encoding: "utf8" });
  return { stdout: p.stdout, stderr: p.stderr, exitCode: p.status ?? 1 };
}

function newTask(title: string): string {
  const r = mustLore(["create", "task", "--adhoc", "--title", title, "--ac-scope", "", "--json"]);
  return (JSON.parse(r.stdout).data as { slug: string }).slug;
}

interface ActiveSession {
  readonly task_slugs: string[];
  readonly message_address?: string | null;
}

function activeSessions(): ActiveSession[] {
  const r = mustLore(["bootstrap", "--json"]);
  return (JSON.parse(r.stdout).data.active_sessions ?? []) as ActiveSession[];
}

function addressHolding(slug: string): string | null | undefined {
  const matches = activeSessions().filter((s) => s.task_slugs.includes(slug));
  expect(matches.length).toBe(1);
  return matches[0]?.message_address;
}

const tasks = { main: "", other: "" };

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);

  root = realpathSync(mkdtempSync(join(tmpdir(), "run-message-address-e2e-")));
  if (root.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  const git = (a: string[]) => execFileSync("git", a, { cwd: corpus, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "e2e@example.invalid"]);
  git(["config", "user.name", "message address e2e"]);
  writeFileSync(join(corpus, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);

  mustLore(["init"]);
  mustLore(["create", "prd", "--title", "E2E Root", "--content", "root", "--no-ai"]);
  // `lore setup` installs the hooks into a Claude config directory; PATH="" keeps any `claude` unreachable
  // (setup registers no MCP server and exits 0 — task-skill-implement-lore-setup-registers-no-tool-server-and).
  claudeDir = join(root, "claude-config");
  const setup = spawnSync(LORE_BIN, ["setup", "--claude-dir", claudeDir, "--yes"], {
    cwd: corpus,
    env: { ...childEnv(), PATH: "" },
    encoding: "utf8",
  });
  installedHook = join(claudeDir, "hooks", "run-register.mjs");
  if (!existsSync(installedHook)) {
    throw new Error(`lore setup did not install ${installedHook} (exit ${setup.status}): ${setup.stderr}${setup.stdout}`);
  }
  tasks.main = newTask("e2e address main holder");
  tasks.other = newTask("e2e address other holder");
});

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

describe("AC-MA-4: installed hook -> built dist/lore -> bootstrap shows the holder's current address", () => {
  it("HAPPY: a SessionStart with a socket, then a claim under that run, lists uds:/tmp/e2e/7.sock", () => {
    const start = runHook({ session_id: SESSION, hook_event_name: "SessionStart", source: "startup" }, "/tmp/e2e/7.sock");
    expect(start.exitCode).toBe(0);
    expect(start.stdout).toBe("");
    mustLore(["claim", tasks.main], MAIN_RUN);
    expect(addressHolding(tasks.main)).toBe("uds:/tmp/e2e/7.sock");
  });

  it("BOUNDARY: a SubagentStart with the variable set stores no address and leaves the main run's untouched", () => {
    const sub = runHook(
      { session_id: SESSION, hook_event_name: "SubagentStart", agent_id: "agent-zzz", agent_type: "worker" },
      "/tmp/e2e/99.sock",
    );
    expect(sub.exitCode).toBe(0);
    expect(addressHolding(tasks.main)).toBe("uds:/tmp/e2e/7.sock");
  });

  it("NEGATIVE: a session registered with no socket lists a null address", () => {
    runHook({ session_id: OTHER_SESSION, hook_event_name: "SessionStart", source: "startup" });
    mustLore(["claim", tasks.other], OTHER_RUN);
    expect(addressHolding(tasks.other)).toBeNull();
  });

  it("STATE: a resume SessionStart with /tmp/e2e/8.sock changes the listed address, and the session is listed once", () => {
    const resume = runHook({ session_id: SESSION, hook_event_name: "SessionStart", source: "resume" }, "/tmp/e2e/8.sock");
    expect(resume.exitCode).toBe(0);
    expect(addressHolding(tasks.main)).toBe("uds:/tmp/e2e/8.sock");
    expect(activeSessions().filter((s) => s.task_slugs.includes(tasks.main)).length).toBe(1);
  });
});

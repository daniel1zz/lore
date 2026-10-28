// @spawns dist/lore
/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and AC-RV-7 (BR-1027, BR-1036)
 *
 * Concurrent subagents of ONE session each carry their own run. Two PreToolUse payloads (subagents `a` and `b` of session
 * S) go through the real `lore run attest-input` AT THE SAME TIME; both resulting commands then run 20 times each, all 40
 * started together, each writing a document to one throwaway corpus. Every stored write carries exactly its own run
 * (`cc:S:a` or `cc:S:b`): zero cross-attribution.
 *
 * Each subagent has a DISTINCT harness process (a `sh` the test starts and registers as that run's harness pid + start
 * time), and the 20 writes of a subagent are descendants of its own harness, so `lore` verifies each value by process
 * ancestry. The main run `cc:S` is registered with the TEST process as harness: if the carrier gave both subagents the
 * session's run, the writes would verify (the test process is an ancestor of both) and be stamped `cc:S`, which this
 * test reports as cross-attribution instead of a refusal.
 *
 * False green guarded: the commands are started together (no sequential call hides shared state), and the stored
 * `harness_run` of all 40 documents is compared with the run of the subagent that wrote it.
 *
 * Coverage:
 *   HAPPY:      40 parallel writes, exit 0 each, 20 stored under cc:S:a and 20 under cc:S:b.
 *   BOUNDARY:   the two attested commands differ only in their own run, and each names its own run.
 *   STATE:      the corpus holds no document stamped with the session's main run or with no run.
 *   REGRESSION: a payload without agent_id still gets the main run (`cc:S`), unchanged.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";
import { registerRunInDb } from "../helpers/test-run-identity";
import { ensureRequirementsDocSlug } from "../helpers/parented-create";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");
const SESSION = "e2e-concurrent-session";
const MAIN_RUN = `cc:${SESSION}`;
const AGENTS = ["a", "b"] as const;
const WRITES_PER_AGENT = 20;

let root = "";
let corpus = "";
let dbPath = "";

function agentEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    CLAUDECODE: "1",
    EDITOR: "true",
    PATH: `${dirname(LORE_BIN)}${delimiter}${process.env["PATH"] ?? ""}`,
  };
  for (const k of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "LORE_HARNESS_RUN", "LORE_TEST_IDENTITY"]) delete e[k];
  return { ...e, ...extra };
}

/** Start time of `pid` as lore's process table reads it (`ps -o lstart=`, ISO-8601, second precision). */
function startTimeOf(pid: number): string {
  const ps = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
  const parsed = new Date((ps.stdout ?? "").trim());
  if (ps.status !== 0 || Number.isNaN(parsed.getTime())) throw new Error(`ps cannot read the start time of ${pid}`);
  return parsed.toISOString();
}

interface Exit {
  readonly code: number | null;
  readonly stderr: string;
}

function whenExited(child: ChildProcess): Promise<Exit> {
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
  return new Promise((resolve) => child.on("close", (code) => resolve({ code, stderr })));
}

/** The real hook verb for one Bash payload of `agent` (or of the main thread when `agent` is undefined). */
function attest(command: string, agent: string | undefined): Promise<string> {
  const payload = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    session_id: SESSION,
    ...(agent === undefined ? {} : { agent_id: agent }),
    tool_input: { command },
  });
  const child = spawn(LORE_BIN, ["run", "attest-input"], { cwd: corpus, env: agentEnv({ LORE_TEST_IDENTITY: "none" }), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
  child.stdin?.end(payload);
  return whenExited(child).then((exit) => {
    if (exit.code !== 0) throw new Error(`attest-input exited ${exit.code}: ${exit.stderr}`);
    return (JSON.parse(stdout) as { hookSpecificOutput: { updatedInput: { command: string } } }).hookSpecificOutput.updatedInput.command;
  });
}

// reason: a knowledge record needs a parent (spec-documents-that-need-a-parent-are-refused-without-one-an-ad D6); the command text
// names the fixture's requirements document, so it is built once the corpus exists.
let WRITE = "";

/** Runs `fn` against the corpus registry/documents, read-write, with a lock wait so it never races a writer. */
function withDb<T>(fn: (db: Database) => T, readonly = false): T {
  const db = new Database(dbPath, readonly ? { readonly: true } : undefined);
  try {
    db.exec("PRAGMA busy_timeout = 10000");
    return fn(db);
  } finally {
    db.close();
  }
}

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
  root = realpathSync(mkdtempSync(join(tmpdir(), "run-identity-concurrent-")));
  if (root.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  const git = (a: string[]) => execFileSync("git", a, { cwd: corpus, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "e2e@example.invalid"]);
  git(["config", "user.name", "concurrent e2e"]);
  writeFileSync(join(corpus, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  const init = spawnSync(LORE_BIN, ["init"], { cwd: corpus, env: agentEnv(), encoding: "utf8" });
  if (init.status !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  dbPath = join(corpus, ".lore", "lore.db");
  // The main session's harness is THIS process (an ancestor of both subagents' harnesses below).
  if (!registerRunInDb(dbPath, MAIN_RUN)) throw new Error("run registration found no runs table");
  const parentSlug = ensureRequirementsDocSlug((args) => {
    const p = spawnSync(LORE_BIN, args, { cwd: corpus, env: agentEnv({ LORE_HARNESS_RUN: MAIN_RUN }), encoding: "utf8" });
    return { stdout: p.stdout, stderr: p.stderr, exitCode: p.status };
  });
  WRITE = `lore create knowledge --parent ${parentSlug} --sub-type reference --title "$1" --content body --no-ai`;
});

afterAll(() => {
  if (root !== "") rmSync(root, { recursive: true, force: true });
});

describe("AC-RV-7: concurrent subagent calls each carry their own run (compiled dist/lore)", () => {
  it("REGRESSION: a payload without agent_id still carries the main run", async () => {
    const command = await attest("echo hi", undefined);
    expect(command).toBe(`export LORE_HARNESS_RUN='${MAIN_RUN}'\necho hi`);
  });

  it("HAPPY: two attested payloads and 2 x 20 writes, all started together, stamp each write with its own run", async () => {
    // 1. Both PreToolUse payloads go through the verb at the same time.
    const attested = await Promise.all(AGENTS.map((agent) => attest(WRITE, agent)));
    AGENTS.forEach((agent, i) => {
      expect(attested[i]).toBe(`export LORE_HARNESS_RUN='${MAIN_RUN}:${agent}'\n${WRITE}`);
    });

    // 2. Each subagent gets its OWN harness process: a `sh` that waits for "go", then starts its 20 calls at once.
    const harnesses = AGENTS.map((agent, i) => {
      const script = `read go; n=0; while [ $n -lt ${WRITES_PER_AGENT} ]; do bash -c "$CMD" bash "${agent}-$n" & n=$((n+1)); done; wait`;
      const child = spawn("sh", ["-c", script], { cwd: corpus, env: agentEnv({ CMD: attested[i] as string }), stdio: ["pipe", "pipe", "pipe"] });
      if (child.pid === undefined) throw new Error("harness did not start");
      return { agent, child, pid: child.pid, done: whenExited(child) };
    });

    // 3. Register each subagent's run with its own harness pid (before it is told to go).
    for (const h of harnesses) {
      const run = `${MAIN_RUN}:${h.agent}`;
      if (!registerRunInDb(dbPath, run)) throw new Error("run registration found no runs table");
      withDb((db) => db.query("UPDATE runs SET harness_pid = ?, harness_pid_start = ? WHERE id = ?").run(h.pid, startTimeOf(h.pid), run));
    }
    expect(new Set(harnesses.map((h) => h.pid)).size).toBe(AGENTS.length);

    // 4. Release both harnesses together.
    for (const h of harnesses) h.child.stdin?.write("go\n");
    const exits = await Promise.all(harnesses.map((h) => h.done));
    exits.forEach((exit, i) => expect({ agent: harnesses[i]?.agent, code: exit.code, stderr: exit.stderr }).toEqual({ agent: harnesses[i]?.agent, code: 0, stderr: exit.stderr }));

    // 5. Every stored write carries exactly its writer's run.
    const rows = withDb(
      (db) => db.query("SELECT title, harness_run FROM versions WHERE title GLOB '[ab]-[0-9]*'").all() as Array<{ title: string; harness_run: string | null }>,
      true,
    );
    expect(rows.length).toBe(AGENTS.length * WRITES_PER_AGENT);
    const misattributed = rows.filter((r) => r.harness_run !== `${MAIN_RUN}:${r.title.split("-")[0]}`);
    expect(misattributed).toEqual([]);
    for (const agent of AGENTS) {
      expect(rows.filter((r) => r.harness_run === `${MAIN_RUN}:${agent}`).length).toBe(WRITES_PER_AGENT);
    }
  });

  it("STATE: no document of the test is stamped with the session's main run or with no run", () => {
    const stamped = withDb(
      (db) => db.query("SELECT harness_run FROM versions WHERE title GLOB '[ab]-[0-9]*' AND (harness_run IS NULL OR harness_run = ?)").all(MAIN_RUN),
      true,
    );
    expect(stamped).toEqual([]);
  });
});

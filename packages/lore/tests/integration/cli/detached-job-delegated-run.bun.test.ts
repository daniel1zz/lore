/**
 * @spec_ref spec-a-detached-lore-job-writes-under-a-child-run-delegated-by#AC-DJ-1
 * @task task-delegate-a-verified-child-run-to-detached-lore-jobs-fixes (resolves #501)
 * @spawns packages/lore/src/index.ts
 *
 * A detached lore job (the post-integrate review batch) outlives `lore integrate`, is re-parented to pid 1 and so no
 * longer descends from the caller's harness. It writes under a CHILD run its verified caller registered for it: the
 * job process is its own harness, the parent run is the caller's, and a stdin start gate keeps the job from writing
 * before that run exists.
 *
 * Real processes throughout, in a throwaway corpus (`lore init` in a mkdtemp dir, never this repository's `.lore/`):
 *   - the CALLER is a short-lived `bun` helper script that composes the App exactly as `lore integrate` does
 *     (`resolveEntryInvocation` + `loadLoreApp` + `app.verifiedInvocationIdentity`), calls `spawnDelegatedJob` and
 *     exits, so the job is re-parented to pid 1; the helper descends from this test process, which is the harness of
 *     the caller run;
 *   - the JOB is either `sh` (so its ordering, environment and parent pid can be observed from inside) or the real
 *     `lore` entry (so the gate, the self-harness verification and the run end are the production ones).
 *
 * False greens guarded (spec AC-DJ-1): the parent chain, the job's own pid and measured start time, the ended state and the
 * pid-1 re-parenting are each asserted; the refused-caller case asserts zero new rows and that the job never started.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRealProcessTablePort } from "../../../src/adapters/process-table-port.js";
import { ensureRequirementsDocSlug } from "../../helpers/parented-create";
import { registerTestRun } from "../../helpers/test-run-identity";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const SRC = join(PACKAGE_ROOT, "src");
const ENTRY = join(SRC, "index.ts");

const CALLER = "cc:dj-caller";
const JOB_NAME = "review-batch";
const REFUSED_PREFIX = "delegated run refused: caller run";

interface RunRow {
  id: string;
  kind: string;
  agent_type: string | null;
  parent_run_id: string | null;
  harness_pid: number | null;
  harness_pid_start: string | null;
  ended_at: string | null;
  end_reason: string | null;
}

interface Spawned {
  readonly pid: number;
  readonly run: string;
  readonly helperPid: number;
}

interface Outcome {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

let dir: string;

function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: dir, CLAUDECODE: "1", ...extra };
  for (const name of ["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "LORE_GATE_BYPASS", "LORE_HARNESS_RUN", "LORE_DELEGATED_JOB"]) {
    if (!(name in extra)) delete env[name];
  }
  return env;
}

function lore(args: string[], env: Record<string, string>, stdin?: string): Outcome {
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], {
    cwd: dir,
    env,
    ...(stdin === undefined ? {} : { stdin: new TextEncoder().encode(stdin) }),
  });
  return { exitCode: proc.exitCode ?? 1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

function withDb<T>(body: (db: Database) => T): T {
  const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
  try {
    return body(db);
  } finally {
    db.close();
  }
}

function runRow(id: string): RunRow | null {
  return withDb((db) => db.query("SELECT id, kind, agent_type, parent_run_id, harness_pid, harness_pid_start, ended_at, end_reason FROM runs WHERE id = ?").get(id) as RunRow | null);
}

function delegatedRows(): RunRow[] {
  return withDb((db) => db.query("SELECT id, kind, agent_type, parent_run_id, harness_pid, harness_pid_start, ended_at, end_reason FROM runs WHERE agent_type = ?").all(JOB_NAME) as RunRow[]);
}

function registerOpenRun(run: string, harnessPid: number, harnessStart: string): void {
  registerTestRun(dir, run);
  const db = new Database(join(dir, ".lore", "lore.db"));
  try {
    db.query("UPDATE runs SET harness_pid = ?, harness_pid_start = ? WHERE id = ?").run(harnessPid, harnessStart, run);
  } finally {
    db.close();
  }
}

async function eventually<T>(read: () => T | null | undefined | false, what: string, milliseconds = 30_000): Promise<T> {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== null && value !== undefined && value !== false) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** The caller helper: composes the App as `lore integrate` does, spawns one delegated job, prints the result, exits. */
function callerScript(): string {
  return `
const { resolveEntryInvocation } = await import(${JSON.stringify(join(SRC, "adapters/cli/run-cli.js"))});
const { loadLoreApp } = await import(${JSON.stringify(join(SRC, "adapters/cli/loader.js"))});
const { spawnDelegatedJob } = await import(${JSON.stringify(join(SRC, "adapters/cli/review-batch-wiring.js"))});
const { exitCode, formatError } = await import(${JSON.stringify(join(SRC, "adapters/cli/utils.js"))});
const inv = await resolveEntryInvocation([]);
const { app } = loadLoreApp({ inv });
const verified = await app.verifiedInvocationIdentity?.();
const spawned = await spawnDelegatedJob({
  name: ${JSON.stringify(JOB_NAME)},
  args: JSON.parse(process.env.DJ_JOB_ARGS),
  cwd: inv.cwd,
  logPath: ${JSON.stringify(join(dir, ".lore", "review-batch.log"))},
  execPath: process.env.DJ_JOB_EXEC,
  isCompiled: true,
  env: inv.env,
  runService: app.runService,
  caller: { claimedRun: inv.identity.harnessRun, verified },
});
app.close();
if (!spawned.ok) {
  process.stderr.write(formatError(spawned.error) + "\\n");
  process.exit(exitCode(spawned.error));
}
process.stdout.write(JSON.stringify({ pid: spawned.value.pid, run: spawned.value.run, helperPid: process.pid }) + "\\n");
process.exit(0);
`;
}

function runCaller(callerRun: string, job: { exec: string; args: string[] }): { outcome: Outcome; spawned: Spawned | null } {
  const script = join(dir, "caller.ts");
  writeFileSync(script, callerScript());
  const proc = Bun.spawnSync(["bun", "run", script], {
    cwd: dir,
    env: cleanEnv({ LORE_HARNESS_RUN: callerRun, DJ_JOB_ARGS: JSON.stringify(job.args), DJ_JOB_EXEC: job.exec }),
  });
  const outcome = { exitCode: proc.exitCode ?? 1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
  const last = outcome.stdout.trim().split("\n").pop() ?? "";
  return { outcome, spawned: outcome.exitCode === 0 && last.startsWith("{") ? (JSON.parse(last) as Spawned) : null };
}

/** A `sh` job: `body` runs after the start gate line `go` arrived on its stdin. */
function shJob(body: string): { exec: string; args: string[] } {
  return { exec: "sh", args: ["-c", `read go; ${body}`] };
}

/** The job's knowledge create; a knowledge needs a parent, so `--parent` is filled in by beforeEach once the corpus exists. */
let NOTE_ARGS: string[] = [];
let NOTE_PARENT = "";

function noteVersions(): { harness_run: string | null }[] {
  return withDb((db) => db.query("SELECT harness_run FROM versions WHERE title = 'Delegated job note'").all() as { harness_run: string | null }[]);
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-delegated-job-")));
  mkdirSync(join(dir, "out"), { recursive: true });
  const init = lore(["init"], cleanEnv({ LORE_HARNESS_RUN: "cc:dj-init" }));
  if (init.exitCode !== 0) throw new Error(`lore init failed (${init.exitCode}): ${init.stderr}${init.stdout}`);
  registerTestRun(dir, CALLER);
  NOTE_PARENT = ensureRequirementsDocSlug((a) => lore(a, cleanEnv({ LORE_HARNESS_RUN: CALLER })));
  NOTE_ARGS = ["create", "knowledge", "--parent", NOTE_PARENT, "--title", "Delegated job note", "--sub-type", "reference", "--no-ai", "--content", "written by the job"];
});

afterEach(() => {
  for (const row of delegatedRows()) {
    if (row.harness_pid !== null) {
      try {
        process.kill(row.harness_pid, "SIGKILL");
      } catch {
        // reason: the job already exited, which is the normal case
      }
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("AC-DJ-1 premise (#501): a re-parented job that carries its CALLER's run is refused", () => {
  it("a job re-parented to pid 1 writing under the caller run exits 4 with 'does not descend'", async () => {
    const out = join(dir, "out", "premise.txt");
    const helper = join(dir, "orphan.sh");
    writeFileSync(
      helper,
      `#!/bin/sh\n( sleep 1; LORE_HARNESS_RUN='${CALLER}' CLAUDECODE=1 HOME='${dir}' bun run '${ENTRY}' ${NOTE_ARGS.map((a) => `'${a}'`).join(" ")} > '${out}' 2>&1; echo "exit=$?" >> '${out}' ) </dev/null >/dev/null 2>&1 &\n`,
    );
    Bun.spawnSync(["sh", helper], { cwd: dir, env: cleanEnv() });
    const text = await eventually(() => (existsSync(out) && readFileSync(out, "utf8").includes("exit=") ? readFileSync(out, "utf8") : null), "the orphaned writer's result");
    expect(text).toContain("exit=4");
    expect(text).toContain("does not descend");
    expect(noteVersions()).toHaveLength(0);
  }, 60_000);
});

describe("AC-DJ-1: a detached lore job writes under a delegated child run", () => {
  it("(a) the child run is registered before the job's first action, with the job's own pid and start time, parent = caller", async () => {
    const out = (name: string) => join(dir, "out", name);
    const job = shJob(
      `echo "$go" > '${out("go.txt")}'; echo "$LORE_HARNESS_RUN" > '${out("env.txt")}'; ` +
        `env -u LORE_DELEGATED_JOB bun run '${ENTRY}' run show "$LORE_HARNESS_RUN" --json > '${out("show.txt")}' 2>&1; echo done > '${out("done.txt")}'; sleep 60`,
    );
    const { outcome, spawned } = runCaller(CALLER, job);
    expect(outcome.exitCode, outcome.stderr).toBe(0);
    expect(spawned).not.toBeNull();
    const { pid, run, helperPid } = spawned as Spawned;
    await eventually(() => existsSync(out("done.txt")), "the job to finish its lookup");

    expect(readFileSync(out("go.txt"), "utf8").trim()).toBe("go");
    expect(readFileSync(out("env.txt"), "utf8").trim()).toBe(run);
    // registered BEFORE the job's first action: the job's own `lore run show` (run after the gate opened) already read the row
    const shown = JSON.parse(readFileSync(out("show.txt"), "utf8")) as { ok: boolean; data: { id: string; parentRunId: string | null; agentType: string | null; kind: string } };
    expect(shown.ok).toBe(true);
    expect(shown.data.id).toBe(run);
    expect(shown.data.parentRunId).toBe(CALLER);
    expect(shown.data.agentType).toBe(JOB_NAME);
    expect(shown.data.kind).toBe("subagent");

    const row = runRow(run) as RunRow;
    expect(row.parent_run_id).toBe(CALLER);
    expect(row.agent_type).toBe(JOB_NAME);
    expect(row.harness_pid).toBe(pid);
    expect(row.harness_pid).not.toBe(helperPid);
    expect(row.harness_pid).not.toBe(process.pid);
    const measured = await createRealProcessTablePort({ env: process.env, cwd: dir }).startTimeOf(pid);
    expect(measured).not.toBeNull();
    expect(row.harness_pid_start).toBe(measured);
    expect(row.ended_at).toBeNull();
    expect(run).toMatch(new RegExp(`^${CALLER}:${JOB_NAME}-[A-Za-z0-9]+$`));
  }, 90_000);

  it("(b) with the caller gone and the job re-parented to pid 1, the job's write exits 0 and is stamped with the child run", async () => {
    const out = (name: string) => join(dir, "out", name);
    const job = shJob(
      `sleep 1; ps -o ppid= -p $$ > '${out("ppid.txt")}'; ` +
        `env -u LORE_DELEGATED_JOB bun run '${ENTRY}' ${NOTE_ARGS.map((a) => `'${a}'`).join(" ")} > '${out("write.txt")}' 2>&1; echo "exit=$?" >> '${out("write.txt")}'`,
    );
    const { outcome, spawned } = runCaller(CALLER, job);
    expect(outcome.exitCode, outcome.stderr).toBe(0);
    const { run, helperPid } = spawned as Spawned;
    expect(() => process.kill(helperPid, 0)).toThrow(); // the caller process has exited
    const written = await eventually(() => (existsSync(out("write.txt")) && readFileSync(out("write.txt"), "utf8").includes("exit=") ? readFileSync(out("write.txt"), "utf8") : null), "the job's write");
    expect(readFileSync(out("ppid.txt"), "utf8").trim()).toBe("1");
    expect(written).toContain("exit=0");
    expect(noteVersions()).toEqual([{ harness_run: run }]);
    expect((runRow(run) as RunRow).parent_run_id).toBe(CALLER);
  }, 90_000);

  it("(b') a real lore job is its own harness: its write verifies and is stamped with the child run", async () => {
    const { outcome, spawned } = runCaller(CALLER, { exec: "bun", args: ["run", ENTRY, ...NOTE_ARGS] });
    expect(outcome.exitCode, outcome.stderr).toBe(0);
    const { pid, run } = spawned as Spawned;
    const rows = await eventually(() => (noteVersions().length > 0 ? noteVersions() : null), "the lore job's write");
    expect(rows).toEqual([{ harness_run: run }]);
    expect((runRow(run) as RunRow).harness_pid).toBe(pid);
  }, 90_000);

  it("(c) a caller whose run does not verify cannot register a child run: exit 4, the refusal text, zero rows, no job started", async () => {
    const processes = createRealProcessTablePort({ env: process.env, cwd: dir });
    const sleeper = Bun.spawn(["sleep", "120"]);
    try {
      const sleeperStart = await processes.startTimeOf(sleeper.pid);
      expect(sleeperStart).not.toBeNull();
      // (1) a run the registry does not know; (2) a run that ended; (3) a run whose harness process is not an ancestor
      registerTestRun(dir, "cc:dj-ended");
      expect(lore(["run", "end", "cc:dj-ended", "--reason", "test"], cleanEnv({ LORE_HARNESS_RUN: CALLER })).exitCode).toBe(0);
      registerOpenRun("cc:dj-foreign", sleeper.pid, sleeperStart as string);
      const before = delegatedRows().length;
      for (const caller of ["cc:dj-unknown", "cc:dj-ended", "cc:dj-foreign"]) {
        const started = join(dir, "out", `started-${caller.replace(/\W/g, "_")}.txt`);
        const { outcome, spawned } = runCaller(caller, { exec: "sh", args: ["-c", `echo started > '${started}'; read go; sleep 30`] });
        expect(outcome.exitCode, `${caller}: ${outcome.stderr}`).toBe(4);
        expect(outcome.stderr).toContain(`${REFUSED_PREFIX} ${caller} is not verified`);
        expect(spawned).toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(existsSync(started), `${caller}: the job must not have been started`).toBe(false);
        expect(delegatedRows()).toHaveLength(before);
      }
    } finally {
      sleeper.kill();
    }
  }, 120_000);

  it("(d) start gate: a job whose stdin closes without 'go' exits 0 having written nothing", () => {
    registerTestRun(dir, "cc:dj-gate:job");
    const env = cleanEnv({ LORE_HARNESS_RUN: "cc:dj-gate:job", LORE_DELEGATED_JOB: JOB_NAME });
    for (const stdin of ["", "not-the-line\n"]) {
      const closed = lore(NOTE_ARGS, env, stdin);
      expect(closed.exitCode, closed.stderr).toBe(0);
      expect(closed.stdout).toBe("");
      expect(noteVersions()).toHaveLength(0);
      expect(runRow("cc:dj-gate:job")?.ended_at).toBeNull(); // a job that never started has no run to end
    }
    // positive control: the same job with the gate opened writes, so the two cases above did not pass for another reason
    const opened = lore(NOTE_ARGS, env, "go\n");
    expect(opened.exitCode, opened.stderr).toBe(0);
    expect(noteVersions()).toEqual([{ harness_run: "cc:dj-gate:job" }]);
  }, 90_000);

  it("(e) when the job exits its child run is ended, and a later write under it exits 4", async () => {
    const { outcome, spawned } = runCaller(CALLER, { exec: "bun", args: ["run", ENTRY, ...NOTE_ARGS] });
    expect(outcome.exitCode, outcome.stderr).toBe(0);
    const { run } = spawned as Spawned;
    const ended = await eventually(() => {
      const row = runRow(run);
      return row !== null && row.ended_at !== null ? row : null;
    }, "the job's child run to end");
    expect(ended.end_reason).toContain(JOB_NAME);
    expect((runRow(CALLER) as RunRow).ended_at).toBeNull(); // only the child ended, never the caller's run

    const later = lore(["create", "knowledge", "--parent", NOTE_PARENT, "--title", "After the job", "--sub-type", "reference", "--no-ai", "--content", "x"], cleanEnv({ LORE_HARNESS_RUN: run }));
    expect(later.exitCode).toBe(4);
    expect(later.stderr).toContain(`Run ${run} is refused: run ${run} ended at`);
    expect(withDb((db) => db.query("SELECT 1 FROM versions WHERE title = 'After the job'").all())).toHaveLength(0);
  }, 90_000);
});

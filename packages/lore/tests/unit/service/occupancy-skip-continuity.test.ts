// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/adapters/oracle-occupancy.ts
// @reads scripts/oracle-lock.ts
/**
 * AC-CT-8 (SPEC-143, corrected 2026-10-17 / R13) — no new check can wedge an unattended loop, and
 * the skip path has a LIVE control.
 *
 * Host: `lore verify`'s stamp step in `VerifyRunnerService`. When a peer holds the checkout-level
 * oracle lock the step marks SKIPPED and continues: one audit row, no stamp, the verify result and
 * therefore the exit code unchanged.
 *
 * Seams (spec-pinned, every one REAL): the lock is the real writer (`scripts/oracle-lock.ts::main`)
 * taken in a throwaway repo's real `.git`; the reader is the real `probeOccupancyForCheckout`;
 * the executor is the real `executeVerifySpawnSpec`; (b) and (c) drive the real CLI
 * (`bun run src/index.ts`) in a `mkdtemp` + `lore init` corpus, never this repo's `.lore/`.
 *
 * Halves, failure-first:
 *  (a) held -> SKIPPED, exactly ONE audit row, results (hence exit code) equal to the same fixture
 *      with the check ABSENT, for a passing AND a failing oracle.
 *  (b) LIVE CONTROL: released -> the SAME check yields a stamped row with a head_sha, no audit row.
 *  (c) real `lore status` stdout has one line carrying both `state-binding` and `SKIPPED`; the line
 *      disappears once a stamped re-record supersedes the skip.
 *  (d) reader and writer share ONE lock name/path (behavioural + source-level pin).
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@lore/core";
import type { AcceptanceCriterion, AuditEntry, DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import { VerifyRunnerService } from "../../../src/service/verify-runner-service.js";
import type { StateBindingOccupancyPort } from "../../../src/service/verify-runner-service.js";
import type { VerifySpawnSpec, VerifyExecutionResult } from "../../../src/service/verify-spawn.js";
import { executeVerifySpawnSpec } from "../../../src/service/verify-executor.js";
import type { VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";
import {
  ORACLE_LOCK_FILE_NAME,
  probeOccupancy,
  probeOccupancyForCheckout,
} from "../../../src/adapters/oracle-occupancy.js";
import { STATE_BINDING_SKIP_AUDIT_ACTION } from "../../../src/service/state-binding-skip.js";
import { LOCK_FILE_NAME, main as acquireOracleLock, releaseLock } from "../../../../../scripts/oracle-lock.js";
import { withSessionIdentity } from "../../helpers/session-actor.js";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const READER_SRC = join(PACKAGE_ROOT, "src", "adapters", "oracle-occupancy.ts");
const WRITER_SRC = join(PACKAGE_ROOT, "..", "..", "scripts", "oracle-lock.ts");

const tempDirs: string[] = [];
const heldLocks: string[] = [];

afterEach(() => {
  while (heldLocks.length > 0) releaseLock(heldLocks.pop()!);
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function makeTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

const GIT_IDENT = ["-c", "user.name=t", "-c", "user.email=t@example.com"];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...GIT_IDENT, ...args], { cwd, encoding: "utf8" }).trim();
}

function makeRepo(): { repo: string; head: string } {
  const repo = makeTempDir("lore-ct8-repo-");
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-q", "-m", "c1");
  return { repo, head: git(repo, "rev-parse", "HEAD") };
}

/** Takes the REAL checkout-level lock for `repo` with the real writer (holder = this live process). */
function holdOracleLock(repo: string): string {
  const lockDir = join(repo, ".git");
  const prev = console.log;
  console.log = () => undefined; // the writer announces itself on stdout; keep the runner summary clean
  try {
    expect(acquireOracleLock(lockDir), "fixture: the writer must acquire the free lock").toBe(0);
  } finally {
    console.log = prev;
  }
  heldLocks.push(lockDir);
  return lockDir;
}

// ─── service-level fixture ────────────────────────────────────────────────────

const NOW = "2026-10-17T10:00:00.000Z";
const FRESH_CLAIM_AT = "2026-10-17T09:59:00.000Z";

function makeDoc(overrides: Partial<DocRecord> & Pick<DocRecord, "id" | "type" | "title">): DocRecord {
  return {
    slug: overrides.id,
    role: "plan",
    status: "approved",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-10-17T00:00:00.000Z",
    updated_at: "2026-10-17T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function bundle(command: string): PlanBundle {
  const ac: AcceptanceCriterion = {
    id: "AC-1",
    statement: "AC-1 statement",
    verify: { mode: "script", oracle: "other", command },
  };
  return {
    plan: makeDoc({ id: "plan-1", type: "plan", title: "Plan" }),
    spec: makeDoc({ id: "spec-1", type: "spec", title: "Spec", extra: { acceptance_criteria: [ac] } }),
    tasks: [
      makeDoc({
        id: "task-1",
        type: "task",
        title: "Task",
        slug: "task-1",
        parent_id: "plan-1",
        extra: { ac_scope: ["AC-1"], claim: { by: "alice", at: FRESH_CLAIM_AT } },
      }),
    ],
  };
}

interface ServiceRun {
  readonly results: ReadonlyArray<{ ac_id: string; result: string; exit_code: number; duration_ms: number }>;
  readonly evidence: VerifiedEvidenceInput[];
  readonly audit: AuditEntry[];
  readonly exitCode: number;
}

/** Mirrors `commands/verify.ts`'s exit derivation (inconclusive 3 > fail 1 > 0) over the service's real results. */
function verifyExitCode(results: ReadonlyArray<{ result: string }>): number {
  if (results.some((r) => r.result === "inconclusive")) return 3;
  return results.some((r) => r.result === "fail") ? 1 : 0;
}

/** Runs the real executor over `command` in `repo`; `armed=false` omits the occupancy port (check ABSENT). */
async function runService(repo: string, command: string, armed: boolean): Promise<ServiceRun> {
  const evidence: VerifiedEvidenceInput[] = [];
  const audit: AuditEntry[] = [];
  const port: StateBindingOccupancyPort = {
    probe: probeOccupancyForCheckout,
    recordSkip: async (entry) => {
      audit.push(entry);
      return ok(undefined);
    },
  };
  const service = new VerifyRunnerService(
    async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle(command)),
    async (id, entry): Promise<Result<DocRecord, LoreError>> => {
      evidence.push(entry);
      return ok(makeDoc({ id, type: "task", title: "Task" }));
    },
    async (spec: VerifySpawnSpec): Promise<Result<VerifyExecutionResult, LoreError>> => executeVerifySpawnSpec(spec),
    { tmpDir: tmpdir(),
      repoRoot: repo,
      defaultTimeoutMs: 60_000,
      claimTtlMinutes: 120,
      requireCommandApproval: false,
      envAllowlist: [],
      envPassthroughAll: true,
      processEnv: process.env as Record<string, string>,
    },
    undefined,
    undefined,
    armed ? port : undefined,
  );
  const result = await service.verifyPlan("plan-1", {
    by: "alice",
    nowIso: NOW,
    executionRoot: { root: repo, mode: "worktree" },
  });
  if (!result.ok) throw new Error(`verifyPlan failed (fixture bug): ${JSON.stringify(result.error)}`);
  return { results: result.value.results, evidence, audit, exitCode: verifyExitCode(result.value.results) };
}

describe("AC-CT-8 (a): an occupied lock -> SKIPPED, one audit row, the check-absent exit code", () => {
  for (const [label, command, expectedExit] of [
    ["passing oracle", "true", 0],
    ["failing oracle", "false", 1],
  ] as const) {
    it(`${label}: SKIPPED + exactly one audit row, results and exit code EQUAL the check-ABSENT run`, async () => {
      const { repo } = makeRepo();
      const absent = await runService(repo, command, false);
      expect(absent.exitCode, "fixture: the control's own exit code").toBe(expectedExit);
      expect(absent.audit, "the absent check writes nothing").toHaveLength(0);

      holdOracleLock(repo);
      const held = await runService(repo, command, true);

      expect(held.audit, "exactly one audit row for the skip").toHaveLength(1);
      const row = held.audit[0]!;
      expect(row.action).toBe(STATE_BINDING_SKIP_AUDIT_ACTION);
      expect(row.doc_id).toBe("task-1");
      expect(row.details).toMatchObject({ ac_id: "AC-1", reason: "oracle_lock_held", holder_pid: process.pid });
      // duration_ms is wall-clock noise between two real runs; every other field must match.
      const withoutDuration = (rs: ServiceRun["results"]) => rs.map(({ duration_ms: _d, ...rest }) => rest);
      expect(withoutDuration(held.results), "a skip must not change a single result").toEqual(withoutDuration(absent.results));
      expect(held.exitCode, "exit code EQUALS the check-absent control").toBe(absent.exitCode);

      const att = held.evidence[0]!.attestation!;
      expect(att.state_stamp, "a skipped step writes no stamp").toBeUndefined();
      expect("head_sha" in att, "and no head_sha").toBe(false);
    });
  }

  it("never waits for the holder: a held lock returns within the oracle's own runtime, not after the holder", async () => {
    const { repo } = makeRepo();
    holdOracleLock(repo);
    const started = Date.now();
    const held = await runService(repo, "true", true);
    expect(held.results).toHaveLength(1);
    expect(Date.now() - started, "no blocking on the held lock").toBeLessThan(20_000);
  });

  it("a stale lock (holder pid dead) is NOT occupancy: the reader mirrors the writer's reclaim rule", async () => {
    const { repo, head } = makeRepo();
    writeFileSync(join(repo, ".git", ORACLE_LOCK_FILE_NAME), "2147483646"); // far above any live pid
    const run = await runService(repo, "true", true);
    expect(run.audit).toHaveLength(0);
    expect(run.evidence[0]!.attestation!.state_stamp).toEqual({ head_sha: head, worktree_dirty: false });
  });
});

describe("AC-CT-8 (b): LIVE CONTROL — released lock, the SAME check yields a real verdict", () => {
  it("released: stamped with a head_sha, NOT skipped, no audit row", async () => {
    const { repo, head } = makeRepo();
    const lockDir = holdOracleLock(repo);
    const held = await runService(repo, "true", true);
    expect(held.audit).toHaveLength(1);

    releaseLock(lockDir);
    heldLocks.pop();
    const released = await runService(repo, "true", true);
    expect(released.audit, "released -> nothing skipped").toHaveLength(0);
    const att = released.evidence[0]!.attestation!;
    expect(att.state_stamp, "released -> stamped").toEqual({ head_sha: head, worktree_dirty: false });
    expect(att.head_sha).toBe(head);
  });
});

describe("AC-CT-8 (d): reader and writer share ONE lock path and name", () => {
  it("the writer's lock file is exactly what the reader reads, and the reader never writes", () => {
    expect(LOCK_FILE_NAME, "writer name === reader name").toBe(ORACLE_LOCK_FILE_NAME);
    const dir = makeTempDir("lore-ct8-lockdir-");
    expect(probeOccupancy(dir)).toEqual({ kind: "free" });
    expect(existsSync(join(dir, ORACLE_LOCK_FILE_NAME)), "reading must not create the lock").toBe(false);
  });

  it("writer-held lock is visible to the reader under the shared name", () => {
    const dir = makeTempDir("lore-ct8-lockdir2-");
    const prev = console.log;
    console.log = () => undefined;
    try {
      expect(acquireOracleLock(dir)).toBe(0);
    } finally {
      console.log = prev;
    }
    heldLocks.push(dir);
    expect(readFileSync(join(dir, LOCK_FILE_NAME), "utf8")).toBe(String(process.pid));
    expect(probeOccupancy(dir)).toEqual({
      kind: "held",
      holder_pid: process.pid,
      lock_path: join(dir, ORACLE_LOCK_FILE_NAME),
    });
    releaseLock(dir);
    heldLocks.pop();
    expect(probeOccupancy(dir)).toEqual({ kind: "free" });
  });

  it("source pin: the lock name is defined ONLY in the reader; the writer imports it (renaming either side alone fails)", () => {
    const literal = "lore-oracle-test.lock";
    const reader = readFileSync(READER_SRC, "utf8");
    const writer = readFileSync(WRITER_SRC, "utf8");
    expect(reader.split(`"${literal}"`).length - 1, "defined exactly once, in the reader").toBe(1);
    expect(writer.includes(`"${literal}"`), "the writer carries no private copy of the name").toBe(false);
    expect(writer).toMatch(/ORACLE_LOCK_FILE_NAME[\s\S]*from "\.\.\/packages\/lore\/src\/adapters\/oracle-occupancy\.js"/);
  });
});

// ─── (b)/(c) through the REAL CLI ─────────────────────────────────────────────

const AC_ID = "AC-OCC-1";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  // reason: HOME is a SIBLING of the corpus repo, never inside it — files the CLI/bun write under HOME
  // would otherwise dirty the tree and demote every run to `dirty_tree`, hiding the stamped control.
  const home = `${cwd}-home`;
  mkdirSync(home, { recursive: true });
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: withSessionIdentity({ ...process.env, HOME: home, EDITOR: "true", CLAUDECODE: "1" }, "occupancy-test") as Record<string, string>,
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

function mustRun(args: string[], cwd: string): string {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function extractSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

function disableAllGates(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      ...["spec-create", "spec-promote", "plan-promote", "task-claim", '"task-create"'].flatMap((g) => [
        `    ${g}:`,
        "      enabled: false",
      ]),
      "",
    ].join("\n"),
  );
}

type EvidenceRow = { result: string; attestation?: { head_sha?: string; state_stamp?: { head_sha: string } } };

function evidenceRows(dir: string, task: string): EvidenceRow[] {
  const parsed = JSON.parse(mustRun(["get", task, "--json"], dir)) as {
    data: { doc: { extra: { verification_evidence?: EvidenceRow[] } } };
  };
  return parsed.data.doc.extra.verification_evidence ?? [];
}

describe("AC-CT-8 (b)(c): real `lore verify` and `lore status` in a throwaway corpus", () => {
  let dir: string;
  let plan: string;
  let task: string;

  // reason: ~10 CLI spawns at ~1-2s each.
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-ct8-cli-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    mustRun(["init"], dir);
    disableAllGates(dir);
    // reason: keep the corpus DB out of `git status`, so a clean tree can be STAMPED (the live control).
    writeFileSync(join(dir, ".gitignore"), ".lore/\n");
    mustRun(["create", "prd", "--title", "Occupancy PRD", "--no-ai", "--content", "body"], dir);
    const spec = extractSlug(mustRun(["create", "spec", "--title", "Occupancy Spec", "--no-ai", "--content", "body"], dir));
    writeFileSync(join(dir, "oracle.test.ts"), 'import { test, expect } from "bun:test";\ntest("ok", () => { expect(1).toBe(1); });\n');
    mustRun(
      ["ac", "add", spec, AC_ID, "--statement", "oracle passes", "--mode", "script", "--oracle", "test",
        "--command", `bun test oracle.test.ts && echo '${AC_ID} PASS: ran'`],
      dir,
    );
    plan = extractSlug(mustRun(["create", "plan", "--title", "Occupancy Plan", "--parent", spec, "--no-ai", "--content", "body"], dir));
    task = extractSlug(
      mustRun(["create", "task", "--title", "Occupancy Task", "--parent", plan, "--plan-id", plan, "--ac-scope", AC_ID, "--no-ai", "--content", "body"], dir),
    );
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", [...GIT_IDENT, "commit", "-q", "-m", "fixture"], { cwd: dir });
  }, 180_000);

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
      rmSync(`${dir}-home`, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("held: verify exits as it does unoccupied, the row is unbound, status prints ONE line with state-binding and SKIPPED; released + re-verify -> stamped, line gone", { timeout: 240_000 }, () => {
    const lockDir = join(dir, ".git");
    const prev = console.log;
    console.log = () => undefined;
    try {
      expect(acquireOracleLock(lockDir)).toBe(0);
    } finally {
      console.log = prev;
    }
    heldLocks.push(lockDir);

    const skipped = runLore(["verify", plan, "--task", task, "--ac", AC_ID, "--yes"], dir);
    expect(skipped.exitCode, skipped.stdout + skipped.stderr).toBe(0);
    expect(skipped.stderr).toContain("SKIPPED");

    const afterSkip = evidenceRows(dir, task);
    expect(afterSkip).toHaveLength(1);
    expect(afterSkip[0]!.result).toBe("pass");
    expect(afterSkip[0]!.attestation?.state_stamp, "unbound: no stamp").toBeUndefined();
    expect(afterSkip[0]!.attestation?.head_sha, "unbound: no head_sha").toBeUndefined();

    const audit = JSON.parse(mustRun(["audit", "--action", STATE_BINDING_SKIP_AUDIT_ACTION, "--json"], dir)) as {
      data: unknown[] | { entries: unknown[] };
    };
    const auditRows = Array.isArray(audit.data) ? audit.data : audit.data.entries;
    expect(auditRows, "exactly one audit row").toHaveLength(1);

    const status = runLore(["status"], dir);
    expect(status.exitCode, status.stderr).toBe(0);
    const lines = status.stdout.split("\n").filter((l) => l.includes("SKIPPED"));
    expect(lines, "one SKIPPED line").toHaveLength(1);
    expect(lines[0], "the SKIPPED line also names state-binding").toContain("state-binding");
    expect(lines[0]).toContain(`/${AC_ID}`);

    // LIVE CONTROL through the real CLI: free the lock, the SAME verify yields a stamped row.
    releaseLock(lockDir);
    heldLocks.pop();
    const stamped = runLore(["verify", plan, "--task", task, "--ac", AC_ID, "--yes"], dir);
    expect(stamped.exitCode, stamped.stdout + stamped.stderr).toBe(skipped.exitCode);
    expect(stamped.stderr).not.toContain("SKIPPED");
    const afterRelease = evidenceRows(dir, task);
    expect(afterRelease).toHaveLength(2);
    expect(afterRelease[1]!.attestation?.head_sha, "released -> a real head_sha").toMatch(/^[0-9a-f]{40}$/);
    expect(afterRelease[1]!.attestation?.state_stamp?.head_sha).toBe(afterRelease[1]!.attestation?.head_sha);

    const statusAfter = runLore(["status"], dir);
    expect(statusAfter.stdout, "a stamped re-record supersedes the skip").not.toContain("SKIPPED");
  });
});

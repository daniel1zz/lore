/**
 * RED — unattested writes are kept, never refused, never guessed
 * (spec-run-identity-slice-1-harness-attested-runs-attested D7 / D11; rules BR-1035, BR-1030, BR-1033).
 *
 * Expected behaviour (from the spec, before the implementation was read):
 *   - A write whose `--harness-run` names an id with no registered run SUCCEEDS (exit 0), stores
 *     `harness_run` NULL on its audit row and version row(s), keeps the name lore resolved for it
 *     (`--by N` -> N with source "flag"; `$LORE_ACTOR=N` -> N with source "env"), and prints EXACTLY ONE
 *     stderr line that names the unknown id (D7: "one stderr warning naming the id"), even when the
 *     command writes several rows (`lore done` walks several lifecycle steps).
 *   - A write with no `--harness-run` succeeds with `harness_run` NULL and prints NO run warning.
 *   - No run is ever filled in for an unattested write: with a run registered in the corpus, a write
 *     without the flag still stores NULL (never "the latest run", never "the only run").
 *   - A write that names a REGISTERED run is stamped and prints no warning (the warning is specific
 *     to the unknown id; without this a "always warn" implementation would pass the warning test).
 *   - The OS user name never becomes the author of a write that was given a name.
 *
 * The spec fixes WHAT is stored (the name with its source) but not WHICH field holds the source, so the
 * source is asserted as "present in the stored audit row" (serialised row contains the source token).
 *
 * Dimensions: HAPPY (registered control), NEGATIVE (unknown / absent id), BOUNDARY (two different unknown
 * ids; multi-row write), STATE (registered run present but not named), ERROR (never refused: exit 0),
 * REGRESSION (name kept exactly as resolved today).
 *
 * No mocks. Throwaway git repo + `lore init` corpus per describe; the repo's own `.lore/` is never touched.
 * Runs are registered through the store's own `insertRun` (AC-RID-4 interface) because no CLI registration
 * exists yet.
 *
 * @spec_ref AC-RID-8
 */

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import type { AuditEntry, VersionRecord } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

const GHOST_A = "cc:ghost-session-aaaa";
const GHOST_B = "cc:ghost-session-bbbb:agent-zz";
const REGISTERED = "cc:registered-session-1";
const NAME = "agent:unattested-writer";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function env(extra: Record<string, string>, home: string): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env, CLAUDECODE: "1", HOME: home, ...extra };
  if (!("LORE_ACTOR" in extra)) delete e["LORE_ACTOR"];
  // reason: the session tier would otherwise name gate rows `agent:session-...` and MASK a gate row that
  // re-resolves its actor instead of using the invocation's name (regression: gate_passed rows read the OS user).
  for (const key of ["CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"]) if (!(key in extra)) delete e[key];
  return e;
}

function lore(args: string[], cwd: string, extra: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env: env(extra, cwd) });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustLore(args: string[], cwd: string, extra: Record<string, string> = {}): RunResult {
  const r = lore(args, cwd, extra);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

const scratch: string[] = [];

function corpusDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  if (d.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  scratch.push(d);
  const git = (a: string[]) => execFileSync("git", a, { cwd: d, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "unattested@example.invalid"]);
  git(["config", "user.name", "unattested test"]);
  writeFileSync(join(d, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustLore(["init"], d, { LORE_ACTOR: "agent:unattested-setup" });
  mustLore(["create", "prd", "--title", "Unattested Root", "--content", "root", "--no-ai"], d, { LORE_ACTOR: "agent:unattested-setup" });
  return d;
}

function withStore<T>(dir: string, fn: (s: SQLiteStore) => Promise<T>): Promise<T> {
  const store = new SQLiteStore(join(dir, ".lore", "lore.db"));
  return fn(store).finally(() => store.close());
}

async function registerRun(dir: string, id: string): Promise<void> {
  const parts = id.split(":");
  await withStore(dir, async (store) => {
    const insertRun = (store as unknown as { insertRun?: (r: unknown) => Promise<{ ok: boolean; error?: unknown }> }).insertRun;
    if (typeof insertRun !== "function") throw new Error("StoreInterface.insertRun is missing (AC-RID-4 interface not implemented)");
    const r = await insertRun.call(store, {
      id,
      kind: "main",
      harness: "claude-code",
      sessionRef: parts[1] ?? "unknown",
      agentRef: null,
      agentType: null,
      parentRunId: null,
      branch: null,
      composition: { schemaVersion: 1, fragments: [] },
      registeredAt: new Date().toISOString(),
    });
    if (r.ok === false) throw new Error(`insertRun refused: ${JSON.stringify(r.error)}`);
  });
}

async function auditSince(dir: string, since: string): Promise<AuditEntry[]> {
  return withStore(dir, async (s) => {
    const r = await s.queryAudit({ limit: 100_000 });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value.filter((row) => row.timestamp >= since);
  });
}

async function versionsSince(dir: string, since: string): Promise<VersionRecord[]> {
  return withStore(dir, async (s) => {
    const r = await s.listAllVersions();
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value.filter((row) => row.created_at >= since);
  });
}

const harnessRunOf = (row: unknown): unknown => (row as { harness_run?: unknown }).harness_run;
const warningLinesNaming = (stderr: string, id: string): string[] => stderr.split("\n").filter((l) => l.includes(id));
/** Any stderr line that talks about an attestation run at all (used for the "no flag -> no warning" negatives). */
const runWarningLines = (stderr: string): string[] => stderr.split("\n").filter((l) => /harness[- _]?run|unattested|not registered|unknown run/i.test(l));

function newTask(dir: string, title: string): string {
  return JSON.parse(mustLore(["create", "task", "--adhoc", "--title", title, "--ac-scope", "", "--json"], dir, { LORE_ACTOR: "agent:unattested-setup" }).stdout).data.slug as string;
}

// ─── Unknown run id: write succeeds, stored unattested, one warning naming the id ───

describe("AC-RID-8: --harness-run naming an unregistered run id", () => {
  let dir = "";
  let task = "";

  beforeAll(() => {
    dir = corpusDir("unattested-unknown-");
    task = newTask(dir, "Unattested claim target");
  });

  it("a claim succeeds (exit 0): an unknown run id never refuses a write", () => {
    const r = lore(["--harness-run", GHOST_A, "claim", task, "--by", NAME], dir);
    expect(r.exitCode).toBe(0);
  });

  it("the claim's audit row stores harness_run NULL, keeps name N, and records the name's source (flag)", async () => {
    const t2 = newTask(dir, "Unattested claim two");
    const since = new Date().toISOString();
    mustLore(["--harness-run", GHOST_A, "claim", t2, "--by", NAME], dir);
    const rows = (await auditSince(dir, since)).filter((r) => r.actor === NAME);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(harnessRunOf(row) ?? null).toBeNull();
      expect(JSON.stringify(row)).toContain("flag");
    }
  });

  it("the claim's version rows also store harness_run NULL (no run is invented for the version history)", async () => {
    const t3 = newTask(dir, "Unattested claim three");
    const since = new Date().toISOString();
    mustLore(["--harness-run", GHOST_A, "claim", t3, "--by", NAME], dir);
    const versions = (await versionsSince(dir, since)).filter((v) => v.created_by === NAME);
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(harnessRunOf(v) ?? null).toBeNull();
  });

  it("stderr carries exactly ONE line naming the unknown id", () => {
    const t4 = newTask(dir, "Unattested claim four");
    const r = lore(["--harness-run", GHOST_A, "claim", t4, "--by", NAME], dir);
    expect(r.exitCode).toBe(0);
    expect(warningLinesNaming(r.stderr, GHOST_A)).toHaveLength(1);
  });

  it("a different unknown id is named in its own warning (the message is not a hardcoded id)", () => {
    const t5 = newTask(dir, "Unattested claim five");
    const r = lore(["--harness-run", GHOST_B, "claim", t5, "--by", NAME], dir);
    expect(r.exitCode).toBe(0);
    expect(warningLinesNaming(r.stderr, GHOST_B)).toHaveLength(1);
    expect(r.stderr).not.toContain(GHOST_A);
  });

  it("a doc create with the name from $LORE_ACTOR keeps the name with source env and stores NULL", async () => {
    const since = new Date().toISOString();
    const r = lore(["--harness-run", GHOST_A, "create", "knowledge", "--sub-type", "reference", "--title", "Unattested via env", "--content", "body", "--no-ai"], dir, { LORE_ACTOR: NAME });
    expect(r.exitCode).toBe(0);
    const rows = (await auditSince(dir, since)).filter((row) => row.actor === NAME);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(harnessRunOf(row) ?? null).toBeNull();
      expect(JSON.stringify(row)).toContain("env");
    }
  });

  it("a write that produces several rows (lore done walks several lifecycle steps) still prints exactly one warning", () => {
    const t6 = newTask(dir, "Unattested multi-row done");
    mustLore(["claim", t6, "--by", NAME], dir);
    mustLore(["evidence", t6, "--oracle", "test", "--command", "echo red fixture", "--result", "expected-fail", "--output-tail", "red fixture row", "--by", NAME], dir);
    const r = lore(["--harness-run", GHOST_A, "done", t6, "--by", NAME, "--override-attestation", "unattested fixture: no runner-attested pass exists for this throwaway task"], dir);
    expect(r.exitCode).toBe(0);
    expect(warningLinesNaming(r.stderr, GHOST_A)).toHaveLength(1);
  });

  it("the registered-run control: a registered id is stamped and draws no warning", async () => {
    await registerRun(dir, REGISTERED);
    const t7 = newTask(dir, "Registered control");
    const since = new Date().toISOString();
    const r = lore(["--harness-run", REGISTERED, "claim", t7, "--by", NAME], dir);
    expect(r.exitCode).toBe(0);
    expect(warningLinesNaming(r.stderr, REGISTERED)).toHaveLength(0);
    const rows = (await auditSince(dir, since)).filter((row) => row.actor === NAME);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(harnessRunOf(row)).toBe(REGISTERED);
  });
});

// ─── No flag at all: unattested, silent, never guessed ───────────────────────

describe("AC-RID-8: no --harness-run at all", () => {
  let dir = "";

  beforeAll(() => {
    dir = corpusDir("unattested-absent-");
  });

  it("a write with no flag succeeds and stores harness_run NULL with the resolved name", async () => {
    const t = newTask(dir, "No flag target");
    const since = new Date().toISOString();
    const r = lore(["claim", t, "--by", NAME], dir);
    expect(r.exitCode).toBe(0);
    const rows = (await auditSince(dir, since)).filter((row) => row.actor === NAME);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(harnessRunOf(row) ?? null).toBeNull();
  });

  it("prints no run warning when no run was named", () => {
    const t = newTask(dir, "No flag quiet target");
    const r = lore(["claim", t, "--by", NAME], dir);
    expect(r.exitCode).toBe(0);
    expect(runWarningLines(r.stderr)).toEqual([]);
  });

  it("the version rows of an unflagged write store harness_run NULL", async () => {
    const t = newTask(dir, "No flag version target");
    const since = new Date().toISOString();
    mustLore(["claim", t, "--by", NAME], dir);
    const versions = (await versionsSince(dir, since)).filter((v) => v.created_by === NAME);
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(harnessRunOf(v) ?? null).toBeNull();
  });

  it("no run is guessed: with a run registered in the corpus, an unflagged write still stores NULL", async () => {
    await registerRun(dir, REGISTERED);
    const t = newTask(dir, "Registered but not named");
    const since = new Date().toISOString();
    const r = lore(["claim", t, "--by", NAME], dir);
    expect(r.exitCode).toBe(0);
    const rows = (await auditSince(dir, since)).filter((row) => row.actor === NAME);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(harnessRunOf(row) ?? null).toBeNull();
    const versions = (await versionsSince(dir, since)).filter((v) => v.created_by === NAME);
    for (const v of versions) expect(harnessRunOf(v) ?? null).toBeNull();
  });

  it("a name that was given is never replaced by the OS user name as author", async () => {
    const os = userInfo().username;
    expect(os).not.toBe(NAME);
    const t = newTask(dir, "No flag author target");
    const since = new Date().toISOString();
    mustLore(["claim", t, "--by", NAME], dir);
    mustLore(["create", "knowledge", "--sub-type", "reference", "--title", "Authored with a given name", "--content", "body", "--no-ai"], dir, { LORE_ACTOR: NAME });
    const rows = await auditSince(dir, since);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(`${row.action} by ${row.actor}`).not.toBe(`${row.action} by ${os}`);
    for (const v of await versionsSince(dir, since)) expect(v.created_by).not.toBe(os);
  });

  it("an empty --harness-run value is not accepted as a run id and never stamps a blank run", async () => {
    const t = newTask(dir, "Empty flag target");
    const since = new Date().toISOString();
    lore(["--harness-run", "", "claim", t, "--by", NAME], dir);
    for (const row of await auditSince(dir, since)) {
      expect(harnessRunOf(row) ?? null).toBeNull();
    }
  });
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

// ─── Regression: gate audit rows carry the operation's name, never an independent resolution ───

describe("AC-RID-8 regression: no audit row of a named write is authored by the OS user (session env removed)", () => {
  let dir = "";

  beforeAll(() => {
    dir = corpusDir("unattested-gate-actor-");
  });

  it("claim --by N: every audit row since the start (gate_passed included) has actor N, none the OS user", async () => {
    const os = userInfo().username;
    const task = newTask(dir, "Gate actor target");
    const since = new Date().toISOString();
    mustLore(["claim", task, "--by", NAME], dir);
    const rows = await auditSince(dir, since);
    expect(rows.some((r) => r.action === "gate_passed")).toBe(true);
    for (const row of rows) {
      expect(row.actor).not.toBe(os);
      expect(row.actor).toBe(NAME);
    }
  });

  it("a gated create under $LORE_ACTOR=N: gate rows also carry N", async () => {
    const os = userInfo().username;
    const since = new Date().toISOString();
    mustLore(["create", "knowledge", "--sub-type", "reference", "--title", "Gate actor create", "--content", "body", "--no-ai"], dir, { LORE_ACTOR: NAME });
    const rows = await auditSince(dir, since);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.actor).not.toBe(os);
  });
});

// ─── Regression: an unregistered run decides a claim as UNATTESTED, one answer for the whole operation ───

describe("AC-RID-8 regression: claim by an unregistered --harness-run is decided and stored unattested", () => {
  let dir = "";

  beforeAll(() => {
    dir = corpusDir("unattested-claim-decision-");
  });

  it("stores claim.harness_run null, warns exactly once, and a same-name unattested claim refreshes (BR-1040)", () => {
    const task = newTask(dir, "Unregistered run claim");
    const first = lore(["--harness-run", GHOST_A, "claim", task, "--by", NAME], dir);
    expect(first.exitCode).toBe(0);
    expect(warningLinesNaming(first.stderr, GHOST_A)).toHaveLength(1);
    const got = (JSON.parse(mustLore(["get", task, "--json"], dir).stdout) as { data: { doc?: { extra?: { claim?: Record<string, unknown> } }; extra?: { claim?: Record<string, unknown> } } }).data;
    const claim = got.doc?.extra?.claim ?? got.extra?.claim;
    if (claim === undefined) throw new Error("claimed task has no extra.claim in `lore get --json`");
    expect(claim["harness_run"] ?? null).toBeNull();
    expect(JSON.stringify(claim)).not.toContain(GHOST_A);
    // two unattested parties with the same name compare by name: the second claim refreshes the lease
    const second = lore(["claim", task, "--by", NAME], dir);
    expect(second.exitCode).toBe(0);
    expect(second.stderr).not.toContain("CLAIM_CONFLICT");
  });
});


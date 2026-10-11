/**
 * RED — `$LORE_ACTOR` draws exactly ONE deprecation line per lore process
 * (spec-run-identity-slice-1-harness-attested-runs-attested D8; rule BR-1033; AC-RID-6, CLI half).
 *
 * Expected behaviour (from the spec, before the implementation was read):
 *   - `$LORE_ACTOR=Y` populates the claimed name with source `env` and prints ONE deprecation line to
 *     stderr per process, however many writes (or identity resolutions) that process performs.
 *   - The line goes to STDERR only; stdout (including `--json`) stays machine-parseable.
 *   - Per process, not once-ever: a second lore process with `$LORE_ACTOR` prints its own single line.
 *   - A process that names itself with `--by` and has no `$LORE_ACTOR` prints no deprecation line.
 *   - The name is still recorded (deprecation is not removal): audit rows carry Y with source `env`.
 *
 * Which multi-write path was used: the CLI performs ONE write for most commands, so the "three writes
 * in one process" case is driven by `lore done`, a single CLI process that walks the task through several
 * lifecycle steps and appends one audit row per step (asserted below: >= 3 audit rows from that one
 * process). The MCP `lore_batch` path was NOT used for this file: with the MCP server the name comes
 * from the `by` argument (source mcp), so `$LORE_ACTOR` is not its identity tier and asserting a
 * deprecation line there would invent behaviour the spec does not state.
 *
 * A deprecation line is any stderr line that mentions `LORE_ACTOR` and the word "deprecat" (any case).
 *
 * Dimensions: HAPPY (single write -> one line), BOUNDARY (multi-write process -> still one; two
 * processes -> one each), NEGATIVE (no env var -> none), STATE (stdout untouched), REGRESSION (name
 * and source env still recorded).
 *
 * No mocks. Throwaway git repo + `lore init` corpus; the repo's own `.lore/` is never touched.
 *
 * @spec_ref AC-RID-6
 */

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditEntry } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

const ACTOR_Y = "agent:deprecation-writer-y";
const ACTOR_Z = "agent:deprecation-writer-z";
const SETUP = "agent:deprecation-setup";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function lore(args: string[], cwd: string, actorEnv: string | null): RunResult {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDECODE: "1", HOME: cwd };
  if (actorEnv === null) delete env["LORE_ACTOR"];
  else env["LORE_ACTOR"] = actorEnv;
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustLore(args: string[], cwd: string, actorEnv: string | null): RunResult {
  const r = lore(args, cwd, actorEnv);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

const deprecationLines = (stderr: string): string[] =>
  stderr.split("\n").filter((l) => /LORE_ACTOR/.test(l) && /deprecat/i.test(l));

const scratch: string[] = [];
let dir = "";

function newTask(title: string): string {
  return JSON.parse(mustLore(["create", "task", "--adhoc", "--title", title, "--ac-scope", "", "--json"], dir, SETUP).stdout).data.slug as string;
}

async function auditSince(since: string): Promise<AuditEntry[]> {
  const store = new SQLiteStore(join(dir, ".lore", "lore.db"));
  try {
    const r = await store.queryAudit({ limit: 100_000 });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value.filter((row) => row.timestamp >= since);
  } finally {
    store.close();
  }
}

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "actor-deprecation-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  scratch.push(dir);
  const git = (a: string[]) => execFileSync("git", a, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "deprecation@example.invalid"]);
  git(["config", "user.name", "deprecation test"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustLore(["init"], dir, SETUP);
  mustLore(["create", "prd", "--title", "Deprecation Root", "--content", "root", "--no-ai"], dir, SETUP);
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

describe("AC-RID-6 (CLI): one deprecation line per process when $LORE_ACTOR names the writer", () => {
  it("a single-write process with $LORE_ACTOR set prints exactly one deprecation line", () => {
    const r = lore(["create", "knowledge", "--sub-type", "reference", "--title", "Deprecation single write", "--content", "body", "--no-ai"], dir, ACTOR_Y);
    expect(r.exitCode).toBe(0);
    expect(deprecationLines(r.stderr)).toHaveLength(1);
  });

  it("ONE process that performs several writes (lore done) prints exactly one deprecation line", async () => {
    const task = newTask("Deprecation multi write");
    mustLore(["claim", task, "--by", ACTOR_Y], dir, null);
    mustLore(["evidence", task, "--oracle", "test", "--command", "echo red fixture", "--result", "expected-fail", "--output-tail", "red fixture row", "--by", ACTOR_Y], dir, null);
    const since = new Date().toISOString();
    const r = lore(["done", task, "--override-attestation", "deprecation fixture: no runner-attested pass exists for this throwaway task"], dir, ACTOR_Y);
    expect(r.exitCode).toBe(0);
    const rows = (await auditSince(since)).filter((row) => row.actor === ACTOR_Y);
    // the process really did several writes, so "one line" is not just "one write -> one line"
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(deprecationLines(r.stderr)).toHaveLength(1);
  });

  it("two separate processes each print their own single line (per process, not once ever)", () => {
    const a = lore(["create", "knowledge", "--sub-type", "reference", "--title", "Deprecation process one", "--content", "body", "--no-ai"], dir, ACTOR_Y);
    const b = lore(["create", "knowledge", "--sub-type", "reference", "--title", "Deprecation process two", "--content", "body", "--no-ai"], dir, ACTOR_Z);
    expect(a.exitCode).toBe(0);
    expect(b.exitCode).toBe(0);
    expect(deprecationLines(a.stderr)).toHaveLength(1);
    expect(deprecationLines(b.stderr)).toHaveLength(1);
  });

  it("the deprecation goes to stderr only: --json stdout stays parseable and does not mention it", () => {
    const r = lore(["create", "knowledge", "--sub-type", "reference", "--title", "Deprecation json stdout", "--content", "body", "--no-ai", "--json"], dir, ACTOR_Y);
    expect(r.exitCode).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
    expect(r.stdout).not.toContain("LORE_ACTOR");
    expect(deprecationLines(r.stderr)).toHaveLength(1);
  });

  it("the name is still recorded: audit rows carry Y with the source env (deprecated, not removed)", async () => {
    const since = new Date().toISOString();
    const r = lore(["create", "knowledge", "--sub-type", "reference", "--title", "Deprecation still recorded", "--content", "body", "--no-ai"], dir, ACTOR_Y);
    expect(r.exitCode).toBe(0);
    const rows = (await auditSince(since)).filter((row) => row.actor === ACTOR_Y);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(JSON.stringify(row)).toContain("env");
  });
});

describe("AC-RID-6 (CLI): no deprecation when $LORE_ACTOR is not the source of the name", () => {
  it("naming the writer with --by and no $LORE_ACTOR prints no deprecation line", () => {
    const task = newTask("Deprecation by flag");
    const r = lore(["claim", task, "--by", ACTOR_Y], dir, null);
    expect(r.exitCode).toBe(0);
    expect(deprecationLines(r.stderr)).toEqual([]);
  });

  it("a write with neither --by nor $LORE_ACTOR prints no deprecation line", () => {
    const r = lore(["create", "knowledge", "--sub-type", "reference", "--title", "Deprecation none", "--content", "body", "--no-ai"], dir, null);
    expect(deprecationLines(r.stderr)).toEqual([]);
  });
});

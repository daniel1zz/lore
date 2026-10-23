// @spawns packages/lore/src/index.ts
/**
 * AC-LG-9 oracle — reads are counted, never logged per row (BR-1373).
 *
 * Real `lore get` child processes (source mode) against a THROWAWAY corpus (mkdtemp + `lore init`), never the
 * repo's own `.lore/`. Dimensions:
 *   HAPPY:      100 `lore get` calls add 0 `trace_events` rows and raise the per-day counter by exactly 100.
 *   STATE:      `lore trace stats --json` reports the same 100 under `reads`, and no `get` kind in `counts_by_kind`.
 *   BOUNDARY:   a failed lookup (unknown slug) counts nothing.
 *   CONCURRENT: 30 simultaneous readers lose no increment (one atomic upsert).
 *   REGRESSION: migration 031 deletes pre-existing `kind='get'` rows but keeps every other kind.
 *
 * @spec_ref AC-LG-9
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function loreEnv(dir: string): NodeJS.ProcessEnv {
  return { ...process.env, HOME: dir, EDITOR: "true", CLAUDECODE: "1" };
}

function runLoreSync(args: string[], dir: string): Ran {
  const proc = spawnSync("bun", ["run", INDEX_TS, ...args], { cwd: dir, env: loreEnv(dir), encoding: "utf8" });
  return { code: proc.status ?? 1, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

function runLoreAsync(args: string[], dir: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", INDEX_TS, ...args], { cwd: dir, env: loreEnv(dir) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Runs `total` `lore get` calls, `width` at a time; returns every exit code. */
async function getMany(docId: string, dir: string, total: number, width: number): Promise<number[]> {
  const codes: number[] = [];
  for (let done = 0; done < total; done += width) {
    const batch = Array.from({ length: Math.min(width, total - done) }, () => runLoreAsync(["get", docId], dir));
    for (const ran of await Promise.all(batch)) codes.push(ran.code);
  }
  return codes;
}

function scalar(dir: string, sql: string): number {
  const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
  try {
    return (db.query(sql).get() as { n: number }).n;
  } finally {
    db.close();
  }
}

const traceRows = (dir: string, where = "1=1"): number => scalar(dir, `SELECT COUNT(*) AS n FROM trace_events WHERE ${where}`);
const readCounter = (dir: string): number => scalar(dir, "SELECT COALESCE(SUM(count), 0) AS n FROM trace_read_counts");

function newCorpus(): { dir: string; docId: string } {
  const dir = mkdtempSync(join(tmpdir(), "lore-read-counter-"));
  const init = runLoreSync(["init"], dir);
  if (init.code !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  const created = runLoreSync(["create", "prd", "--title", "Counted Reads", "--content", "x", "--json"], dir);
  if (created.code !== 0) throw new Error(`lore create failed: ${created.stderr}`);
  const docId = (JSON.parse(created.stdout) as { data: { id: string } }).data.id;
  return { dir, docId };
}

let tmpDir = "";

afterEach(() => {
  if (tmpDir !== "") rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = "";
});

describe("reads counted not logged", () => {
  it("HAPPY: 100 lore get calls add 0 trace_events rows and raise the per-day counter by exactly 100; trace stats reports them", async () => {
    const { dir, docId } = newCorpus();
    tmpDir = dir;
    const rowsBefore = traceRows(dir);
    const counterBefore = readCounter(dir);

    const codes = await getMany(docId, dir, 100, 10);
    expect(codes.every((code) => code === 0)).toBe(true);

    expect(traceRows(dir)).toBe(rowsBefore);
    expect(traceRows(dir, "kind = 'get'")).toBe(0);
    expect(readCounter(dir) - counterBefore).toBe(100);

    const stats = runLoreSync(["trace", "stats", "--json"], dir);
    expect(stats.code).toBe(0);
    const report = (
      JSON.parse(stats.stdout) as {
        data: { counts_by_kind: Record<string, number>; reads: { total: number; by_day: { day: string; count: number }[] } };
      }
    ).data;
    expect(report.reads.total).toBe(100);
    expect(report.reads.by_day.reduce((sum, row) => sum + row.count, 0)).toBe(100);
    expect(report.counts_by_kind["get"]).toBeUndefined();
  }, 240_000);

  it("BOUNDARY: a failed lookup counts nothing", () => {
    const { dir } = newCorpus();
    tmpDir = dir;
    const ran = runLoreSync(["get", "no-such-slug-anywhere"], dir);
    expect(ran.code).not.toBe(0);
    expect(readCounter(dir)).toBe(0);
    expect(traceRows(dir, "kind = 'get'")).toBe(0);
  }, 60_000);

  it("CONCURRENT: 30 simultaneous readers lose no increment", async () => {
    const { dir, docId } = newCorpus();
    tmpDir = dir;
    const codes = await getMany(docId, dir, 30, 30);
    expect(codes.every((code) => code === 0)).toBe(true);
    expect(readCounter(dir)).toBe(30);
  }, 120_000);

  it("REGRESSION: migration 031 deletes old get rows and keeps every other kind", () => {
    const { dir } = newCorpus();
    tmpDir = dir;
    const db = new Database(join(dir, ".lore", "lore.db"));
    try {
      db.run("DROP TABLE trace_read_counts");
      db.run("PRAGMA user_version = 30");
      for (const kind of ["get", "get", "search", "gate_deny"]) {
        db.run(
          "INSERT INTO trace_events (ts, actor, surface, session_id, kind, details) VALUES (?, 'agent:seed', 'agent', 's', ?, '{}')",
          ["2026-01-01T00:00:00.000Z", kind],
        );
      }
    } finally {
      db.close();
    }

    const migrated = runLoreSync(["migrate", "schema"], dir);
    expect(migrated.code, migrated.stderr).toBe(0);

    expect(traceRows(dir, "kind = 'get'")).toBe(0);
    expect(traceRows(dir, "kind = 'search'")).toBe(1);
    expect(traceRows(dir, "kind = 'gate_deny'")).toBe(1);
    expect(scalar(dir, "SELECT COUNT(*) AS n FROM trace_read_counts")).toBe(0);
    expect(scalar(dir, "SELECT user_version AS n FROM pragma_user_version")).toBe(34);
  }, 60_000);
});

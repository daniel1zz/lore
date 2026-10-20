// @spawns packages/lore/src/index.ts
/**
 * task-audit-verification-checks-every-version-pre-writer-history: audit verification checks every version, and
 * history that predates the audit writers is made explicit once by `lore migrate audit-backfill`.
 *
 * Every scenario spawns the real CLI against a `mkdtemp` fixture (the repo's own `.lore/` is never touched):
 *   (a) NEGATIVE/REGRESSION: a version recorded long ago with no audit entry is reported missing (exit 4) — no date
 *       skips it (the falsifier: the retired `audit.verify_since` default skipped everything before 2026-07-06).
 *   (b) HAPPY/STATE/BOUNDARY: `migrate audit-backfill` previews (writes nothing), `--apply` writes one hash-chained
 *       reconstructed entry per such version, verification then passes and reports the reconstructed count, a second
 *       `--apply` writes nothing.
 *   (c) NEGATIVE: a config still setting `audit.verify_since` is refused by every command with exit 4 and the exact
 *       text naming the migrate action; the per-run `--since` option of `--verify` is removed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Database } from "bun:sqlite";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scrubIdentityEnv } from "../helpers/test-run-identity.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

const REFUSAL =
  "audit.verify_since was retired: audit verification checks every version. " +
  "Run `lore migrate audit-backfill --apply` to remove it from .lore/config.yaml and record the versions that predate the audit writers as reconstructed.";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1", LORE_ACTOR: "agent:audit-backfill-test" },
    encoding: "utf8",
    timeout: 100_000,
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

let dir = "";
let base = "";
let docId = "";
const configPath = (): string => join(dir, ".lore", "config.yaml");
const dbPath = (): string => join(dir, ".lore", "lore.db");

/** Runs `fn` against the fixture database, closing the handle afterwards. */
function withDb<T>(fn: (db: Database) => T): T {
  const db = new Database(dbPath());
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const auditCount = (): number => withDb((db) => (db.query("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n);

/** Inserts a versions row (no audit entry) recorded at `createdAt` — the shape of history the audit writers never saw. */
function seedUnauditedVersion(version: number, createdAt: string): void {
  withDb((db) => {
    db.prepare(
      `INSERT INTO versions (doc_id, version, content, extra, status, title, action, created_at, created_by, change_summary, slug, harness_run)
       VALUES (?, ?, 'old', '{}', 'draft', 'old', 'update', ?, 'agent:legacy', NULL, NULL, NULL)`,
    ).run(docId, version, createdAt);
  });
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "auditbackfill-")));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, stdio: "ignore" });
  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}${init.stdout}`);
  base = readFileSync(configPath(), "utf8").trimEnd();
  const created = runLore(["create", "knowledge", "--sub-type", "reference", "--title", "Backfill fixture", "--content", "body", "--json"], dir);
  if (created.exitCode !== 0) throw new Error(`lore create failed: ${created.stderr}${created.stdout}`);
  docId = (JSON.parse(created.stdout) as { data: { id: string } }).data.id;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("verification checks every version (AC a)", () => {
  it("NEGATIVE: a long-ago version with no audit entry is reported missing with exit 4 — no date skips it", () => {
    seedUnauditedVersion(900, "2026-01-01T00:00:00.000Z");

    const verify = runLore(["audit", "--verify", "--json"], dir);

    expect(verify.exitCode, verify.stdout + verify.stderr).toBe(4);
    const data = (JSON.parse(verify.stdout) as { data: { clean: boolean; misses: { doc_id: string; version: number }[] } }).data;
    expect(data.clean).toBe(false);
    expect(data.misses).toEqual([expect.objectContaining({ doc_id: docId, version: 900 })]);
  });

  it("BOUNDARY: a corpus whose every version has its audit entry verifies clean with exit 0", () => {
    const verify = runLore(["audit", "--verify"], dir);
    expect(verify.exitCode, verify.stdout + verify.stderr).toBe(0);
  });

  it("ERROR: the per-run cut-off option of --verify is removed and refused with exit 2", () => {
    const verify = runLore(["audit", "--verify", "--since", "2030-01-01T00:00:00Z"], dir);
    expect(verify.exitCode).toBe(2);
    expect(verify.stderr).toContain("--since is not accepted with --verify");
  });
});

describe("lore migrate audit-backfill (AC b)", () => {
  it("HAPPY+STATE: preview writes nothing; --apply reconstructs and verification passes reporting the count; a second --apply writes nothing", () => {
    seedUnauditedVersion(900, "2026-01-01T00:00:00.000Z");
    const before = auditCount();

    const preview = runLore(["migrate", "audit-backfill"], dir);
    expect(preview.exitCode, preview.stderr).toBe(0);
    expect(preview.stdout).toContain("Audit backfill (preview)");
    expect(preview.stdout).toContain("1 version(s) would be recorded as reconstructed");
    expect(preview.stdout).toContain("Re-run with --apply to execute.");
    expect(auditCount()).toBe(before);

    const applied = runLore(["migrate", "audit-backfill", "--apply"], dir);
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(applied.stdout).toContain("Audit backfill complete");
    expect(applied.stdout).toContain("1 version(s) recorded as reconstructed");
    expect(auditCount()).toBe(before + 1);

    const verify = runLore(["audit", "--verify"], dir);
    expect(verify.exitCode, verify.stdout + verify.stderr).toBe(0);
    expect(verify.stdout).toContain("1 reconstructed");
    expect(verify.stdout).toContain("Chain integrity: clean");

    const again = runLore(["migrate", "audit-backfill", "--apply"], dir);
    expect(again.exitCode, again.stderr).toBe(0);
    expect(again.stdout).toContain("0 version(s) recorded as reconstructed");
    expect(auditCount()).toBe(before + 1);
  }, 120_000);

  it("STATE: the reconstructed entry names the version, the reason and the upgrade run", () => {
    seedUnauditedVersion(900, "2026-01-01T00:00:00.000Z");
    expect(runLore(["migrate", "audit-backfill", "--apply"], dir).exitCode).toBe(0);

    const entry = withDb(
      (db) => db.query("SELECT action, doc_id, session_id, details FROM audit WHERE action = 'audit-backfill'").get() as { action: string; doc_id: string; session_id: string; details: string },
    );
    const details = JSON.parse(entry.details) as Record<string, unknown>;
    expect(entry.doc_id).toBe(docId);
    expect(details["version"]).toBe(900);
    expect(details["reconstructed"]).toBe(true);
    expect(details["reason"]).toEqual(expect.stringContaining("predates the audit writers"));
    expect(details["run"]).toBe(entry.session_id);
  });

  it("BOUNDARY: the boundary is the earliest audit entry — the preview names it and its source; a version after it with no entry is NOT reconstructed and stays missing", () => {
    seedUnauditedVersion(900, "2026-01-01T00:00:00.000Z");
    seedUnauditedVersion(901, "2099-01-01T00:00:00.000Z");
    const earliest = withDb(
      (db) => (db.query("SELECT MIN(timestamp) AS t FROM audit WHERE json_extract(details, '$.version') IS NOT NULL").get() as { t: string }).t,
    );

    const preview = runLore(["migrate", "audit-backfill"], dir);
    expect(preview.exitCode, preview.stderr).toBe(0);
    expect(preview.stdout).toContain(`Boundary: ${earliest} (earliest audit entry)`);
    expect(preview.stdout).toContain("1 version(s) would be recorded as reconstructed");

    const applied = runLore(["migrate", "audit-backfill", "--apply"], dir);
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(applied.stdout).toContain(`Boundary: ${earliest} (earliest audit entry)`);
    expect(applied.stdout).toContain("1 version(s) recorded as reconstructed");

    const verify = runLore(["audit", "--verify", "--json"], dir);
    expect(verify.exitCode).toBe(4);
    const data = (JSON.parse(verify.stdout) as { data: { misses: { version: number }[] } }).data;
    expect(data.misses.map((m) => m.version)).toEqual([901]);
  }, 120_000);

  it("REGRESSION: a retired cut-off still in the config is NOT the boundary — the data is (a cut-off before the old version would have skipped it)", () => {
    writeFileSync(configPath(), `${base}\naudit:\n  verify_since: "2020-01-01T00:00:00Z"\n`);
    seedUnauditedVersion(900, "2026-01-01T00:00:00.000Z");

    const applied = runLore(["migrate", "audit-backfill", "--apply"], dir);
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(applied.stdout).toContain("(earliest audit entry)");
    expect(applied.stdout).toContain("1 version(s) recorded as reconstructed");
    expect(runLore(["audit", "--verify"], dir).exitCode).toBe(0);
  });

  it("NEGATIVE: with no known party the run is refused (exit 4) naming `lore session start --human` and `lore setup`, and writes nothing", () => {
    seedUnauditedVersion(2, "2026-01-02T00:00:00.000Z");
    const configBefore = readFileSync(configPath(), "utf8");
    const auditBefore = auditCount();

    // reason: a spawn "as nobody": no harness-run flag, none of the identity variables, and the test run's spawn rewrite
    // (scripts/test-known-party-spawn.ts) opted out of giving it a registered run.
    const asNobody = (args: string[]): RunResult => {
      const env: Record<string, string | undefined> = { ...scrubIdentityEnv(process.env), HOME: dir, EDITOR: "true", LORE_TEST_IDENTITY: "none" };
      const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], { cwd: dir, env, timeout: 100_000 });
      return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
    };

    for (const args of [["migrate", "audit-backfill", "--apply"], ["migrate", "audit-backfill"]]) {
      const refused = asNobody(args);
      expect(refused.exitCode, `${refused.stdout}${refused.stderr}`).toBe(4);
      expect(refused.stderr).toContain("lore session start --human");
      expect(refused.stderr).toContain("lore setup");
      expect(refused.stderr).not.toContain("Storage failure");
    }
    expect(auditCount()).toBe(auditBefore);
    expect(readFileSync(configPath(), "utf8")).toBe(configBefore);
  });

  it("STATE: --apply removes only the retired config setting (every other byte kept)", () => {
    const old = `# keep me\n${base}\naudit:\n  verify_since: "2026-07-06T12:02:00Z" # old\n`;
    writeFileSync(configPath(), old);

    expect(runLore(["migrate", "audit-backfill", "--apply"], dir).exitCode).toBe(0);

    expect(readFileSync(configPath(), "utf8")).toBe(`# keep me\n${base}\n`);
    expect(runLore(["status"], dir).exitCode).toBe(0);
  });
});

describe("a config still setting the cut-off is refused by every command (AC c)", () => {
  it("NEGATIVE: status, list, bootstrap and audit --verify each exit 4 with the exact text and write nothing", () => {
    const text = `${base}\naudit:\n  verify_since: "2026-07-06T12:02:00Z"\n`;
    writeFileSync(configPath(), text);
    for (const args of [["status"], ["list"], ["bootstrap"], ["audit", "--verify"]]) {
      const r = runLore(args, dir);
      expect(r.exitCode, args.join(" ")).toBe(4);
      expect(r.stderr).toContain(REFUSAL);
    }
    expect(readFileSync(configPath(), "utf8")).toBe(text);
  });
});

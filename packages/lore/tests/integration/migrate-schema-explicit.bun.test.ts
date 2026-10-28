// @spawns packages/lore/src/index.ts
/**
 * Corpus schema upgrades run ONLY through `lore migrate schema`
 * (task-skill-implement-corpus-schema-upgrades-run-only-through, user decision 2026-10-19).
 *
 * Fixture: a throwaway `mkdtemp` directory + `lore init`, whose db is then replaced by one built by the real
 * `SQLiteStore` stopped at schema N-1 (`schemaCeiling`), i.e. GENUINELY one migration behind. The CLI is spawned
 * from source. Never touches the repo's own `.lore/`.
 *
 * Coverage:
 *   HAPPY     migrate schema exits 0, user_version becomes N, ONE audit row (actor, from, to, duration, working copy).
 *   NEGATIVE  `lore list`, `lore serve` exit 4 naming both versions and the command; user_version unchanged.
 *   BOUNDARY  `--dry-run` lists pending and writes nothing; a corpus already at N reports nothing pending.
 *   STATE     a second run writes nothing (audit rows stay at 1); `lore list` works after the migrate.
 *   REGRESSION a NEW corpus (lore init) starts at the latest schema without any migrate; the store itself refuses a behind corpus.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SQLiteStore } from "../../src/store/sqlite-store";
import { SchemaBehindError } from "../../src/store/schema-behind";
import { LATEST_SCHEMA_VERSION } from "../../src/store/schema-version";

const PKG_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const CLI_ENTRY = join(PKG_ROOT, "src", "index.ts");
const TEST_TIMEOUT_MS = 90_000;
const BEHIND = LATEST_SCHEMA_VERSION - 1;

let sandbox = "";
let corpusDir = "";
let dbPath = "";

function runLore(args: string[], cwd: string) {
  const proc = Bun.spawnSync(["bun", "run", CLI_ENTRY, ...args], {
    cwd,
    stdin: "ignore",
    // reason: before the refusal exists `lore serve` starts and never returns; a timeout turns that hang into a red exit code.
    timeout: 25_000,
    killSignal: "SIGKILL",
    env: { ...process.env, HOME: sandbox, CLAUDECODE: "1", EDITOR: "true" },
  });
  return { out: proc.stdout.toString() + proc.stderr.toString(), stdout: proc.stdout.toString(), exitCode: proc.exitCode ?? -1 };
}

function readUserVersion(path: string): number {
  const db = new Database(path);
  try {
    return (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  } finally {
    db.close();
  }
}

function migrateAuditRows(path: string): { actor: string; details: string }[] {
  const db = new Database(path);
  try {
    return db.query("SELECT actor, details FROM audit WHERE action = 'migrate_schema'").all() as { actor: string; details: string }[];
  } finally {
    db.close();
  }
}

/** A free TCP port, found by binding port 0 (never assume 8787). */
function ephemeralPort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) throw new Error("Bun.serve({ port: 0 }) reported no port");
  return port;
}

beforeAll(() => {
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "lore-migrate-schema-")));
  corpusDir = join(sandbox, "corpus");
  mkdirSync(corpusDir);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: corpusDir, stdio: "pipe" });
  expect(runLore(["init"], corpusDir).exitCode).toBe(0);
  dbPath = join(corpusDir, ".lore", "lore.db");
  expect(readUserVersion(dbPath)).toBe(LATEST_SCHEMA_VERSION);
  // Replace the fresh db with a genuinely-one-behind one built in place by the real store.
  expect(sandbox.startsWith(PKG_ROOT)).toBe(false);
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  new SQLiteStore(dbPath, { schemaCeiling: BEHIND }).close();
  expect(readUserVersion(dbPath)).toBe(BEHIND);
}, TEST_TIMEOUT_MS);

afterAll(() => {
  if (sandbox !== "") rmSync(sandbox, { recursive: true, force: true });
});

describe("a corpus one schema behind is refused by every command except `lore migrate schema`", () => {
  it("AC-1: `lore list` exits 4 naming both versions and the command; user_version is unchanged", () => {
    const res = runLore(["list"], corpusDir);
    expect(res.exitCode).toBe(4);
    expect(res.out).toContain(`schema version ${BEHIND}`);
    expect(res.out).toContain(`requires ${LATEST_SCHEMA_VERSION}`);
    expect(res.out).toContain("lore migrate schema");
    expect(readUserVersion(dbPath)).toBe(BEHIND);
  }, TEST_TIMEOUT_MS);

  it("AC-2b: `lore serve` on an ephemeral port refuses the same way", () => {
    const res = runLore(["serve", "--port", String(ephemeralPort())], corpusDir);
    expect(res.exitCode).toBe(4);
    expect(res.out).toContain("lore migrate schema");
    expect(res.out).toContain(`requires ${LATEST_SCHEMA_VERSION}`);
    expect(readUserVersion(dbPath)).toBe(BEHIND);
  }, TEST_TIMEOUT_MS);

  it("`lore setup` names the command when the project corpus is behind the installed binary (and writes nothing to the corpus)", () => {
    const proc = Bun.spawnSync([process.execPath, "run", CLI_ENTRY, "setup", "--claude-dir", join(sandbox, "claude-dir"), "--yes"], {
      cwd: corpusDir,
      stdin: "ignore",
      timeout: 60_000,
      killSignal: "SIGKILL",
      // PATH="" keeps this run from reaching any real tool on this machine's PATH; the file writes and the receipt still happen.
      env: { ...process.env, PATH: "", HOME: sandbox, CLAUDECODE: "1" },
    });
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out).toContain("lore migrate schema");
    expect(out).toContain(`schema ${BEHIND}`);
    expect(readUserVersion(dbPath)).toBe(BEHIND);
  }, TEST_TIMEOUT_MS);

  it("the store itself refuses a behind corpus (no side-effect migration) and migrates only when told to", () => {
    const copyPath = join(sandbox, "store-copy.db");
    copyFileSync(dbPath, copyPath);
    expect(() => new SQLiteStore(copyPath)).toThrow(SchemaBehindError);
    expect(readUserVersion(copyPath)).toBe(BEHIND);
    new SQLiteStore(copyPath, { migrate: true }).close();
    expect(readUserVersion(copyPath)).toBe(LATEST_SCHEMA_VERSION);
  });
});

describe("`lore migrate schema`", () => {
  it("--dry-run lists the pending migrations and writes nothing", () => {
    const res = runLore(["migrate", "schema", "--dry-run"], corpusDir);
    expect(res.exitCode).toBe(0);
    expect(res.out).toContain(`${BEHIND} -> ${LATEST_SCHEMA_VERSION}`);
    expect(res.out).toContain(`migration-${String(LATEST_SCHEMA_VERSION).padStart(3, "0")}`);
    expect(readUserVersion(dbPath)).toBe(BEHIND);
  }, TEST_TIMEOUT_MS);

  it("AC-3: exits 0, user_version becomes N, and ONE audit row records actor, working copy, from, to and duration", () => {
    const res = runLore(["migrate", "schema"], corpusDir);
    expect(res.exitCode).toBe(0);
    expect(readUserVersion(dbPath)).toBe(LATEST_SCHEMA_VERSION);
    const rows = migrateAuditRows(dbPath);
    expect(rows).toHaveLength(1);
    const details = JSON.parse(rows[0]!.details) as Record<string, unknown>;
    expect(rows[0]!.actor.length).toBeGreaterThan(0);
    expect(details.from).toBe(BEHIND);
    expect(details.to).toBe(LATEST_SCHEMA_VERSION);
    expect(typeof details.duration_ms).toBe("number");
    expect(details.duration_ms as number).toBeGreaterThanOrEqual(0);
    expect(details.working_copy).toBe(corpusDir);
    // the row rides the shared write route (CorpusService.appendAudit): exactly one, naming the resolved actor
    expect(rows.filter((row) => row.actor === rows[0]!.actor)).toHaveLength(1);
  }, TEST_TIMEOUT_MS);

  it("AC-4: a second run reports nothing pending and writes nothing", () => {
    const before = migrateAuditRows(dbPath).length;
    const res = runLore(["migrate", "schema"], corpusDir);
    expect(res.exitCode).toBe(0);
    expect(res.out).toContain("nothing pending");
    expect(migrateAuditRows(dbPath)).toHaveLength(before);
    expect(readUserVersion(dbPath)).toBe(LATEST_SCHEMA_VERSION);
  }, TEST_TIMEOUT_MS);

  it("an ordinary command works once the corpus is migrated", () => {
    expect(runLore(["list"], corpusDir).exitCode).toBe(0);
  }, TEST_TIMEOUT_MS);

  it("a corpus created by this binary starts at the latest schema with no migrate (store level)", () => {
    const freshPath = join(sandbox, "fresh.db");
    new SQLiteStore(freshPath).close();
    expect(readUserVersion(freshPath)).toBe(LATEST_SCHEMA_VERSION);
  });
});

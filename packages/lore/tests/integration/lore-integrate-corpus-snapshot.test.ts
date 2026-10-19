// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
// @reads packages/lore/src/store/schema-version.ts
// @reads packages/lore/src/store/sqlite-store.ts
/**
 * INT-T12 oracle — `lore integrate` runs its floor against a snapshot of the shared corpus, so a branch whose binary
 * needs a newer schema can land without migrating the live corpus first (task-skill-fix-int-t12-lore-integrate-runs-
 * the-floor-against-a; rules BR-1245..1247 of baseline-integrate-a-branch-into-main).
 *
 * Throwaway repo + throwaway corpus (mkdtemp, `git init`, `lore init`), REAL git worktrees and REAL `lore` processes;
 * never the repo's own `.lore/`. "A branch binary that needs a newer schema" is staged by putting the shared corpus
 * one schema version BEHIND this checkout's binary: the floor script REBUILDS the corpus it resolves as a genuine LATEST-1 database
 * (a fresh db migrated by the real `SQLiteStore` only up to `schemaCeiling = LATEST - 1`, then every row of the LATEST copy carried over), so it holds
 * whatever the newest migration does; rewriting `user_version` alone would re-run a plain ADD COLUMN migration and fail. The floor then opens the
 * corpus with the real code path and the real foreign-schema guard decides, exactly as for a branch that adds a
 * migration. The floor command is a small shell script (outside the repo) that runs real `lore` commands in the
 * integration worktree, reads a doc created in the shared corpus, and writes a marker into whatever corpus it sees.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installShippedGuard } from "./support/main-guard-repo.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const SQLITE_STORE_TS = join(PACKAGE_ROOT, "src", "store", "sqlite-store.ts");

interface RunResult {
  readonly out: string;
  readonly exitCode: number;
}

/** Reads or writes a corpus db: `stageOlder <dbPath> <version>` | `getVersion <dbPath>` | `marker <dbPath>` | `hasMarker <dbPath>`. */
const DB_TOOL_TS = `
import { Database } from "bun:sqlite";
import { renameSync, rmSync } from "node:fs";
import { SQLiteStore } from ${JSON.stringify(SQLITE_STORE_TS)};
const [verb, arg] = process.argv.slice(2);
if (verb === "stageOlder") {
  const version = Number(process.argv[4]);
  const older = arg + ".older";
  for (const suffix of ["", "-wal", "-shm"]) rmSync(older + suffix, { force: true });
  // the store's own handle does the copying (it keeps cached statements, so it is never closed; the process exit ends it)
  const db = new SQLiteStore(older, { schemaCeiling: version }).getDatabase();
  db.run("PRAGMA foreign_keys = OFF");
  db.run("ATTACH DATABASE '" + arg.replaceAll("'", "''") + "' AS src");
  const cols = (schema, table) => db.query("PRAGMA " + schema + ".table_info(" + table + ")").all().map((c) => c.name);
  const tables = db.query("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'docs_fts%' AND sql NOT LIKE 'CREATE VIRTUAL%'").all().map((t) => t.name);
  for (const t of tables) {
    const have = new Set(cols("src", t));
    const shared = cols("main", t).filter((c) => have.has(c)).map((c) => '"' + c + '"').join(", ");
    if (shared !== "") db.run('INSERT INTO main."' + t + '" (' + shared + ') SELECT ' + shared + ' FROM src."' + t + '"');
  }
  // VACUUM INTO writes one self-contained rollback-journal file (user_version kept, no -wal/-shm), which a cold readonly probe can open
  const staged = arg + ".staged";
  rmSync(staged, { force: true });
  db.run("VACUUM main INTO '" + staged.replaceAll("'", "''") + "'");
  for (const suffix of ["", "-wal", "-shm"]) rmSync(arg + suffix, { force: true });
  renameSync(staged, arg);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(older + suffix, { force: true });
  process.exit(0);
}
else if (verb === "getVersion") { const db = new Database(arg, { readonly: true }); console.log(db.query("PRAGMA user_version").get().user_version); db.close(); }
else if (verb === "marker") { const db = new Database(arg); db.run("CREATE TABLE floor_marker (x TEXT)"); db.run("INSERT INTO floor_marker VALUES ('written by the floor')"); db.close(); }
else if (verb === "hasMarker") { const db = new Database(arg, { readonly: true }); console.log(db.query("SELECT count(*) AS n FROM sqlite_master WHERE name = 'floor_marker'").get().n); db.close(); }
else { console.error("unknown verb " + verb); process.exit(2); }
`;

let root = "";
let repoSeq = 0;
let toolPath = "";
let latestVersion = 0;

function sh(cwd: string, cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

class Fixture {
  readonly repo: string;
  readonly floorScript: string;
  docSlug = "";

  constructor() {
    repoSeq += 1;
    this.repo = join(root, `repo-${repoSeq}`);
    mkdirSync(this.repo, { recursive: true });
    this.git(["init", "-q", "-b", "main"]);
    this.git(["config", "user.email", "t@example.com"]);
    this.git(["config", "user.name", "t"]);
    this.git(["config", "commit.gpgsign", "false"]);
    writeFileSync(join(this.repo, "base.txt"), "base\n");
    this.git(["add", "base.txt"]);
    this.git(["commit", "-q", "-m", "base"]);
    const init = sh(this.repo, "bun", ["run", INDEX_TS, "init"], this.env());
    if (init.status !== 0) throw new Error(`lore init failed: ${init.stderr}`);
    appendFileSync(join(this.repo, ".git", "info", "exclude"), ".lore/\n.claude/\n");
    this.git(["checkout", "-q", "--detach", "main"]);
    installShippedGuard(this.repo, `${this.repo}-guard-hooks`); // integrate requires the guard (BR-1273)

    const created = sh(this.repo, "bun", ["run", INDEX_TS, "create", "knowledge", "--title", "Snapshot visible doc", "--sub-type", "reference", "--content", "present in the shared corpus", "--json"], this.env());
    if (created.status !== 0) throw new Error(`lore create failed: ${created.stdout}${created.stderr}`);
    const slug = /"slug":\s*"([^"]+)"/.exec(created.stdout)?.[1];
    if (slug === undefined) throw new Error(`no slug in: ${created.stdout}`);
    this.docSlug = slug;
    this.floorScript = join(root, `floor-${repoSeq}.sh`);
    // step 1 stages "a branch binary that needs a newer schema": the corpus this cwd resolves to (its own .lore, else the
    // main checkout's, as corpus resolution does) is put one schema behind the binary. `lore integrate` itself must run
    // on a corpus at LATEST (it opens the corpus before the floor), so the staging has to happen inside the floor.
    // `bun run <index> get` opens the corpus the cwd resolves to (guard, then migrate); the marker lands in that same corpus
    writeFileSync(
      this.floorScript,
      [
        "set -e",
        `if [ -f .lore/lore.db ]; then DB=.lore/lore.db; else DB="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/.lore/lore.db"; fi`,
        `bun run ${JSON.stringify(toolPath)} stageOlder "$DB" ${latestVersion - 1}`,
        // an older corpus is upgraded only by the explicit command (the snapshot is this worktree's own corpus)
        `bun run ${JSON.stringify(INDEX_TS)} migrate schema`,
        `bun run ${JSON.stringify(INDEX_TS)} get ${JSON.stringify(this.docSlug)} > floor-read.out`,
        `grep -q "present in the shared corpus" floor-read.out`,
        `bun run ${JSON.stringify(toolPath)} marker .lore/lore.db`,
        "echo floor-ok",
      ].join("\n") + "\n",
    );
    this.setFloor(`sh ${JSON.stringify(this.floorScript)}`);
  }

  env(session?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: this.repo, EDITOR: "true", CLAUDECODE: "1" };
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.CLAUDE_SESSION_ID;
    if (session !== undefined) env.CLAUDE_CODE_SESSION_ID = session;
    return env;
  }

  git(args: string[], cwd: string = this.repo): string {
    const r = sh(cwd, "git", args);
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
    return r.stdout.trim();
  }

  sharedDb(): string {
    return join(this.repo, ".lore", "lore.db");
  }

  dbTool(args: string[]): string {
    const r = sh(this.repo, "bun", ["run", toolPath, ...args]);
    if (r.status !== 0) throw new Error(`db tool ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout.trim();
  }

  setFloor(floorCommand: string): void {
    const cfg = join(this.repo, ".lore", "config.yaml");
    const base = readFileSync(cfg, "utf8").split("\nworkflow:")[0] ?? "";
    writeFileSync(cfg, `${base.trimEnd()}\nworkflow:\n  integrate:\n    floor_command: ${JSON.stringify(floorCommand)}\n`);
  }

  makeBranch(name: string): string {
    this.git(["checkout", "-q", "-b", name, "main"]);
    writeFileSync(join(this.repo, `${name}.txt`), `${name}\n`);
    this.git(["add", `${name}.txt`]);
    this.git(["commit", "-q", "-m", `work on ${name}`]);
    this.git(["checkout", "-q", "--detach", "main"]);
    return name;
  }

  integrate(branch: string, session: string): Promise<RunResult> {
    return new Promise((resolve) => {
      const child = spawn("bun", ["run", INDEX_TS, "integrate", branch, "--session", session], { cwd: this.repo, env: this.env(session) });
      let out = "";
      child.stdout.on("data", (c: Buffer) => (out += c.toString()));
      child.stderr.on("data", (c: Buffer) => (out += c.toString()));
      child.on("close", (code) => resolve({ out, exitCode: code ?? 1 }));
    });
  }

  integrationWorktree(session: string): string {
    return join(this.repo, ".claude", "worktrees", `integrate-${session}`);
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lore-int12-"));
  toolPath = join(root, "db-tool.ts");
  writeFileSync(toolPath, DB_TOOL_TS);
  const schemaFile = readFileSync(join(PACKAGE_ROOT, "src", "store", "schema-version.ts"), "utf8");
  latestVersion = Number(/LATEST_SCHEMA_VERSION\s*=\s*(\d+)/.exec(schemaFile)?.[1]);
  if (!Number.isInteger(latestVersion) || latestVersion < 2) throw new Error("cannot read LATEST_SCHEMA_VERSION");
});

afterAll(() => {
  if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
});

describe("INT-T12 the floor runs against a snapshot of the shared corpus", () => {
  it("a branch needing a newer schema lands; the shared corpus keeps its schema, content and rows", async () => {
    const fx = new Fixture();
    const branch = fx.makeBranch("needs-newer-schema");
    const before = fx.git(["rev-parse", "main"]);
    expect(fx.dbTool(["getVersion", fx.sharedDb()])).toBe(String(latestVersion));

    const r = await fx.integrate(branch, "sess-snap");

    expect(r.exitCode, r.out).toBe(0);
    expect(r.out).toMatch(/integrate: floor runs against a corpus snapshot taken \d{4}-\d\d-\d\dT/);
    expect(fx.git(["rev-parse", "main"])).not.toBe(before);
    expect(fx.git(["merge-base", "--is-ancestor", branch, "main"])).toBe("");
    // the live corpus was never touched by the floor: still at LATEST (the floor's own copy was the one pushed behind)
    expect(fx.dbTool(["getVersion", fx.sharedDb()])).toBe(String(latestVersion));
    // nothing the floor wrote reached the shared corpus
    expect(fx.dbTool(["hasMarker", fx.sharedDb()])).toBe("0");
    // and the snapshot did not outlive its run
    expect(existsSync(join(fx.integrationWorktree("sess-snap"), ".lore", "lore.db"))).toBe(false);
  }, 180_000);

  it("the floor reads the shared corpus's content (a doc created before integrate is visible)", async () => {
    const fx = new Fixture();
    const branch = fx.makeBranch("reads-content");

    const r = await fx.integrate(branch, "sess-read");

    // the floor script (set -e) greps the doc body out of `lore get` in the integration worktree: exit 0 means it was found
    expect(r.exitCode, r.out).toBe(0);
    expect(fx.docSlug).not.toBe("");
  }, 180_000);

  it("a floor that fails still leaves no snapshot behind and the shared corpus untouched", async () => {
    const fx = new Fixture();
    fx.setFloor(`sh -c ${JSON.stringify(`bun run ${toolPath} marker .lore/lore.db; exit 3`)}`);
    const branch = fx.makeBranch("floor-fails");

    const r = await fx.integrate(branch, "sess-fail");

    expect(r.exitCode, r.out).toBe(1);
    expect(fx.dbTool(["hasMarker", fx.sharedDb()])).toBe("0");
    expect(existsSync(join(fx.integrationWorktree("sess-fail"), ".lore", "lore.db"))).toBe(false);
  }, 180_000);

  it("control: the same floor in a plain linked worktree (no snapshot) is refused by the foreign-schema guard", () => {
    const fx = new Fixture();
    const plain = join(fx.repo, ".claude", "worktrees", "plain-control");
    fx.git(["worktree", "add", "-q", "--detach", plain, "main"]);

    const r = sh(plain, "sh", [fx.floorScript], fx.env());

    expect(r.status, r.stdout + r.stderr).not.toBe(0);
    expect(r.stdout + r.stderr).toContain("schema mismatch");
  }, 120_000);
});

// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
// @reads packages/lore/src/store/schema-version.ts
// @reads packages/lore/src/store/sqlite-store.ts
/**
 * Oracle — `lore integrate` upgrades the corpus only through `lore migrate schema` (task-after-explicit-only-schema-
 * upgrades-lore-integrate-cannot): the floor's snapshot is migrated by the BRANCH binary before the floor runs, and
 * after the landing (CAS, refresh, rebuild) the live corpus is migrated once, with its from/to reported.
 *
 * Throwaway repo + corpus (mkdtemp, `git init`, `lore init`), REAL git worktrees and REAL `lore` processes; never the
 * repo's own `.lore/`. MECHANISM (the honest minimal one): the product has no hook for a fake migration N+1, and the
 * integrate process itself must open a corpus at its own LATEST, so "a branch that adds migration N+1" is staged by
 * `workflow.integrate.migrate_command` naming a tiny wrapper script (outside the repo) that stands for the branch
 * binary: it first rebuilds the corpus of its cwd as a genuine LATEST-1 database (the same `stageOlder` the INT-T12
 * oracle uses: a fresh db migrated by the real SQLiteStore up to LATEST-1, every row carried over), then execs the REAL
 * `lore migrate schema` of this checkout. So the upgrade itself, its audit row and its --json report are real; only
 * "the corpus was one version behind this binary" is staged. The wrapper's cwd tells the service's two calls apart
 * (inside `.claude/worktrees/` = the floor's snapshot; otherwise the live corpus).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { actedStore } from "../live-invocation.js";
import { runSchemaMigration } from "../../src/service/integrate-service.js";
import type { RunId } from "@lore/core";
import { installShippedGuard } from "./support/main-guard-repo.js";
import { claimBranchTask } from "../helpers/claim-branch-task.js";
import { scrubIdentityEnv } from "../helpers/test-run-identity.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const SQLITE_STORE_TS = join(PACKAGE_ROOT, "src", "store", "sqlite-store.ts");

interface RunResult {
  readonly out: string;
  readonly exitCode: number;
}

/** `stageOlder <db> <version>` | `getVersion <db>` | `auditCount <db>` | `marker <db>` | `hasMarker <db>`. */
const DB_TOOL_TS = `
import { Database } from "bun:sqlite";
import { renameSync, rmSync } from "node:fs";
import { SQLiteStore } from ${JSON.stringify(SQLITE_STORE_TS)};
const [verb, arg] = process.argv.slice(2);
if (verb === "stageOlder") {
  const version = Number(process.argv[4]);
  const older = arg + ".older";
  for (const suffix of ["", "-wal", "-shm"]) rmSync(older + suffix, { force: true });
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
  const staged = arg + ".staged";
  rmSync(staged, { force: true });
  db.run("VACUUM main INTO '" + staged.replaceAll("'", "''") + "'");
  for (const suffix of ["", "-wal", "-shm"]) rmSync(arg + suffix, { force: true });
  renameSync(staged, arg);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(older + suffix, { force: true });
  process.exit(0);
}
else if (verb === "getVersion") { const db = new Database(arg, { readonly: true }); console.log(db.query("PRAGMA user_version").get().user_version); db.close(); }
else if (verb === "auditCount") { const db = new Database(arg, { readonly: true }); console.log(db.query("SELECT count(*) AS n FROM audit WHERE action = 'migrate_schema'").get().n); db.close(); }
else if (verb === "migrateRuns") { const db = new Database(arg, { readonly: true }); console.log(JSON.stringify(db.query("SELECT harness_run FROM audit WHERE action = 'migrate_schema' ORDER BY id").all().map((r) => r.harness_run))); db.close(); }
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

/** What the wrapper (the stand-in branch binary) does: `behind` stages one-version-behind then migrates for real; `current` just migrates; `fail-snapshot` / `fail-live` exit 3 where named. */
type WrapperMode = "behind" | "current" | "fail-snapshot" | "fail-live";

class Fixture {
  readonly repo: string;
  readonly wrapperPath: string;
  readonly floorScript: string;

  constructor(mode: WrapperMode) {
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
    installShippedGuard(this.repo, `${this.repo}-guard-hooks`);

    this.wrapperPath = join(root, `branch-lore-${repoSeq}.sh`);
    writeFileSync(
      this.wrapperPath,
      [
        "MODE=$1; shift",
        'case "$PWD" in */.claude/worktrees/*) WHERE=snapshot;; *) WHERE=live;; esac',
        'if [ "$MODE" = "fail-$WHERE" ]; then echo "migration 999 exploded" >&2; exit 3; fi',
        `if [ "$MODE" != "current" ]; then bun run ${JSON.stringify(toolPath)} stageOlder "$PWD/.lore/lore.db" ${latestVersion - 1} || exit 1; fi`,
        `exec bun run ${JSON.stringify(INDEX_TS)} "$@"`,
      ].join("\n") + "\n",
    );
    this.floorScript = join(root, `floor-${repoSeq}.sh`);
    // the floor proves it ran against a MIGRATED snapshot: its schema is LATEST and it carries the one migrate_schema row
    writeFileSync(
      this.floorScript,
      [
        "set -e",
        `test "$(bun run ${JSON.stringify(toolPath)} getVersion .lore/lore.db)" = "${latestVersion}"`,
        ...(mode === "behind" ? [`test "$(bun run ${JSON.stringify(toolPath)} auditCount .lore/lore.db)" = "1"`] : []),
        `bun run ${JSON.stringify(toolPath)} marker .lore/lore.db`,
        "echo floor-saw-migrated-snapshot",
      ].join("\n") + "\n",
    );
    const cfg = join(this.repo, ".lore", "config.yaml");
    const base = readFileSync(cfg, "utf8").split("\nworkflow:")[0] ?? "";
    writeFileSync(
      cfg,
      `${base.trimEnd()}\nworkflow:\n  integrate:\n    floor_command: ${JSON.stringify(`sh ${this.floorScript}`)}\n    migrate_command: ${JSON.stringify(`sh ${this.wrapperPath} ${mode} migrate schema`)}\n`,
    );
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

  makeBranch(name: string): string {
    this.git(["checkout", "-q", "-b", name, "main"]);
    writeFileSync(join(this.repo, `${name}.txt`), `${name}\n`);
    this.git(["add", `${name}.txt`]);
    this.git(["commit", "-q", "-m", `work on ${name}`]);
    this.git(["checkout", "-q", "--detach", "main"]);
    claimBranchTask((args) => {
      const r = sh(this.repo, "bun", ["run", INDEX_TS, ...args], this.env());
      return { status: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
    }, this.repo, name);
    return name;
  }

  /** `lore integrate` as the registered run `cc:<session>` (integrate refuses a configured migrate_command without an attested caller run). */
  async integrate(branch: string, session: string): Promise<RunResult> {
    const run = `cc:${session}`;
    await this.registerRun(run);
    return this.integrateAs(branch, session, run);
  }

  /** Registers `run` in this repo's corpus (the same `insertRun` the agent integration uses), so `--harness-run <run>` verifies. */
  async registerRun(run: string): Promise<void> {
    const store = actedStore(new SQLiteStore(this.sharedDb()));
    try {
      const inserted = await store.insertRun({
        id: run as RunId,
        kind: "main",
        harness: "claude-code",
        sessionRef: "sess-run",
        agentRef: null,
        agentType: null,
        parentRunId: null,
        branch: null,
        composition: { schemaVersion: 1, fragments: [] },
        registeredAt: "2026-10-01T00:00:00.000Z",
        messageAddress: null,
      });
      if (!inserted.ok) throw new Error(`insertRun failed: ${JSON.stringify(inserted.error)}`);
    } finally {
      store.close();
    }
  }

  /** `lore integrate` as the party `run` (Bun.spawnSync, so no inherited party): `--harness-run <run>`, or no run at all when `run` is undefined. */
  integrateAs(branch: string, session: string, run: string | undefined): RunResult {
    // reason: with no run to name, the spawn must be nobody: the test run's spawn rewrite gives every `lore` start a registered
    // agent run unless it opts out (`LORE_TEST_IDENTITY=none`), and no identity variable may name a writer.
    const env: Record<string, string | undefined> =
      run === undefined ? { ...scrubIdentityEnv(this.env(session)), LORE_TEST_IDENTITY: "none" } : { ...this.env(session) };
    const flag = run === undefined ? [] : ["--harness-run", run];
    const proc = Bun.spawnSync(["bun", "run", INDEX_TS, "integrate", branch, "--session", session, ...flag], { cwd: this.repo, env });
    return { out: `${proc.stdout.toString()}${proc.stderr.toString()}`, exitCode: proc.exitCode ?? 1 };
  }

  integrationWorktree(session: string): string {
    return join(this.repo, ".claude", "worktrees", `integrate-${session}`);
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lore-intmig-"));
  toolPath = join(root, "db-tool.ts");
  writeFileSync(toolPath, DB_TOOL_TS);
  const schemaFile = readFileSync(join(PACKAGE_ROOT, "src", "store", "schema-version.ts"), "utf8");
  latestVersion = Number(/LATEST_SCHEMA_VERSION\s*=\s*(\d+)/.exec(schemaFile)?.[1]);
  if (!Number.isInteger(latestVersion) || latestVersion < 2) throw new Error("cannot read LATEST_SCHEMA_VERSION");
});

afterAll(() => {
  if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
});

describe("integrate migrates the floor's snapshot and then the live corpus, only through `lore migrate schema`", () => {
  it("AC-MIG-1 a branch adding a migration lands: floor on a migrated snapshot, live corpus upgraded once, from/to reported", async () => {
    const fx = new Fixture("behind");
    const branch = fx.makeBranch("adds-migration");
    const before = fx.git(["rev-parse", "main"]);
    expect(fx.dbTool(["auditCount", fx.sharedDb()])).toBe("0");

    const r = await fx.integrate(branch, "sess-mig");

    expect(r.exitCode, r.out).toBe(0);
    expect(fx.git(["rev-parse", "main"])).not.toBe(before);
    // the floor script (set -e, exit 0 = it passed) asserted: snapshot at LATEST with its own one migrate_schema row
    expect(r.out).toContain(`integrate: snapshot schema: ${latestVersion - 1} -> ${latestVersion}`);
    expect(r.out).toContain(`integrate: schema: ${latestVersion - 1} -> ${latestVersion}`);
    expect(fx.dbTool(["getVersion", fx.sharedDb()])).toBe(String(latestVersion));
    expect(fx.dbTool(["auditCount", fx.sharedDb()])).toBe("1");
    expect(fx.dbTool(["hasMarker", fx.sharedDb()])).toBe("0");
    expect(existsSync(join(fx.integrationWorktree("sess-mig"), ".lore", "lore.db"))).toBe(false);
  }, 240_000);

  it("AC-MIG-2 a corpus already current is reported as already current, with no audit row", async () => {
    const fx = new Fixture("current");
    const branch = fx.makeBranch("no-migration");

    const r = await fx.integrate(branch, "sess-cur");

    expect(r.exitCode, r.out).toBe(0);
    expect(r.out).toContain("integrate: schema: already current");
    expect(fx.dbTool(["auditCount", fx.sharedDb()])).toBe("0");
  }, 240_000);

  it("AC-MIG-3 a branch whose migration fails on the snapshot is refused (exit 1) naming the snapshot and the output; main unchanged", async () => {
    const fx = new Fixture("fail-snapshot");
    const branch = fx.makeBranch("migration-explodes");
    const before = fx.git(["rev-parse", "main"]);

    const r = await fx.integrate(branch, "sess-bad");

    expect(r.exitCode, r.out).toBe(1);
    expect(r.out).toContain("migration 999 exploded");
    expect(r.out).toContain(join(fx.integrationWorktree("sess-bad"), ".lore"));
    expect(r.out).toContain("the floor did not run and main is unchanged");
    expect(r.out).not.toContain("integrate: landed");
    expect(fx.git(["rev-parse", "main"])).toBe(before);
    expect(fx.dbTool(["getVersion", fx.sharedDb()])).toBe(String(latestVersion));
    expect(existsSync(join(fx.integrationWorktree("sess-bad"), ".lore", "lore.db"))).toBe(false);
  }, 240_000);

  it("AC-MIG-4 a failing live migrate is loud (exit 1), names the corpus and the command to rerun, and never undoes the landing", async () => {
    const fx = new Fixture("fail-live");
    const branch = fx.makeBranch("live-migrate-fails");
    const before = fx.git(["rev-parse", "main"]);

    const r = await fx.integrate(branch, "sess-live");

    expect(r.exitCode, r.out).toBe(1);
    expect(fx.git(["rev-parse", "main"])).not.toBe(before);
    expect(fx.git(["merge-base", "--is-ancestor", branch, "main"])).toBe("");
    expect(r.out).toContain("migration 999 exploded");
    expect(r.out).toContain(`on ${join(fx.repo, ".lore")};`);
    expect(r.out).toContain(`sh ${fx.wrapperPath} fail-live migrate schema`);
    expect(r.out).toMatch(/main stays landed/);
  }, 240_000);

  it("IDENT-1 the migrate child runs as the CALLER's party: the live migrate_schema audit row names the caller's run", async () => {
    const fx = new Fixture("behind");
    const branch = fx.makeBranch("child-attributed");
    await fx.registerRun("cc:sess-run");

    const r = fx.integrateAs(branch, "sess-run", "cc:sess-run");

    expect(r.exitCode, r.out).toBe(0);
    expect(JSON.parse(fx.dbTool(["migrateRuns", fx.sharedDb()]))).toEqual(["cc:sess-run"]);
  }, 240_000);

  it("IDENT-2 migrate_command configured and no attested caller run: refused (exit 4) before anything moves; main, worktree and corpus unchanged", () => {
    const fx = new Fixture("behind");
    const branch = fx.makeBranch("nobody-integrates");
    const before = fx.git(["rev-parse", "main"]);

    const r = fx.integrateAs(branch, "sess-nobody", undefined);

    expect(r.exitCode, r.out).toBe(4);
    expect(r.out).toContain("no attested agent run");
    expect(fx.git(["rev-parse", "main"])).toBe(before);
    expect(existsSync(fx.integrationWorktree("sess-nobody"))).toBe(false);
    expect(fx.dbTool(["auditCount", fx.sharedDb()])).toBe("0");
    expect(fx.dbTool(["getVersion", fx.sharedDb()])).toBe(String(latestVersion));
  }, 240_000);

  it("IDENT-3 a malformed run id is refused without spawning anything: integrate (registered unsafe id) and runSchemaMigration alike", async () => {
    const fx = new Fixture("behind");
    const branch = fx.makeBranch("unsafe-run");
    const sentinel = join(root, `pwned-${repoSeq}`);
    const unsafe = `cc:x;touch ${sentinel}`;
    await fx.registerRun(unsafe);
    const before = fx.git(["rev-parse", "main"]);

    const r = fx.integrateAs(branch, "sess-unsafe", unsafe);

    expect(r.exitCode, r.out).toBe(4);
    expect(existsSync(sentinel)).toBe(false);
    expect(fx.git(["rev-parse", "main"])).toBe(before);
    expect(fx.dbTool(["auditCount", fx.sharedDb()])).toBe("0");

    const spawned: string[] = [];
    const direct = runSchemaMigration((cmd) => { spawned.push(cmd); return { status: 0, output: "" }; }, "lore migrate schema", fx.repo, join(fx.repo, ".lore"), unsafe);
    expect(direct.state).toBe("failed");
    expect(spawned).toEqual([]);
    const good = runSchemaMigration((cmd) => { spawned.push(cmd); return { status: 1, output: "" }; }, "lore migrate schema", fx.repo, join(fx.repo, ".lore"), "cc:sess-run");
    expect(good.state).toBe("failed");
    expect(spawned).toEqual(["export LORE_HARNESS_RUN='cc:sess-run'\nlore migrate schema --json"]);
  }, 240_000);
});

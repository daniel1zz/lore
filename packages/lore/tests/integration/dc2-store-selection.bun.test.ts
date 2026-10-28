// @reads assets/**
/**
 * D22 — with `sync.enabled` every route reads and writes through the embedded replica, or fails loud with no write to
 * the local file (BR-925, BR-930). Throwaway corpora only (never the repo's `.lore/`), no real Turso remote and no real
 * token: the failing routes use a variable that is unset and a closed ephemeral port; the passing route injects a
 * replica-store double through the store-selection seam (`installReplicaStoreFactory`).
 *
 * @spec_ref spec-defect-clusters-round-2-part-c-criterion-data-demotion
 */

import { Database } from "bun:sqlite";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { Readable } from "stream";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { buildTestInvocation } from "../helpers/test-invocation";
import { installReplicaStoreFactory } from "../../src/app";
import { loadLoreApp } from "../../src/adapters/cli/loader";
import { mountRegisteredProject } from "../../src/adapters/cli/commands/dashboard";
import { InMemoryStore } from "../../src/store/in-memory-store";
import { SQLiteStore } from "../../src/store/sqlite-store";
import type { TursoConfig, TursoStore } from "../../src/store/turso-store";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import type { RunId, RunRecord } from "@lore/core";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const SPEC = "spec-defect-clusters-round-2-part-c-criterion-data-demotion";
const TOKEN_VARIABLE = "LORE_DC2_REPLICA_TOKEN";
const TITLE = "dc2 replica write";

interface Sandbox {
  readonly root: string;
  readonly home: string;
  readonly corpus: string;
  readonly dbPath: string;
  readonly env: Record<string, string>;
}

const sandboxRoots: string[] = [];
const restores: Array<() => void> = [];
afterAll(() => {
  for (const root of sandboxRoots) rmSync(root, { recursive: true, force: true });
});
afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

async function lore(sb: Sandbox, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = await runLoreInProcess(args, { cwd: sb.corpus, home: sb.home, env: sb.env });
  return { code: proc.exitCode, stdout: proc.stdout, stderr: proc.stderr };
}

/** A fresh lore project whose config.yaml carries the given sync section (`init` runs BEFORE sync is switched on). */
async function makeSandbox(syncYaml: string, withToken: boolean): Promise<Sandbox> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-dc2-store-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  sandboxRoots.push(root);
  const home = join(root, "home");
  const corpus = join(root, "corpus");
  for (const d of [home, join(root, "xdg"), corpus]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_CONFIG_HOME", TOKEN_VARIABLE]) delete env[k];
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = join(root, "xdg");
  if (withToken) env[TOKEN_VARIABLE] = "dc2-not-a-real-token";
  const sb: Sandbox = { root, home, corpus, dbPath: join(corpus, ".lore", "lore.db"), env };
  const init = await lore(sb, "init");
  if (init.code !== 0) throw new Error(`harness: lore init failed: ${init.stderr}`);
  patchLoreConfig(corpus, syncYaml);
  return sb;
}

function syncSection(enabled: boolean, remoteUrl: string): string {
  return ["sync:", `  enabled: ${String(enabled)}`, `  remote_url: ${remoteUrl}`, `  auth_token_env: ${TOKEN_VARIABLE}`].join("\n");
}

/** Number of documents in the local lore.db, read through a plain read-only handle. */
function localDocCount(sb: Sandbox): number {
  const db = new Database(sb.dbPath, { readonly: true });
  try {
    return (db.query("SELECT COUNT(*) AS n FROM docs").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

function localTitleCount(sb: Sandbox, title: string): number {
  const db = new Database(sb.dbPath, { readonly: true });
  try {
    return (db.query("SELECT COUNT(*) AS n FROM docs WHERE title = ?").get(title) as { n: number }).n;
  } finally {
    db.close();
  }
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).map(String).sort();
}

/** A port nothing listens on: bind an ephemeral port, then release it. */
async function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** Replica-store double: an in-memory store behind a proxy that records every doc write and every open. */
async function makeReplicaDouble(seedFrom: string): Promise<{ store: TursoStore; opens: TursoConfig[]; writes: string[]; factory: (c: TursoConfig) => TursoStore }> {
  const inner = new InMemoryStore();
  const opens: TursoConfig[] = [];
  const writes: string[] = [];
  const DOC_WRITE = /^(insert|update|softDelete|delete)(WithProvenance|WithAllocatedOrdinal|WithProvenanceAndAllocatedOrdinal)?$/;
  const store = new Proxy(inner, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (typeof prop === "string" && DOC_WRITE.test(prop)) writes.push(prop);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as unknown as TursoStore;
  // Seed the double with what `lore init` wrote locally (the root PRD), so the double stands for the remote corpus.
  const local = new SQLiteStore(seedFrom);
  const seed = await local.findMany({ exclude_deleted: false });
  local.close();
  if (!seed.ok) throw new Error("harness: could not read the seed corpus");
  for (const doc of seed.value) {
    const inserted = await inner.insert(doc);
    if (!inserted.ok) throw new Error(`harness: seeding the double failed: ${JSON.stringify(inserted.error)}`);
  }
  // The run registry is part of the corpus the double stands for: a write by an agent run is refused unless the run is known (BR-1351).
  const registry = new Database(seedFrom, { readonly: true });
  try {
    const rows = registry.query("SELECT id, kind, harness, session_ref, agent_ref, agent_type, parent_run_id, branch, composition, registered_at FROM runs").all() as Array<Record<string, string | null>>;
    for (const row of rows) {
      const inserted = await inner.insertRun({
        id: row["id"] as RunId,
        kind: row["kind"] as RunRecord["kind"],
        harness: row["harness"] as RunRecord["harness"],
        sessionRef: row["session_ref"] as string,
        agentRef: row["agent_ref"] ?? null,
        agentType: row["agent_type"] ?? null,
        parentRunId: row["parent_run_id"] as RunId | null,
        branch: row["branch"] ?? null,
        composition: JSON.parse(row["composition"] as string) as RunRecord["composition"],
        registeredAt: row["registered_at"] as string,
        messageAddress: null,
      });
      if (!inserted.ok) throw new Error(`harness: seeding the double's run registry failed: ${JSON.stringify(inserted.error)}`);
    }
  } finally {
    registry.close();
  }
  return {
    store,
    opens,
    writes,
    factory: (config) => {
      opens.push(config);
      return store;
    },
  };
}

function loadRoute(sb: Sandbox, argv: readonly string[], surface: "http" | "cli"): { close: () => void } {
  const out: string[] = [];
  const inv = buildTestInvocation({
    argv,
    cwd: sb.corpus,
    env: sb.env,
    home: sb.home,
    io: { stdout: { write: (t) => out.push(t) }, stderr: { write: (t) => out.push(t) }, stdin: Readable.from([]), stdinIsTTY: false },
  });
  const { app } = loadLoreApp({ surface, inv });
  return { close: () => app.close() };
}

describe("sync.enabled: every route goes through the replica or fails loud", () => {
  it(
    `${SPEC}#AC-DC2-22 (a) URL set, token variable unset: create exits 1 naming the variable, the local file is unchanged, no replica file appears`,
    async () => {
      const sb = await makeSandbox(syncSection(true, "libsql://127.0.0.1:1"), false);
      const countBefore = localDocCount(sb);
      const filesBefore = filesUnder(join(sb.corpus, ".lore"));

      const result = await lore(sb, "create", "knowledge", "--title", TITLE, "--sub-type", "reference", "--content", "body");

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(TOKEN_VARIABLE);
      expect(localDocCount(sb)).toBe(countBefore);
      expect(localTitleCount(sb, TITLE)).toBe(0);
      expect(filesUnder(join(sb.corpus, ".lore"))).toEqual(filesBefore);
    },
    60_000,
  );

  it(
    `${SPEC}#AC-DC2-22 (b) token set, URL on a closed port: create exits 1 naming the URL, with no fallback to the local file`,
    async () => {
      const port = await closedPort();
      const url = `libsql://127.0.0.1:${port}`;
      const sb = await makeSandbox(syncSection(true, url), true);
      const countBefore = localDocCount(sb);

      const result = await lore(sb, "create", "knowledge", "--title", TITLE, "--sub-type", "reference", "--content", "body");

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(url);
      expect(localDocCount(sb)).toBe(countBefore);
      expect(localTitleCount(sb, TITLE)).toBe(0);
      // a read refuses the same way: there is no local-only read path either
      const read = await lore(sb, "list");
      expect(read.code).toBe(1);
      expect(read.stderr).toContain(url);
    },
    90_000,
  );

  it(
    `${SPEC}#AC-DC2-22 (c) create writes once through the injected replica double, get reads it back, the local file is untouched`,
    async () => {
      const sb = await makeSandbox(syncSection(true, "libsql://127.0.0.1:1"), true);
      const double = await makeReplicaDouble(sb.dbPath);
      restores.push(installReplicaStoreFactory(double.factory));
      const countBefore = localDocCount(sb);

      const created = await lore(sb, "create", "knowledge", "--title", TITLE, "--sub-type", "reference", "--content", "body", "--json");
      expect(created.code, created.stderr).toBe(0);
      const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
      expect(double.writes.filter((name) => name.startsWith("insert"))).toHaveLength(1);
      expect(double.opens.length).toBeGreaterThanOrEqual(1);
      expect(double.opens[0]?.localPath).toBe(sb.dbPath);
      expect(double.opens[0]?.remoteUrl).toBe("libsql://127.0.0.1:1");

      const read = await lore(sb, "get", slug, "--json");
      expect(read.code, read.stderr).toBe(0);
      // the title exists only in the double (asserted absent from the local file below), so a read that shows it came through the double
      expect(read.stdout).toContain(TITLE);

      expect(localDocCount(sb)).toBe(countBefore);
      expect(localTitleCount(sb, TITLE)).toBe(0);
    },
    60_000,
  );

  it(
    `${SPEC}#AC-DC2-22 (c) lore serve (through loadLoreApp) and a dashboard-mounted project select the same double`,
    async () => {
      const sb = await makeSandbox(syncSection(true, "libsql://127.0.0.1:1"), true);
      const double = await makeReplicaDouble(sb.dbPath);
      restores.push(installReplicaStoreFactory(double.factory));

      const serve = loadRoute(sb, ["serve"], "http");
      expect(double.opens.map((c) => c.localPath)).toEqual([sb.dbPath]);
      serve.close();

      const out: string[] = [];
      const inv = buildTestInvocation({
        argv: ["dashboard"],
        cwd: sb.corpus,
        env: sb.env,
        home: sb.home,
        io: { stdout: { write: (t) => out.push(t) }, stderr: { write: (t) => out.push(t) }, stdin: Readable.from([]), stdinIsTTY: false },
      });
      const mounted = await mountRegisteredProject(inv, sb.dbPath);
      expect(double.opens.map((c) => c.remoteUrl)).toEqual(["libsql://127.0.0.1:1", "libsql://127.0.0.1:1"]);
      mounted.close();
    },
    60_000,
  );

  it(
    `${SPEC}#AC-DC2-22 (d) sync.enabled false: commands use the local SQLite store and never open the replica`,
    async () => {
      const sb = await makeSandbox(syncSection(false, "libsql://127.0.0.1:1"), false);
      const double = await makeReplicaDouble(sb.dbPath);
      restores.push(installReplicaStoreFactory(double.factory));
      const countBefore = localDocCount(sb);

      const created = await lore(sb, "create", "knowledge", "--title", TITLE, "--sub-type", "reference", "--content", "body");

      expect(created.code, created.stderr).toBe(0);
      expect(double.opens).toHaveLength(0);
      expect(localDocCount(sb)).toBe(countBefore + 1);
      expect(localTitleCount(sb, TITLE)).toBe(1);
    },
    60_000,
  );
});

// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-runs-carry-their-messaging-address-holder-listings-show-it (AC-MA-2; BR-1360)
 *
 * RED then GREEN for the run messaging address: `lore run register --messaging-socket <path>` stores
 * `uds:<path>` for a claude-code main run, EVERY register replaces it (resume replaces, absence clears), a
 * subagent stores NULL, and `lore run show` (text and --json) reads it back. Refusals (plan I1): an unknown
 * harness with the flag, an empty or relative path -> exit 2 and nothing stored.
 *
 * Isolation: mkdtemp HOME + XDG_CONFIG_HOME + a throwaway `lore init` corpus. NEVER touches the repo's `.lore/`.
 *
 * Six dimensions: HAPPY (store + show), NEGATIVE (unknown harness, empty path, relative path), BOUNDARY
 * (register without --harness-pid still writes), STATE (resume replaces, absence clears), ERROR (refusal stores
 * nothing), REGRESSION (subagent NULL; in-memory store parity; migration adds the nullable column).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/schema-version.js";
import { RunService } from "../../../src/service/run-service.js";
import { actedStore } from "../../live-invocation.js";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
interface Sandbox {
  root: string;
  corpus: string;
}

function runLore(sb: Sandbox, args: string[]): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd: sb.corpus,
    env: {
      ...process.env,
      HOME: join(sb.root, "home"),
      XDG_CONFIG_HOME: join(sb.root, "xdg"),
      EDITOR: "true",
      CLAUDECODE: "1",
    },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

let sb: Sandbox;
beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "lore-run-address-"));
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  const corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  sb = { root, corpus };
  const init = runLore(sb, ["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
});
afterEach(() => rmSync(sb.root, { recursive: true, force: true }));

function register(session: string, extra: string[] = [], harness = "claude-code"): RunResult {
  return runLore(sb, ["run", "register", "--harness", harness, "--session", session, ...extra]);
}

function showJson(id: string): { messageAddress: string | null } {
  const r = runLore(sb, ["run", "show", id, "--json"]);
  expect(r.exitCode).toBe(0);
  return JSON.parse(r.stdout).data;
}

function showText(id: string): string {
  const r = runLore(sb, ["run", "show", id]);
  expect(r.exitCode).toBe(0);
  return r.stdout;
}

describe("lore run register --messaging-socket (AC-MA-2)", () => {
  it("HAPPY: stores uds:<path>; second register replaces; third without the flag clears (no --harness-pid anywhere)", () => {
    expect(register("S", ["--messaging-socket", "/a"]).exitCode).toBe(0);
    expect(showJson("cc:S").messageAddress).toBe("uds:/a");
    expect(showText("cc:S")).toContain("address: uds:/a");

    expect(register("S", ["--messaging-socket", "/b"]).exitCode).toBe(0);
    expect(showJson("cc:S").messageAddress).toBe("uds:/b");
    expect(showText("cc:S")).toContain("address: uds:/b");

    expect(register("S").exitCode).toBe(0);
    expect(showJson("cc:S").messageAddress).toBeNull();
    expect(showText("cc:S")).toContain("address: none recorded");
  });

  it("REGRESSION: a run registered without the flag shows 'address: none recorded' and null", () => {
    expect(register("N").exitCode).toBe(0);
    expect(showJson("cc:N").messageAddress).toBeNull();
    expect(showText("cc:N")).toContain("address: none recorded");
  });

  it("STATE: a subagent run registered with the flag stores NULL and leaves the main run's address alone", () => {
    expect(register("M", ["--messaging-socket", "/main"]).exitCode).toBe(0);
    expect(register("M", ["--agent-id", "a1", "--agent-type", "explore", "--messaging-socket", "/sub"]).exitCode).toBe(0);
    expect(showJson("cc:M:a1").messageAddress).toBeNull();
    expect(showJson("cc:M").messageAddress).toBe("uds:/main");
  });

  it("NEGATIVE: an unknown harness given the flag exits 2 and stores nothing", () => {
    const r = register("U", ["--messaging-socket", "/a"], "no-such-harness");
    expect(r.exitCode).toBe(2);
    expect(runLore(sb, ["run", "show", "cc:U"]).exitCode).not.toBe(0);
  });

  it("NEGATIVE: an empty socket path exits 2 and stores nothing", () => {
    const r = register("E", ["--messaging-socket", ""]);
    expect(r.exitCode).toBe(2);
    expect(runLore(sb, ["run", "show", "cc:E"]).exitCode).not.toBe(0);
  });

  it("NEGATIVE: a relative socket path exits 2 and stores nothing", () => {
    const r = register("R", ["--messaging-socket", "rel/x.sock"]);
    expect(r.exitCode).toBe(2);
    expect(runLore(sb, ["run", "show", "cc:R"]).exitCode).not.toBe(0);
  });

  it("ERROR: a refused resume keeps the previously stored address", () => {
    expect(register("K", ["--messaging-socket", "/keep"]).exitCode).toBe(0);
    expect(register("K", ["--messaging-socket", "rel"]).exitCode).toBe(2);
    expect(showJson("cc:K").messageAddress).toBe("uds:/keep");
  });
});

describe("in-memory store parity (AC-MA-2)", () => {
  it("register stores, resume replaces, absence clears, subagent stores none", async () => {
    const store = actedStore(new InMemoryStore());
    const service = new RunService(store, undefined, undefined, undefined, "/repo");
    const composition = { schemaVersion: 1 as const, fragments: [] };
    const addressOf = async (session: string, agentId?: string): Promise<string | null | undefined> => {
      const r = await service.show(agentId === undefined ? `cc:${session}` : `cc:${session}:${agentId}`);
      return r.ok ? r.value.messageAddress : undefined;
    };
    await service.register({ harness: "claude-code", sessionId: "S", composition, messageAddress: "uds:/a" });
    expect(await addressOf("S")).toBe("uds:/a");
    await service.register({ harness: "claude-code", sessionId: "S", composition, messageAddress: "uds:/b" });
    expect(await addressOf("S")).toBe("uds:/b");
    await service.register({ harness: "claude-code", sessionId: "S", composition });
    expect(await addressOf("S")).toBeNull();
    await service.register({ harness: "claude-code", sessionId: "S", agentId: "a", agentType: "t", composition, messageAddress: "uds:/c" });
    expect(await addressOf("S", "a")).toBeNull();
  });
});

// migration-030.ts adds runs.message_address; a fixture "one behind" is pinned to that migration, not to the moving latest.
const MESSAGE_ADDRESS_MIGRATION = 30;

describe("migration adds runs.message_address (AC-MA-2)", () => {
  it("a corpus one schema version behind the migration that adds the column (030) migrates to the latest with a nullable column", () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-m-address-"));
    try {
      const dbPath = join(dir, "c.db");
      const old = new SQLiteStore(dbPath, { schemaCeiling: MESSAGE_ADDRESS_MIGRATION - 1 });
      const before = (old.getDatabase().query("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name);
      expect(before).not.toContain("message_address");
      old.close();

      const upgraded = new SQLiteStore(dbPath, { migrate: true });
      try {
        const cols = upgraded.getDatabase().query("PRAGMA table_info(runs)").all() as { name: string; notnull: number }[];
        const col = cols.find((c) => c.name === "message_address");
        expect(col?.notnull).toBe(0);
        const user = (upgraded.getDatabase().query("PRAGMA user_version").get() as { user_version: number }).user_version;
        expect(user).toBe(LATEST_SCHEMA_VERSION);
      } finally {
        upgraded.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

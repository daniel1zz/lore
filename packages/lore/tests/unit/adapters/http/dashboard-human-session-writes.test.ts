/**
 * Local dashboard writes are made by the checkout's open human session (GitHub #324;
 * spec-every-write-is-made-by-a-known-party-an-attested-agent-run, BR-1055 / BR-1350).
 *
 * Contract under test, through a REAL `startHttpServer` over a REAL `createApp` corpus file, with the server
 * configured the way `lore dashboard` configures it (`humanWrites`):
 *   - a cookie write is recorded with the person whose human session is open in the checkout (name, source `human`,
 *     the session's own run), whatever owner the cookie's key carries;
 *   - with NO open session, a cookie write is refused (4xx) with a body naming `lore session start --human <name>`
 *     and writes nothing, while a cookie READ still works;
 *   - the session is looked up at write time: starting it after the server is up takes effect, ending it makes the
 *     next write refused;
 *   - a bearer key keeps being named by its own name, session or not.
 *
 * Dimensions: HAPPY (write as the person), NEGATIVE (no session), STATE (start/end without restart), BOUNDARY
 * (reads without a session), REGRESSION (bearer unaffected).
 *
 * MOCK RISK: none — the session file is written by the production writer into a throwaway state dir, its run is
 * registered through the production `registerParty`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../../src/app.js";
import type { App } from "../../../../src/app.js";
import { startHttpServer } from "../../../../src/adapters/http/index.js";
import { createMachineAuthStores } from "../../../../src/adapters/http/machine-auth.js";
import {
  deleteHumanSessionFile,
  hashSessionToken,
  newSessionToken,
  resolveHumanSessionBinding,
  writeHumanSessionFile,
} from "../../../../src/adapters/cli/human-session-file.js";
import { liveAmbient, liveIo } from "../../../live-invocation.js";
import { SQLiteStore } from "../../../../src/store/sqlite-store.js";
import { insertRequirementsDocWithoutHistory } from "../../../helpers/parented-create.js";

interface Harness {
  /** A requirements document inserted without history rows (these suites count and attribute every create row). */
  readonly parentId: string;
  readonly dir: string;
  readonly stateHome: string;
  readonly dbPath: string;
  readonly app: App;
  readonly server: ReturnType<typeof startHttpServer>;
  readonly baseUrl: string;
  readonly cookie: string;
  readonly bearer: string;
}

const NO_PARTY = { harnessRun: null, claimed: null, claimedSource: null, unresolvedReason: "the serve process has no known party" } as const;

function auditActors(dbPath: string): Array<{ actor: string; harness_run: string | null; source: unknown }> {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.query("SELECT actor, harness_run, details FROM audit WHERE action = 'create' ORDER BY id").all() as Array<{
      actor: string;
      harness_run: string | null;
      details: string | null;
    }>;
    return rows.map((r) => ({
      actor: r.actor,
      harness_run: r.harness_run,
      source: r.details === null ? undefined : (JSON.parse(r.details) as Record<string, unknown>)["name_source"],
    }));
  } finally {
    db.close();
  }
}

async function openHumanSession(h: Harness, name: string): Promise<void> {
  const token = newSessionToken();
  const registered = await h.app.runService!.registerParty({ harness: "human", name, tokenHash: hashSessionToken(token) });
  if (!registered.ok) throw new Error(`register: ${JSON.stringify(registered.error)}`);
  writeHumanSessionFile({ LORE_STATE_HOME: h.stateHome }, h.dir, {
    version: 1,
    checkout: h.dir,
    name,
    token,
    started_at: new Date().toISOString(),
  });
}

async function post(h: Harness, headers: Record<string, string>, title: string): Promise<Response> {
  return fetch(`${h.baseUrl}/api/docs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ type: "knowledge", title, content: "body", parent_id: h.parentId, extra: { sub_type: "reference" } }),
  });
}

describe("local dashboard writes are made by the checkout's human session", () => {
  let h: Harness;

  beforeEach(async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "dash-human-")));
    mkdirSync(join(dir, ".lore"), { recursive: true });
    const stateHome = join(dir, "state");
    const dbPath = join(dir, ".lore", "lore.db");
    const app = createApp(dbPath, undefined, liveAmbient(), { identity: NO_PARTY }) as App;

    const key = await app.apiKeyStore.create("ci-bot", "owner-of-ci-bot");
    if (!key.ok) throw new Error(`api key: ${JSON.stringify(key.error)}`);
    const machineAuth = createMachineAuthStores({ baseDir: join(dir, "machine-auth") });
    // The cookie's key owner is a placeholder, NOT a person: the person is the checkout's human session.
    const dashboardKey = await machineAuth.apiKeyStore.create("dashboard-local", "dashboard-local");
    if (!dashboardKey.ok) throw new Error(`dashboard key: ${JSON.stringify(dashboardKey.error)}`);
    const session = machineAuth.sessionStore.create("dashboard-local");

    const server = startHttpServer(app, {
      io: liveIo(),
      port: 0,
      host: "127.0.0.1",
      machineAuth,
      humanWrites: {
        checkoutRoot: dir,
        humanSessionOf: (checkout) => resolveHumanSessionBinding({ LORE_STATE_HOME: stateHome }, dir, checkout),
      },
    });
    const seedStore = new SQLiteStore(dbPath);
    const parentId = await insertRequirementsDocWithoutHistory(seedStore);
    seedStore.close();
    h = {
      parentId,
      dir,
      stateHome,
      dbPath,
      app,
      server,
      baseUrl: `http://127.0.0.1:${server.port}`,
      cookie: `lore_sid=${session.session_id}`,
      bearer: `Bearer ${key.value.rawKey}`,
    };
  });

  afterEach(() => {
    h.server.stop(true);
    h.app.close();
    rmSync(h.dir, { recursive: true, force: true });
  });

  it("records the person whose human session is open, under that session's run", async () => {
    await openHumanSession(h, "dana");
    const response = await post(h, { Cookie: h.cookie }, "Written from the dashboard");
    expect(response.status).toBe(201);
    const rows = auditActors(h.dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe("dana");
    expect(rows[0]?.harness_run).toMatch(/^human:/);
    expect(rows[0]?.source).toBe("human");
  });

  it("refuses a write with no open session, naming the command, and writes nothing", async () => {
    const response = await post(h, { Cookie: h.cookie }, "Written with nobody logged in");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    const text = await response.text();
    expect(text).toContain("lore session start --human <name>");
    expect(auditActors(h.dbPath)).toHaveLength(0);
  });

  it("still serves cookie reads with no open session", async () => {
    const response = await fetch(`${h.baseUrl}/api/docs`, { headers: { Cookie: h.cookie } });
    expect(response.status).toBe(200);
  });

  it("reads the session at write time: a session started later is used, an ended one is refused", async () => {
    expect((await post(h, { Cookie: h.cookie }, "Before the session")).status).toBeGreaterThanOrEqual(400);
    await openHumanSession(h, "erin");
    expect((await post(h, { Cookie: h.cookie }, "During the session")).status).toBe(201);
    expect(deleteHumanSessionFile({ LORE_STATE_HOME: h.stateHome }, h.dir, h.dir)).toBe(true);
    expect((await post(h, { Cookie: h.cookie }, "After the session")).status).toBeGreaterThanOrEqual(400);
    expect(auditActors(h.dbPath).map((r) => r.actor)).toEqual(["erin"]);
  });

  it("leaves a bearer key named by its own name, with or without a session", async () => {
    expect((await post(h, { Authorization: h.bearer }, "By the key, no session")).status).toBe(201);
    await openHumanSession(h, "dana");
    expect((await post(h, { Authorization: h.bearer }, "By the key, session open")).status).toBe(201);
    expect(auditActors(h.dbPath).map((r) => r.actor)).toEqual(["ci-bot", "ci-bot"]);
  });
});

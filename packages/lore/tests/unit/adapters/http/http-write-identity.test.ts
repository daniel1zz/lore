/**
 * AC-HID-6 — HTTP writes name their key or their login
 * (spec-every-write-is-made-by-a-known-party-an-attested-agent-run end state 3-4; BR-1055, BR-1032).
 *
 * Contract under test, through a REAL `startHttpServer` over a REAL `createApp` corpus file:
 *   - a bearer-key write is recorded with the KEY's name and source `api-key`, under an `api-key` run of that key;
 *   - a dashboard cookie write is recorded with the logged-in person and source `dashboard`, under a `dashboard` run;
 *   - neither depends on the `lore serve` process's own identity: the same writes succeed when that process has NO
 *     known party at all, and when it IS a different agent run, no row carries that run or its name;
 *   - the same key (or person) reuses ONE run across writes; a read registers nothing; an unauthenticated write is
 *     refused (401) and writes nothing.
 *
 * Dimensions: HAPPY (bearer, cookie), NEGATIVE (no credentials), STATE (run reuse, reads register nothing),
 * BOUNDARY (a serve process with no party; a serve process that is another run), REGRESSION (a write through the
 * server still lands its document).
 *
 * MOCK RISK: none — no stubs. The cookie session is minted in the machine-scope store exactly as the dashboard's
 * bootstrap does (`SessionStore.create`), the key through `ApiKeyStore.create`.
 *
 * @spec_ref AC-HID-6
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InvocationIdentity } from "@lore/core";
import { createApp } from "../../../../src/app.js";
import type { App } from "../../../../src/app.js";
import { startHttpServer } from "../../../../src/adapters/http/index.js";
import { createMachineAuthStores } from "../../../../src/adapters/http/machine-auth.js";
import { liveAmbient, liveIo } from "../../../live-invocation.js";
import { registerTestRun } from "../../../helpers/test-run-identity.js";

interface Harness {
  readonly dir: string;
  readonly dbPath: string;
  readonly app: App;
  readonly server: ReturnType<typeof startHttpServer>;
  readonly baseUrl: string;
  readonly bearer: string;
  readonly cookie: string;
}

/** A serve process whose OWN identity is another agent run (registered): the thing a request must never inherit. */
const SERVE_RUN = "cc:serve-process-session";
const SERVE_RUN_NAME = "agent:session-serve-pr";

interface AuditRow {
  actor: string;
  action: string;
  harness_run: string | null;
  details: Record<string, unknown>;
}

function auditRows(dbPath: string): AuditRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.query("SELECT actor, action, harness_run, details FROM audit ORDER BY id").all() as Array<{
      actor: string;
      action: string;
      harness_run: string | null;
      details: string | null;
    }>;
    return rows.map((r) => ({ ...r, details: r.details === null ? {} : (JSON.parse(r.details) as Record<string, unknown>) }));
  } finally {
    db.close();
  }
}

function runIds(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.query("SELECT id FROM runs ORDER BY id").all() as Array<{ id: string }>).map((r) => r.id);
  } finally {
    db.close();
  }
}

async function post(h: Harness, headers: Record<string, string>, title: string): Promise<Response> {
  return fetch(`${h.baseUrl}/api/docs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ type: "knowledge", title, content: "body", extra: { sub_type: "reference" } }),
  });
}

const cases: ReadonlyArray<{ readonly label: string; readonly serveIdentity: () => InvocationIdentity }> = [
  {
    label: "the serve process has NO known party",
    serveIdentity: () => ({ harnessRun: null, claimed: null, claimedSource: null, unresolvedReason: "the serve process has no known party" }),
  },
  {
    label: "the serve process is a different agent run",
    serveIdentity: () => ({ harnessRun: SERVE_RUN as InvocationIdentity["harnessRun"] & string, claimed: SERVE_RUN_NAME, claimedSource: "run" }),
  },
];

describe.each(cases)("AC-HID-6: HTTP writes name their key or login ($label)", ({ serveIdentity }) => {
  let h: Harness;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    // reason: the serve process's ambient identity inputs are set to loud values; no request may ever pick them up.
    for (const name of ["CLAUDE_CODE_SESSION_ID", "USER", "LOGNAME"]) savedEnv[name] = process.env[name];
    process.env["CLAUDE_CODE_SESSION_ID"] = "serve-env-session-0000";
    process.env["USER"] = "serve-os-user";
    process.env["LOGNAME"] = "serve-os-user";

    const dir = realpathSync(mkdtempSync(join(tmpdir(), "hid6-")));
    mkdirSync(join(dir, ".lore"), { recursive: true });
    const dbPath = join(dir, ".lore", "lore.db");
    const identity = serveIdentity();
    const app = createApp(dbPath, undefined, liveAmbient(), { identity }) as App;
    if (identity.harnessRun !== null) registerTestRun(dir, identity.harnessRun);

    const key = await app.apiKeyStore.create("ci-bot", "owner-of-ci-bot");
    if (!key.ok) throw new Error(`api key: ${JSON.stringify(key.error)}`);
    // reason: SPEC-078 D1 — cookie sessions live in the MACHINE-scope store; its base dir is a throwaway.
    const machineAuth = createMachineAuthStores({ baseDir: join(dir, "machine-auth") });
    const dashboardKey = await machineAuth.apiKeyStore.create("dashboard-local", "dana");
    if (!dashboardKey.ok) throw new Error(`dashboard key: ${JSON.stringify(dashboardKey.error)}`);
    const session = machineAuth.sessionStore.create("dashboard-local");

    const server = startHttpServer(app, { io: liveIo(), port: 0, host: "127.0.0.1", machineAuth });
    h = {
      dir,
      dbPath,
      app,
      server,
      baseUrl: `http://127.0.0.1:${server.port}`,
      bearer: `Bearer ${key.value.rawKey}`,
      cookie: `lore_sid=${session.session_id}`,
    };
  });

  afterEach(() => {
    h.server.stop(true);
    h.app.close();
    rmSync(h.dir, { recursive: true, force: true });
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("a bearer-key write is recorded with the key's name, source api-key, and the key's run", async () => {
    const response = await post(h, { Authorization: h.bearer }, "Written by the key");
    expect(response.status).toBe(201);
    const rows = auditRows(h.dbPath).filter((r) => r.action === "create");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe("ci-bot");
    expect(rows[0]?.harness_run).toBe("api-key:ci-bot");
    expect(rows[0]?.details["name_source"]).toBe("api-key");
  });

  it("a dashboard cookie write is recorded with the logged-in person, source dashboard, and the login's run", async () => {
    const response = await post(h, { Cookie: h.cookie }, "Written by the login");
    expect(response.status).toBe(201);
    const rows = auditRows(h.dbPath).filter((r) => r.action === "create");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe("dana");
    expect(rows[0]?.harness_run).toBe("dashboard:dana");
    expect(rows[0]?.details["name_source"]).toBe("dashboard");
  });

  it("neither write carries the serve process's run, session, user or name", async () => {
    expect((await post(h, { Authorization: h.bearer }, "By key, serve ambient loud")).status).toBe(201);
    expect((await post(h, { Cookie: h.cookie }, "By login, serve ambient loud")).status).toBe(201);
    const text = JSON.stringify(auditRows(h.dbPath).filter((r) => r.action === "create"));
    expect(text).not.toContain(SERVE_RUN);
    expect(text).not.toContain(SERVE_RUN_NAME);
    expect(text).not.toContain("serve-os-user");
    expect(text).not.toContain("serve-env-session");
    expect(text).not.toContain("agent:session-serve-en");
  });

  it("the same key reuses ONE run across writes, and the same person one run of their own", async () => {
    for (const title of ["Key one", "Key two", "Key three"]) expect((await post(h, { Authorization: h.bearer }, title)).status).toBe(201);
    for (const title of ["Login one", "Login two"]) expect((await post(h, { Cookie: h.cookie }, title)).status).toBe(201);
    const ids = runIds(h.dbPath).filter((id) => id.startsWith("api-key:") || id.startsWith("dashboard:"));
    expect(ids).toEqual(["api-key:ci-bot", "dashboard:dana"]);
  });

  it("a read registers no run", async () => {
    const before = runIds(h.dbPath);
    const response = await fetch(`${h.baseUrl}/api/docs`, { headers: { Authorization: h.bearer } });
    expect(response.status).toBe(200);
    expect(runIds(h.dbPath)).toEqual(before);
  });

  it("an unauthenticated write is refused with 401 and writes nothing", async () => {
    const before = auditRows(h.dbPath).length;
    const response = await post(h, {}, "Written by nobody");
    expect(response.status).toBe(401);
    expect(auditRows(h.dbPath)).toHaveLength(before);
  });
});

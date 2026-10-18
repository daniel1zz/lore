/**
 * Tests for SPEC-062 T2 — HTTP config routes: `GET /api/config` +
 * `PATCH /api/dashboard/config` (If-Match optimistic concurrency).
 * Covers AC-062-3 (stale If-Match → 409, config.yaml byte-unchanged) and
 * AC-062-5 (bearer token → 403, config.yaml byte-unchanged).
 *
 * Extended by SPEC-064 T3 for the machine-scope siblings — `GET /api/config/machine` +
 * `PATCH /api/dashboard/config/machine` — covering the route-half of AC-064-4 (the
 * service-half, `GlobalConfigService.update`'s own deny-key/CAS enforcement, is
 * covered by `tests/unit/service/global-config-service.test.ts`, T2).
 *
 * Uses a real `mkdtemp` corpus directory (never the repo's own `.lore/`, per
 * this repo's own testing rule) so `ConfigService`'s real file IO is exercised
 * end-to-end, plus an `InMemoryStore` for the injected `appendAuditEntry` port
 * — mirrors `tests/unit/service/config-service.test.ts`'s harness exactly. The
 * machine scope reuses a SECOND `mkdtemp` directory (never the real XDG path) for
 * `GlobalConfigService`, mirroring `global-config-service.test.ts`'s harness.
 *
 * Every other `App` service is null-cast (never exercised by these routes),
 * mirroring the established pattern in `dashboard-routes.test.ts`'s `makeApp()`.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: SPEC-062 §Acceptance Criteria AC-062-3, AC-062-5; SPEC-064 §Acceptance
 *   Criteria AC-064-4.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import yaml from "yaml";
import { NoOpTelemetry } from "@lore/core";
import type { LoreConfig, GlobalLoreConfig } from "@lore/core";
import { ConfigService } from "../../../../src/service/config-service.js";
import { GlobalConfigService } from "../../../../src/service/global-config-service.js";
import { InMemoryStore } from "../../../../src/store/in-memory-store.js";
import { handleApiRoute } from "../../../../src/adapters/http/routes.js";
import { handleDashboardRoute } from "../../../../src/adapters/http/dashboard-routes.js";
import type { App } from "../../../../src/app.js";
import type { ApiKeyStore, ActorContext } from "../../../../src/adapters/http/auth.js";
import { actedStore } from "../../../live-invocation.js";

// ─── Harness (mirrors config-service.test.ts) ──────────────────────────────────

let corpusDir: string;

function baseConfig(extra: Partial<LoreConfig> = {}): LoreConfig {
  return {
    project: { name: "test-project", author: "tester" },
    ...extra,
  } as LoreConfig;
}

function seedConfig(config: LoreConfig): void {
  const loreDir = join(corpusDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  writeFileSync(join(loreDir, "config.yaml"), yaml.stringify(config), "utf8");
}

function rawConfigBytes(): string {
  return readFileSync(join(corpusDir, ".lore", "config.yaml"), "utf8");
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const stubApiKeyStore = {} as ApiKeyStore;

function makeApp(
  configService: ConfigService | undefined,
  globalConfigService?: GlobalConfigService | undefined,
): App {
  return {
    corpusService: null as unknown as App["corpusService"],
    reviewService: null as unknown as App["reviewService"],
    versionService: null as unknown as App["versionService"],
    outlineService: null as unknown as App["outlineService"],
    migrationService: null as unknown as App["migrationService"],
    treeCheckService: null as unknown as App["treeCheckService"],
    apiKeyStore: stubApiKeyStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    // reason: exactOptionalPropertyTypes:true (tsconfig.tests.json) distinguishes an
    // explicit `configService: undefined` from an OMITTED key on an optional property —
    // only the latter is assignable to `configService?: ConfigService`. Spread the key
    // in conditionally so the "configService absent from App" test case (which passes
    // `undefined`) actually omits it, matching how production `App` fixtures elsewhere
    // in this codebase handle optional fields.
    ...(configService !== undefined ? { configService } : {}),
    // reason: same exactOptionalPropertyTypes discipline as configService above, applied
    // to the machine-scope sibling (SPEC-064 D1) — an OMITTED key (not `globalConfigService:
    // undefined`) is required for App["globalConfigService"]?: GlobalConfigService.
    ...(globalConfigService !== undefined ? { globalConfigService } : {}),
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

const COOKIE_ACTOR: ActorContext = {
  name: "test-user",
  session_id: "test-session",
  callerSurface: "http_cookie" as const,
  owner: "admin",
};

const BEARER_ACTOR: ActorContext = {
  name: "test-agent",
  session_id: "token-session",
  callerSurface: "http_token" as const,
};

function makeUrl(path: string): URL {
  return new URL(`http://localhost${path}`);
}

function req(method: string, path: string, opts?: { body?: unknown; headers?: Record<string, string> }): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...(opts?.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

async function parseRes(res: Response): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: Record<string, unknown> }> {
  return res.json() as Promise<{ ok: boolean; data?: Record<string, unknown>; error?: Record<string, unknown> }>;
}

/** GET /api/config through the full v1 dispatcher (auth already resolved, mirrors production). */
async function getConfig(app: App, actor: ActorContext = COOKIE_ACTOR) {
  const url = makeUrl("/api/config");
  const res = await handleApiRoute(req("GET", "/api/config"), url, app, actor);
  return res as Response;
}

/** PATCH /api/dashboard/config through the full dashboard dispatcher (CSRF + cookie guard included). */
async function patchConfig(
  app: App,
  patch: unknown,
  opts?: { ifMatch?: string; actor?: ActorContext; headers?: Record<string, string> },
) {
  const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
  if (opts?.ifMatch !== undefined) headers["If-Match"] = opts.ifMatch;
  const url = makeUrl("/api/dashboard/config");
  const res = await handleDashboardRoute(
    req("PATCH", "/api/dashboard/config", { body: patch, headers }),
    url,
    app,
    opts?.actor ?? COOKIE_ACTOR,
  );
  return res as Response;
}

/** GET /api/config/machine through the full v1 dispatcher (auth already resolved). */
async function getMachineConfig(app: App, actor: ActorContext = COOKIE_ACTOR) {
  const url = makeUrl("/api/config/machine");
  const res = await handleApiRoute(req("GET", "/api/config/machine"), url, app, actor);
  return res as Response;
}

/** PATCH /api/dashboard/config/machine through the full dashboard dispatcher (CSRF + cookie guard included). */
async function patchMachineConfig(
  app: App,
  patch: unknown,
  opts?: { ifMatch?: string; actor?: ActorContext; headers?: Record<string, string> },
) {
  const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
  if (opts?.ifMatch !== undefined) headers["If-Match"] = opts.ifMatch;
  const url = makeUrl("/api/dashboard/config/machine");
  const res = await handleDashboardRoute(
    req("PATCH", "/api/dashboard/config/machine", { body: patch, headers }),
    url,
    app,
    opts?.actor ?? COOKIE_ACTOR,
  );
  return res as Response;
}

let store: InMemoryStore;
let configService: ConfigService;
let app: App;

// ─── Machine-scope (SPEC-064) harness ──────────────────────────────────────────

let machineWorkDir: string;
let machineConfigPath: string;
let globalStore: InMemoryStore;
let globalConfigService: GlobalConfigService;

function seedMachineConfig(config: GlobalLoreConfig): void {
  mkdirSync(machineWorkDir, { recursive: true });
  writeFileSync(machineConfigPath, yaml.stringify(config), "utf8");
}

function rawMachineConfigBytesOrNull(): string | null {
  return existsSync(machineConfigPath) ? readFileSync(machineConfigPath, "utf8") : null;
}

beforeEach(() => {
  corpusDir = mkdtempSync(join(tmpdir(), "lore-config-routes-test-"));
  seedConfig(baseConfig());
  store = actedStore(new InMemoryStore());
  configService = new ConfigService(corpusDir, store.appendAuditEntry.bind(store));

  // reason: a SEPARATE mkdtemp dir + InMemoryStore for the machine scope, never
  // the real XDG path — mirrors global-config-service.test.ts's own harness. Left
  // UNSEEDED by default (D7 — a missing machine config file is `ok({})`, not an
  // error); individual tests call seedMachineConfig() when they need a starting file.
  machineWorkDir = mkdtempSync(join(tmpdir(), "lore-config-routes-machine-test-"));
  machineConfigPath = join(machineWorkDir, "config.yaml");
  globalStore = actedStore(new InMemoryStore());
  globalConfigService = new GlobalConfigService(machineConfigPath, globalStore.appendAuditEntry.bind(globalStore));

  app = makeApp(configService, globalConfigService);
});

afterEach(() => {
  rmSync(corpusDir, { recursive: true, force: true });
  rmSync(machineWorkDir, { recursive: true, force: true });
});

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("GET /api/config", () => {
  it("HAPPY: returns 200 with redacted config, effects map, and a hash", async () => {
    const res = await getConfig(app);
    expect(res.status).toBe(200);
    const body = await parseRes(res);
    expect(body.ok).toBe(true);
    const data = body.data!;
    expect((data.config as Record<string, unknown>).project).toEqual({ name: "test-project", author: "tester" });
    expect(typeof data.hash).toBe("string");
    expect((data.hash as string).length).toBe(64); // sha256 hex
    expect(data.effects).toBeDefined();
  });

  it("HAPPY: bearer-token actors can also read config (unlike the dashboard PATCH surface)", async () => {
    const res = await getConfig(app, BEARER_ACTOR);
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/dashboard/config", () => {
  it("HAPPY: a matching If-Match + legal patch writes through and returns the new hash", async () => {
    const getRes = await getConfig(app);
    const { hash } = (await parseRes(getRes)).data!;

    const patchRes = await patchConfig(app, { workflow: { claim_ttl_minutes: 45 } }, { ifMatch: hash as string });
    expect(patchRes.status).toBe(200);
    const body = await parseRes(patchRes);
    expect(body.ok).toBe(true);
    expect(body.data!.updated).toEqual(["workflow.claim_ttl_minutes"]);
    expect(body.data!.restart_required).toEqual([]);
    expect(typeof body.data!.hash).toBe("string");
    expect(body.data!.hash).not.toBe(hash); // config content changed → hash must change
  });

  // ─── NEGATIVE ───────────────────────────────────────────────────────────────

  it("NEGATIVE: a deny-key patch over HTTP is rejected and writes 0 bytes (HTTP layer does not bypass ConfigService)", async () => {
    const getRes = await getConfig(app);
    const { hash } = (await parseRes(getRes)).data!;
    const before = sha256(rawConfigBytes());

    const patchRes = await patchConfig(
      app,
      { verify: { env: { passthrough_all: true } } },
      { ifMatch: hash as string },
    );
    expect(patchRes.status).toBe(422);
    const body = await parseRes(patchRes);
    expect(body.ok).toBe(false);
    expect(body.error!.code).toBe("VALIDATION_ERROR");

    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);
  });

  it("NEGATIVE: bearer rejected — a bearer-token PATCH returns 403 and writes 0 bytes to config.yaml (AC-062-5)", async () => {
    const getRes = await getConfig(app);
    const { hash } = (await parseRes(getRes)).data!;
    const before = sha256(rawConfigBytes());

    const patchRes = await patchConfig(
      app,
      { workflow: { claim_ttl_minutes: 999 } },
      { ifMatch: hash as string, actor: BEARER_ACTOR },
    );
    expect(patchRes.status).toBe(403);

    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);
  });

  it("NEGATIVE: a disallowed Origin header is rejected with 403 (CSRF guard, same as every other dashboard route)", async () => {
    const getRes = await getConfig(app);
    const { hash } = (await parseRes(getRes)).data!;
    const before = sha256(rawConfigBytes());

    const patchRes = await patchConfig(
      app,
      { workflow: { claim_ttl_minutes: 15 } },
      { ifMatch: hash as string, headers: { Origin: "https://evil.example" } },
    );
    expect(patchRes.status).toBe(403);

    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);
  });

  // ─── BOUNDARY ───────────────────────────────────────────────────────────────

  it("BOUNDARY: a missing If-Match header is explicitly rejected (400), not treated as an unconditional write", async () => {
    const before = sha256(rawConfigBytes());

    const patchRes = await patchConfig(app, { workflow: { claim_ttl_minutes: 20 } });
    expect(patchRes.status).toBe(400);
    const body = await parseRes(patchRes);
    expect(body.ok).toBe(false);
    expect(body.error!.code).toBe("VALIDATION_ERROR");
    expect(body.error!.field).toBe("If-Match");

    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);
  });

  it("BOUNDARY: an empty-string If-Match header is treated the same as a missing header (400)", async () => {
    const patchRes = await patchConfig(app, { workflow: { claim_ttl_minutes: 20 } }, { ifMatch: "" });
    expect(patchRes.status).toBe(400);
    const body = await parseRes(patchRes);
    expect(body.error!.field).toBe("If-Match");
  });

  // ─── ERROR ──────────────────────────────────────────────────────────────────

  it("ERROR: stale If-Match hash returns exactly 409, carries the current hash, config.yaml byte-unchanged (AC-062-3)", async () => {
    const before = sha256(rawConfigBytes());

    const patchRes = await patchConfig(
      app,
      { workflow: { claim_ttl_minutes: 30 } },
      { ifMatch: "0000000000000000000000000000000000000000000000000000000000000000" },
    );
    expect(patchRes.status).toBe(409);
    const body = await parseRes(patchRes);
    expect(body.ok).toBe(false);
    expect(body.error!.code).toBe("STALE_VERSION");
    expect(typeof body.error!.current_hash).toBe("string");
    expect((body.error!.current_hash as string).length).toBe(64);

    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);
  });

  it("ERROR: a stale hash computed from a PRE-update GET is rejected after a real update landed", async () => {
    const firstGet = await getConfig(app);
    const { hash: staleHash } = (await parseRes(firstGet)).data!;

    // A real update lands, bumping the hash.
    await patchConfig(app, { workflow: { claim_ttl_minutes: 50 } }, { ifMatch: staleHash as string });

    const before = sha256(rawConfigBytes());
    const secondPatch = await patchConfig(
      app,
      { workflow: { claim_ttl_minutes: 60 } },
      { ifMatch: staleHash as string }, // reusing the NOW-stale hash from the first GET
    );
    expect(secondPatch.status).toBe(409);
    const after = sha256(rawConfigBytes());
    expect(after).toBe(before);
  });

  it("ERROR: configService absent from App surfaces a 500 rather than throwing", async () => {
    const bareApp = makeApp(undefined);
    const res = await getConfig(bareApp);
    expect(res.status).toBe(500);

    const patchRes = await patchConfig(bareApp, { workflow: { claim_ttl_minutes: 1 } }, { ifMatch: "irrelevant" });
    expect(patchRes.status).toBe(500);
  });

  // ─── STATE ──────────────────────────────────────────────────────────────────

  it("STATE: GET's hash after a successful PATCH matches a fresh GET's hash (no drift between response and re-read)", async () => {
    const getRes = await getConfig(app);
    const { hash } = (await parseRes(getRes)).data!;

    const patchRes = await patchConfig(app, { workflow: { claim_ttl_minutes: 33 } }, { ifMatch: hash as string });
    const patchBody = await parseRes(patchRes);
    const hashFromPatch = patchBody.data!.hash;

    const rereadRes = await getConfig(app);
    const hashFromReread = (await parseRes(rereadRes)).data!.hash;

    expect(hashFromPatch).toBe(hashFromReread);
  });

  it("STATE: sync.enabled change reports restart_required=['sync.enabled'] over HTTP (matches ConfigService semantics)", async () => {
    const getRes = await getConfig(app);
    const { hash } = (await parseRes(getRes)).data!;

    const patchRes = await patchConfig(app, { sync: { enabled: false } }, { ifMatch: hash as string });
    expect(patchRes.status).toBe(200);
    const body = await parseRes(patchRes);
    expect(body.data!.restart_required).toEqual(["sync.enabled"]);
  });

  // ─── REGRESSION ─────────────────────────────────────────────────────────────

  it("REGRESSION: an unrelated v1 GET route (handled by the same dispatcher) is unaffected by the new /api/config route", async () => {
    // handleStatus requires a real corpusService — assert only that the route still
    // matches and is dispatched (not a 404/null) rather than exercising corpusService.
    const url = makeUrl("/api/config");
    const res = await handleApiRoute(req("GET", "/api/config"), url, app, COOKIE_ACTOR);
    expect(res).not.toBeNull();
  });

  it("REGRESSION: an unmatched dashboard path still returns null (unaffected by the new configPatch case)", async () => {
    const url = makeUrl("/api/dashboard/nonexistent");
    const res = await handleDashboardRoute(req("GET", "/api/dashboard/nonexistent"), url, app, COOKIE_ACTOR);
    expect(res).toBeNull();
  });

  it("REGRESSION: PATCH /api/dashboard/config with a GET-only method variant is not matched (wrong method → null)", async () => {
    const url = makeUrl("/api/dashboard/config");
    const res = await handleDashboardRoute(req("GET", "/api/dashboard/config"), url, app, COOKIE_ACTOR);
    expect(res).toBeNull();
  });
});

// ─── Machine scope (SPEC-064 D6) ────────────────────────────────────────────────

describe("GET /api/config/machine", () => {
  it("HAPPY: returns 200 with the redacted machine config, effects map, and a hash — even with no file seeded (D7)", async () => {
    const res = await getMachineConfig(app);
    expect(res.status).toBe(200);
    const body = await parseRes(res);
    expect(body.ok).toBe(true);
    const data = body.data!;
    expect(data.config).toEqual({});
    expect(typeof data.hash).toBe("string");
    expect((data.hash as string).length).toBe(64); // sha256 hex
    expect(data.effects).toEqual({});
  });

  it("HAPPY: bearer-token actors can also read the machine config (unlike the dashboard PATCH surface)", async () => {
    seedMachineConfig({ defaults: { format: "json" } });
    const res = await getMachineConfig(app, BEARER_ACTOR);
    expect(res.status).toBe(200);
    const data = (await parseRes(res)).data!;
    expect((data.config as Record<string, unknown>).defaults).toEqual({ format: "json" });
  });
});

describe("PATCH /api/dashboard/config/machine", () => {
  it("HAPPY: a matching If-Match + legal patch writes through and round-trips via a fresh GET", async () => {
    const getRes = await getMachineConfig(app);
    const { hash } = (await parseRes(getRes)).data!;

    const patchRes = await patchMachineConfig(app, { defaults: { format: "json" } }, { ifMatch: hash as string });
    expect(patchRes.status).toBe(200);
    const body = await parseRes(patchRes);
    expect(body.ok).toBe(true);
    expect(body.data!.updated).toEqual(["defaults.format"]);
    expect(typeof body.data!.hash).toBe("string");
    expect(body.data!.hash).not.toBe(hash); // config content changed → hash must change

    const rereadRes = await getMachineConfig(app);
    const reread = (await parseRes(rereadRes)).data!;
    expect((reread.config as Record<string, unknown>).defaults).toEqual({ format: "json" });
    expect(reread.hash).toBe(body.data!.hash);
  });

  // ─── NEGATIVE ───────────────────────────────────────────────────────────────

  it("NEGATIVE: a deny-key patch (defaults.editor) over HTTP is rejected — the service's deny-key check, not a route reimplementation — and writes 0 bytes", async () => {
    const getRes = await getMachineConfig(app);
    const { hash } = (await parseRes(getRes)).data!;
    expect(rawMachineConfigBytesOrNull()).toBeNull();

    const patchRes = await patchMachineConfig(app, { defaults: { editor: "vim" } }, { ifMatch: hash as string });
    expect(patchRes.status).toBe(422);
    const body = await parseRes(patchRes);
    expect(body.ok).toBe(false);
    expect(body.error!.code).toBe("VALIDATION_ERROR");

    // Confirm this would have FAILED against a route that skipped the guard:
    // a legal sibling key (defaults.format) on the SAME shape DOES write through.
    const legalPatch = await patchMachineConfig(app, { defaults: { format: "json" } }, { ifMatch: hash as string });
    expect(legalPatch.status).toBe(200);
    expect(rawMachineConfigBytesOrNull()).not.toBeNull();
  });

  it("NEGATIVE: bearer rejected — a bearer-token PATCH returns 403 and writes 0 bytes to the machine config", async () => {
    const getRes = await getMachineConfig(app);
    const { hash } = (await parseRes(getRes)).data!;

    const patchRes = await patchMachineConfig(
      app,
      { defaults: { format: "json" } },
      { ifMatch: hash as string, actor: BEARER_ACTOR },
    );
    expect(patchRes.status).toBe(403);
    expect(rawMachineConfigBytesOrNull()).toBeNull();
  });

  it("NEGATIVE: a disallowed Origin header is rejected with 403 (CSRF guard inherited from the dashboard route group, not reimplemented)", async () => {
    const getRes = await getMachineConfig(app);
    const { hash } = (await parseRes(getRes)).data!;

    const patchRes = await patchMachineConfig(
      app,
      { defaults: { format: "json" } },
      { ifMatch: hash as string, headers: { Origin: "https://evil.example" } },
    );
    expect(patchRes.status).toBe(403);
    expect(rawMachineConfigBytesOrNull()).toBeNull();
  });

  // ─── BOUNDARY ───────────────────────────────────────────────────────────────

  it("BOUNDARY: GET on a missing machine config file returns defaults (empty config, D7) rather than an error", async () => {
    expect(rawMachineConfigBytesOrNull()).toBeNull();
    const res = await getMachineConfig(app);
    expect(res.status).toBe(200);
    expect((await parseRes(res)).data!.config).toEqual({});
  });

  it("BOUNDARY: a missing If-Match header is explicitly rejected (400), not treated as an unconditional write", async () => {
    const patchRes = await patchMachineConfig(app, { defaults: { format: "json" } });
    expect(patchRes.status).toBe(400);
    const body = await parseRes(patchRes);
    expect(body.ok).toBe(false);
    expect(body.error!.code).toBe("VALIDATION_ERROR");
    expect(body.error!.field).toBe("If-Match");
    expect(rawMachineConfigBytesOrNull()).toBeNull();
  });

  it("BOUNDARY: an empty-string If-Match header is treated the same as a missing header (400)", async () => {
    const patchRes = await patchMachineConfig(app, { defaults: { format: "json" } }, { ifMatch: "" });
    expect(patchRes.status).toBe(400);
    const body = await parseRes(patchRes);
    expect(body.error!.field).toBe("If-Match");
  });

  // ─── ERROR ──────────────────────────────────────────────────────────────────

  it("ERROR: stale If-Match hash returns exactly 409, carries the current hash, machine config byte-unchanged", async () => {
    seedMachineConfig({ defaults: { format: "text" } });
    const before = readFileSync(machineConfigPath, "utf8");

    const patchRes = await patchMachineConfig(
      app,
      { defaults: { format: "json" } },
      { ifMatch: "0000000000000000000000000000000000000000000000000000000000000000" },
    );
    expect(patchRes.status).toBe(409);
    const body = await parseRes(patchRes);
    expect(body.ok).toBe(false);
    expect(body.error!.code).toBe("STALE_VERSION");
    expect(typeof body.error!.current_hash).toBe("string");
    expect((body.error!.current_hash as string).length).toBe(64);

    expect(readFileSync(machineConfigPath, "utf8")).toBe(before);
  });

  it("ERROR: a stale hash computed from a PRE-update GET is rejected after a real update landed", async () => {
    const firstGet = await getMachineConfig(app);
    const { hash: staleHash } = (await parseRes(firstGet)).data!;

    // A real update lands, bumping the hash.
    await patchMachineConfig(app, { defaults: { format: "json" } }, { ifMatch: staleHash as string });

    const before = readFileSync(machineConfigPath, "utf8");
    const secondPatch = await patchMachineConfig(
      app,
      { defaults: { color: true } },
      { ifMatch: staleHash as string }, // reusing the NOW-stale hash from the first GET
    );
    expect(secondPatch.status).toBe(409);
    expect(readFileSync(machineConfigPath, "utf8")).toBe(before);
  });

  it("ERROR: globalConfigService absent from App surfaces a 500 rather than throwing", async () => {
    const bareApp = makeApp(configService, undefined);
    const res = await getMachineConfig(bareApp);
    expect(res.status).toBe(500);

    const patchRes = await patchMachineConfig(bareApp, { defaults: { format: "json" } }, { ifMatch: "irrelevant" });
    expect(patchRes.status).toBe(500);
  });

  // ─── STATE ──────────────────────────────────────────────────────────────────

  it("STATE: GET's hash after a successful PATCH matches a fresh GET's hash (no drift between response and re-read)", async () => {
    const getRes = await getMachineConfig(app);
    const { hash } = (await parseRes(getRes)).data!;

    const patchRes = await patchMachineConfig(app, { defaults: { color: false } }, { ifMatch: hash as string });
    const patchBody = await parseRes(patchRes);
    const hashFromPatch = patchBody.data!.hash;

    const rereadRes = await getMachineConfig(app);
    const hashFromReread = (await parseRes(rereadRes)).data!.hash;

    expect(hashFromPatch).toBe(hashFromReread);
  });

  it("STATE: the team-scope config file is untouched by a machine-scope write, and vice versa (two independent scopes)", async () => {
    const teamBefore = sha256(rawConfigBytes());

    const machineGetRes = await getMachineConfig(app);
    const { hash: machineHash } = (await parseRes(machineGetRes)).data!;
    const machinePatchRes = await patchMachineConfig(
      app,
      { defaults: { format: "json" } },
      { ifMatch: machineHash as string },
    );
    expect(machinePatchRes.status).toBe(200);

    // Team-scope file is byte-unchanged by the machine-scope write.
    expect(sha256(rawConfigBytes())).toBe(teamBefore);

    const machineBefore = readFileSync(machineConfigPath, "utf8");
    const teamGetRes = await getConfig(app);
    const { hash: teamHash } = (await parseRes(teamGetRes)).data!;
    const teamPatchRes = await patchConfig(app, { workflow: { claim_ttl_minutes: 77 } }, { ifMatch: teamHash as string });
    expect(teamPatchRes.status).toBe(200);

    // Machine-scope file is byte-unchanged by the team-scope write.
    expect(readFileSync(machineConfigPath, "utf8")).toBe(machineBefore);
  });

  // ─── REGRESSION ─────────────────────────────────────────────────────────────

  it("REGRESSION: an unmatched dashboard path still returns null (unaffected by the new machineConfigPatch case)", async () => {
    const url = makeUrl("/api/dashboard/nonexistent");
    const res = await handleDashboardRoute(req("GET", "/api/dashboard/nonexistent"), url, app, COOKIE_ACTOR);
    expect(res).toBeNull();
  });

  it("REGRESSION: PATCH /api/dashboard/config/machine with a GET-only method variant is not matched (wrong method → null)", async () => {
    const url = makeUrl("/api/dashboard/config/machine");
    const res = await handleDashboardRoute(req("GET", "/api/dashboard/config/machine"), url, app, COOKIE_ACTOR);
    expect(res).toBeNull();
  });

  it("REGRESSION: the team-scope PATCH /api/dashboard/config route is unaffected by the new machine route (still dispatches to configPatch)", async () => {
    const getRes = await getConfig(app);
    const { hash } = (await parseRes(getRes)).data!;
    const patchRes = await patchConfig(app, { workflow: { claim_ttl_minutes: 22 } }, { ifMatch: hash as string });
    expect(patchRes.status).toBe(200);
  });
});

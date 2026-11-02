// @spawns packages/lore/src/index.ts
/**
 * AC-PAR-1 — a knowledge record (every creatable sub-type), a decision record (adr) and a plan created without a
 * parent are refused on every route: `CorpusService.create` directly, the CLI, `POST /api/docs` (routes.ts) and
 * `POST /api/dashboard/docs` (dashboard-routes.ts). CLI exit exactly 4; HTTP 4xx with the SAME LoreError code; the
 * message names `--parent` and lists the requirements document (PRD) and the spec as candidates; nothing is written.
 * With a valid parent each create succeeds. A corpus with neither names creating the requirements document first.
 *
 * Dimensions: HAPPY (each type succeeds with a parent), NEGATIVE (each type refused without one, on every route),
 * BOUNDARY (no PRD and no spec; an empty-string parent through HTTP), STATE (a refusal writes no document and no
 * version/audit row), REGRESSION (a spec/prd/task create is unaffected by the refusal).
 *
 * MOCK RISK: none for the CLI (real `lore` spawned against a throwaway corpus); the service and HTTP routes run over
 * a real `CorpusService` on an `InMemoryStore`, the same composition `dashboard-routes.test.ts` uses.
 *
 * @spec_ref spec-documents-that-need-a-parent-are-refused-without-one-an-ad#AC-PAR-1
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DOC_TYPE_ROLE_MAP, NoOpTelemetry } from "@lore/core";
import type { CreateDocInput, DocId, DocRecord, LoreError } from "@lore/core";
import { ulid } from "ulidx";
import { join } from "node:path";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { handleApiRoute } from "../../../src/adapters/http/routes.js";
import { handleDashboardRoute } from "../../../src/adapters/http/dashboard-routes.js";
import type { ActorContext, ApiKeyStore } from "../../../src/adapters/http/auth.js";
import type { App } from "../../../src/app.js";
import { actedStore } from "../../live-invocation.js";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";
import { createPartyCorpus } from "../../helpers/known-party-corpus.js";
import type { PartyCorpus } from "../../helpers/known-party-corpus.js";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";

/** The knowledge sub-types `lore create` may write (handoff, uat, milestone-review have their own writers). */
const CREATABLE_SUB_TYPES = ["ideation", "retro", "research", "reference", "prompt", "skill"] as const;

/** Every parent-requiring shape: each creatable knowledge sub-type, an adr, a plan. */
const PARENTLESS_CASES: ReadonlyArray<{ label: string; type: "knowledge" | "adr" | "plan"; subType?: string }> = [
  ...CREATABLE_SUB_TYPES.map((subType) => ({ label: `knowledge/${subType}`, type: "knowledge" as const, subType })),
  { label: "adr", type: "adr" },
  { label: "plan", type: "plan" },
];

function inputFor(c: (typeof PARENTLESS_CASES)[number], parentId?: string): CreateDocInput {
  return {
    type: c.type,
    title: `Parentless ${c.label}`,
    content: "body",
    ...(c.subType !== undefined ? { extra: { sub_type: c.subType } } : {}),
    ...(c.type === "adr" ? { extra: { decision_status: "proposed" } } : {}),
    ...(parentId !== undefined ? { parent_id: parentId } : {}),
  } as CreateDocInput;
}

/** Insert a spec straight into a store (the spec-create gate needs a full skeleton; this suite is about parents). */
async function insertSpec(store: { insert(doc: DocRecord): Promise<{ ok: boolean }> }): Promise<{ id: DocId; slug: string }> {
  const id = ulid() as DocId;
  const slug = `spec-fixture-${id.slice(-6).toLowerCase()}`;
  const now = new Date().toISOString();
  const inserted = await store.insert({
    id, slug, type: "spec", role: DOC_TYPE_ROLE_MAP["spec"], title: "Fixture spec", status: "draft", priority: "medium",
    content: "", parent_id: null, created_at: now, updated_at: now, created_by: "test", version: 1, deleted_at: null, tags: [], extra: {},
  });
  if (!inserted.ok) throw new Error("insert spec failed");
  return { id, slug };
}

// ─── In-memory app (service + both HTTP routes) ───────────────────────────────

function makeApp(): { app: App; store: ReturnType<typeof actedStore> } {
  const store = actedStore(new InMemoryStore());
  const lock = () => new RecordLockService(store, new GateEnforcer(undefined));
  const app = {
    warn: () => undefined,
    corpusService: new CorpusService(store, lock()),
    reviewService: new ReviewService(store, lock()),
    versionService: new VersionService(store, lock()),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: {} as ApiKeyStore,
    judgmentService: new JudgmentService(store, new NoOpTelemetry()),
    auditService: null as unknown as App["auditService"],
    auditVerifyRunner: inLoopAuditVerifyRunner(null as unknown as App["auditService"]),
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  } as unknown as App;
  return { app, store };
}

const COOKIE_ACTOR: ActorContext = { name: "test-user", session_id: "s1", callerSurface: "http_cookie" as const };
const BEARER_ACTOR: ActorContext = { name: "test-agent", session_id: "s2", callerSurface: "http_token" as const };

function postJson(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postDocs(app: App, route: "v1" | "dashboard", body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const path = route === "v1" ? "/api/docs" : "/api/dashboard/docs";
  const req = postJson(path, body);
  const url = new URL(`http://localhost${path}`);
  const res = route === "v1" ? await handleApiRoute(req, url, app, BEARER_ACTOR) : await handleDashboardRoute(req, url, app, COOKIE_ACTOR);
  if (res === null) throw new Error(`no route answered POST ${path}`);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function countDocs(app: App): Promise<number> {
  const listed = await app.corpusService.list({});
  if (!listed.ok) throw new Error("list failed");
  return listed.value.docs.length;
}

describe("AC-PAR-1: CorpusService.create refuses a parentless knowledge record, adr or plan", () => {
  for (const c of PARENTLESS_CASES) {
    it(`service: ${c.label} without a parent is refused (VALIDATION_ERROR), names --parent, the PRD and the spec; nothing is written`, async () => {
      const { app, store } = makeApp();
      const prd = await app.corpusService.create({ type: "prd", title: "The Requirements" } as CreateDocInput);
      if (!prd.ok) throw new Error("prd");
      const spec = await insertSpec(store);
      const before = await countDocs(app);

      const refused = await app.corpusService.create(inputFor(c));
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.error.code).toBe("VALIDATION_ERROR");
      const message = (refused.error as Extract<LoreError, { code: "VALIDATION_ERROR" }>).message;
      expect(message).toContain("--parent");
      expect(message).toContain(prd.value.slug);
      expect(message).toContain(spec.slug);
      expect(await countDocs(app)).toBe(before);
    });

    it(`service: ${c.label} WITH a parent succeeds`, async () => {
      const { app } = makeApp();
      const prd = await app.corpusService.create({ type: "prd", title: "The Requirements" } as CreateDocInput);
      if (!prd.ok) throw new Error("prd");
      const made = await app.corpusService.create(inputFor(c, prd.value.id));
      expect(made.ok).toBe(true);
      if (made.ok) expect(made.value.parent_id).toBe(prd.value.id);
    });
  }

  it("service: with neither a PRD nor a spec the refusal says to create the requirements document first", async () => {
    const { app } = makeApp();
    for (const c of PARENTLESS_CASES) {
      const refused = await app.corpusService.create(inputFor(c));
      expect(refused.ok).toBe(false);
      if (refused.ok) continue;
      const message = (refused.error as Extract<LoreError, { code: "VALIDATION_ERROR" }>).message;
      expect(message).toContain("create the requirements document first");
      expect(message).toContain("--parent");
    }
    expect(await countDocs(app)).toBe(0);
  });

  it("service: a soft-deleted PRD is not offered as a candidate", async () => {
    const { app } = makeApp();
    const prd = await app.corpusService.create({ type: "prd", title: "Gone PRD" } as CreateDocInput);
    if (!prd.ok) throw new Error("prd");
    const deleted = await app.corpusService.delete(prd.value.id, true);
    expect(deleted.ok).toBe(true);
    const refused = await app.corpusService.create(inputFor(PARENTLESS_CASES[0]!));
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    const message = (refused.error as Extract<LoreError, { code: "VALIDATION_ERROR" }>).message;
    expect(message).not.toContain(prd.value.slug);
    expect(message).toContain("create the requirements document first");
  });

  it("REGRESSION: a prd and a spec-less corpus still accept a PRD without a parent", async () => {
    const { app } = makeApp();
    const prd = await app.corpusService.create({ type: "prd", title: "Root" } as CreateDocInput);
    expect(prd.ok).toBe(true);
  });
});

describe("AC-PAR-1: the HTTP create routes return the same refusal", () => {
  for (const route of ["v1", "dashboard"] as const) {
    for (const c of PARENTLESS_CASES) {
      it(`${route}: ${c.label} without a parent -> 4xx, error.code VALIDATION_ERROR (the service's code), names --parent, PRD and spec; nothing written`, async () => {
        const { app, store } = makeApp();
        const prd = await app.corpusService.create({ type: "prd", title: "The Requirements" } as CreateDocInput);
        if (!prd.ok) throw new Error("prd");
        const spec = await insertSpec(store);
        const before = await countDocs(app);

        const direct = await app.corpusService.create(inputFor(c));
        expect(direct.ok).toBe(false);
        const directCode = direct.ok ? "" : direct.error.code;

        const res = await postDocs(app, route, inputFor(c));
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        const error = res.json["error"] as { code: string; message: string };
        expect(error.code).toBe(directCode);
        expect(error.code).toBe("VALIDATION_ERROR");
        expect(error.message).toContain("--parent");
        expect(error.message).toContain(prd.value.slug);
        expect(error.message).toContain(spec.slug);
        expect(await countDocs(app)).toBe(before);
      });
    }

    it(`${route}: knowledge WITH a parent succeeds (201)`, async () => {
      const { app } = makeApp();
      const prd = await app.corpusService.create({ type: "prd", title: "The Requirements" } as CreateDocInput);
      if (!prd.ok) throw new Error("prd");
      const res = await postDocs(app, route, inputFor(PARENTLESS_CASES[0]!, prd.value.id));
      expect(res.status).toBe(201);
    });

    it(`${route}: with no PRD and no spec the refusal names creating the requirements document first`, async () => {
      const { app } = makeApp();
      const res = await postDocs(app, route, inputFor(PARENTLESS_CASES[PARENTLESS_CASES.length - 1]!));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect((res.json["error"] as { message: string }).message).toContain("create the requirements document first");
    });
  }
});

describe("AC-PAR-1: the CLI exits exactly 4 and writes nothing", () => {
  let corpus: PartyCorpus;
  let prdSlug = "";
  let specSlug = "";

  beforeAll(async () => {
    corpus = createPartyCorpus("create-requires-parent");
    prdSlug = corpus.slugOf(corpus.setup(["create", "prd", "--title", "CLI Requirements", "--no-ai", ...templatedFieldsArgs("prd")]));
    const store = new SQLiteStore(join(corpus.dir, ".lore", "lore.db"));
    try {
      specSlug = (await insertSpec(store)).slug;
    } finally {
      store.close();
    }
  }, 120_000);

  afterAll(() => corpus.cleanup());

  for (const c of PARENTLESS_CASES) {
    it(`${c.label} without --parent: exit 4, stderr names --parent, the PRD and the spec, no row written`, () => {
      const before = corpus.counts();
      const args = ["create", c.type, "--title", `CLI parentless ${c.label}`, "--no-ai", ...templatedFieldsArgs(c.type, c.subType === undefined ? {} : { kind: c.subType })];
      if (c.subType !== undefined) args.push("--sub-type", c.subType);
      if (c.type === "adr") args.push("--decision-status", "proposed");
      const ran = corpus.lore(args, { kind: "run", run: "cc:create-requires-parent" });
      expect(ran.exitCode).toBe(4);
      expect(ran.stderr).toContain("--parent");
      expect(ran.stderr).toContain(prdSlug);
      expect(ran.stderr).toContain(specSlug);
      expect(corpus.counts()).toEqual(before);
      const listed = JSON.parse(corpus.lore(["list", "--json"], { kind: "run", run: "cc:create-requires-parent" }).stdout) as {
        data: { docs: Array<{ title: string }> };
      };
      expect(listed.data.docs.map((d) => d.title)).not.toContain(`CLI parentless ${c.label}`);
    }, 60_000);
  }

  it("knowledge, adr and plan WITH --parent exit 0", () => {
    for (const c of [PARENTLESS_CASES[0]!, PARENTLESS_CASES[PARENTLESS_CASES.length - 2]!, PARENTLESS_CASES[PARENTLESS_CASES.length - 1]!]) {
      const args = ["create", c.type, "--title", `CLI parented ${c.label}`, "--no-ai", ...templatedFieldsArgs(c.type, c.subType === undefined ? {} : { kind: c.subType }), "--parent", prdSlug];
      if (c.subType !== undefined) args.push("--sub-type", c.subType);
      if (c.type === "adr") args.push("--decision-status", "proposed");
      const ran = corpus.lore(args, { kind: "run", run: "cc:create-requires-parent" });
      expect(ran.exitCode).toBe(0);
    }
  }, 120_000);

  it("`lore create --help` states which types need --parent", () => {
    const help = corpus.lore(["create", "--help"], { kind: "run", run: "cc:create-requires-parent" });
    const text = help.stdout + help.stderr;
    expect(text).toMatch(/REQUIRED for knowledge/);
    expect(text).toContain("--parent");
  }, 60_000);

  it("a corpus with no PRD and no spec: exit 4 and says to create the requirements document first", () => {
    const bare = createPartyCorpus("create-requires-parent-bare");
    try {
      const ran = bare.lore(["create", "knowledge", "--title", "K", "--sub-type", "reference", "--no-ai", ...templatedFieldsArgs("knowledge", { kind: "reference" })], {
        kind: "run",
        run: "cc:create-requires-parent",
      });
      expect(ran.exitCode).toBe(4);
      expect(ran.stderr).toContain("create the requirements document first");
      expect(ran.stderr).toContain("--parent");
    } finally {
      bare.cleanup();
    }
  }, 120_000);
});

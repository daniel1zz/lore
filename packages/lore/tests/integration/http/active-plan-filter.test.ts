/**
 * AC-077-1 (plan-dashboard-read-surface-defects-plan-selector-ready-list) —
 * `GET /api/docs?type=plan&active=true` and `bootstrap().active_plans` share ONE
 * "active plan" predicate (`isActivePlan` in @lore/core), so they cannot disagree.
 *
 * Real SQLite corpus in a mkdtemp dir (createApp, same composition root as production)
 * with plans in draft, approved, archived, deprecated.
 *
 *   HAPPY:      active=true returns exactly the draft + approved plans
 *   NEGATIVE:   archived and deprecated plans are absent
 *   STATE:      the slug set equals bootstrap's active_plans slugs
 *   ERROR:      active=true with type=spec (or no type) -> 422 VALIDATION_ERROR naming `active`
 *   BOUNDARY:   active=false / active=maybe -> 422 (only the literal `true` is a filter)
 *   REGRESSION: without active, the same list still returns all four plans
 *
 * @spec_ref spec-077-dashboard-execution-read-surface-prd-21-f3 AC-077-1
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startHttpServer } from "../../../src/adapters/http/index.js";
import { createMachineAuthStores } from "../../../src/adapters/http/machine-auth.js";
import { createApp } from "../../../src/app.js";
import type { App } from "../../../src/app.js";
import type { CreateDocInput, LoreConfig } from "@lore/core";
import { liveAmbient, liveWriteContext, liveIo } from "../../live-invocation.js";

interface Rig {
  server: ReturnType<typeof Bun.serve>;
  app: App;
  baseUrl: string;
  rawKey: string;
  tmpDir: string;
  slugsByStatus: Record<string, string>;
}

let rig: Rig;

async function makeRig(): Promise<Rig> {
  const tmpDir = mkdtempSync(join(tmpdir(), "lore-active-plan-filter-"));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  // reason: plans are judged by default; this suite moves plans to approved/archived only to
  // reach the list filter under test, so review-judgment is emptied (mirrors plan-close-cascade).
  const config = {
    project: { name: "active-plan-filter-test", author: "tester" },
    workflow: { review: { judgment_required_types: [] } },
  } as unknown as LoreConfig;
  const app = createApp(join(tmpDir, ".lore", "lore.db"), config, liveAmbient(), liveWriteContext()) as App;
  const key = await app.apiKeyStore.create("active-plan-agent", "owner");
  if (!key.ok) throw new Error("api key");
  const machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-active-plan-machine-")) });

  const prd = await app.corpusService.create({ type: "prd", title: "Root PRD", content: "root" });
  if (!prd.ok) throw new Error("prd");

  const slugsByStatus: Record<string, string> = {};
  for (const status of ["draft", "approved", "archived", "deprecated"] as const) {
    const plan = await app.corpusService.create({
      type: "plan",
      title: `Plan ${status}`,
      parent_id: prd.value.id,
      content: "## Plan",
      // reason: bypasses the plan-close attestation floor — out of scope here.
      extra: {
        attestation_exempt: true,
        attestation_exempt_reason: "list-filter test — evidence out of scope",
        attestation_exempt_kind: "no-oracle",
      },
    } as CreateDocInput);
    if (!plan.ok) throw new Error(`plan ${status}`);
    slugsByStatus[status] = plan.value.slug;
    // reason: the lifecycle only allows draft -> approved -> archived|deprecated, so each target walks it.
    const path = status === "draft" ? [] : status === "approved" ? ["approved"] : ["approved", status];
    for (const step of path) {
      const moved = await app.corpusService.set(plan.value.id, { status: step as "approved" | "archived" | "deprecated" });
      if (!moved.ok) throw new Error(`set ${step}: ${JSON.stringify(moved.error)}`);
    }
  }

  const server = startHttpServer(app, { io: liveIo(), port: 0, host: "127.0.0.1", machineAuth });
  return { server, app, baseUrl: `http://127.0.0.1:${server.port}`, rawKey: key.value.rawKey, tmpDir, slugsByStatus };
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${rig.baseUrl}${path}`, { headers: { Authorization: `Bearer ${rig.rawKey}` } });
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  rig = await makeRig();
});
afterEach(() => {
  rig.server.stop(true);
  rmSync(rig.tmpDir, { recursive: true, force: true });
});

describe("GET /api/docs?type=plan&active=true (AC-077-1)", () => {
  it("returns exactly the draft and approved plans, equal to bootstrap's active_plans", async () => {
    const { status, body } = await get("/api/docs?type=plan&active=true");
    expect(status).toBe(200);
    const slugs = (body.data.docs as Array<{ slug: string }>).map((d) => d.slug).sort();
    expect(slugs).toEqual([rig.slugsByStatus.draft, rig.slugsByStatus.approved].sort());

    const boot = await rig.app.sessionService!.bootstrap("tester");
    if (!boot.ok) throw new Error("bootstrap");
    expect(boot.value.active_plans.map((p) => p.slug).sort()).toEqual(slugs);
    expect(body.data.total).toBe(2);
  });

  it("still lists all four plans without the active filter", async () => {
    const { body } = await get("/api/docs?type=plan");
    expect(body.data.docs).toHaveLength(4);
  });

  it("refuses active=true for a non-plan type with VALIDATION_ERROR", async () => {
    const { status, body } = await get("/api/docs?type=spec&active=true");
    expect(status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.field).toBe("active");
  });

  it("refuses active=true with no type", async () => {
    const { status, body } = await get("/api/docs?active=true");
    expect(status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("refuses a value other than the literal true", async () => {
    for (const v of ["false", "maybe"]) {
      const { status, body } = await get(`/api/docs?type=plan&active=${v}`);
      expect(status).toBe(422);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

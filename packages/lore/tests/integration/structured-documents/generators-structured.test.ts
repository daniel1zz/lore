// @reads assets/project/lore-config-template.yaml
// @spawns-external git builds a throwaway git repository the test runs against
/**
 * spec-every-document-is-stored-as-structured-fields-validated-by (BR-1528): every internal generator creates its
 * document structured through its seed template, with `workflow.structured_documents.require_create` ON, so the generators
 * provably do not depend on the switch being off. Each created document pins `extra.template_ref` and `lore template check`
 * finds it clean (every field valid, every dimension answered, every ref resolving).
 *
 * Throwaway corpus (mkdtemp + `lore init` + `lore migrate templates --apply`, never the repo's own `.lore/`), driven through
 * the real command tree, the real HTTP route handlers and the real services.
 *
 * Coverage:
 *   HAPPY:      handoff (CLI), milestone review (MilestoneReviewService), ad-hoc stale-refresh task (the refresher `lore assess`
 *               builds), sync-docs (SyncDocsService), `lore baseline add --fields-file`, `lore create ... --supersedes`
 *               with fields, HTTP POST /api/docs and POST /api/dashboard/docs with fields, and the UAT verdict builder through
 *               the guarded `createUatDoc` seam each yield a templated, check-clean document
 *   NEGATIVE:   with the switch ON a plain create (no fields) is refused exit 4 naming `--fields-file`; HTTP create without
 *               fields is refused (422) and writes nothing; `baseline add` without fields is refused exit 4
 *   ERROR:      invalid fields on `baseline add` and on HTTP create are refused naming the failing field, nothing written
 *   STATE:      a refused create leaves the document count unchanged
 *
 * Not covered here (named in the task report): `lore uat record` end to end (UatService wiring is held by another claim),
 * `lore issue adopt` (the `task` template needs a governing spec an adopted defect does not have).
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ok, type CreateDocInput, type DocRecord, type LoreConfig, type UatVerdict } from "@lore/core";
import { readShippedTemplateSeeds } from "../../../src/adapters/cli/template-seeds.js";
import { createAppStaleRefresher } from "../../../src/adapters/cli/assess-stale-refresh.js";
import { handleApiRoute } from "../../../src/adapters/http/routes.js";
import { handleDashboardRoute } from "../../../src/adapters/http/dashboard-routes.js";
import { MilestoneReviewService } from "../../../src/service/milestone-review-service.js";
import { uatFields, withGeneratedFields } from "../../../src/service/generated-fields.js";
import { answerJson } from "../../helpers/milestone-judgment-fixture.js";
import { createStructuredRig, must, writeFieldsFile, type StructuredRig } from "../../helpers/structured-corpus.js";
import { armRequireCreate, createStructured, requireCreateConfig, seedTemplates } from "../../helpers/structured-docs.js";
import { fillShippedTemplate } from "../../helpers/structured-corpus-wiring.js";
import { liveWriteActor } from "../../live-invocation.js";

let rig: StructuredRig;
let config: LoreConfig;
let prdSlug: string;
let specSlug: string;
let planId: string;
let planSlug: string;
const extraDirs: string[] = [];

/** `lore template check <slug>`: exit 0 and nothing reported. */
async function expectCheckClean(slug: string): Promise<void> {
  const checked = await rig.lore(["template", "check", slug]);
  expect(checked.exitCode, `lore template check ${slug}: ${checked.stdout}${checked.stderr}`).toBe(0);
}

async function docOf(slug: string): Promise<DocRecord> {
  return await rig.withApp(async (app) => (await must(app.corpusService.get(slug), `get ${slug}`)).doc, config);
}

/**
 * The `template_ref` the corpus pins for a (type, kind): the version is read from the shipped seed, never a literal, so a
 * seed bump cannot leave an assertion stale.
 */
function seededRef(docType: string, kind?: string): string {
  const seeds = readShippedTemplateSeeds();
  if (!seeds.ok) throw new Error(`seededRef: ${JSON.stringify(seeds.error)}`);
  const seed = seeds.value.find((s) => s.template.doc_type === docType && (kind === undefined || s.template.kind === kind));
  if (seed === undefined) throw new Error(`seededRef: no shipped seed for ${docType}/${kind ?? "-"}`);
  return `${docType}${kind === undefined ? "" : `-${kind}`}-template@${String(seed.template.version)}`;
}

function pinnedRef(doc: DocRecord): unknown {
  return (doc.extra as Record<string, unknown>)["template_ref"];
}

beforeAll(async () => {
  rig = await createStructuredRig("lore-generators");
  await seedTemplates(rig);
  armRequireCreate(rig);
  config = requireCreateConfig();
  await rig.withApp(async (app) => {
    const prd = await createStructured(app, { type: "prd", title: "Generators PRD" });
    const spec = await createStructured(app, { type: "spec", title: "Generators spec", extra: { spec_kind: "feature" } });
    const plan = await createStructured(app, { type: "plan", title: "Generators plan", parent_id: spec.id });
    prdSlug = prd.slug;
    specSlug = spec.slug;
    planId = plan.id;
    planSlug = plan.slug;
  }, config);
}, 240_000);

afterAll(() => {
  rig?.cleanup();
  for (const dir of extraDirs) rmSync(dir, { recursive: true, force: true });
});

describe("BR-1528 generators create structured documents with require_create ON", () => {
  it("HAPPY: lore handoff files a templated, check-clean handoff under its plan", async () => {
    const written = await rig.lore(["handoff", "--plan", planSlug, "--decision", "keep the typed extra@0.9", "--next", "run the suite", "--json"]);
    expect(written.exitCode, written.stderr + written.stdout).toBe(0);
    const slug = (JSON.parse(written.stdout) as { data: { slug: string } }).data.slug;
    const doc = await docOf(slug);
    expect(pinnedRef(doc)).toBe(seededRef("knowledge", "handoff"));
    expect((doc.extra as { handoff?: unknown }).handoff).toBeDefined();
    expect(doc.content).toContain("## Next steps");
    await expectCheckClean(slug);
  });

  it("HAPPY: the milestone review is a templated, check-clean document filed under its plan", async () => {
    const review = await rig.withApp(async (app) => {
      const plan = { id: planId, slug: planSlug, title: "Generators plan", content: "Body.", version: 1, status: "approved", extra: {} };
      const task = { id: "T1", slug: "task-one", title: "Task", status: "archived", content: "task body", version: 1, extra: {} };
      const spec = { id: "S1", slug: specSlug, title: "Generators spec", content: "spec body", version: 1, extra: {} };
      const reply = answerJson({
        spec_conformance: { verdict: "pass" },
        design_necessity: { verdict: "pass" },
        concurrency_safety: { verdict: "pass" },
        security: { verdict: "pass" },
      });
      const service = new MilestoneReviewService({
        getPlanBundle: async () => ok({ plan, tasks: [task], spec } as never),
        getCitedRuleStates: async () => ok([] as never),
        listDecisionLog: async () => ok([]),
        judge: async () => ok(reply),
        judgeMeasured: async () => ok({ text: reply, duration_ms: 5 }),
        createReviewDoc: (input) => app.corpusService.createMilestoneReviewDoc(input),
        link: async (from, to, type) => app.corpusService.link(from, to, type),
      });
      return await service.review(planSlug, { diffSource: "test", maxDiffChars: 80_000 });
    }, config);
    expect(review.ok, JSON.stringify(review)).toBe(true);
    if (!review.ok) return;
    const doc = await docOf(review.value.doc.slug);
    expect(pinnedRef(doc)).toBe(seededRef("knowledge", "milestone-review"));
    expect(doc.parent_id).toBe(planId);
    expect((doc.extra as { milestone_review?: unknown }).milestone_review).toBeDefined();
    await expectCheckClean(doc.slug);
  }, 120_000);

  it("HAPPY: the ad-hoc task `lore assess` creates to re-verify a criterion is templated and check-clean", async () => {
    await rig.withApp(async (app) => {
      if (app.acService === undefined || app.verifyRunnerService === undefined) throw new Error("acService / verifyRunnerService are not wired");
      await must(
        app.acService.addCriterion(specSlug, { id: "AC-GEN-1", statement: "runs", verify: { mode: "script", oracle: "other", command: "echo ran && echo 'AC-GEN-1 PASS'" } }),
        "add criterion",
      );
      const refresher = createAppStaleRefresher(app, app.verifyRunnerService, { executionRoot: rig.dir, by: liveWriteActor(), nowIso: () => new Date().toISOString() });
      const out = await refresher.runAcs(planSlug, ["AC-GEN-1"]);
      expect(out, JSON.stringify(out)).toMatchObject({ ok: true });
    }, config);
    const tasks = await rig.withApp(async (app) => (await must(app.corpusService.listFull({ type: "task" }), "list tasks")).docs, config);
    const adhoc = tasks.find((task) => (task.extra as Record<string, unknown>)["adhoc"] === true);
    expect(adhoc).toBeDefined();
    expect(pinnedRef(adhoc as DocRecord)).toBe(seededRef("task"));
    // its `ac_scope` names an AC the spec in its `spec_ref` declares, which the check resolves against that spec's criteria
    expect((adhoc as DocRecord).extra["ac_scope"]).toEqual(["AC-GEN-1"]);
    expect(((adhoc as DocRecord).extra["fields"] as Record<string, unknown>)["spec_ref"]).toBe(specSlug);
    await expectCheckClean((adhoc as DocRecord).slug);
  }, 120_000);

  it("HAPPY: the UAT verdict builder creates a templated, check-clean verdict through the guarded createUatDoc seam", async () => {
    const verdict: UatVerdict = {
      verdict: "accept",
      tier_results: [{ tier: "P0", accepted: 2, rejected: 0, unverified: 0 }],
      requirement_coverage: { total: 2, covered: 2, uncovered_p0: [] },
      uiux: { blocker_count: 0, min_dimension_score: 4 },
      run_meta: { at: "2026-11-01T00:00:00.000Z", by: liveWriteActor() },
    };
    const doc = await rig.withApp(async (app) => {
      const input = withGeneratedFields(
        { type: "knowledge", title: "UAT generators", parent_id: planId, extra: { sub_type: "uat", uat: verdict } } as Omit<CreateDocInput, "content">,
        uatFields(planSlug, verdict),
      );
      return await must(app.corpusService.createUatDoc(input), "create uat doc");
    }, config);
    expect(pinnedRef(doc)).toBe(seededRef("knowledge", "uat"));
    await expectCheckClean(doc.slug);
  });

  it("HAPPY: sync-docs creates a templated, check-clean spec from a file whose front matter carries fields", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-generators-sync-"));
    extraDirs.push(dir);
    const filled = fillShippedTemplate("spec", "feature", prdSlug);
    writeFileSync(
      join(dir, "SPEC-sync.md"),
      ["---", "type: spec", 'title: "Synced generators spec"', `fields: ${JSON.stringify(filled.fields)}`, `dimensions: ${JSON.stringify(filled.dimensions)}`, "---", ""].join("\n"),
      "utf8",
    );
    const report = await rig.withApp(async (app) => await must(app.syncDocsService.run({ fromDir: dir, dryRun: false }), "sync-docs"), config);
    expect(report.errors).toEqual([]);
    expect(report.created).toHaveLength(1);
    const doc = await docOf(report.created[0]!.slug);
    expect(pinnedRef(doc)).toMatch(/^spec-feature-template@\d+$/);
    await expectCheckClean(doc.slug);
  });

  it("HAPPY: lore baseline add --fields-file creates a templated baseline root; without fields it is refused exit 4", async () => {
    const filled = fillShippedTemplate("baseline", "root", prdSlug);
    const fieldsPath = writeFieldsFile(rig, "baseline-root.yaml", filled);
    const before = await rig.countDocs();
    const refused = await rig.lore(["baseline", "add", prdSlug, "--node", "root", "--label", "Generators root", "--title", "Baseline root generators"]);
    expect(refused.exitCode, refused.stderr).toBe(4);
    expect(await rig.countDocs()).toBe(before);

    const created = await rig.lore(["baseline", "add", prdSlug, "--node", "root", "--label", "Generators root", "--title", "Baseline root generators", "--fields-file", fieldsPath, "--json"]);
    expect(created.exitCode, created.stderr + created.stdout).toBe(0);
    const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
    const doc = await docOf(slug);
    expect(pinnedRef(doc)).toMatch(/^baseline-root-template@\d+$/);
    await expectCheckClean(slug);
  });

  it("ERROR: baseline add with invalid fields is refused naming the failing field, nothing written", async () => {
    const filled = fillShippedTemplate("baseline", "root");
    const bad = writeFieldsFile(rig, "baseline-root-bad.yaml", { fields: { ...filled.fields, summary: 42 }, dimensions: filled.dimensions });
    const before = await rig.countDocs();
    const refused = await rig.lore(["baseline", "add", prdSlug, "--node", "root", "--label", "Bad root", "--title", "Bad baseline root", "--fields-file", bad]);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("does not satisfy");
    expect(await rig.countDocs()).toBe(before);
  });

  it("HAPPY: create --supersedes with fields creates a templated, check-clean ADR and invalidates the old one", async () => {
    const old = await rig.withApp(
      async (app) => await createStructured(app, { type: "adr", title: "Old generators ADR", parent_id: (await must(app.corpusService.get(specSlug), "get spec")).doc.id, extra: { decision_status: "accepted" } }),
      config,
    );
    const filled = fillShippedTemplate("adr", undefined, prdSlug);
    const fieldsPath = writeFieldsFile(rig, "adr-new.yaml", filled);
    const created = await rig.lore(["create", "adr", "--title", "New generators ADR", "--decision-status", "accepted", "--parent", specSlug, "--fields-file", fieldsPath, "--supersedes", old.slug, "--json"]);
    expect(created.exitCode, created.stderr + created.stdout).toBe(0);
    const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
    const doc = await docOf(slug);
    expect(pinnedRef(doc)).toMatch(/^adr-template@\d+$/);
    await expectCheckClean(slug);
    const superseded = await docOf(old.slug);
    expect((superseded.extra as { validity?: unknown }).validity).toBeDefined();
  });

  it("NEGATIVE: with the switch ON a plain create is refused exit 4 naming --fields-file, and nothing is written", async () => {
    const before = await rig.countDocs();
    const refused = await rig.lore(["create", "prd", "--title", "Plain generators PRD", "--content", "a free body", "--no-ai"]);
    expect(refused.exitCode, refused.stderr).toBe(4);
    expect(refused.stderr).toContain("--fields-file");
    expect(await rig.countDocs()).toBe(before);
  });

  it("HAPPY and NEGATIVE: HTTP POST /api/docs and POST /api/dashboard/docs create from fields and refuse a plain create", async () => {
    const filled = fillShippedTemplate("prd", undefined, prdSlug);
    const bearer = { name: liveWriteActor(), session_id: "generators-bearer" };
    const cookie = { name: liveWriteActor(), session_id: "generators-cookie", callerSurface: "http_cookie" as const };
    const post = (path: string, body: unknown): { req: Request; url: URL } => {
      const url = new URL(`http://localhost${path}`);
      return { url, req: new Request(url.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) };
    };
    const before = await rig.countDocs();
    await rig.withApp(async (app) => {
      const plainApi = post("/api/docs", { type: "prd", title: "Plain http PRD", content: "a free body" });
      const refusedApi = await handleApiRoute(plainApi.req, plainApi.url, app, bearer);
      expect(refusedApi?.status).toBe(422);
      const plainDash = post("/api/dashboard/docs", { type: "prd", title: "Plain dashboard PRD", content: "a free body" });
      const refusedDash = await handleDashboardRoute(plainDash.req, plainDash.url, app, cookie);
      expect(refusedDash?.status).toBe(422);
    }, config);
    expect(await rig.countDocs()).toBe(before);

    const slugs: string[] = [];
    await rig.withApp(async (app) => {
      const viaApi = post("/api/docs", { type: "prd", title: "Fields http PRD", extra: { fields: filled.fields, dimensions: filled.dimensions } });
      const createdApi = await handleApiRoute(viaApi.req, viaApi.url, app, bearer);
      expect(createdApi?.status).toBe(201);
      slugs.push(((await createdApi!.json()) as { data: { slug: string } }).data.slug);
      const viaDash = post("/api/dashboard/docs", { type: "prd", title: "Fields dashboard PRD", extra: { fields: filled.fields, dimensions: filled.dimensions } });
      const createdDash = await handleDashboardRoute(viaDash.req, viaDash.url, app, cookie);
      expect(createdDash?.status).toBe(201);
      slugs.push(((await createdDash!.json()) as { data: { doc: { slug: string } } }).data.doc.slug);
    }, config);
    for (const slug of slugs) {
      expect(pinnedRef(await docOf(slug))).toMatch(/^prd-template@\d+$/);
      await expectCheckClean(slug);
    }
  });

  it("ERROR: an HTTP create with invalid fields is refused naming the problem and writes nothing", async () => {
    const filled = fillShippedTemplate("prd");
    const url = new URL("http://localhost/api/docs");
    const req = new Request(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "prd", title: "Invalid http PRD", extra: { fields: { unknown_field: true }, dimensions: filled.dimensions } }),
    });
    const before = await rig.countDocs();
    const res = await rig.withApp(async (app) => await handleApiRoute(req, url, app, { name: liveWriteActor(), session_id: "generators-bearer-2" }), config);
    expect(res?.status).toBe(422);
    expect(JSON.stringify(await res!.json())).toContain("does not satisfy");
    expect(await rig.countDocs()).toBe(before);
  });
});

// @spawns packages/lore/src/index.ts
// @reads assets/templates/**
/**
 * AC-PAR-2 — every internal creator passes its parent explicitly (BR-709), because `CorpusService.create` refuses a
 * knowledge record without one:
 *   - `lore handoff`: filed under its `--plan`; without one, under the requirements document; with neither, exit exactly 4
 *     naming both;
 *   - the milestone review: filed under the plan it judges;
 *   - the UAT verdict (`UatService.record`): filed under its plan (BR-570);
 *   - the baseline fidelity sample: filed under the one spec it measures, else the requirements document;
 *   - `lore migrate v1` stays exempt: a parentless imported document is written and listed in the report.
 *
 * Dimensions: HAPPY (each creator files under its parent), NEGATIVE (handoff with neither; fidelity over several specs with
 * no or several PRDs), BOUNDARY (handoff --plan wins over an existing PRD), STATE (a refused handoff writes nothing),
 * REGRESSION (migrate v1 keeps importing parentless documents).
 *
 * MOCK RISK: handoff is the real CLI against a throwaway corpus; the service tests use real services on an InMemoryStore;
 * the milestone review's judge and bundle ports are scripted (the review's parent wiring is what is measured, not a model).
 *
 * @spec_ref spec-documents-that-need-a-parent-are-refused-without-one-an-ad#AC-PAR-2
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOC_TYPE_ROLE_MAP, ok } from "@lore/core";
import type { CreateDocInput, DocId, DocRecord, LoreError, UatVerdict } from "@lore/core";
import { ulid } from "ulidx";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { UatService } from "../../../src/service/uat-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { MilestoneReviewService } from "../../../src/service/milestone-review-service.js";
import { resolveFidelityParentId } from "../../../src/service/fidelity-sample.js";
import type { FidelityRecord } from "../../../src/service/fidelity-sample.js";
import { resolveDoc } from "../../../src/service/resolve.js";
import { actedStore } from "../../live-invocation.js";
import { answerJson } from "../../helpers/milestone-judgment-fixture.js";
import { createPartyCorpus } from "../../helpers/known-party-corpus.js";
import type { PartyCorpus } from "../../helpers/known-party-corpus.js";

const RUN = "cc:internal-creators";

function message(error: LoreError): string {
  return "message" in error && typeof error.message === "string" ? error.message : error.code;
}

// ─── Handoff (real CLI) ───────────────────────────────────────────────────────

/** Parent slug of the doc whose title starts with `titlePrefix`, read straight from the corpus file. */
function parentSlugOfTitle(corpus: PartyCorpus, titlePrefix: string): string | null | undefined {
  const db = new Database(join(corpus.dir, ".lore", "lore.db"), { readonly: true });
  try {
    const row = db
      .query("SELECT p.slug AS parent_slug FROM docs d LEFT JOIN docs p ON p.id = d.parent_id WHERE d.title LIKE ? ORDER BY d.created_at DESC LIMIT 1")
      .get(`${titlePrefix}%`) as { parent_slug: string | null } | null;
    return row === null ? undefined : row.parent_slug;
  } finally {
    db.close();
  }
}

function handoff(corpus: PartyCorpus, extra: string[] = []): ReturnType<PartyCorpus["lore"]> {
  return corpus.lore(["handoff", "--next", "merge the branch", "--json", ...extra], { kind: "run", run: RUN });
}

describe("AC-PAR-2: lore handoff files under its plan, else the requirements document, else is refused", () => {
  let corpus: PartyCorpus;
  beforeEach(() => {
    corpus = createPartyCorpus("internal-creators-handoff");
    // BR-1528: a handoff is created structured through the approved `knowledge/handoff` template.
    corpus.setup(["migrate", "templates", "--apply"], RUN);
  });
  afterEach(() => corpus.cleanup());

  it("with --plan: filed under that plan (even when a PRD exists)", () => {
    const prd = corpus.slugOf(corpus.setup(["create", "prd", "--title", "Handoff Requirements", "--no-ai", "--content", "root"], RUN));
    const plan = corpus.slugOf(corpus.setup(["create", "plan", "--title", "Handoff Plan", "--parent", prd, "--no-ai", "--content", "p"], RUN));
    const ran = handoff(corpus, ["--plan", plan]);
    expect(ran.exitCode).toBe(0);
    expect(parentSlugOfTitle(corpus, "Handoff —")).toBe(plan);
  }, 120_000);

  it("with only a requirements document: filed under it", () => {
    const prd = corpus.slugOf(corpus.setup(["create", "prd", "--title", "Handoff Requirements", "--no-ai", "--content", "root"], RUN));
    const ran = handoff(corpus);
    expect(ran.exitCode).toBe(0);
    expect(parentSlugOfTitle(corpus, "Handoff —")).toBe(prd);
  }, 120_000);

  it("with neither a plan nor a requirements document: exit exactly 4 naming both, nothing written", () => {
    const before = corpus.counts();
    const ran = handoff(corpus);
    expect(ran.exitCode).toBe(4);
    expect(ran.stderr).toContain("--plan");
    expect(ran.stderr).toContain("requirements document");
    expect(corpus.counts()).toEqual(before);
    expect(parentSlugOfTitle(corpus, "Handoff —")).toBeUndefined();
  }, 120_000);
});

// ─── Service-level creators (in-memory) ───────────────────────────────────────

function makeCorpus() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return { store, corpusService };
}

async function mustCreate(corpusService: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const made = await corpusService.create(input);
  if (!made.ok) throw new Error(`fixture create failed: ${JSON.stringify(made.error)}`);
  return made.value;
}

async function insertSpec(store: { insert(doc: DocRecord): Promise<{ ok: boolean }> }): Promise<DocRecord> {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const doc: DocRecord = {
    id, slug: `spec-fixture-${id.slice(-6).toLowerCase()}`, type: "spec", role: DOC_TYPE_ROLE_MAP["spec"], title: "Fixture spec",
    status: "draft", priority: "medium", content: "", parent_id: null, created_at: now, updated_at: now, created_by: "test",
    version: 1, deleted_at: null, tags: [], extra: {},
  };
  const inserted = await store.insert(doc);
  if (!inserted.ok) throw new Error("insert spec failed");
  return doc;
}

describe("AC-PAR-2: the UAT verdict is filed under its plan (BR-570)", () => {
  const VERDICT: UatVerdict = {
    verdict: "accept",
    tier_results: [{ tier: "P0", accepted: 5, rejected: 0, unverified: 0 }],
    requirement_coverage: { total: 5, covered: 5, uncovered_p0: [] },
    uiux: { blocker_count: 0, min_dimension_score: 4 },
    run_meta: { at: "2026-07-18T00:00:00.000Z", by: "agent:uat" },
  };

  it("UatService.record creates the verdict with parent_id = the plan, and the informs link still lands", async () => {
    const { store, corpusService } = makeCorpus();
    const prd = await mustCreate(corpusService, { type: "prd", title: "Req", content: "b" } as CreateDocInput);
    const plan = await mustCreate(corpusService, { type: "plan", title: "The Plan", content: "b", parent_id: prd.id } as CreateDocInput);
    const uat = new UatService({
      createUatDoc: corpusService.createUatDoc.bind(corpusService),
      resolveTarget: (idOrSlug: string) => resolveDoc(store, idOrSlug),
      addLink: store.addLink.bind(store),
      now: () => "2026-07-18T00:00:00.000Z",
    });
    const recorded = await uat.record(plan.slug, VERDICT, { by: "agent:uat" });
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    expect(recorded.value.doc.parent_id).toBe(plan.id);
    const links = await store.findLinks(recorded.value.doc.id, "out");
    expect(links.ok && links.value.some((l) => l.link_type === "informs" && l.to_id === plan.id)).toBe(true);
  });
});

describe("AC-PAR-2: the milestone review is filed under its plan", () => {
  it("createReviewDoc receives parent_id = the plan, and the real writer accepts it", async () => {
    const { corpusService } = makeCorpus();
    const prd = await mustCreate(corpusService, { type: "prd", title: "Req", content: "b" } as CreateDocInput);
    const planDoc = await mustCreate(corpusService, { type: "plan", title: "Reviewed Plan", content: "b", parent_id: prd.id } as CreateDocInput);
    const plan = { id: planDoc.id, slug: planDoc.slug, title: planDoc.title, content: "Body.", version: 1, status: "approved", extra: {} };
    const task = { id: "T1", slug: "task-one", title: "Task", status: "archived", content: "task body", version: 1, extra: {} };
    const spec = { id: "S1", slug: "spec-one", title: "Spec", content: "spec body", version: 1, extra: {} };
    let seenParent: string | undefined;
    let created: DocRecord | undefined;
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
      createReviewDoc: async (input) => {
        seenParent = input.parent_id;
        const made = await corpusService.createMilestoneReviewDoc(input);
        if (made.ok) created = made.value;
        return made;
      },
      link: async () => ok(undefined),
    });
    const reviewed = await service.review(planDoc.slug, { diffSource: "test", maxDiffChars: 80000 });
    // reason: the review's own verdicts are not what is measured here; whatever it concluded, it must have filed the doc under its plan.
    if (!reviewed.ok && created === undefined) throw new Error(`review did not reach createReviewDoc: ${JSON.stringify(reviewed.error)}`);
    expect(seenParent).toBe(planDoc.id);
    expect(created?.parent_id).toBe(planDoc.id);
  });
});

describe("AC-PAR-2: the baseline fidelity sample is filed under the most specific measured document", () => {
  function recordOver(specSlugs: string[]): FidelityRecord {
    return {
      mode: "citations", seed: 1, size: specSlugs.length, pool: 10, judges: 1,
      verdicts: specSlugs.map((s, i) => ({ n: i + 1, key: `${s}#AC-X-${i + 1}->BR-${i + 1}`, verdict: "faithful" as const, reason: "ok" })),
      disagreements: [], faithful_share: 1, not_seen: 0, catch_all: [], threshold_share: 0.05,
    };
  }

  it("a sample over one spec is filed under that spec", async () => {
    const { store, corpusService } = makeCorpus();
    await mustCreate(corpusService, { type: "prd", title: "Req", content: "b" } as CreateDocInput);
    const spec = await insertSpec(store);
    const parent = await resolveFidelityParentId(store, recordOver([spec.slug, spec.slug]));
    expect(parent.ok && parent.value).toBe(spec.id);
  });

  it("a sample over several specs is filed under the requirements document", async () => {
    const { store, corpusService } = makeCorpus();
    const prd = await mustCreate(corpusService, { type: "prd", title: "Req", content: "b" } as CreateDocInput);
    const a = await insertSpec(store);
    const b = await insertSpec(store);
    const parent = await resolveFidelityParentId(store, recordOver([a.slug, b.slug]));
    expect(parent.ok && parent.value).toBe(prd.id);
  });

  it("a sample over several specs with no requirements document is refused, saying to create it first", async () => {
    const { store } = makeCorpus();
    const a = await insertSpec(store);
    const b = await insertSpec(store);
    const parent = await resolveFidelityParentId(store, recordOver([a.slug, b.slug]));
    expect(parent.ok).toBe(false);
    if (!parent.ok) {
      expect(parent.error.code).toBe("VALIDATION_ERROR");
      expect(message(parent.error)).toContain("create the requirements document first");
    }
  });

  it("a sample over several specs with two requirements documents is refused, never choosing one", async () => {
    const { store, corpusService } = makeCorpus();
    await mustCreate(corpusService, { type: "prd", title: "Req one", content: "b" } as CreateDocInput);
    await mustCreate(corpusService, { type: "prd", title: "Req two", content: "b" } as CreateDocInput);
    const a = await insertSpec(store);
    const b = await insertSpec(store);
    const parent = await resolveFidelityParentId(store, recordOver([a.slug, b.slug]));
    expect(parent.ok).toBe(false);
  });
});

describe("AC-PAR-2: lore migrate v1 stays exempt and lists every parentless import", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "internal-creators-migrate-"));
    mkdirSync(dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const KNOWLEDGE = (id: string, title: string): string =>
    `---\nid: "${id}"\ntype: knowledge\nstatus: published\npriority: low\ncreated: "2025-03-01"\nupdated: "2025-04-01"\ntags: []\nlinks: []\ntitle: "${title}"\n---\n\nKnowledge content.\n`;
  const PRD = `---\nid: "PRD-1"\ntype: prd\nstatus: published\npriority: high\ncreated: "2025-01-01"\nupdated: "2025-01-01"\ntags: []\nlinks: []\ntitle: "Imported Requirements"\n---\n\nRequirements.\n`;
  const PARENTED = `---\nid: "K-2"\ntype: knowledge\nparent: "PRD-1"\nstatus: published\npriority: low\ncreated: "2025-03-01"\nupdated: "2025-04-01"\ntags: []\nlinks: []\ntitle: "Parented Knowledge"\n---\n\nKnowledge content.\n`;

  it("imports a parentless knowledge doc (exit-equivalent success) and lists it, and only it, in parentless_imports", async () => {
    writeFileSync(join(dir, "prd.md"), PRD);
    writeFileSync(join(dir, "k1.md"), KNOWLEDGE("K-1", "Loose Knowledge"));
    writeFileSync(join(dir, "k2.md"), PARENTED);
    const store = actedStore(new InMemoryStore());
    const result = await new MigrationService(store).execute(dir, { dryRun: false, skipSecretScan: false, idStrategy: "preserve" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.imported).toBe(3);
    expect(result.value.errors).toEqual([]);
    expect(result.value.parentless_imports.map((d) => d.type)).toEqual(["knowledge"]);
    expect(result.value.parentless_imports[0]?.file).toContain("k1.md");
    const listed = await store.findMany({ type: "knowledge" });
    expect(listed.ok && listed.value.map((d) => d.title).sort()).toEqual(["Loose Knowledge", "Parented Knowledge"]);
  });

  it("a dry run lists nothing and writes nothing", async () => {
    writeFileSync(join(dir, "k1.md"), KNOWLEDGE("K-1", "Loose Knowledge"));
    const store = actedStore(new InMemoryStore());
    const result = await new MigrationService(store).execute(dir, { dryRun: true, skipSecretScan: false, idStrategy: "preserve" });
    expect(result.ok && result.value.parentless_imports).toEqual([]);
    const listed = await store.findMany({ type: "knowledge" });
    expect(listed.ok && listed.value).toHaveLength(0);
  });
});

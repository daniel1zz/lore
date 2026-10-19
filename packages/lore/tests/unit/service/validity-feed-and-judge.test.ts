/**
 * Six-dimension tests for SPEC-043's "loud composed surfaces" (D9, D8, AC-MH-12):
 *   1. `lore feed <checkpoint>` pack renders the D4 banner when the discovered
 *      feeding-skill doc is invalidated (feed-flow.ts::renderDocMarkdown wiring site)
 *   2. The review-judge prompt gains a "# Staleness Notice" section when the
 *      bundle's doc or parent is invalidated, and NOT otherwise (review-template.ts)
 *   3. `lore status`'s report carries the invalidated-feeding-source warning,
 *      computed via the SAME armed-gate helper `SessionService.bootstrap` uses
 *      (CorpusService.status, checkpoint-registry.ts::computeArmedGates)
 *
 * Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      all three composed surfaces mark an invalidated doc loudly
 *   NEGATIVE:   n/a — these are read-only composition paths with no invalid-input
 *               failure mode of their own
 *   BOUNDARY:   n/a — covered by validity.test.ts's isInvalidated boundary cases
 *   ERROR:      n/a — buildFeed never fails (advisory-only); status()/the review
 *               template never fail on an invalidated doc
 *   STATE:      status()'s warning and bootstrap's armed_gates[] agree on the SAME
 *               feeding_source_slug for spec-create — proof of the "never a second
 *               derivation" invariant
 *   REGRESSION: a VALID feeding-skill/doc/parent produces NO banner/notice/warning
 *               on any of the three surfaces; the review template's nowIso-omitted
 *               call site (purity contract) never inserts a notice either
 *
 * @spec_ref SPEC-043 AC-MH-12
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ValidityService } from "../../../src/service/validity-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { CreateDocInput, DocRecord, ReviewBundle } from "@lore/core";
import { buildFeed } from "../../../src/flows/feed-flow.js";
import { REVIEW_TEMPLATES, REVIEW_PROMPT_VERSION } from "../../../src/ai/review-template.js";
import { actedStore } from "../../live-invocation.js";
import { inLoopAuditVerifyRunner } from "../../support/audit-verify-runner-stub.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeCorpusServices() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const validityService = new ValidityService(store);
  const outlineService = new OutlineService(store);
  return { store, corpusService, validityService, outlineService };
}

/** Minimal App stub — only the fields `buildFeed` actually touches are real. */
function makeApp(corpusService: CorpusService, outlineService: OutlineService): App {
  return {
    warn: () => undefined,
    corpusService,
    reviewService: null as unknown as App["reviewService"],
    versionService: null as unknown as App["versionService"],
    outlineService,
    migrationService: null as unknown as App["migrationService"],
    treeCheckService: null as unknown as App["treeCheckService"],
    apiKeyStore: null as unknown as App["apiKeyStore"],
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    auditVerifyRunner: inLoopAuditVerifyRunner(null as unknown as App["auditService"]),
    callerSurface: "cli" as const,
    resolveAiDefault: () => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

async function createApprovedSkill(
  cs: CorpusService,
  title: string,
  appliesTo = "spec",
): Promise<DocRecord> {
  const createResult = await cs.create({
    type: "knowledge",
    title,
    content: "# Skill rules\nWrite good specs.",
    extra: { sub_type: "skill", skill: { applies_to: appliesTo } },
  } as CreateDocInput);
  if (!createResult.ok) throw new Error(`setup failed: ${JSON.stringify(createResult.error)}`);
  // Fast-track to approved (skips review workflow) — status transitions are
  // orthogonal to validity (D5), so a direct store.update is fine for test setup.
  const approveResult = await cs.set(createResult.value.id, { status: "approved" });
  if (!approveResult.ok) throw new Error(`setup failed: ${JSON.stringify(approveResult.error)}`);
  return approveResult.value;
}

function makeBundle(doc: DocRecord, parent?: DocRecord): ReviewBundle {
  return { doc, ...(parent !== undefined ? { parent } : {}), links: [] };
}

// ─── HAPPY — lore feed banner (D4 site 3) ───────────────────────────────────

describe("HAPPY — lore feed <checkpoint> renders the D4 banner for an invalidated feeding skill", () => {
  it("buildFeed's feed text carries the INVALIDATED banner when the discovered skill doc is invalidated", async () => {
    const { corpusService, validityService, outlineService } = makeCorpusServices();
    const skill = await createApprovedSkill(corpusService, "Write-spec rules");
    const invalidateResult = await validityService.invalidate(skill.id, { by: "alice", reason: "outdated" });
    expect(invalidateResult.ok).toBe(true);

    const app = makeApp(corpusService, outlineService);
    const outcome = await buildFeed(app, "spec-create");
    expect(outcome.skill).not.toBeNull();
    expect(outcome.feed).toContain("⚠ INVALIDATED");
    expect(outcome.feed).toContain("outdated");
  });

  it("REGRESSION: a VALID feeding skill produces feed text with NO invalidation banner", async () => {
    const { corpusService, outlineService } = makeCorpusServices();
    await createApprovedSkill(corpusService, "Write-spec rules");

    const app = makeApp(corpusService, outlineService);
    const outcome = await buildFeed(app, "spec-create");
    expect(outcome.skill).not.toBeNull();
    expect(outcome.feed).not.toContain("INVALIDATED");
  });
});

// ─── HAPPY — review-judge Staleness Notice ──────────────────────────────────

describe("HAPPY — review-judge prompt gains a Staleness Notice iff doc or parent is invalidated", () => {
  const template = REVIEW_TEMPLATES[REVIEW_PROMPT_VERSION]!;
  const budgets = { max_doc_chars: 4000, max_context_chars: 2000 };

  function makeDoc(overrides: Partial<DocRecord> & { id: string; title: string }): DocRecord {
    return {
      id: overrides.id,
      slug: overrides.slug ?? `${overrides.id}-slug`,
      type: overrides.type ?? "spec",
      role: overrides.role ?? "spec",
      title: overrides.title,
      status: overrides.status ?? "draft",
      priority: overrides.priority ?? "medium",
      content: overrides.content ?? "body",
      parent_id: overrides.parent_id ?? null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      created_by: "test",
      version: 1,
      deleted_at: null,
      tags: [],
      extra: overrides.extra ?? {},
    };
  }

  const nowIso = "2026-06-01T00:00:00.000Z";
  const invalidatedExtra = { validity: { invalid_at: "2026-05-01T00:00:00.000Z", reason: "stale" } };

  it("the doc itself invalidated → Staleness Notice present", () => {
    const doc = makeDoc({ id: "doc-1", title: "Doc", type: "knowledge", extra: invalidatedExtra });
    const result = template(makeBundle(doc), [], budgets, nowIso);
    expect(result.prompt).toContain("# Staleness Notice");
    expect(result.prompt).toContain("Document Under Review");
  });

  it("the PARENT invalidated (doc itself valid) → Staleness Notice present, names the parent", () => {
    const doc = makeDoc({ id: "doc-1", title: "Doc" });
    const parent = makeDoc({ id: "parent-1", title: "Parent", type: "knowledge", extra: invalidatedExtra });
    const result = template(makeBundle(doc, parent), [], budgets, nowIso);
    expect(result.prompt).toContain("# Staleness Notice");
    expect(result.prompt).toContain("PARENT document");
  });

  it("REGRESSION: neither doc nor parent invalidated → NO Staleness Notice", () => {
    const doc = makeDoc({ id: "doc-1", title: "Doc" });
    const parent = makeDoc({ id: "parent-1", title: "Parent" });
    const result = template(makeBundle(doc, parent), [], budgets, nowIso);
    expect(result.prompt).not.toContain("# Staleness Notice");
  });

  it("REGRESSION: nowIso omitted → NO Staleness Notice even for an invalidated doc (purity contract)", () => {
    const doc = makeDoc({ id: "doc-1", title: "Doc", type: "knowledge", extra: invalidatedExtra });
    const result = template(makeBundle(doc), [], budgets);
    expect(result.prompt).not.toContain("# Staleness Notice");
  });
});

// ─── HAPPY / STATE — lore status invalidated-feeding-source warning (D8) ───

describe("HAPPY/STATE — lore status invalidated-feeding-source warning, via the SAME armed-gate helper bootstrap uses", () => {
  it("status() warns when the spec-create feeding skill is invalidated, naming the checkpoint + slug", async () => {
    const { corpusService, validityService } = makeCorpusServices();
    const skill = await createApprovedSkill(corpusService, "Write-spec rules");
    await validityService.invalidate(skill.id, { by: "alice" });

    const statusResult = await corpusService.status();
    expect(statusResult.ok).toBe(true);
    if (!statusResult.ok) return;
    expect(statusResult.value.invalidated_feeding_source_warnings.length).toBe(1);
    expect(statusResult.value.invalidated_feeding_source_warnings[0]).toContain("spec-create");
    expect(statusResult.value.invalidated_feeding_source_warnings[0]).toContain(skill.slug);
  });

  it("REGRESSION: a VALID feeding skill produces NO warning", async () => {
    const { corpusService } = makeCorpusServices();
    await createApprovedSkill(corpusService, "Write-spec rules");

    const statusResult = await corpusService.status();
    expect(statusResult.ok).toBe(true);
    if (!statusResult.ok) return;
    expect(statusResult.value.invalidated_feeding_source_warnings).toEqual([]);
  });

  it("STATE: status()'s warned slug matches bootstrap's armed_gates[].feeding_source_slug for spec-create — never a second derivation", async () => {
    const { store, corpusService, validityService } = makeCorpusServices();
    const skill = await createApprovedSkill(corpusService, "Write-spec rules");
    await validityService.invalidate(skill.id, { by: "alice" });

    const sessionService = new SessionService(store, {
      claimTtlMinutes: 120,
      handoffTtlMinutes: 10_080,
      createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
    });

    const bootstrapResult = await sessionService.bootstrap("alice");
    expect(bootstrapResult.ok).toBe(true);
    if (!bootstrapResult.ok) return;
    const specCreateGate = bootstrapResult.value.armed_gates.find((g) => g.checkpoint === "spec-create");
    expect(specCreateGate?.feeding_source_slug).toBe(skill.slug);

    const statusResult = await corpusService.status();
    expect(statusResult.ok).toBe(true);
    if (!statusResult.ok) return;
    expect(statusResult.value.invalidated_feeding_source_warnings[0]).toContain(skill.slug);
  });
});

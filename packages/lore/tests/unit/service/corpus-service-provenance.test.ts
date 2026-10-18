/**
 * Tests for CorpusService's provenance auto-write (IoC vertical-slice tech-spec
 * §4.1 P4): `_createImpl` calls a private `writeProvenanceLink` step after every
 * successful create, which — when an approved feeding skill exists for the new
 * doc's type (via `findFeedingSkill`) — writes a `skill --governs--> newDoc` link.
 * Also covers the reverse-query counterpart `CorpusService.listGovernedBy` and the
 * reverse-direction navigation backlink that `get()` already surfaces generically
 * for any link type (including `governs`).
 *
 * Spec-first expectations (derived from the dispatch's described behavior, written
 * BEFORE reading corpus-service.ts's writeProvenanceLink/listGovernedBy bodies):
 *   - create() must ALWAYS return ok(doc) once the doc itself validates + inserts,
 *     regardless of what happens in the provenance step — this is the load-bearing
 *     "fail-soft" contract. A provenance-step failure (store error, unexpected throw)
 *     must NEVER surface as create()'s error and must NEVER throw out of create().
 *   - When a matching approved skill exists, a `governs` link from skill -> new doc
 *     must exist afterward, discoverable via listGovernedBy(skill).
 *   - The idempotency guarantee (store.addLink rejecting an exact duplicate edge with
 *     DUPLICATE_LINK) is a store-level invariant this fail-soft design depends on —
 *     asserted directly against the same store instance the service is using.
 *   - No matching feeding skill -> create() still succeeds, no governs link appears
 *     anywhere near the new doc (a common case, not a special one).
 *   - listGovernedBy is a plain resolve + link-traversal + summary-projection: exact
 *     match, empty-list on a skill with no governs links, and DOC_NOT_FOUND-shaped
 *     error on an unresolvable skill id/slug.
 *   - get()'s navigation.related is a generic non-"parent" link surface — a `governs`
 *     edge where the doc is the `to_id` side must appear with link_type: "governs",
 *     without any special-case code for this specific link type (regression guard).
 *
 * Six-dimension coverage:
 *   HAPPY:      create() auto-writes a governs link when a feeding skill matches;
 *               listGovernedBy finds it by id AND by slug
 *   NEGATIVE:   no matching feeding skill -> no link, create() still ok
 *   BOUNDARY:   listGovernedBy on a skill with zero governs links -> empty array
 *   ERROR:      listGovernedBy on an unresolvable id/slug -> DOC_NOT_FOUND;
 *               a forced store.addLink failure during provenance write never
 *               surfaces as a create() error (fail-soft)
 *   STATE:      re-running the provenance step for the same (skill, doc) pair does
 *               not duplicate the edge (store.addLink's own DUPLICATE_LINK guard)
 *   REGRESSION: get()'s navigation.related already surfaces a governs backlink with
 *               no source change needed — this pins that behavior down
 *
 * @spec_ref IoC vertical-slice tech-spec §4.1 P4
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput, LinkRecord, LoreError, Result, Telemetry, TelemetryEvent } from "@lore/core";
import { err } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── Capturing telemetry spy (mirrors corpus-service-telemetry.test.ts) ───────

class CapturingTelemetry implements Telemetry {
  readonly events: TelemetryEvent[] = [];
  private closed = false;

  record(event: TelemetryEvent): void {
    if (this.closed) return;
    this.events.push(event);
  }

  emit(): void {
    /* not used by these tests */
  }

  close(): void {
    this.closed = true;
  }
}

// ─── A store double whose addLink ALWAYS fails, everything else delegated to a
// real InMemoryStore via `extends` — used to exercise writeProvenanceLink's
// fail-soft path deterministically without touching corpus-service.ts. ─────────

class FailingLinkStore extends InMemoryStore {
  override async addLink(_link: LinkRecord): Promise<Result<LinkRecord, LoreError>> {
    return err({ code: "STORE_ERROR", message: "forced failure for test" });
  }
}

// ─── Test helpers ──────────────────────────────────────────────────────────────

function makeService(store: InMemoryStore = actedStore(new InMemoryStore())) {
  const telemetry = new CapturingTelemetry();
  const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), telemetry);
  return { service, store, telemetry };
}

/** Seed an approved knowledge/skill doc scoped to `appliesTo` — mirrors the
 * shape used by corpus-service-find-feeding-skill.test.ts exactly. */
async function createApprovedSkillDoc(
  service: CorpusService,
  opts: { title: string; appliesTo: string },
): Promise<{ id: string; slug: string }> {
  const created = await service.create({
    type: "knowledge",
    title: opts.title,
    content: "## Rule\n\nBody.",
    extra: { sub_type: "skill", skill: { applies_to: opts.appliesTo } },
  } as CreateDocInput);
  if (!created.ok) throw new Error(`create skill failed: ${JSON.stringify(created.error)}`);
  const approved = await service.set(created.value.id, { status: "approved" });
  if (!approved.ok) throw new Error(`approve skill failed: ${JSON.stringify(approved.error)}`);
  return { id: created.value.id, slug: approved.value.slug };
}

/** Create a parent PRD then a child spec under it — satisfies PARENT_TYPE_CONTRACT.spec = ["prd"]. */
async function createSpecUnderPrd(
  service: CorpusService,
  specTitle = "Governed Spec",
): Promise<{ specId: string }> {
  const prd = await service.create({ type: "prd", title: "Root PRD" } as CreateDocInput);
  if (!prd.ok) throw new Error(`create prd failed: ${JSON.stringify(prd.error)}`);
  const spec = await service.create({
    type: "spec",
    title: specTitle,
    content: "body",
  } as CreateDocInput);
  if (!spec.ok) throw new Error(`create spec failed: ${JSON.stringify(spec.error)}`);
  return { specId: spec.value.id };
}

// ─── HAPPY ─────────────────────────────────────────────────────────────────────

describe("CorpusService.create() provenance auto-write — HAPPY", () => {
  it("AC-P4-3: creating a matching-type doc auto-writes a governs link from the feeding skill", async () => {
    const { service, store } = makeService();
    const skill = await createApprovedSkillDoc(service, { title: "Write-spec rules", appliesTo: "spec" });
    const { specId } = await createSpecUnderPrd(service);

    const linksResult = await store.findLinks(skill.id, "out");
    expect(linksResult.ok).toBe(true);
    if (!linksResult.ok) return;
    const governs = linksResult.value.filter((l) => l.link_type === "governs" && l.to_id === specId);
    expect(governs).toHaveLength(1);
  });

  it("AC-P4-3: listGovernedBy(skillId) finds the newly-created doc exactly once", async () => {
    const { service } = makeService();
    const skill = await createApprovedSkillDoc(service, { title: "Write-spec rules", appliesTo: "spec" });
    const { specId } = await createSpecUnderPrd(service);

    const result = await service.listGovernedBy(skill.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(1);
    expect(result.value.docs.filter((d) => d.id === specId)).toHaveLength(1);
  });

  it("AC-P4-3: listGovernedBy(skillSlug) resolves by slug too, same result as by id", async () => {
    const { service } = makeService();
    const skill = await createApprovedSkillDoc(service, { title: "Write-spec rules", appliesTo: "spec" });
    const { specId } = await createSpecUnderPrd(service);

    const bySlug = await service.listGovernedBy(skill.slug);
    expect(bySlug.ok).toBe(true);
    if (!bySlug.ok) return;
    expect(bySlug.value.total).toBe(1);
    expect(bySlug.value.docs[0]?.id).toBe(specId);
  });

  it("AC-P4-3 idempotency: store.addLink independently rejects a repeat (skill, doc, governs) edge with DUPLICATE_LINK", async () => {
    const { service, store } = makeService();
    const skill = await createApprovedSkillDoc(service, { title: "Write-spec rules", appliesTo: "spec" });
    const { specId } = await createSpecUnderPrd(service);

    // The provenance step already wrote this edge once (asserted above in a sibling
    // test); re-attempting the exact same write here directly against the store must
    // be rejected — this is the load-bearing guarantee writeProvenanceLink's fail-soft
    // idempotency relies on (see its JSDoc: "store.addLink independently rejects exact
    // duplicates").
    const repeat = await store.addLink({
      from_id: skill.id as never,
      to_id: specId as never,
      link_type: "governs",
      created_at: new Date().toISOString(),
      created_by: "system",
    });
    expect(repeat.ok).toBe(false);
    if (repeat.ok) return;
    expect(repeat.error.code).toBe("DUPLICATE_LINK");
  });
});

// ─── ERROR (fail-soft) ─────────────────────────────────────────────────────────

describe("CorpusService.create() provenance auto-write — ERROR (fail-soft)", () => {
  it("AC-P4-4: a forced store.addLink failure during provenance write never surfaces as create()'s error", async () => {
    const failingStore = new FailingLinkStore();
    const { service, telemetry } = makeService(failingStore);

    const skill = await createApprovedSkillDoc(service, { title: "Write-spec rules", appliesTo: "spec" });
    expect(skill.id).toBeTruthy(); // seeding itself must succeed despite the failing store

    const result = await createSpecUnderPrd(service, "Fail-soft Spec");
    // createSpecUnderPrd throws on non-ok create — reaching this line already proves
    // create() returned ok(doc) even though addLink was forced to fail underneath.
    expect(result.specId).toBeTruthy();

    const persisted = await failingStore.find(result.specId as never);
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.value).not.toBeNull();
      expect(persisted.value?.id).toBe(result.specId);
    }

    // The fail-soft path records its failure via telemetry (method: "provenance",
    // ok: false) rather than silently discarding it — asserted here since this test
    // file already has the CapturingTelemetry plumbing in place.
    const provenanceFailures = telemetry.events.filter((e) => e.method === "provenance" && e.ok === false);
    expect(provenanceFailures.length).toBeGreaterThanOrEqual(1);
  });

  it("AC-P4-4: create() itself never throws when the provenance store call fails", async () => {
    const failingStore = new FailingLinkStore();
    const { service } = makeService(failingStore);
    await createApprovedSkillDoc(service, { title: "Write-spec rules", appliesTo: "spec" });

    // No try/catch here on purpose — an uncaught throw fails the test naturally.
    const prd = await service.create({ type: "prd", title: "Root PRD 2" } as CreateDocInput);
    expect(prd.ok).toBe(true);
    if (!prd.ok) return;
    const spec = await service.create({
      type: "spec",
      title: "Another Fail-soft Spec",
      content: "body",
    } as CreateDocInput);
    expect(spec.ok).toBe(true);
  });
});

// ─── NEGATIVE ──────────────────────────────────────────────────────────────────

describe("CorpusService.create() provenance auto-write — NEGATIVE", () => {
  it("no approved feeding skill declared for the type -> create() still ok, no governs link anywhere", async () => {
    const { service, store } = makeService();
    // Deliberately seed NO skill doc at all.
    const plan = await service.create({ type: "plan", title: "Ungoverned Plan" } as CreateDocInput);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const incoming = await store.findLinks(plan.value.id, "in");
    expect(incoming.ok).toBe(true);
    if (!incoming.ok) return;
    expect(incoming.value.filter((l) => l.link_type === "governs")).toHaveLength(0);
  });

  it("a skill scoped to a DIFFERENT applies_to does not govern this doc", async () => {
    const { service, store } = makeService();
    await createApprovedSkillDoc(service, { title: "Task rules", appliesTo: "task" });
    const { specId } = await createSpecUnderPrd(service, "Unrelated-scope Spec");

    const incoming = await store.findLinks(specId as never, "in");
    expect(incoming.ok).toBe(true);
    if (!incoming.ok) return;
    expect(incoming.value.filter((l) => l.link_type === "governs")).toHaveLength(0);
  });
});

// ─── BOUNDARY ──────────────────────────────────────────────────────────────────

describe("CorpusService.listGovernedBy — BOUNDARY", () => {
  it("a skill with zero governs links -> ok({docs: [], total: 0})", async () => {
    const { service } = makeService();
    const skill = await createApprovedSkillDoc(service, { title: "Lonely skill", appliesTo: "spec" });
    // No matching doc created — the skill governs nothing.

    const result = await service.listGovernedBy(skill.id);
    expect(result).toEqual({ ok: true, value: { docs: [], total: 0 } });
  });
});

// ─── ERROR (resolve) ───────────────────────────────────────────────────────────

describe("CorpusService.listGovernedBy — ERROR", () => {
  it("an unresolvable id/slug -> err(DOC_NOT_FOUND)", async () => {
    const { service } = makeService();
    const result = await service.listGovernedBy("knowledge-totally-nonexistent-slug");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── REGRESSION — reverse nav backlink ────────────────────────────────────────

describe("CorpusService.get() navigation.related — REGRESSION (governs backlink)", () => {
  it("a governed doc's navigation.related includes the governing skill with link_type 'governs'", async () => {
    const { service } = makeService();
    const skill = await createApprovedSkillDoc(service, { title: "Write-spec rules", appliesTo: "spec" });
    const { specId } = await createSpecUnderPrd(service);

    const got = await service.get(specId);
    expect(got.ok).toBe(true);
    if (!got.ok) return;

    const backlink = got.value.navigation.related.find((r) => r.id === skill.id);
    expect(backlink).toBeDefined();
    expect(backlink?.link_type).toBe("governs");
  });
});

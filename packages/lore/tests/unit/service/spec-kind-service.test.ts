/**
 * Unit tests for SpecKindService.migrateSpecKind.
 * Uses InMemoryStore — no file I/O, no SQLite dependency.
 * Covers HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / IDEMPOTENCY dimensions.
 *
 * Test philosophy: every test encodes a SPEC-032 §3.4 requirement, not what the
 * code happens to do. Adversarial targets identified during implementation read:
 *   - migrateSpecKind dryRun must NOT persist — tests re-read the doc via store.find
 *     directly (bypassing the service) to verify zero writes.
 *   - Already-classified docs (extra.spec_kind "tech"/"design") must be skipped
 *     EVEN IF the heuristic would also fire on their title/content — this is what
 *     makes the sweep idempotent, so a test deliberately sets up a doc that would
 *     match the heuristic but is pre-classified, and confirms it is left alone.
 *   - dryRun=false must preserve unrelated pre-existing extra keys (not overwrite
 *     the whole extra object).
 *   - Idempotency: running twice in a row (dryRun=false both times) — second run
 *     must report touched=0.
 *
 * @spec_ref SPEC-032 §3.4
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { SpecKindService } from "../../../src/service/spec-kind-service.js";
import type { CreateDocInput } from "@lore/core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store));
  const specKindService = new SpecKindService(store);
  return { store, corpusService, specKindService };
}

/** Create a PRD (valid parent for spec docs — spec-kind-audit tests use it as the root). */
async function createPrd(cs: CorpusService, title = "Root PRD"): Promise<string> {
  const result = await cs.create({ type: "prd", title } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create prd: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/** Create a spec under the given PRD parent, optionally overriding extra. */
async function createSpec(
  cs: CorpusService,
  parentId: string,
  title: string,
  content = "",
  extraOpts: Record<string, unknown> = {},
): Promise<{ id: string; slug: string }> {
  const result = await cs.create({
    type: "spec",
    title,
    content,
    extra: extraOpts,
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create spec: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, slug: result.value.slug };
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("migrateSpecKind — HAPPY", () => {
  it("flags a spec with a tech-signal title and default 'feature' kind as a tech candidate (dryRun)", async () => {
    const { corpusService, specKindService } = makeServices();
    const prdId = await createPrd(corpusService);
    const spec = await createSpec(corpusService, prdId, "Corpus Architecture Overview", "n/a");

    const result = await specKindService.migrateSpecKind({ dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toBe(1);
    expect(result.value.skipped).toBe(0);
    expect(result.value.candidates).toHaveLength(1);
    const candidate = result.value.candidates[0];
    expect(candidate?.id).toBe(spec.id);
    expect(candidate?.slug).toBe(spec.slug);
    expect(candidate?.from).toBe("feature");
    expect(candidate?.to).toBe("tech");
    expect(candidate?.matchedIn).toBe("title");
    expect(candidate?.signal.toLowerCase()).toBe("architecture");
  });

  it("flags a spec with a design-signal title as a design candidate", async () => {
    const { corpusService, specKindService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, "Dashboard Visual Redesign", "n/a");

    const result = await specKindService.migrateSpecKind({ dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toBe(1);
    expect(result.value.candidates[0]?.to).toBe("design");
  });

  it("different fixtures produce different candidate kinds (defeats a hardcoded-return stub)", async () => {
    const { corpusService, specKindService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, "Storage Migration Plan", "n/a");
    await createSpec(corpusService, prdId, "Prototype Component Library", "n/a");

    const result = await specKindService.migrateSpecKind({ dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toBe(2);
    const kinds = result.value.candidates.map((c) => c.to).sort();
    expect(kinds).toEqual(["design", "tech"]);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("migrateSpecKind — NEGATIVE", () => {
  it("a spec with no signal in title or content is skipped, not touched", async () => {
    const { corpusService, specKindService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, "Quarterly Roadmap Review", "Upcoming feature priorities.");

    const result = await specKindService.migrateSpecKind({ dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toBe(0);
    expect(result.value.skipped).toBe(1);
    expect(result.value.candidates).toHaveLength(0);
  });

  it("a spec ALREADY explicitly extra.spec_kind='tech' is skipped even though its title also matches a design signal", async () => {
    const { corpusService, specKindService, store } = makeServices();
    const prdId = await createPrd(corpusService);
    // Title matches DESIGN_SIGNAL_PATTERN ("dashboard"/"ui"), but this doc is
    // already explicitly classified as "tech" — must never be re-touched.
    const spec = await createSpec(corpusService, prdId, "Dashboard UI Notes", "n/a", {
      spec_kind: "tech",
    });

    const result = await specKindService.migrateSpecKind({ dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toBe(0);
    expect(result.value.skipped).toBe(1);
    expect(result.value.candidates).toHaveLength(0);

    // Confirm the doc's spec_kind was never altered.
    const doc = await store.find(spec.id as unknown as Parameters<typeof store.find>[0]);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value?.extra["spec_kind"]).toBe("tech");
  });

  it("a spec ALREADY explicitly extra.spec_kind='design' is skipped even though its title also matches a tech signal", async () => {
    const { corpusService, specKindService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, "Architecture Schema Notes", "n/a", {
      spec_kind: "design",
    });

    const result = await specKindService.migrateSpecKind({ dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toBe(0);
    expect(result.value.skipped).toBe(1);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("migrateSpecKind — BOUNDARY (mixed corpus)", () => {
  it("mixed corpus: candidates, already-classified, and no-signal specs are counted correctly", async () => {
    const { corpusService, specKindService } = makeServices();
    const prdId = await createPrd(corpusService);

    // Candidate: tech signal, default feature kind
    await createSpec(corpusService, prdId, "Service Layer Architecture", "n/a");
    // Candidate: design signal, default feature kind
    await createSpec(corpusService, prdId, "Component Prototype", "n/a");
    // Already classified — must be skipped regardless of signal
    await createSpec(corpusService, prdId, "Dashboard Notes", "n/a", { spec_kind: "design" });
    // No signal anywhere — skipped
    await createSpec(corpusService, prdId, "Team Roadmap", "Priorities for next quarter.");
    await createSpec(corpusService, prdId, "Onboarding Guide", "How to join the team.");

    const result = await specKindService.migrateSpecKind({ dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toBe(2);
    expect(result.value.skipped).toBe(3);
    expect(result.value.candidates).toHaveLength(2);
  });
});

// ─── ERROR / STATE — dryRun performs zero writes ────────────────────────────

describe("migrateSpecKind — ERROR/STATE (dryRun write isolation)", () => {
  it("dryRun=true reports the candidate but performs ZERO writes to the store", async () => {
    const { corpusService, specKindService, store } = makeServices();
    const prdId = await createPrd(corpusService);
    const spec = await createSpec(corpusService, prdId, "Storage Adapter Overview", "n/a");

    const result = await specKindService.migrateSpecKind({ dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toBe(1);
    expect(result.value.dryRun).toBe(true);

    // Fetch the doc directly from the store (bypassing the service) — spec_kind
    // must be unchanged ("feature") because dryRun must not call store.update.
    const doc = await store.find(spec.id as unknown as Parameters<typeof store.find>[0]);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    expect(doc.value?.extra["spec_kind"]).toBe("feature");
  });
});

describe("migrateSpecKind — STATE (dryRun=false persists)", () => {
  it("dryRun=false actually writes the suggested spec_kind, preserving other pre-existing extra keys", async () => {
    const { corpusService, specKindService, store } = makeServices();
    const prdId = await createPrd(corpusService);
    const spec = await createSpec(corpusService, prdId, "Storage Adapter Overview", "n/a", {
      owner: "team-infra",
    });

    const result = await specKindService.migrateSpecKind({ dryRun: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.touched).toBe(1);
    expect(result.value.dryRun).toBe(false);

    const doc = await store.find(spec.id as unknown as Parameters<typeof store.find>[0]);
    expect(doc.ok).toBe(true);
    if (!doc.ok) return;
    // spec_kind reclassified to the heuristic-suggested kind.
    expect(doc.value?.extra["spec_kind"]).toBe("tech");
    // Unrelated pre-existing extra key survives the update (not clobbered).
    expect(doc.value?.extra["owner"]).toBe("team-infra");
  });
});

// ─── IDEMPOTENCY ─────────────────────────────────────────────────────────────

describe("migrateSpecKind — IDEMPOTENCY", () => {
  it("running twice in a row (dryRun=false both times) — second run reports touched=0", async () => {
    const { corpusService, specKindService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, "Data Migration Schema", "n/a");

    const firstRun = await specKindService.migrateSpecKind({ dryRun: false });
    expect(firstRun.ok).toBe(true);
    if (!firstRun.ok) return;
    expect(firstRun.value.touched).toBe(1);

    const secondRun = await specKindService.migrateSpecKind({ dryRun: false });
    expect(secondRun.ok).toBe(true);
    if (!secondRun.ok) return;
    // Spec-032 §3.4: idempotent — the previously-flagged doc is now in the
    // already-classified bucket and must not be re-touched.
    expect(secondRun.value.touched).toBe(0);
    expect(secondRun.value.skipped).toBe(1);
    expect(secondRun.value.candidates).toHaveLength(0);
  });
});

/**
 * RED suite (TDD-Role: red, paired-impl task T6 "OutlineMigrationService") for
 * `packages/lore/src/service/outline-migration-service.ts` — a module that does
 * NOT exist yet. Covers AC-080-7 (migration dry-run on a violation fixture
 * reports the failed set-equality invariant and performs zero writes — doc
 * version count unchanged before/after) plus the broader Migration Plan
 * invariants from spec-080-prd-as-outline-contract-structured-outline-domain
 * (§Migration Plan Phase 1, §Risk Registry "Mid-migration content loss").
 *
 * Runner: bun:sqlite (real `SQLiteStore`, mkdtemp'd throwaway DB per test) —
 * must run under `bun test`, not vitest (project CLAUDE.md "bun:sqlite is
 * external to vitest").
 * NEVER touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * RED mechanism (mirrors packages/lore/tests/unit/service/phase-migration.bun.test.ts
 * and packages/lore/tests/unit/service/seat-service.test.ts — this repo's
 * SPEC-056/057 RED precedent): `OutlineMigrationService` is loaded via a dynamic
 * `import()` whose specifier is a COMPUTED (non-literal) string, so
 * `bun run typecheck` stays green before `outline-migration-service.ts` exists
 * (TS only statically resolves literal `import()` specifiers) and the import
 * genuinely throws ("Cannot find module") at runtime today.
 *
 * The `SectionMigrationVerdict`/`OutlineMigrationRefusal`/
 * `OutlineMigrationServiceCtor` interfaces below are this suite's OWN local
 * contract for the not-yet-existing module (same practice phase-migration.bun.test.ts
 * documents) — the paired implementer (T6) must satisfy them verbatim; this
 * suite pins the CONTRACT, not a re-derivation of the real module's eventual
 * internals.
 *
 * Fixture (built inline, not a JSON file — small enough to stay readable):
 * a throwaway PRD doc whose `content` carries 3 domain sections
 * ("feedback-loop" §14, "session-layer" §15, "memory-hygiene" §16), each with
 * an explicit, hand-declared ground-truth `sectionRefs`/`rIds` set (this suite
 * pins the EXPECTED sets directly rather than re-deriving them via regex — the
 * real extraction logic is the paired implementer's job).
 *   - "feedback-loop" has NO pre-existing child doc (fresh — exercises the
 *     first-run dry-run + live-run two-step-order paths).
 *   - "session-layer" has a pre-existing but INCOMPLETE child doc (missing its
 *     second paragraph, which is the only paragraph carrying the §15 marker) —
 *     the VIOLATION fixture: char-coverage and section-ref-equality both fail,
 *     r-id-equality independently PASSES (its lone R-16 ref survived in the
 *     paragraph that IS present) — proving the three invariants are computed
 *     independently, not collapsed into one bundled boolean.
 *   - "memory-hygiene" has a pre-existing COMPLETE child doc (full section text,
 *     byte-identical coverage) — the IDEMPOTENCY fixture.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      dry-run over all 3 seeded sections reports per-section
 *               char-coverage + section-ref + R-id set-equality verdicts, and
 *               the whole dry run performs zero writes (doc count + PRD
 *               version unchanged)
 *   NEGATIVE:   the violation fixture's failed invariants are named by name in
 *               dry-run, AND a live run on that section is REFUSED (Result
 *               err), performing zero writes
 *   BOUNDARY:   an unknown section key (not present in the PRD at all) is
 *               rejected with zero writes
 *   ERROR:      a closed store surfaces a typed Result err, never a throw
 *   STATE:      a live run on the fresh section proves the two-step write
 *               order (child doc insert + link BEFORE the PRD body-shrink
 *               update) via a store-call-order spy; separately, the
 *               pre-seeded already-complete child doc is detected as
 *               already-migrated (zero writes) without needing a live run
 *   REGRESSION: after a real live migration of the fresh section, calling
 *               migrateSection again on that SAME now-migrated section
 *               performs zero additional writes (idempotent re-run)
 *
 * Source: spec-080-prd-as-outline-contract-structured-outline-domain
 *   §C1, §Migration Plan Phase 1, §Risk Registry, §Acceptance Criteria AC-080-7.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulidx";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface, UpdateOpts } from "../../../src/store/store-interface.js";
import type { DocRecord, LinkRecord, LoreError, Result } from "@lore/core";

// packages/lore/tests/unit/service/ -> ../../../ -> packages/lore/src/service/outline-migration-service.js
const OUTLINE_MIGRATION_SERVICE_MODULE_PATH = [
  "..",
  "..",
  "..",
  "src",
  "service",
  "outline-migration-service.js",
].join("/");

// ─── Minimal local contract for the not-yet-existing module ───────────────────
//
// DELIBERATELY narrower/looser than the real module's eventual exports (mirrors
// phase-migration.bun.test.ts's precedent) — just enough structure for this
// suite to call through. The paired implementer's real
// outline-migration-service.ts is the source of truth once it lands; this
// suite pins the CONTRACT it must satisfy.

/** Pass/fail + a human-readable detail for one migration invariant. */
interface InvariantVerdict {
  passed: boolean;
  detail: string;
}

/**
 * Verdict for one `migrateSection` call.
 *
 *   - passed: AND of the three invariants below (dry-run) or "the write
 *     actually landed" (live run).
 *   - already_migrated: true when a pre-existing child doc already fully
 *     covers the old section — the idempotency-skip path (zero writes
 *     regardless of dryRun).
 *   - writes_performed: total store mutations this call made (0 for every
 *     dry-run call and every already-migrated skip; > 0 only on a successful
 *     first-time live run).
 *   - char_coverage: `chars(old §) ⊆ chars(child doc content)` (the outline
 *     entry's own bounded summary is additive coverage once the outline verb
 *     family lands — T6's scope is the child-doc side of this invariant).
 *   - section_ref_equality / r_id_equality: set-equality between the old
 *     section's `§`/`R-##` token sets and the child doc's token sets.
 *   - failed_invariants: the SUBSET of {"char_coverage",
 *     "section_ref_equality", "r_id_equality"} that failed, by field name —
 *     empty when passed is true.
 */
interface SectionMigrationVerdict {
  section: string;
  dry_run: boolean;
  passed: boolean;
  already_migrated: boolean;
  writes_performed: number;
  char_coverage: InvariantVerdict;
  section_ref_equality: InvariantVerdict;
  r_id_equality: InvariantVerdict;
  domain_doc_id?: string;
  failed_invariants: string[];
}

/** Refusal shape for a live run that fails its own invariant check. */
interface OutlineMigrationRefusal {
  code: string;
  message: string;
  section: string;
  failed_invariants: string[];
}

interface OutlineMigrationServiceCtor {
  new (store: StoreInterface): {
    migrateSection(
      prdId: string,
      section: string,
      opts: { dryRun: boolean },
    ): Promise<Result<SectionMigrationVerdict, OutlineMigrationRefusal>>;
  };
}

async function loadOutlineMigrationServiceCtor(): Promise<OutlineMigrationServiceCtor> {
  const mod = (await import(OUTLINE_MIGRATION_SERVICE_MODULE_PATH)) as unknown as {
    OutlineMigrationService: OutlineMigrationServiceCtor;
  };
  return mod.OutlineMigrationService;
}

// ─── Fixture construction (inline — small enough to stay readable) ────────────

interface SectionFixture {
  key: string;
  heading: string;
  paragraphs: string[];
  /** Ground truth this suite declares for the "old section" token sets. */
  sectionRefs: string[];
  rIds: string[];
}

const OVERVIEW_TEXT =
  "## 1. Overview\n\nCore intro text, not a domain section, never migrated by this service.";

const SECTION_FIXTURES: Record<string, SectionFixture> = {
  "feedback-loop": {
    key: "feedback-loop",
    heading: "## 14. Feedback Loop",
    paragraphs: [
      "Every lifecycle transition is audit-traced end to end, closing the loop described by §14 (R-14).",
      "Calibration data accumulates per doc type; Wilson-bounded agreement gates the auto-approve trigger (R-15).",
    ],
    sectionRefs: ["§14"],
    rIds: ["R-14", "R-15"],
  },
  "session-layer": {
    key: "session-layer",
    heading: "## 15. Session Layer",
    paragraphs: [
      "Bootstrap injects a volatile pointer-set so a fresh session never re-derives corpus state from scratch (R-16).",
      "Lossless handoff lets a session end mid-task and resume with zero human re-briefing, per §15.",
    ],
    sectionRefs: ["§15"],
    rIds: ["R-16"],
  },
  "memory-hygiene": {
    key: "memory-hygiene",
    heading: "## 16. Memory Hygiene",
    paragraphs: [
      "Bi-temporal invalidation marks a doc wrong-as-of a point in time without deleting its history (R-17, R-18).",
      "Staleness probes surface priority = in-degree x age, feeding the drift oracle, per §16.",
    ],
    sectionRefs: ["§16"],
    rIds: ["R-17", "R-18"],
  },
};

function sectionBodyText(fx: SectionFixture): string {
  return [fx.heading, ...fx.paragraphs].join("\n\n");
}

function buildPrdContent(): string {
  return [
    "# Root PRD (fixture)",
    "",
    OVERVIEW_TEXT,
    "",
    sectionBodyText(SECTION_FIXTURES["feedback-loop"]!),
    "",
    sectionBodyText(SECTION_FIXTURES["session-layer"]!),
    "",
    sectionBodyText(SECTION_FIXTURES["memory-hygiene"]!),
    "",
  ].join("\n");
}

function domainDocSlugFor(section: string): string {
  return `spec-domain-overview-${section}`;
}

const FIXED_TIME_PRD = "2026-07-20T00:00:00.000Z";
const FIXED_TIME_CHILD = "2026-07-21T00:00:00.000Z";

function buildFixturePrd(): DocRecord {
  return {
    id: ulid(),
    slug: "prd-fixture-outline-migration",
    type: "prd",
    role: "intent",
    title: "Fixture Root PRD (outline migration)",
    status: "approved",
    priority: "critical",
    content: buildPrdContent(),
    parent_id: null,
    created_at: FIXED_TIME_PRD,
    updated_at: FIXED_TIME_PRD,
    created_by: "outline-migration-fixture",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
}

/** Incomplete pre-existing child doc for "session-layer" — missing its 2nd
 *  paragraph (the only one carrying the §15 marker). R-16 (in paragraph 1)
 *  survives, so r_id_equality independently PASSES while char_coverage and
 *  section_ref_equality both FAIL — proving the three invariants are computed
 *  independently. */
function buildIncompleteChildDoc(prdId: string): DocRecord {
  const fx = SECTION_FIXTURES["session-layer"]!;
  return {
    id: ulid(),
    slug: domainDocSlugFor(fx.key),
    type: "spec",
    role: "spec",
    title: "Session Layer (domain overview, fixture — INCOMPLETE on purpose)",
    status: "draft",
    priority: "medium",
    content: [fx.heading, fx.paragraphs[0]].join("\n\n"),
    parent_id: prdId,
    created_at: FIXED_TIME_CHILD,
    updated_at: FIXED_TIME_CHILD,
    created_by: "outline-migration-fixture",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { spec_kind: "domain-overview" },
  };
}

/** Complete pre-existing child doc for "memory-hygiene" — full section text,
 *  byte-identical coverage. The idempotency-marker fixture. */
function buildCompleteChildDoc(prdId: string): DocRecord {
  const fx = SECTION_FIXTURES["memory-hygiene"]!;
  return {
    id: ulid(),
    slug: domainDocSlugFor(fx.key),
    type: "spec",
    role: "spec",
    title: "Memory Hygiene (domain overview, fixture — complete)",
    status: "approved",
    priority: "medium",
    content: sectionBodyText(fx),
    parent_id: prdId,
    created_at: FIXED_TIME_CHILD,
    updated_at: FIXED_TIME_CHILD,
    created_by: "outline-migration-fixture",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { spec_kind: "domain-overview" },
  };
}

// ─── Store seeding + generic read helpers ──────────────────────────────────

async function mustInsert(store: StoreInterface, doc: DocRecord): Promise<void> {
  const result = await store.insert(doc);
  if (!result.ok) {
    throw new Error(`fixture insert failed for ${doc.slug}: ${JSON.stringify(result.error)}`);
  }
}

async function mustAddLink(store: StoreInterface, link: LinkRecord): Promise<void> {
  const result = await store.addLink(link);
  if (!result.ok) {
    throw new Error(`fixture addLink failed for ${link.from_id}->${link.to_id}: ${JSON.stringify(result.error)}`);
  }
}

async function mustFindMany(store: StoreInterface): Promise<DocRecord[]> {
  const result = await store.findMany({});
  if (!result.ok) throw new Error(`findMany failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function mustFind(store: StoreInterface, id: string): Promise<DocRecord> {
  const result = await store.find(id);
  if (!result.ok) throw new Error(`find failed: ${JSON.stringify(result.error)}`);
  if (result.value === null) throw new Error(`doc not found: ${id}`);
  return result.value;
}

// ─── Suite setup ────────────────────────────────────────────────────────────

let tempDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "lore-outline-migration-"));
  dbPath = join(tempDir, "test.db");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Seeds a single store carrying all 3 fixture scenarios at once (fresh /
 *  violation / already-migrated), matching the task's "seeded prd with 3
 *  domain sections" framing. */
async function freshSeededStore(): Promise<{
  store: SQLiteStore;
  prd: DocRecord;
  incompleteChild: DocRecord;
  completeChild: DocRecord;
}> {
  const store = new SQLiteStore(dbPath);
  const prd = buildFixturePrd();
  await mustInsert(store, prd);

  const incompleteChild = buildIncompleteChildDoc(prd.id);
  await mustInsert(store, incompleteChild);

  const completeChild = buildCompleteChildDoc(prd.id);
  await mustInsert(store, completeChild);
  await mustAddLink(store, {
    from_id: prd.id,
    to_id: completeChild.id,
    link_type: "relates-to",
    created_at: FIXED_TIME_CHILD,
    created_by: "outline-migration-fixture",
  });

  return { store, prd, incompleteChild, completeChild };
}

// ─── HAPPY: dry-run over all 3 seeded sections, per-section verdict shape ──────

describe("OutlineMigrationService.migrateSection — dry-run per-section verdicts (AC-080-7 HAPPY)", () => {
  it("reports char-coverage + section-ref + R-id set-equality verdicts for every section and performs zero writes total", async () => {
    const { store, prd } = await freshSeededStore();
    const docsBefore = await mustFindMany(store);
    const docCountBefore = docsBefore.length;
    const prdVersionBefore = (await mustFind(store, prd.id)).version;

    const OutlineMigrationService = await loadOutlineMigrationServiceCtor();
    const service = new OutlineMigrationService(store);

    for (const section of ["feedback-loop", "session-layer", "memory-hygiene"]) {
      const result = await service.migrateSection(prd.id, section, { dryRun: true });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const verdict = result.value;
      expect(verdict.section).toBe(section);
      expect(verdict.dry_run).toBe(true);
      expect(verdict.writes_performed).toBe(0);
      // every verdict carries all three independently-computed invariants
      expect(verdict.char_coverage).toBeDefined();
      expect(verdict.section_ref_equality).toBeDefined();
      expect(verdict.r_id_equality).toBeDefined();
    }

    // fresh section: nothing to violate yet — a straight verbatim extraction
    // trivially satisfies all three invariants
    const freshResult = await service.migrateSection(prd.id, "feedback-loop", { dryRun: true });
    if (freshResult.ok) {
      expect(freshResult.value.passed).toBe(true);
      expect(freshResult.value.already_migrated).toBe(false);
    }

    // already-complete section: idempotency-skip, still zero writes
    const completeResult = await service.migrateSection(prd.id, "memory-hygiene", { dryRun: true });
    if (completeResult.ok) {
      expect(completeResult.value.already_migrated).toBe(true);
      expect(completeResult.value.passed).toBe(true);
    }

    // zero writes across the WHOLE dry-run sweep — doc count + PRD version unchanged
    const docsAfter = await mustFindMany(store);
    expect(docsAfter).toHaveLength(docCountBefore);
    const prdVersionAfter = (await mustFind(store, prd.id)).version;
    expect(prdVersionAfter).toBe(prdVersionBefore);

    store.close();
  });
});

// ─── NEGATIVE: violation fixture — failed invariant named, live run refused ────

describe("OutlineMigrationService.migrateSection — violation fixture (AC-080-7 NEGATIVE)", () => {
  it("dry-run names char_coverage and section_ref_equality as failed while r_id_equality independently passes", async () => {
    const { store, prd } = await freshSeededStore();

    const OutlineMigrationService = await loadOutlineMigrationServiceCtor();
    const service = new OutlineMigrationService(store);
    const result = await service.migrateSection(prd.id, "session-layer", { dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const verdict = result.value;

    expect(verdict.passed).toBe(false);
    expect(verdict.char_coverage.passed).toBe(false);
    expect(verdict.section_ref_equality.passed).toBe(false);
    expect(verdict.r_id_equality.passed).toBe(true);
    expect(verdict.failed_invariants).toContain("char_coverage");
    expect(verdict.failed_invariants).toContain("section_ref_equality");
    expect(verdict.failed_invariants).not.toContain("r_id_equality");

    store.close();
  });

  it("refuses a live run on the violating section, performing zero writes", async () => {
    const { store, prd, incompleteChild } = await freshSeededStore();
    const docsBefore = await mustFindMany(store);
    const docCountBefore = docsBefore.length;
    const childBefore = await mustFind(store, incompleteChild.id);

    const OutlineMigrationService = await loadOutlineMigrationServiceCtor();
    const service = new OutlineMigrationService(store);
    const result = await service.migrateSection(prd.id, "session-layer", { dryRun: false });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.section).toBe("session-layer");
    expect(result.error.failed_invariants.length).toBeGreaterThan(0);

    // zero writes: doc count unchanged, incomplete child doc untouched, PRD untouched
    const docsAfter = await mustFindMany(store);
    expect(docsAfter).toHaveLength(docCountBefore);
    const childAfter = await mustFind(store, incompleteChild.id);
    expect(childAfter.version).toBe(childBefore.version);
    expect(childAfter.content).toBe(childBefore.content);
    const prdAfter = await mustFind(store, prd.id);
    expect(prdAfter.version).toBe(1);

    store.close();
  });
});

// ─── BOUNDARY: unknown section key ─────────────────────────────────────────────

describe("OutlineMigrationService.migrateSection — unknown section key (AC-080-7 BOUNDARY)", () => {
  it("is rejected with zero writes when the section does not exist in the PRD body at all", async () => {
    const { store, prd } = await freshSeededStore();
    const docsBefore = await mustFindMany(store);

    const OutlineMigrationService = await loadOutlineMigrationServiceCtor();
    const service = new OutlineMigrationService(store);
    const result = await service.migrateSection(prd.id, "nonexistent-section-xyz", { dryRun: false });

    expect(result.ok).toBe(false);

    const docsAfter = await mustFindMany(store);
    expect(docsAfter).toHaveLength(docsBefore.length);

    store.close();
  });
});

// ─── ERROR: closed store surfaces a typed Result err, never a throw ────────────

describe("OutlineMigrationService.migrateSection — closed store (AC-080-7 ERROR)", () => {
  it("returns a Result err instead of throwing when the underlying store is closed", async () => {
    const { store, prd } = await freshSeededStore();
    store.close();

    const OutlineMigrationService = await loadOutlineMigrationServiceCtor();
    const service = new OutlineMigrationService(store);
    const result = await service.migrateSection(prd.id, "feedback-loop", { dryRun: false });

    expect(result.ok).toBe(false);
  });
});

// ─── STATE: pre-existing complete child doc detected as already-migrated ──────

describe("OutlineMigrationService.migrateSection — pre-existing complete child doc (AC-080-7 STATE)", () => {
  it("detects the already-migrated section via its slug marker and performs zero writes even on a live run", async () => {
    const { store, prd, completeChild } = await freshSeededStore();
    const docsBefore = await mustFindMany(store);
    const childBefore = await mustFind(store, completeChild.id);

    const OutlineMigrationService = await loadOutlineMigrationServiceCtor();
    const service = new OutlineMigrationService(store);
    const result = await service.migrateSection(prd.id, "memory-hygiene", { dryRun: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.already_migrated).toBe(true);
    expect(result.value.writes_performed).toBe(0);
    expect(result.value.passed).toBe(true);

    const docsAfter = await mustFindMany(store);
    expect(docsAfter).toHaveLength(docsBefore.length);
    const childAfter = await mustFind(store, completeChild.id);
    expect(childAfter.version).toBe(childBefore.version);

    store.close();
  });
});

// ─── STATE: live run proves the two-step write order (BUG-class: mid-migration content loss) ──

/**
 * Wraps a real `SQLiteStore` recording the ORDER of `insert` / `addLink` /
 * `update` calls, so this suite can prove — independent of the service's own
 * self-report — that the child doc (and its link) are durably written BEFORE
 * the PRD's body-shrink update, per the spec's Risk Registry mitigation
 * ("Two-phase per-section ordering: create+link FIRST, shrink second").
 */
function wrapStoreRecordingOrder(store: SQLiteStore, log: string[]): StoreInterface {
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "insert") {
        return async (doc: DocRecord) => {
          const result = await target.insert(doc);
          if (result.ok) log.push(`insert:${doc.type}:${doc.slug}`);
          return result;
        };
      }
      if (prop === "addLink") {
        return async (link: LinkRecord) => {
          const result = await target.addLink(link);
          if (result.ok) log.push(`addLink:${link.from_id}->${link.to_id}`);
          return result;
        };
      }
      if (prop === "update") {
        return async (id: string, patch: Partial<DocRecord>, opts?: UpdateOpts) => {
          const result = await target.update(id, patch, opts);
          if (result.ok) {
            log.push(`update:${id}:${patch.content !== undefined ? "content" : "other"}`);
          }
          return result;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as StoreInterface;
}

describe("OutlineMigrationService.migrateSection — two-step write order on a fresh live run (AC-080-7 STATE)", () => {
  it("inserts the child doc and creates its link BEFORE the PRD content-shrink update", async () => {
    const { store: rawStore, prd } = await freshSeededStore();
    const log: string[] = [];
    const wrappedStore = wrapStoreRecordingOrder(rawStore, log);

    const OutlineMigrationService = await loadOutlineMigrationServiceCtor();
    const service = new OutlineMigrationService(wrappedStore);
    const result = await service.migrateSection(prd.id, "feedback-loop", { dryRun: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.already_migrated).toBe(false);
    expect(result.value.passed).toBe(true);

    const insertIdx = log.findIndex((l) => l.startsWith("insert:spec:"));
    const linkIdx = log.findIndex((l) => l.startsWith("addLink:"));
    const shrinkIdx = log.findIndex((l) => l === `update:${prd.id}:content`);

    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(linkIdx).toBeGreaterThanOrEqual(0);
    expect(shrinkIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeLessThan(shrinkIdx);
    expect(linkIdx).toBeLessThan(shrinkIdx);

    // the shrink must have actually shrunk the PRD — shorter, and no longer
    // carrying the section's 2nd paragraph verbatim
    const prdAfter = await mustFind(rawStore, prd.id);
    expect(prdAfter.content.length).toBeLessThan(prd.content.length);
    expect(prdAfter.content).not.toContain(SECTION_FIXTURES["feedback-loop"]!.paragraphs[1]!);

    rawStore.close();
  });
});

// ─── REGRESSION: re-running migrateSection on a freshly-migrated section is a no-op ──

describe("OutlineMigrationService.migrateSection — idempotent re-run after a real live migration (AC-080-7 REGRESSION)", () => {
  it("performs zero additional writes when migrateSection is called again on the SAME now-migrated section", async () => {
    const { store, prd } = await freshSeededStore();

    const OutlineMigrationService = await loadOutlineMigrationServiceCtor();
    const service = new OutlineMigrationService(store);

    const firstRun = await service.migrateSection(prd.id, "feedback-loop", { dryRun: false });
    expect(firstRun.ok).toBe(true);
    if (!firstRun.ok) return;
    expect(firstRun.value.writes_performed).toBeGreaterThan(0);

    const docsAfterFirst = await mustFindMany(store);
    const snapshotAfterFirst = new Map(docsAfterFirst.map((d) => [d.id, d.version]));

    const secondRun = await service.migrateSection(prd.id, "feedback-loop", { dryRun: false });
    expect(secondRun.ok).toBe(true);
    if (!secondRun.ok) return;
    expect(secondRun.value.already_migrated).toBe(true);
    expect(secondRun.value.writes_performed).toBe(0);

    const docsAfterSecond = await mustFindMany(store);
    expect(docsAfterSecond).toHaveLength(docsAfterFirst.length);
    const snapshotAfterSecond = new Map(docsAfterSecond.map((d) => [d.id, d.version]));
    expect(snapshotAfterSecond).toEqual(snapshotAfterFirst);

    store.close();
  });
});

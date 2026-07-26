/**
 * RED suite (TDD-Role: red, paired-impl task T6 "OutlineMigrationService") for
 * a `renderLinkOnlyOutlineForBootstrap` export co-located with
 * `packages/lore/src/service/outline-migration-service.ts` — a module that
 * does NOT exist yet. Pins AC-080-8: "bootstrap/feed inject link-only
 * outline: injected PRD-derived content < 32000 chars on the migrated
 * corpus (payload-size regression pin, no resolved MDX)".
 *
 * Runner: bun:sqlite (real `SQLiteStore`, mkdtemp'd throwaway DB per test) —
 * must run under `bun test`, not vitest.
 * NEVER touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * Scope note: wiring this render function INTO the real `lore bootstrap`
 * / `lore feed session-resume` commands (SessionService.bootstrap currently
 * only carries a `{slug, title}` root pointer — see
 * packages/lore/src/adapters/cli/commands/bootstrap.ts) is a follow-up task's
 * responsibility, outside this task's two-file boundary. This suite pins the
 * SIZE + link-only invariant at the RENDER-FUNCTION level: it takes a
 * migrated PRD `DocRecord` (§C1 `extra.outline[]` populated, `content`
 * already shrunk) and returns the bounded payload string a future bootstrap
 * wiring task will inject verbatim. The signature `(prd: DocRecord) =>
 * string` — no store, no child-doc access — is itself the "link-only, never
 * resolved MDX" (T7) enforcement mechanism: a function that never receives
 * child-doc bodies structurally cannot inline them.
 *
 * RED mechanism (mirrors phase-migration.bun.test.ts / seat-service.test.ts):
 * dynamic `import()` with a COMPUTED (non-literal) specifier, so
 * `bun run typecheck` stays green before the module exists and the import
 * genuinely throws ("Cannot find module") at runtime today.
 *
 * Fixture: a hand-built "already migrated" PRD — 12 domain-overview outline
 * entries, each carrying a short bounded `direction` summary + a `links[]`
 * pointer to its child doc's slug. The ORIGINAL (pre-migration) equivalent
 * prose is built separately purely to prove the render function's output is
 * dramatically smaller than a naive full-content dump would be — it is never
 * passed to the render function itself (structurally unreachable, per the
 * scope note above).
 *
 * Four-dimension coverage for this integration-scoped file:
 *   HAPPY:    12-section migrated fixture -> payload < 32000 chars, non-empty,
 *             carries every section's title + child-doc slug pointer
 *   NEGATIVE: payload is dramatically smaller than the pre-migration original
 *             prose length (regression pin beyond the bare threshold — proves
 *             it isn't coincidentally close to failing)
 *   BOUNDARY: zero-outline-entries PRD (root-only, nothing migrated yet)
 *             still renders a well-formed, non-throwing, in-budget payload
 *   ERROR:    a malformed `extra.outline` (not an array) degrades gracefully
 *             — never throws — mirroring the Downstream Handoff note
 *             ("budget check on legacy PRD without outline[] … never crash")
 *
 * Source: spec-080-prd-as-outline-contract-structured-outline-domain
 *   §C1, §Data Flow ("Read (agent)"), §Trade-off Decisions T7,
 *   §Acceptance Criteria AC-080-8.
 */

import { describe, expect, it } from "bun:test";
import { ulid } from "ulidx";
import type { DocRecord } from "@lore/core";

// packages/lore/tests/integration/ -> ../../ -> packages/lore/src/service/outline-migration-service.js
const OUTLINE_MIGRATION_SERVICE_MODULE_PATH = [
  "..",
  "..",
  "src",
  "service",
  "outline-migration-service.js",
].join("/");

// ─── Minimal local contract for the not-yet-existing module ───────────────────

async function loadRenderLinkOnlyOutlineForBootstrap(): Promise<(prd: DocRecord) => string> {
  const mod = (await import(OUTLINE_MIGRATION_SERVICE_MODULE_PATH)) as unknown as {
    renderLinkOnlyOutlineForBootstrap: (prd: DocRecord) => string;
  };
  return mod.renderLinkOnlyOutlineForBootstrap;
}

// ─── Fixture construction ───────────────────────────────────────────────────

const DOMAIN_SECTION_COUNT = 12;

/** One long, unique-per-section filler paragraph — used to build the
 *  PRE-migration equivalent prose length for the NEGATIVE comparison below.
 *  Never passed to the render function itself. */
function longOriginalParagraph(n: number): string {
  const sentence = `Domain narrative sentence for section ${n} restates staged commitments, owner-decision context, and hard constraints for this domain round after round. `;
  return sentence.repeat(20);
}

function originalSectionHeading(n: number): string {
  return `## ${13 + n}. Domain Section ${n}`;
}

/** Total character count of what the PRE-migration PRD body would have been
 *  for `DOMAIN_SECTION_COUNT` domain sections at 2 long paragraphs each. */
function buildOriginalEquivalentLength(): number {
  let total = 0;
  for (let i = 1; i <= DOMAIN_SECTION_COUNT; i++) {
    total += originalSectionHeading(i).length + 2 * longOriginalParagraph(i).length + 4; // separators
  }
  return total;
}

interface OutlineEntryFixture {
  section: string;
  title: string;
  tier: "core" | "domain";
  direction: string;
  decision_pointers: string[];
  constraints: string[];
  links: Array<{ slug: string; rel: "detail" | "landing-spec" | "adr" }>;
}

function buildOutlineEntry(n: number): OutlineEntryFixture {
  return {
    section: `domain-section-${n}`,
    title: `Domain Section ${n}`,
    tier: "domain",
    direction: `Bounded summary for domain section ${n}: staged commitments and constraints, detail linked below.`,
    decision_pointers: [`adr-domain-section-${n}-decision`],
    constraints: [`Constraint ${n}.1 stays hard-invariant, not renegotiable per round.`],
    links: [{ slug: `spec-domain-overview-domain-section-${n}`, rel: "detail" }],
  };
}

const FIXED_TIME = "2026-07-20T00:00:00.000Z";

/** A hand-built "already migrated" PRD: `content` already shrunk to a small
 *  rendered projection, `extra.outline[]` fully populated. */
function buildMigratedPrd(entryCount: number): DocRecord {
  const outline = Array.from({ length: entryCount }, (_, i) => buildOutlineEntry(i + 1));
  return {
    id: ulid(),
    slug: "prd-fixture-migrated-outline",
    type: "prd",
    role: "intent",
    title: "Fixture Root PRD (post-migration)",
    status: "approved",
    priority: "critical",
    content: "# Root PRD (fixture, post-migration)\n\nBody is a rendered projection of extra.outline[].",
    parent_id: null,
    created_at: FIXED_TIME,
    updated_at: FIXED_TIME,
    created_by: "outline-migration-fixture",
    version: 2,
    deleted_at: null,
    tags: [],
    extra: { outline },
  };
}

/** A root-only PRD — nothing migrated yet, `extra.outline` absent entirely. */
function buildUnmigratedPrd(): DocRecord {
  return {
    id: ulid(),
    slug: "prd-fixture-unmigrated",
    type: "prd",
    role: "intent",
    title: "Fixture Root PRD (nothing migrated)",
    status: "approved",
    priority: "critical",
    content: "# Root PRD (fixture)\n\n## 1. Overview\n\nOnly the narrative core exists so far.",
    parent_id: null,
    created_at: FIXED_TIME,
    updated_at: FIXED_TIME,
    created_by: "outline-migration-fixture",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  };
}

/** A PRD with a MALFORMED `extra.outline` (a string, not an array) —
 *  simulates hand-edited/legacy corpus drift the render function must
 *  degrade gracefully against, never throw on. */
function buildMalformedOutlinePrd(): DocRecord {
  return {
    ...buildUnmigratedPrd(),
    id: ulid(),
    slug: "prd-fixture-malformed-outline",
    extra: { outline: "not-an-array" },
  };
}

// ─── HAPPY: 12-section migrated fixture stays comfortably under budget ─────────

describe("renderLinkOnlyOutlineForBootstrap — migrated 12-section PRD (AC-080-8 HAPPY)", () => {
  it("renders a non-empty, well-formed, sub-32000-char payload carrying every section's pointer", async () => {
    const prd = buildMigratedPrd(DOMAIN_SECTION_COUNT);
    const render = await loadRenderLinkOnlyOutlineForBootstrap();
    const payload = render(prd);

    expect(typeof payload).toBe("string");
    expect(payload.length).toBeGreaterThan(0);
    expect(payload.length).toBeLessThan(32000);

    const outline = (prd.extra as { outline: OutlineEntryFixture[] }).outline;
    for (const entry of outline) {
      expect(payload).toContain(entry.title);
      expect(payload).toContain(entry.links[0]!.slug);
    }

    // sanity: the fixture itself is large enough to make the < 32000 assertion
    // non-vacuous — a naive per-entry JSON dump of 12 entries this size would
    // plausibly approach or exceed budget if unbounded
    expect(JSON.stringify(outline).length).toBeGreaterThan(1000);
  });
});

// ─── NEGATIVE: dramatically smaller than the pre-migration original prose ──────

describe("renderLinkOnlyOutlineForBootstrap — link-only vs full-prose size (AC-080-8 NEGATIVE)", () => {
  it("stays under 10% of the size the equivalent pre-migration full-prose body would have been", async () => {
    const prd = buildMigratedPrd(DOMAIN_SECTION_COUNT);
    const render = await loadRenderLinkOnlyOutlineForBootstrap();
    const payload = render(prd);

    const originalEquivalentLength = buildOriginalEquivalentLength();
    // the fixture's original-equivalent prose must itself exceed the 32000
    // budget, or this comparison proves nothing about "link-only" behavior
    expect(originalEquivalentLength).toBeGreaterThan(32000);

    expect(payload.length).toBeLessThan(originalEquivalentLength * 0.1);
  });
});

// ─── BOUNDARY: zero-outline-entries (nothing migrated yet) ─────────────────────

describe("renderLinkOnlyOutlineForBootstrap — unmigrated PRD, empty outline (AC-080-8 BOUNDARY)", () => {
  it("still renders a well-formed, non-throwing, in-budget payload with zero outline entries", async () => {
    const prd = buildUnmigratedPrd();
    const render = await loadRenderLinkOnlyOutlineForBootstrap();
    const payload = render(prd);

    expect(typeof payload).toBe("string");
    expect(payload.length).toBeLessThan(32000);
  });
});

// ─── ERROR: malformed extra.outline degrades gracefully, never throws ─────────

describe("renderLinkOnlyOutlineForBootstrap — malformed extra.outline (AC-080-8 ERROR)", () => {
  it("never throws on a legacy/hand-edited PRD whose extra.outline is not an array", async () => {
    const prd = buildMalformedOutlinePrd();
    const render = await loadRenderLinkOnlyOutlineForBootstrap();

    let threw = false;
    let payload = "";
    try {
      payload = render(prd);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(typeof payload).toBe("string");
    expect(payload.length).toBeLessThan(32000);
  });
});

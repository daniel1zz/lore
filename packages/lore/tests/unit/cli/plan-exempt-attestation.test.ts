/**
 * plan-exempt-attestation.test.ts — SPEC-069 AC-069-8 … AC-069-12: the
 * `lore plan exempt-attestation` writer for the plan-close attestation floor's
 * escape hatch, and the WRITER-EXISTS class audit that generalizes it.
 *
 * Why this file exists at all: `extra.attestation_exempt` was a gate-read field
 * with NO writer verb for a week. The floor consulted it; nothing in the CLI or
 * MCP could author it. When the only sanctioned opt-out is unreachable, the
 * undocumented path becomes the path of least resistance — four plans were
 * archived at ratio 0.00 by riding a vacuous predicate instead. AC-069-12 is the
 * class-level fix: a scan that FAILS a test the next time a plan-close-read
 * field ships without an authoring surface.
 *
 * Runner split (project CLAUDE.md, "bun:sqlite is external to vitest"):
 *   - `commands/plan.ts` reaches the store through a DYNAMIC `import("../loader.js")`
 *     performed INSIDE each subcommand's `run()`, AFTER argument validation — so
 *     this vitest file can import the REAL citty command object and observe the
 *     REAL `process.exitCode` the real handler sets on a refusal, without ever
 *     resolving `bun:sqlite`. That is a deliberate, load-bearing deviation from
 *     the sibling command modules' static `loadLoreApp` import (see that file's
 *     own header): the alternative — asserting exit 2 via a source scan — proves
 *     that a literal `2` appears near a refusal, not that the command exits 2.
 *   - The happy path THROUGH the binary (store, audit persistence, close-output
 *     naming) is AC-069-13's compiled-binary e2e
 *     (`tests/e2e/plan-exempt-attestation-compiled.bun.test.ts`), which is the
 *     only place a real exit code from a real `dist/lore` process is observed
 *     end to end.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-069-8, AC-069-9, AC-069-10, AC-069-11, AC-069-12 —
 *   spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann;
 *   spec-verify-reachability-plan-promote-early-warning §Scope M3 (typed kind)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import type { AuditEntry, DocRecord } from "@lore/core";
import { attestationExemptKindSchema } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { PlanExemptionService } from "../../../src/service/plan-exemption-service.js";
import {
  ATTESTATION_EXEMPT_KIND_VALUES,
  PLAN_EXEMPT_USAGE_EXIT_CODE,
  checkExemptAssessmentFreshnessArgs,
  checkExemptAttestationArgs,
  formatAttestationExemptionNotice,
} from "../../../src/adapters/cli/plan-exempt-validation.js";
import planCommand from "../../../src/adapters/cli/commands/plan.js";
import { findUnknownFlag } from "../../../src/adapters/cli/strict-flags.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PLAN_ID = "01HP0000000000000000000001";

/**
 * A plan carrying several UNRELATED `extra` keys. AC-069-8's whole subject is
 * that these survive the write byte-identically — `lore set` replaces `extra`
 * wholesale, which is precisely why a dedicated writer exists.
 */
function makePlan(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: PLAN_ID,
    slug: "plan-exempt-fixture",
    type: "plan",
    role: "plan",
    title: "Exempt Fixture Plan",
    status: "approved",
    priority: "medium",
    content: "## Plan\n\nFixture.",
    parent_id: "01HSPECEXEMPT0000000000001",
    created_at: "2026-07-31T00:00:00.000Z",
    updated_at: "2026-07-31T00:00:00.000Z",
    created_by: "system",
    version: 3,
    deleted_at: null,
    tags: ["fixture"],
    extra: {
      phases: [{ key: "p1", title: "Phase One" }],
      requires_uat: false,
      prd_sync_exempt: { reason: "unrelated sibling exemption", by: "agent:other", at: "2026-07-30T00:00:00.000Z" },
      nested: { deep: { value: 42 } },
    },
    ...overrides,
  };
}

async function seedPlan(store: InMemoryStore, overrides: Partial<DocRecord> = {}): Promise<DocRecord> {
  const plan = makePlan(overrides);
  const inserted = await store.insert(plan);
  if (!inserted.ok) throw new Error(`fixture insert failed: ${JSON.stringify(inserted.error)}`);
  return inserted.value;
}

async function readPlan(store: InMemoryStore): Promise<DocRecord> {
  const found = await store.find(PLAN_ID);
  if (!found.ok || found.value === null) throw new Error("fixture plan vanished");
  return found.value;
}

async function readAudit(store: InMemoryStore): Promise<AuditEntry[]> {
  const entries = await store.queryAudit({});
  if (!entries.ok) throw new Error(`audit query failed: ${JSON.stringify(entries.error)}`);
  return entries.value;
}

let store: InMemoryStore;
let service: PlanExemptionService;

beforeEach(() => {
  store = new InMemoryStore();
  service = new PlanExemptionService(store);
});

// ═══ AC-069-8 — read-merge-write, every unrelated extra key byte-identical ═══

describe("AC-069-8 — the exemption writer merges onto extra instead of replacing it", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("AC-069-8 authors all three fields in one write", async () => {
    await seedPlan(store);

    const result = await service.exemptAttestation("plan-exempt-fixture", {
      reason: "every task in this plan is a RED/TDD anchor; attesting would misrepresent it",
      kind: "red-tdd",
      by: "agent:attestation-exempt-writer",
    });

    expect(result.ok).toBe(true);
    const extra = (await readPlan(store)).extra;
    expect(extra["attestation_exempt"]).toBe(true);
    expect(extra["attestation_exempt_reason"]).toBe(
      "every task in this plan is a RED/TDD anchor; attesting would misrepresent it",
    );
    expect(extra["attestation_exempt_kind"]).toBe("red-tdd");
  });

  it("AC-069-8 leaves every unrelated extra key byte-identical (deep structures included)", async () => {
    const before = await seedPlan(store);
    const untouchedBefore = JSON.stringify({
      phases: before.extra["phases"],
      requires_uat: before.extra["requires_uat"],
      prd_sync_exempt: before.extra["prd_sync_exempt"],
      nested: before.extra["nested"],
    });

    const result = await service.exemptAttestation(PLAN_ID, {
      reason: "no automatable oracle exists for this plan's scope",
      kind: "no-oracle",
      by: "agent:writer",
    });
    expect(result.ok).toBe(true);

    const after = await readPlan(store);
    const untouchedAfter = JSON.stringify({
      phases: after.extra["phases"],
      requires_uat: after.extra["requires_uat"],
      prd_sync_exempt: after.extra["prd_sync_exempt"],
      nested: after.extra["nested"],
    });
    expect(untouchedAfter).toBe(untouchedBefore);
  });

  it("AC-069-8 adds EXACTLY the three exemption keys — no key is dropped and none other is added", async () => {
    const before = await seedPlan(store);
    const keysBefore = Object.keys(before.extra).sort();

    await service.exemptAttestation(PLAN_ID, { reason: "why", kind: "other", by: "agent:writer" });

    const keysAfter = Object.keys((await readPlan(store)).extra).sort();
    const added = keysAfter.filter((k) => !keysBefore.includes(k));
    const dropped = keysBefore.filter((k) => !keysAfter.includes(k));
    expect(added).toEqual([
      "attestation_exempt",
      "attestation_exempt_kind",
      "attestation_exempt_reason",
    ]);
    expect(dropped).toEqual([]);
  });

  // ── STATE ──────────────────────────────────────────────────────────────

  it("AC-069-8 re-exempting an already-exempt plan overwrites reason+kind and still preserves siblings", async () => {
    await seedPlan(store);
    await service.exemptAttestation(PLAN_ID, { reason: "first", kind: "red-tdd", by: "agent:a" });
    await service.exemptAttestation(PLAN_ID, { reason: "second", kind: "no-oracle", by: "agent:b" });

    const extra = (await readPlan(store)).extra;
    expect(extra["attestation_exempt_reason"]).toBe("second");
    expect(extra["attestation_exempt_kind"]).toBe("no-oracle");
    expect(extra["phases"]).toEqual([{ key: "p1", title: "Phase One" }]);
  });

  it("AC-069-8 the write is version-logged (append-only history, not a silent extra mutation)", async () => {
    const before = await seedPlan(store);
    await service.exemptAttestation(PLAN_ID, { reason: "why", kind: "other", by: "agent:a" });

    const after = await readPlan(store);
    expect(after.version).toBe(before.version + 1);

    const versions = await store.findVersions(PLAN_ID);
    expect(versions.ok).toBe(true);
    const logged = versions.ok ? versions.value.find((v) => v.version === after.version) : undefined;
    expect(logged).toBeDefined();
  });

  // ── ERROR ──────────────────────────────────────────────────────────────

  it("AC-069-8 refuses a non-plan target rather than writing plan-shaped fields onto it", async () => {
    await seedPlan(store, { type: "task", slug: "task-not-a-plan" });

    const result = await service.exemptAttestation(PLAN_ID, {
      reason: "why",
      kind: "other",
      by: "agent:a",
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "VALIDATION_ERROR") {
      expect(result.error.message).toContain("plan");
    } else {
      throw new Error(`expected VALIDATION_ERROR, got ${JSON.stringify(result)}`);
    }
    // NEGATIVE CONTROL for this case: nothing was written.
    expect((await readPlan(store)).extra["attestation_exempt"]).toBeUndefined();
  });

  it("AC-069-8 an unknown plan is DOC_NOT_FOUND, never a silently-created document", async () => {
    const result = await service.exemptAttestation("plan-does-not-exist", {
      reason: "why",
      kind: "other",
      by: "agent:a",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DOC_NOT_FOUND");
  });

  // ── The assessment-freshness sibling (the SECOND instance of the class) ──

  it("AC-069-8 the assessment-freshness sibling merges the same way and does not disturb the attestation fields", async () => {
    await seedPlan(store);
    await service.exemptAttestation(PLAN_ID, { reason: "attestation why", kind: "other", by: "agent:a" });
    await service.exemptAssessmentFreshness(PLAN_ID, { reason: "freshness why", by: "agent:a" });

    const extra = (await readPlan(store)).extra;
    expect(extra["assessment_freshness_exempt"]).toBe(true);
    expect(extra["assessment_freshness_exempt_reason"]).toBe("freshness why");
    expect(extra["attestation_exempt"]).toBe(true);
    expect(extra["attestation_exempt_reason"]).toBe("attestation why");
    expect(extra["phases"]).toEqual([{ key: "p1", title: "Phase One" }]);
  });
});

// ═══ AC-069-9 — refusals: blank reason and off-taxonomy kind both exit 2 ═════

describe("AC-069-9 — an exemption with no justification, or an untyped one, is never authorable", () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  /** The real citty subcommand object — not a re-implementation of its logic. */
  function subcommand(name: string): { run: (ctx: { args: Record<string, unknown> }) => unknown } {
    const subs = planCommand.subCommands as Record<string, unknown> | undefined;
    const cmd = subs?.[name] as { run?: (ctx: { args: Record<string, unknown> }) => unknown } | undefined;
    if (cmd?.run === undefined) {
      throw new Error(`lore plan has no "${name}" subcommand with a run handler`);
    }
    return cmd as { run: (ctx: { args: Record<string, unknown> }) => unknown };
  }

  // ── BOUNDARY / NEGATIVE — the pure classifier ──────────────────────────

  it("AC-069-9 the permitted-kind set is sourced from attestationExemptKindSchema, never a local literal union", () => {
    expect([...ATTESTATION_EXEMPT_KIND_VALUES].sort()).toEqual(
      [...attestationExemptKindSchema.options].sort(),
    );
    expect(ATTESTATION_EXEMPT_KIND_VALUES).toHaveLength(4);
  });

  it("AC-069-9 a missing --reason is refused", () => {
    const check = checkExemptAttestationArgs({ reason: undefined, kind: "red-tdd" });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).toContain("--reason");
  });

  it("AC-069-9 a whitespace-only --reason is refused (a blank justification is no justification)", () => {
    for (const blank of ["", "   ", "\t", "\n  \n"]) {
      const check = checkExemptAttestationArgs({ reason: blank, kind: "red-tdd" });
      expect(check.ok).toBe(false);
    }
  });

  it("AC-069-9 an off-taxonomy --kind is refused and the message NAMES every permitted value", () => {
    const check = checkExemptAttestationArgs({ reason: "valid reason", kind: "bogus-kind" });
    expect(check.ok).toBe(false);
    if (!check.ok) {
      for (const permitted of ATTESTATION_EXEMPT_KIND_VALUES) {
        expect(check.message).toContain(permitted);
      }
      expect(check.message).toContain("bogus-kind");
    }
  });

  it("AC-069-9 a MISSING --kind is refused too — a bare exemption with no type is the silent-fallback shape", () => {
    const check = checkExemptAttestationArgs({ reason: "valid reason", kind: undefined });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).toContain("--kind");
  });

  // ── HAPPY (the classifier's positive control — proves it can say yes) ───

  it("AC-069-9 every permitted kind paired with a real reason is ACCEPTED (positive control)", () => {
    for (const kind of ATTESTATION_EXEMPT_KIND_VALUES) {
      const check = checkExemptAttestationArgs({ reason: "a real justification", kind });
      expect(check.ok).toBe(true);
      if (check.ok) {
        expect(check.kind).toBe(kind);
        expect(check.reason).toBe("a real justification");
      }
    }
  });

  it("AC-069-9 the assessment-freshness sibling refuses a blank reason and accepts a real one", () => {
    expect(checkExemptAssessmentFreshnessArgs({ reason: "  " }).ok).toBe(false);
    expect(checkExemptAssessmentFreshnessArgs({ reason: "judged outcome is stale by design" }).ok).toBe(true);
  });

  // ── ERROR — the REAL command handler's REAL exit code ───────────────────

  it("AC-069-9 the real `lore plan exempt-attestation` handler sets process.exitCode 2 on a blank reason", async () => {
    expect(process.exitCode).toBeUndefined();
    await subcommand("exempt-attestation").run({
      args: { plan: "plan-exempt-fixture", reason: "   ", kind: "red-tdd" },
    });
    expect(process.exitCode).toBe(PLAN_EXEMPT_USAGE_EXIT_CODE);
    expect(PLAN_EXEMPT_USAGE_EXIT_CODE).toBe(2);
  });

  it("AC-069-9 the real handler sets process.exitCode 2 on an off-taxonomy kind", async () => {
    expect(process.exitCode).toBeUndefined();
    await subcommand("exempt-attestation").run({
      args: { plan: "plan-exempt-fixture", reason: "a real justification", kind: "bogus-kind" },
    });
    expect(process.exitCode).toBe(2);
  });

  it("AC-069-9 the real assessment-freshness handler sets process.exitCode 2 on a blank reason", async () => {
    expect(process.exitCode).toBeUndefined();
    await subcommand("exempt-assessment-freshness").run({
      args: { plan: "plan-exempt-fixture", reason: "" },
    });
    expect(process.exitCode).toBe(2);
  });

  /**
   * NEGATIVE CONTROL for the three cases above: the assertions would be
   * vacuous if `process.exitCode` were already 2 before the handler ran, or if
   * the handler set it unconditionally. Each case asserts `undefined` first
   * (above); this one proves the handler is genuinely REACHED and genuinely
   * discriminates — a refusal never touches the store, so a VALID invocation
   * must get PAST validation and fail LATER (on the loader, in this
   * corpus-less test process) rather than exiting 2.
   */
  it("AC-069-9 CONTROL: a VALID invocation does not exit 2 at the validation seam", async () => {
    expect(process.exitCode).toBeUndefined();
    try {
      await subcommand("exempt-attestation").run({
        args: { plan: "plan-exempt-fixture", reason: "a real justification", kind: "red-tdd" },
      });
    } catch {
      // Reaching the loader (and failing there, corpus-less) is the POINT:
      // it proves validation let a valid invocation through.
    }
    expect(process.exitCode).not.toBe(PLAN_EXEMPT_USAGE_EXIT_CODE);
  });
});

// ═══ AC-069-10 — the exemption is AUDITED (actor + reason) ═══════════════════

describe("AC-069-10 — the write emits an audit entry carrying actor and reason", () => {
  it("AC-069-10 the audit entry's actor is the caller-resolved actor, not a hardcoded 'system'", async () => {
    await seedPlan(store);
    await service.exemptAttestation(PLAN_ID, {
      reason: "pipeline is structurally unreachable for this plan",
      kind: "pipeline-unreachable",
      by: "agent:attestation-exempt-writer",
    });

    const entries = (await readAudit(store)).filter((e) => e.doc_id === PLAN_ID);
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[entries.length - 1]!;
    expect(entry.actor).toBe("agent:attestation-exempt-writer");
    expect(entry.actor).not.toBe("system");
  });

  it("AC-069-10 the audit entry carries the reason verbatim and the typed kind", async () => {
    await seedPlan(store);
    const reason = "pipeline is structurally unreachable for this plan";
    await service.exemptAttestation(PLAN_ID, { reason, kind: "pipeline-unreachable", by: "agent:x" });

    const entry = (await readAudit(store)).filter((e) => e.doc_id === PLAN_ID).at(-1)!;
    const details = entry.details ?? {};
    expect(JSON.stringify(details)).toContain(reason);
    expect(details["attestation_exempt_kind"]).toBe("pipeline-unreachable");
  });

  it("AC-069-10 two different actors produce two distinguishable audit entries (attribution is real)", async () => {
    await seedPlan(store);
    await service.exemptAttestation(PLAN_ID, { reason: "first", kind: "other", by: "agent:one" });
    await service.exemptAttestation(PLAN_ID, { reason: "second", kind: "other", by: "agent:two" });

    const actors = (await readAudit(store))
      .filter((e) => e.doc_id === PLAN_ID)
      .map((e) => e.actor);
    expect(actors).toContain("agent:one");
    expect(actors).toContain("agent:two");
  });

  it("AC-069-10 a refused write emits NO audit entry (nothing to attribute)", async () => {
    await seedPlan(store);
    const result = await service.exemptAttestation(PLAN_ID, {
      reason: "   ",
      kind: "other",
      by: "agent:one",
    });
    expect(result.ok).toBe(false);
    expect((await readAudit(store)).filter((e) => e.doc_id === PLAN_ID)).toEqual([]);
  });

  /**
   * The `--by > $LORE_ACTOR > OS username` precedence itself is `resolveActor`'s
   * (utils.ts) contract, exercised by `actor-session-tier.test.ts`. What THIS
   * AC needs is that `commands/plan.ts` routes through that shared resolver
   * rather than reading `$LORE_ACTOR` itself — a second resolution site would
   * silently diverge from every other writer's precedence.
   */
  it("AC-069-10 commands/plan.ts resolves its actor via the shared resolveActor, with no second precedence chain", () => {
    const source = readFileSync(PLAN_COMMAND_PATH, "utf8");
    const executable = stripCommentLines(source).join("\n");
    expect(executable).toContain("resolveActor(");
    // A private precedence chain would have to reach the environment or the OS
    // itself. Keying on the bare token "LORE_ACTOR" would false-positive on the
    // --by flag's HELP TEXT (which legitimately names the env var to the user);
    // `process.env` / `userInfo` are the actual reads a rival chain needs.
    expect(executable).not.toContain("process.env");
    expect(executable).not.toContain("userInfo");
  });
});

// ═══ AC-069-11 — NO BACK DOOR: `lore set --attestation-exempt` exits 2 ═══════

describe("AC-069-11 — the dedicated writer has no `lore set` back door", () => {
  it("AC-069-11 commands/set.ts declares no attestation-exempt flag of any spelling", () => {
    const executable = stripCommentLines(readFileSync(SET_COMMAND_PATH, "utf8")).join("\n");
    for (const spelling of ["attestation-exempt", "attestation_exempt", "attestationExempt"]) {
      expect(executable).not.toContain(spelling);
    }
  });

  it("AC-069-11 the strict unknown-flag seam refuses `--attestation-exempt` for a set-shaped arg spec", () => {
    // The seam is what produces the exit-2; this exercises it directly against
    // an arg spec shaped like `set`'s (a `status` flag it DOES declare).
    const setLikeSpec = { status: { type: "string" as const }, json: { type: "boolean" as const } };
    expect(findUnknownFlag(["plan-x", "--attestation-exempt"], setLikeSpec)).toBe("--attestation-exempt");
    expect(findUnknownFlag(["plan-x", "--attestation-exempt=true"], setLikeSpec)).toBe("--attestation-exempt");
  });

  it("AC-069-11 CONTROL: the same seam ACCEPTS a flag the spec does declare (it is not refusing everything)", () => {
    const setLikeSpec = { status: { type: "string" as const }, json: { type: "boolean" as const } };
    expect(findUnknownFlag(["plan-x", "--status", "archived"], setLikeSpec)).toBeNull();
    expect(findUnknownFlag(["plan-x", "--json"], setLikeSpec)).toBeNull();
  });

  it("AC-069-11 every top-level command — `set` included — is routed through the strict seam", () => {
    const indexSource = readFileSync(CLI_INDEX_PATH, "utf8");
    // `wrapDefault` is the ONE place index.ts applies wrapCommandStrict; if
    // `set` were registered without it, the seam would not cover this flag.
    expect(indexSource).toMatch(/set:\s*\(\)\s*=>\s*import\([^)]*\)\.then\(wrapDefault\("set"\)\)/);
    expect(stripCommentLines(indexSource).join("\n")).toContain("wrapCommandStrict");
  });
});

// ═══ AC-069-12 — WRITER-EXISTS CLASS AUDIT ══════════════════════════════════
//
// The generalization of this whole task. `attestation_exempt` was one instance;
// the scan below enumerates EVERY plan-level `extra.*` field the plan-close
// checkpoint reads and asserts each one has an authoring surface. A scan that
// finds nothing because it looked at nothing is the failure mode this repo has
// recorded five times, so every step below carries a control:
//   - the region extractor is a pure function over source TEXT, so a synthetic
//     source with a deliberately-unwritable field proves it can flag one;
//   - the sentinel lookup throws (never silently scans the whole file) when the
//     markers are absent;
//   - the direct-read extractor asserts a MINIMUM field count (sampling power);
//   - a helper-mediated read (`extractPrdSyncExempt`) that is NOT registered
//     fails the test, so hiding a new field behind a helper does not evade it;
//   - the witness check is proven falsifiable against a nonexistent witness.

const LORE_SRC_DIR = fileURLToPath(new URL("../../../src/", import.meta.url));
const ADAPTERS_DIR = join(LORE_SRC_DIR, "adapters");
const CORPUS_SERVICE_PATH = join(LORE_SRC_DIR, "service", "corpus-service.ts");
const PLAN_COMMAND_PATH = join(LORE_SRC_DIR, "adapters", "cli", "commands", "plan.ts");
const SET_COMMAND_PATH = join(LORE_SRC_DIR, "adapters", "cli", "commands", "set.ts");
const CLI_INDEX_PATH = join(LORE_SRC_DIR, "adapters", "cli", "index.ts");

/** The sentinel comments delimiting plan-close's gate-read `extra` block. */
const REGION_BEGIN = "PLAN-CLOSE GATE-READ EXTRA FIELDS (AC-069-12 scan region)";
const REGION_END = "END PLAN-CLOSE GATE-READ EXTRA FIELDS";

/**
 * Drops comment lines so a prose MENTION of a field is never mistaken for a
 * read or a write of it — same rule AC-061-14's scan uses.
 */
function stripCommentLines(source: string): string[] {
  return source.split("\n").filter((line) => {
    const trimmed = line.trim();
    return (
      trimmed.length > 0 &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("*") &&
      !trimmed.startsWith("/*")
    );
  });
}

/**
 * Slices the sentinel-delimited plan-close region out of a source text.
 * THROWS when either sentinel is missing — a scan that silently fell back to
 * "the whole file" (or to "") is exactly the vacuous pass this AC exists to
 * prevent.
 */
function sliceScanRegion(source: string): string {
  const start = source.indexOf(REGION_BEGIN);
  const end = source.indexOf(REGION_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `AC-069-12 scan sentinels not found (begin=${start}, end=${end}). ` +
        `corpus-service.ts must delimit its plan-close gate-read block with ` +
        `"${REGION_BEGIN}" … "${REGION_END}".`,
    );
  }
  return source.slice(start, end);
}

/** Every `effectiveExtra["field"]` subscript read in a region, deduped. */
function extractDirectExtraReads(region: string): string[] {
  const found = new Set<string>();
  for (const m of region.matchAll(/effectiveExtra\[\s*"([A-Za-z0-9_]+)"\s*\]/g)) {
    found.add(m[1]!);
  }
  return [...found].sort();
}

/** Every `extractXxx(` / `resolveXxx(` helper identifier appearing in a region. */
function extractHelperReadIdentifiers(region: string): string[] {
  const found = new Set<string>();
  for (const m of region.matchAll(/\b(?:extract|resolve)[A-Z][A-Za-z0-9]*/g)) {
    found.add(m[0]);
  }
  return [...found].sort();
}

/**
 * Helper-mediated reads of plan `extra` inside the scan region: which `extra`
 * field each helper reads on the plan's behalf. A helper appearing in the
 * region but ABSENT from this map fails the test — that is what stops a new
 * gate-read field from hiding behind an accessor.
 */
const HELPER_READS: Readonly<Record<string, string>> = {
  // (empty after slice 3a: the plan-close gate no longer reads `prd_sync_exempt` — BR-984 replaced that
  // predicate with a cited-rule-state read, and its writer `lore outline exempt` was retired, BR-985.)
};

interface AuthoringSurface {
  /** The user-facing verb that authors this field. */
  readonly verb: string;
  /** Top-level key that MUST be registered in the CLI command registry. */
  readonly group: string;
  /** Adapter module implementing the verb, relative to `src/adapters/`. */
  readonly module: string;
  /** A token that must appear in that module's EXECUTABLE (non-comment) code. */
  readonly witness: string;
}

/**
 * field → the surface that can author it. Every field the scan finds must be
 * present here, and every entry's surface must actually exist and actually be
 * reachable. This map is the class-audit's SSOT: adding a plan-close gate-read
 * field without adding a row here fails AC-069-12 by construction.
 */
const AUTHORING_SURFACES: Readonly<Record<string, AuthoringSurface>> = {
  requires_uat: {
    verb: "lore create plan --requires-uat",
    group: "create",
    module: "cli/commands/create.ts",
    witness: "requires_uat: true",
  },
  attestation_exempt: {
    verb: "lore plan exempt-attestation",
    group: "plan",
    module: "cli/commands/plan.ts",
    witness: "exemptAttestation(",
  },
  attestation_exempt_reason: {
    verb: "lore plan exempt-attestation --reason",
    group: "plan",
    module: "cli/commands/plan.ts",
    witness: "exemptAttestation(",
  },
  attestation_exempt_kind: {
    verb: "lore plan exempt-attestation --kind",
    group: "plan",
    module: "cli/commands/plan.ts",
    witness: "exemptAttestation(",
  },
  assessment_freshness_exempt: {
    verb: "lore plan exempt-assessment-freshness",
    group: "plan",
    module: "cli/commands/plan.ts",
    witness: "exemptAssessmentFreshness(",
  },
  assessment_freshness_exempt_reason: {
    verb: "lore plan exempt-assessment-freshness --reason",
    group: "plan",
    module: "cli/commands/plan.ts",
    witness: "exemptAssessmentFreshness(",
  },
};

/** True when `witness` appears in the adapter module's executable code. */
function witnessPresent(moduleRelPath: string, witness: string): boolean {
  const full = join(ADAPTERS_DIR, moduleRelPath);
  let source: string;
  try {
    source = readFileSync(full, "utf8");
  } catch {
    return false;
  }
  return stripCommentLines(source).join("\n").includes(witness);
}

/** Fields the region reads that have no row in {@link AUTHORING_SURFACES}. */
function findUnregisteredFields(region: string): string[] {
  const direct = extractDirectExtraReads(region);
  const viaHelpers = extractHelperReadIdentifiers(region)
    .map((id) => HELPER_READS[id])
    .filter((f): f is string => f !== undefined);
  return [...new Set([...direct, ...viaHelpers])]
    .filter((field) => AUTHORING_SURFACES[field] === undefined)
    .sort();
}

/** Every `.ts` file under a directory, recursively. */
function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...listSourceFiles(full));
    else if (entry.endsWith(".ts")) found.push(full);
  }
  return found;
}

describe("AC-069-12 — every plan-close gate-read extra field has an authoring surface", () => {
  const region = (): string => sliceScanRegion(readFileSync(CORPUS_SERVICE_PATH, "utf8"));

  // ── Sampling power: prove the scan looked at something real ─────────────

  it("AC-069-12 the scan region is sentinel-delimited in corpus-service.ts and is non-trivial", () => {
    const text = region();
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain("effectiveExtra[");
  });

  it("AC-069-12 the direct-read extractor finds every field plan-close is known to read (>= 6)", () => {
    const fields = extractDirectExtraReads(region());
    expect(fields).toEqual(
      expect.arrayContaining([
        "assessment_freshness_exempt",
        "assessment_freshness_exempt_reason",
        "attestation_exempt",
        "attestation_exempt_kind",
        "attestation_exempt_reason",
        "requires_uat",
      ]),
    );
    expect(fields.length).toBeGreaterThanOrEqual(6);
  });

  it("AC-069-12 every helper-mediated extra read in the region is REGISTERED — a new accessor cannot hide a field", () => {
    const unregisteredHelpers = extractHelperReadIdentifiers(region()).filter(
      (id) => HELPER_READS[id] === undefined,
    );
    expect(unregisteredHelpers).toEqual([]);
    // …and the retired read is really gone from the gate region (nothing left hiding behind that accessor):
    expect(extractHelperReadIdentifiers(region())).not.toContain("extractPrdSyncExempt");
  });

  // ── The class invariant itself ──────────────────────────────────────────

  it("AC-069-12 NO plan-close gate-read field lacks an authoring surface", () => {
    expect(findUnregisteredFields(region())).toEqual([]);
  });

  it("AC-069-12 every registered surface's adapter module exists and really implements the verb", () => {
    const broken: string[] = [];
    for (const [field, surface] of Object.entries(AUTHORING_SURFACES)) {
      if (!witnessPresent(surface.module, surface.witness)) {
        broken.push(`${field}: ${surface.verb} (${surface.module} lacks "${surface.witness}")`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("AC-069-12 every registered surface's command group is reachable from the CLI registry", () => {
    const indexSource = readFileSync(CLI_INDEX_PATH, "utf8");
    const unreachable = [...new Set(Object.values(AUTHORING_SURFACES).map((s) => s.group))]
      .filter((group) => !new RegExp(`\\n\\s*${group}:\\s*\\(\\)\\s*=>\\s*import\\(`).test(indexSource))
      .sort();
    expect(unreachable).toEqual([]);
  });

  it("AC-069-12 the exemption fields are genuinely authorable somewhere under src/adapters (the original defect, inverted)", () => {
    const adapterSources = listSourceFiles(ADAPTERS_DIR)
      .map((f) => stripCommentLines(readFileSync(f, "utf8")).join("\n"))
      .join("\n");
    for (const field of ["attestation_exempt", "attestation_exempt_reason", "attestation_exempt_kind"]) {
      expect(adapterSources).toContain(field);
    }
  });

  // ── NEGATIVE CONTROLS — prove every step of the scan can FAIL ───────────

  it("AC-069-12 CONTROL: a synthetic region reading an unwritable field is FLAGGED", () => {
    const synthetic = `${REGION_BEGIN}
      const a = effectiveExtra["requires_uat"] === true;
      const b = effectiveExtra["synthetic_unwritable_field"];
      ${REGION_END}`;
    expect(findUnregisteredFields(synthetic)).toEqual(["synthetic_unwritable_field"]);
  });

  it("AC-069-12 CONTROL: a synthetic region hiding a field behind an UNREGISTERED helper is FLAGGED", () => {
    const synthetic = `${REGION_BEGIN}
      const c = extractSomeBrandNewExemption({ extra: effectiveExtra });
      ${REGION_END}`;
    const unregistered = extractHelperReadIdentifiers(synthetic).filter(
      (id) => HELPER_READS[id] === undefined,
    );
    expect(unregistered).toEqual(["extractSomeBrandNewExemption"]);
  });

  it("AC-069-12 CONTROL: missing sentinels THROW rather than silently scanning nothing", () => {
    expect(() => sliceScanRegion("const x = effectiveExtra[\"requires_uat\"];")).toThrow(
      /scan sentinels not found/,
    );
    expect(() => sliceScanRegion(`${REGION_END} ... ${REGION_BEGIN}`)).toThrow(
      /scan sentinels not found/,
    );
  });

  it("AC-069-12 CONTROL: the witness check reports FALSE for a witness no module contains", () => {
    expect(witnessPresent("cli/commands/plan.ts", "zzzNoSuchWitnessEverExisted(")).toBe(false);
    expect(witnessPresent("cli/commands/does-not-exist.ts", "anything")).toBe(false);
    // …and TRUE for one that is really there (proves it is not always false).
    expect(witnessPresent("cli/commands/plan.ts", "exemptAttestation(")).toBe(true);
  });

  it("AC-069-12 CONTROL: the direct-read extractor returns nothing for a region with no extra reads", () => {
    expect(extractDirectExtraReads("const x = 1; // effectiveExtra is only mentioned")).toEqual([]);
  });
});

// ═══ The close output NAMES an active exemption (AC-069-13's render unit) ════

describe("formatAttestationExemptionNotice — an exemption that allowed a close is never invisible", () => {
  const activeExtra = {
    attestation_exempt: true,
    attestation_exempt_reason: "no automatable oracle exists for this plan's scope",
    attestation_exempt_kind: "no-oracle",
  };

  it("HAPPY: names the exemption, its typed kind, and its reason verbatim", () => {
    const notice = formatAttestationExemptionNotice(activeExtra);
    expect(notice).not.toBeNull();
    expect(notice).toContain("attestation");
    expect(notice).toContain("no-oracle");
    expect(notice).toContain(activeExtra.attestation_exempt_reason);
  });

  it("NEGATIVE: a plan with no exemption gets no notice", () => {
    expect(formatAttestationExemptionNotice({ phases: [] })).toBeNull();
    expect(formatAttestationExemptionNotice(undefined)).toBeNull();
    expect(formatAttestationExemptionNotice(null)).toBeNull();
  });

  it("BOUNDARY: the render's activeness rule matches the gate's — flag alone, or a blank reason, or an off-taxonomy kind is NOT active", () => {
    expect(formatAttestationExemptionNotice({ attestation_exempt: true })).toBeNull();
    expect(
      formatAttestationExemptionNotice({ attestation_exempt: true, attestation_exempt_reason: "   ", attestation_exempt_kind: "no-oracle" }),
    ).toBeNull();
    expect(
      formatAttestationExemptionNotice({ ...activeExtra, attestation_exempt_kind: "bogus" }),
    ).toBeNull();
    expect(
      formatAttestationExemptionNotice({ ...activeExtra, attestation_exempt: false }),
    ).toBeNull();
  });
});

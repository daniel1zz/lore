// @reads packages/lore/src/**
/**
 * isplanmember-single-definition.test.ts —
 * task-three-byte-identical-copies-of-isplanmember-survive.
 *
 * `isPlanMember` — the one-line plan-membership predicate — existed in THREE
 * byte-identical copies: the shared `plan-membership.ts` module plus a PRIVATE
 * duplicate inside `task-workflow-service.ts` and `phase-workflow-service.ts`.
 * The duplication survived an earlier consolidation sweep because the shared
 * module's OWN JSDoc recorded a false blocker for it — it claimed
 * `service/CLAUDE.md`'s "Service per concern, no cross-service imports" pattern
 * prevented the two services from importing the shared module. That reason is
 * factually wrong: `plan-membership.ts` is not a service (no store dependency,
 * no class, no service surface) and seven other modules already imported it.
 * A written justification NOT to consolidate, living in the SSOT itself, is
 * what kept three copies alive — so this suite pins both halves: the single
 * definition site AND the absence of the false blocker.
 *
 * This is a pure de-duplication, so the predicate's OWN behaviour is pinned
 * here too (unchanged semantics: `extra.plan_id === planId`, nothing else).
 *
 * ⛔ Structural assertions read the source files from disk. They are therefore
 * invisible to import-graph selection on their own — this file additionally
 * imports all three modules it judges, so `bun run test:changed` re-selects it
 * via the reverse-dependency rule whenever any of them changes.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref task-three-byte-identical-copies-of-isplanmember-survive (AC-1, AC-2, AC-3)
 * @spec_ref adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the
 * @spec_ref task-plan-membership-is-extra-plan-id-but-the-last-task
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DocId, DocRecord } from "@lore/core";
import { isPlanMember } from "../../../src/service/plan-membership.js";
// reason: these two imports exist for the import-graph edge described in the
//   module header (test:changed reverse-dep selection), not only for the
//   type-level constructions below — do not "clean up" as unused.
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { PhaseWorkflowService } from "../../../src/service/phase-workflow-service.js";

// ─── Source-tree helpers ────────────────────────────────────────────────────

/** Repo root, derived from this file's known location (packages/lore/tests/unit/service/). */
function findRepoRoot(): string {
  return join(__dirname, "..", "..", "..", "..", "..");
}

const SRC_ROOT = "packages/lore/src";
const SHARED_MODULE = `${SRC_ROOT}/service/plan-membership.ts`;
const TASK_SERVICE = `${SRC_ROOT}/service/task-workflow-service.ts`;
const PHASE_SERVICE = `${SRC_ROOT}/service/phase-workflow-service.ts`;

/** The membership-rationale slug every call site's JSDoc must keep pointing at. */
const MEMBERSHIP_SLUG = "task-plan-membership-is-extra-plan-id-but-the-last-task";

/** Recursively lists repo-relative `.ts` source files under `dir` (excludes tests). */
function walkSourceFiles(dir: string, repoRoot: string): string[] {
  const abs = join(repoRoot, dir);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const rel = join(dir, entry);
    if (statSync(join(repoRoot, rel)).isDirectory()) {
      files.push(...walkSourceFiles(rel, repoRoot));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(rel);
    }
  }
  return files;
}

function readSource(relPath: string): string {
  return readFileSync(join(findRepoRoot(), relPath), "utf8");
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ─── Behaviour fixtures ─────────────────────────────────────────────────────

function makeTask(extra: Record<string, unknown>): DocRecord {
  return {
    id: "01TASK0000000000000000000",
    slug: "task-fixture",
    type: "task",
    role: null,
    title: "Fixture task",
    content: "",
    status: "draft",
    priority: "medium",
    parent_id: null,
    tags: [],
    extra,
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
    version: 1,
  } as unknown as DocRecord;
}

const PLAN_ID = "01PLAN0000000000000000000" as DocId;
const OTHER_PLAN_ID = "01PLAN1111111111111111111" as DocId;

// ─── AC-1: exactly ONE definition site ──────────────────────────────────────

describe("AC-1 single definition site (structural, deterministic)", () => {
  it("exactly one file under packages/lore/src defines isPlanMember, and it is plan-membership.ts", () => {
    const repoRoot = findRepoRoot();
    const definingFiles = walkSourceFiles(SRC_ROOT, repoRoot).filter((rel) =>
      readFileSync(join(repoRoot, rel), "utf8").includes("function isPlanMember"),
    );

    // Positive count, never "no matches" — a 0 here would mean the predicate was
    // deleted outright, which must fail just as loudly as 3 copies did.
    expect(definingFiles).toEqual([SHARED_MODULE]);
  });

  it("neither workflow service declares its own private copy of the predicate", () => {
    for (const rel of [TASK_SERVICE, PHASE_SERVICE]) {
      expect(readSource(rel)).not.toContain("function isPlanMember");
    }
  });
});

// ─── AC-2: import wiring ────────────────────────────────────────────────────

describe("AC-2 both workflow services import the shared module", () => {
  it.each([
    ["task-workflow-service.ts", TASK_SERVICE],
    ["phase-workflow-service.ts", PHASE_SERVICE],
  ])("%s imports from ./plan-membership.js", (_label, rel) => {
    const source = readSource(rel);
    expect(source).toContain('from "./plan-membership.js"');
    // Independent of the string above: the symbol must actually be named in an
    // import clause, so a bare side-effect import cannot satisfy this AC.
    expect(source).toMatch(/import\s*\{[^}]*\bisPlanMember\b[^}]*\}\s*from\s*"\.\/plan-membership\.js"/);
  });

  it("the shared module still exports the predicate the services now import", () => {
    expect(readSource(SHARED_MODULE)).toContain("export function isPlanMember");
  });
});

// ─── AC-3: the false blocker is gone, and NOT silently deleted ──────────────

describe("AC-3 the shared module's JSDoc no longer carries the false blocker", () => {
  const header = readSource(SHARED_MODULE);

  it.each([["NOT the only copy"], ["NAMED FOLLOW-UP"]])(
    "does not contain %s",
    (forbidden) => {
      expect(header).not.toContain(forbidden);
    },
  );

  it("records the consolidation positively instead of leaving an explanation vacuum", () => {
    // reason: deleting the paragraph outright would satisfy the two negatives
    // above while inviting the exact same wrong conclusion again (an absent
    // explanation reads as "nobody considered it"). These positives make the
    // replacement note load-bearing.
    expect(header).toMatch(/consolidat/i);
    expect(header).toContain("TaskWorkflowService");
    expect(header).toContain("PhaseWorkflowService");
    expect(header).toMatch(/not a service/i);
  });

  it("keeps the membership-rationale cross-reference (REGRESSION: requirement 4)", () => {
    expect(header).toContain(MEMBERSHIP_SLUG);
  });
});

// ─── REGRESSION: call-site cross-references survive the consolidation ───────

describe("REGRESSION call-site JSDoc cross-references are preserved", () => {
  it.each([
    ["task-workflow-service.ts", TASK_SERVICE, 6],
    ["phase-workflow-service.ts", PHASE_SERVICE, 1],
  ])("%s still cites the membership rationale at its call sites", (_label, rel, floor) => {
    // A floor, not an exact count: the definition-site JSDoc that carried one of
    // these references is removed by this task, but every CALL-SITE reference
    // documenting WHY membership keys on extra.plan_id must survive untouched.
    expect(countOccurrences(readSource(rel), MEMBERSHIP_SLUG)).toBeGreaterThanOrEqual(floor);
  });

  it("both services still reference the predicate at their query sites", () => {
    for (const rel of [TASK_SERVICE, PHASE_SERVICE]) {
      expect(readSource(rel)).toMatch(/isPlanMember\(/);
    }
  });
});

// ─── Behaviour pin: the surviving predicate is semantically unchanged ───────

describe("shared isPlanMember behaviour (pure de-duplication, no semantic change)", () => {
  it("HAPPY: true when extra.plan_id equals the plan id", () => {
    expect(isPlanMember(makeTask({ plan_id: PLAN_ID }), PLAN_ID)).toBe(true);
  });

  it("NEGATIVE: false when extra.plan_id names a different plan", () => {
    expect(isPlanMember(makeTask({ plan_id: OTHER_PLAN_ID }), PLAN_ID)).toBe(false);
  });

  it("BOUNDARY: false when extra.plan_id is absent (never a permissive match)", () => {
    expect(isPlanMember(makeTask({}), PLAN_ID)).toBe(false);
  });

  it("BOUNDARY: false for a non-string extra.plan_id — strict equality, no coercion", () => {
    expect(isPlanMember(makeTask({ plan_id: null }), PLAN_ID)).toBe(false);
    expect(isPlanMember(makeTask({ plan_id: 0 }), PLAN_ID)).toBe(false);
  });

  it("STATE: parent_id is ignored entirely — a diverged member still matches", () => {
    const diverged = { ...makeTask({ plan_id: PLAN_ID }), parent_id: OTHER_PLAN_ID } as DocRecord;
    expect(isPlanMember(diverged, PLAN_ID)).toBe(true);
  });

  it("ERROR: reading a task whose extra bag is empty does not throw", () => {
    expect(() => isPlanMember(makeTask({}), PLAN_ID)).not.toThrow();
  });
});

// ─── Import-graph edge pin (keeps this file selectable by test:changed) ─────

describe("import-graph edge", () => {
  it("both workflow service classes are importable from this suite", () => {
    // reason: this assertion's real job is justifying the two top-level imports
    // that give test:changed a reverse-dependency edge to both services — a
    // structural suite that only readFileSync's its subjects is invisible to
    // import-graph selection (scripts/changed-tests.ts, rule (b)).
    expect(typeof TaskWorkflowService).toBe("function");
    expect(typeof PhaseWorkflowService).toBe("function");
  });
});

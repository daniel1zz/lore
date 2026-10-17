// @reads packages/lore/tests/fixtures/seat-branch-sanitize.golden.json
/**
 * RED suite (TDD-Role: red, paired-impl task-skill-implement-core-seat-ts-seatservice-
 * realgitport) for `@lore/core`'s `seat.ts` — a module that does NOT exist yet. Covers
 * AC-S-1 (naming/parsing round-trip, 4-class location table, `assertSeatEntryReady`
 * matched pair, `deriveResumeHint` seat-scoped/corpus-global/null-when-none) and half
 * of AC-S-5 (sanitizer-parity golden fixture, TS side — the hook side of the same
 * fixture is consumed by `packages/lore/tests/unit/hooks/session-seat-injection.test.ts`).
 *
 * RED mechanism (mirrors this repo's own SPEC-058 RED precedent,
 * `packages/lore/tests/unit/core/verification-profile.test.ts`): the module under test
 * is loaded via a dynamic `import()` whose specifier is a COMPUTED (non-literal) string
 * built via `.join("/")`. TypeScript only performs static module resolution against
 * `import()` calls whose argument is a string literal, so `bun run typecheck` stays
 * green today (before `packages/core/src/seat.ts` exists) with zero edits to this file
 * either way once it lands. At runtime today the import genuinely throws ("Cannot find
 * module") inside `beforeAll`, which vitest reports as every `it` in this file failing
 * due to a failed hook — the "import errors against not-yet-existing modules" RED mode.
 *
 * Source: spec-spec-057-two-tier-worktree-seat-model-lore-seat-verb-seat-a
 *   §Public Interface, §Acceptance Criteria AC-S-1, AC-S-5.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { LoreError, Result } from "@lore/core";

// packages/lore/tests/unit/core/ -> ../../../../ -> packages/ -> core/src/seat.js
const SEAT_MODULE_PATH = ["..", "..", "..", "..", "core", "src", "seat.js"].join("/");

// ─── Minimal local contracts for the not-yet-existing module ──────────────────
//
// These are DELIBERATELY narrower/looser than the real module's eventual exports
// (mirroring verification-profile.test.ts's precedent) — just enough structure for
// this suite to call through. The paired implementer's real seat.ts is the source
// of truth once it lands; this suite pins the CONTRACT, not the implementation.

/** Git facts `classifySessionLocation` classifies — `parentSeatBranch` is a fact the
 *  CALLER (hook/CLI git-plumbing) has already resolved, never derived by this fn. */
interface GitFacts {
  branch: string | null;
  isLinkedWorktree: boolean;
  parentSeatBranch: string | null;
}

type SessionLocationClass = "main" | "seat" | "task_under_seat" | "detached";

/** Narrow projection of `ReadyReport` (`packages/lore/src/service/task-workflow-service.ts`)
 *  — only the field `assertSeatEntryReady` reads. Declared locally (not imported) because
 *  `@lore/core` must never depend on `packages/lore/src/**` (AC-MR-B1); the real predicate
 *  accepts anything structurally compatible with this shape. */
interface SeatReadyReportLike {
  anchor_conflicts: Array<{ task_slug: string; holder: string; paths: string[] }>;
}

/** Pointer to one handoff `deriveResumeHint` scans — the fields it actually reads. */
interface HandoffPointer {
  handoff_slug: string;
  plan_id: string | null;
  plan_slug: string | null;
  at: string;
}

interface ResumeHint {
  plan_slug: string | null;
  handoff_slug: string;
}

interface SeatModule {
  seatBranchName: (planSlug: string) => string;
  parseSeatBranch: (branch: string) => string | null;
  sanitizeBranchSegment: (input: string) => string;
  classifySessionLocation: (facts: GitFacts) => SessionLocationClass;
  assertSeatEntryReady: (report: SeatReadyReportLike) => Result<void, LoreError>;
  deriveResumeHint: (handoffs: HandoffPointer[], seatPlanId?: string) => ResumeHint | null;
}

let mod: SeatModule;

beforeAll(async () => {
  mod = (await import(SEAT_MODULE_PATH)) as unknown as SeatModule;
});

// ─── Golden fixture (shared with the hook suite — AC-S-5) ─────────────────────

interface GoldenPair {
  input: string;
  expected: string;
}

function loadGoldenPairs(): GoldenPair[] {
  const fixturePath = join(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "..",
    "fixtures",
    "seat-branch-sanitize.golden.json",
  );
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as { pairs: GoldenPair[] };
  return raw.pairs;
}

// ─── seatBranchName / parseSeatBranch — naming round-trip ─────────────────────

describe("seat.ts — seatBranchName / parseSeatBranch (HAPPY)", () => {
  it("seatBranchName prefixes an already-clean kebab slug with plan/", () => {
    expect(mod.seatBranchName("plan-session-layer")).toBe("plan/plan-session-layer");
  });

  it("seatBranchName sanitizes underscores/slashes/uppercase in the slug", () => {
    expect(mod.seatBranchName("Plan_Session/Layer")).toBe("plan/plan-session-layer");
  });

  it("parseSeatBranch recovers the plan slug from a well-formed seat branch", () => {
    expect(mod.parseSeatBranch("plan/plan-session-layer")).toBe("plan-session-layer");
  });

  it("seatBranchName then parseSeatBranch round-trips to the sanitized slug", () => {
    const branch = mod.seatBranchName("Weird_Plan Title");
    expect(mod.parseSeatBranch(branch)).toBe(mod.sanitizeBranchSegment("Weird_Plan Title"));
  });
});

describe("seat.ts — parseSeatBranch (NEGATIVE / BOUNDARY)", () => {
  it("a branch with no plan/ prefix is not a seat branch", () => {
    expect(mod.parseSeatBranch("feat/x_y")).toBeNull();
  });

  it("the literal branch main is not a seat branch", () => {
    expect(mod.parseSeatBranch("main")).toBeNull();
  });

  it("a degenerate plan/ branch with an empty slug remainder is not a valid seat branch", () => {
    expect(mod.parseSeatBranch("plan/")).toBeNull();
  });
});

// ─── classifySessionLocation — 4-class table (AC-S-1) ──────────────────────────

describe("seat.ts — classifySessionLocation (STATE, 4-class table)", () => {
  it("non-worktree checkout classifies as main", () => {
    expect(
      mod.classifySessionLocation({ branch: "main", isLinkedWorktree: false, parentSeatBranch: null }),
    ).toBe("main");
  });

  it("main class is independent of branch name — any branch in a non-worktree checkout is main", () => {
    expect(
      mod.classifySessionLocation({ branch: "some-feature", isLinkedWorktree: false, parentSeatBranch: null }),
    ).toBe("main");
  });

  it("a linked worktree whose own branch is a seat branch classifies as seat", () => {
    expect(
      mod.classifySessionLocation({
        branch: "plan/plan-session-layer",
        isLinkedWorktree: true,
        parentSeatBranch: null,
      }),
    ).toBe("seat");
  });

  it("a linked worktree with a non-seat branch but a resolved parentSeatBranch classifies as task_under_seat", () => {
    expect(
      mod.classifySessionLocation({
        branch: "worktree-agent-abc123",
        isLinkedWorktree: true,
        parentSeatBranch: "plan/plan-session-layer",
      }),
    ).toBe("task_under_seat");
  });

  it("a linked worktree in detached HEAD (branch null) classifies as detached", () => {
    expect(
      mod.classifySessionLocation({ branch: null, isLinkedWorktree: true, parentSeatBranch: null }),
    ).toBe("detached");
  });

  it("detached wins over a resolved parentSeatBranch when branch is null", () => {
    expect(
      mod.classifySessionLocation({
        branch: null,
        isLinkedWorktree: true,
        parentSeatBranch: "plan/plan-session-layer",
      }),
    ).toBe("detached");
  });
});

// ─── assertSeatEntryReady — matched pair (AC-S-1) ──────────────────────────────

describe("seat.ts — assertSeatEntryReady (HAPPY / NEGATIVE matched pair)", () => {
  it("a plan with zero anchor conflicts is ready to enter", () => {
    const result = mod.assertSeatEntryReady({ anchor_conflicts: [] });
    expect(result.ok).toBe(true);
  });

  it("a plan with an open anchor conflict is blocked, naming the conflicting task/holder", () => {
    const result = mod.assertSeatEntryReady({
      anchor_conflicts: [{ task_slug: "task-a", holder: "agent:other", paths: ["src/a.ts"] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialized = JSON.stringify(result.error);
    expect(serialized).toContain("task-a");
    expect(serialized).toContain("agent:other");
  });
});

// ─── deriveResumeHint — seat-scoped / corpus-global / null-when-none (AC-S-1) ──

describe("seat.ts — deriveResumeHint (HAPPY / STATE / BOUNDARY)", () => {
  const handoffs: HandoffPointer[] = [
    { handoff_slug: "handoff-plan-a-old", plan_id: "plan-a-id", plan_slug: "plan-a", at: "2026-07-01T00:00:00.000Z" },
    { handoff_slug: "handoff-plan-a-new", plan_id: "plan-a-id", plan_slug: "plan-a", at: "2026-07-10T00:00:00.000Z" },
    { handoff_slug: "handoff-plan-b-newest", plan_id: "plan-b-id", plan_slug: "plan-b", at: "2026-07-15T00:00:00.000Z" },
  ];

  it("seatPlanId given -> scopes to the newest handoff for that plan only, ignoring a globally-newer handoff on another plan", () => {
    const hint = mod.deriveResumeHint(handoffs, "plan-a-id");
    expect(hint).toEqual({ plan_slug: "plan-a", handoff_slug: "handoff-plan-a-new" });
  });

  it("seatPlanId absent -> corpus-global newest overall (byte-identical to the pre-seat derivation)", () => {
    const hint = mod.deriveResumeHint(handoffs);
    expect(hint).toEqual({ plan_slug: "plan-b", handoff_slug: "handoff-plan-b-newest" });
  });

  it("seatPlanId given but no handoff matches that plan -> null, a fact, no silent corpus-global fallback", () => {
    const hint = mod.deriveResumeHint(handoffs, "plan-c-id-with-no-handoffs");
    expect(hint).toBeNull();
  });

  it("empty handoffs and no seatPlanId -> null", () => {
    expect(mod.deriveResumeHint([])).toBeNull();
  });
});

// ─── Golden-fixture consumption (AC-S-5, TS side) ──────────────────────────────

describe("seat.ts — sanitizer golden-fixture parity (AC-S-5)", () => {
  const pairs = loadGoldenPairs();

  it("loaded golden fixture has at least 10 pairs", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(10);
  });

  it("sanitizeBranchSegment matches every golden pair", () => {
    for (const { input, expected } of pairs) {
      expect(mod.sanitizeBranchSegment(input)).toBe(expected);
    }
  });

  it("seatBranchName composes plan/ + the sanitized segment for every golden pair", () => {
    for (const { input, expected } of pairs) {
      expect(mod.seatBranchName(input)).toBe(`plan/${expected}`);
    }
  });
});

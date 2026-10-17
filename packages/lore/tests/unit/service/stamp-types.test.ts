// @reads packages/core/src/**
// @reads packages/lore/packages/core/src/index.ts
// @reads packages/lore/src/service/gate-predicates.ts
// @reads packages/lore/tests/packages/core/src/index.ts
// @reads packages/lore/tests/unit/packages/core/src/index.ts
// @reads packages/lore/tests/unit/service/packages/core/src/index.ts
// @reads packages/packages/core/src/index.ts
// @layer service-stamp-verdict AC-CT-9
/**
 * RED-phase oracle for SPEC-143's two-axis stamp type foundation (C1 + C2, R9;
 * AC-CT-9 half (c)).
 *
 * The types this file asserts about DO NOT EXIST YET. That is the point: this
 * suite is written before the paired implementation task
 * (`task-skill-implement-two-axis-type-foundation-stampclass`) lands
 * `StampClass` / `RadiusMeasurement` / `StampCurrency` / `StampVerdict` /
 * `readStampVerdict` in `packages/lore/src/service/gate-predicates.ts` and
 * `StateStamp` in `packages/core/src/task-workflow.ts` (and, after R13, the arming vocabulary in `stamp-binding.ts`). Every
 * failure below is engineered to name the missing symbol, so a red run is
 * attributable to a missing implementation and never to a broken test.
 *
 * ## What each scenario measures, and what would make it vacuous
 *
 * 1. `readStampVerdict` projects five readings — asserted as a SET SIZE, not as
 *    five independent equalities. Five separate `toBe` assertions stay green if
 *    two arms collapse onto one reading; `new Set(...).size === 5` does not.
 *    Reinforced by walking the FULL 3x3 product (three `StampClass` members x
 *    three `RadiusMeasurement` arms): totality is the claim SPEC-143 C2 makes
 *    ("total over the product"), and nine cells is what "total" means here.
 *    A third case pins the AXIS ORDER — for `unbound` and `legacy_unbound`
 *    every radius arm must give the SAME reading, which is what distinguishes
 *    two orthogonal axes from one collapsed four-valued enum, the exact defect
 *    R9 corrected.
 *
 * 2. A sixth `StampClass` member must break the build AT `readStampVerdict`'s
 *    `never` check. A union is closed, so no consumer can widen it — the only
 *    honest oracle copies the whole real module into an isolated project and
 *    widens the declaration in place. Three halves, all required: a GREEN
 *    CONTROL (verbatim copy compiles at exit 0, so the widened failure is
 *    attributable to the widening alone), the widened case (exit EXACTLY 2,
 *    with a `never` diagnostic INSIDE `readStampVerdict`'s own line range —
 *    "fails at the never check", not "fails somewhere"), and a REVERSE CONTROL
 *    proving exit 2 alone cannot discriminate a real detection from a config
 *    fatal.
 *
 * 3. Both `RadiusMeasurement` arms must be constructible and narrow, and a bare
 *    boolean / the bare string `"unmeasured"` must NOT type-check as one. This
 *    is the shape `packages/lore/src/adapters/real-git-port.ts`'s
 *    `BranchMeasurement` already enforces for the same reason ("not measured"
 *    and "known-absent" are different facts) and which SPEC-143 C3 explicitly
 *    RETIRED `boolean | "unmeasured"` in favour of. The negative halves are
 *    compile-time, measured by exit code against the REAL imported type.
 *
 * 4. `StateStamp` and `STATE_BINDING_ARMED_ACTION` must be reachable from the BROWSER-SAFE
 *    `@lore/core` barrel with no Node builtin anywhere in that barrel's
 *    transitive closure — the dashboard imports it, and Vite's dev-mode `fs`
 *    stub throws at module-LOAD time, blanking the SPA before React mounts
 *    (`packages/core/src/index.ts`'s own invariant). Asserted structurally
 *    (`task-workflow.ts` is IN the closure and declares both symbols) plus a
 *    LIVE CONTROL that the same scanner DOES find a builtin in
 *    `packages/core/src/node.ts`'s closure — without that control an inert
 *    detector passes trivially.
 *
 * ## Why there is no `@ts-expect-error` in this file
 *
 * The in-repo RED-phase convention (`packages/lore/tests/unit/core/
 * plan-update.test.ts`) carries `// @ts-expect-error TS2305` on the import of a
 * not-yet-existing symbol and has the implementer flip the pragma. That
 * convention is deliberately NOT used here, for two reasons. First, it does not
 * compose: once an import is suppressed the symbol becomes an error type, so a
 * follow-on `// @ts-expect-error TS2322` guard on `const bad: RadiusMeasurement
 * = true` would be UNUSED during RED and redden `bun run typecheck` — the
 * negative halves of scenario 3 are unexpressible that way. Second, it is
 * unnecessary: every type-level claim here is instead measured by exit code in
 * an isolated project that imports the REAL module (see the fixture header),
 * which is strictly stronger than a pragma AND leaves nothing for the paired
 * implementer to remember to remove. Values are read through a module
 * NAMESPACE import, which never fails to link, so a missing export surfaces as
 * this file's own "MISSING IMPLEMENTATION" message in the one scenario that
 * needs it rather than as a collection-time crash taking all four down.
 *
 * ## Coverage
 *
 *   HAPPY      — the five canonical cells project to the five declared readings.
 *   NEGATIVE   — a bare boolean and the bare string `"unmeasured"` are rejected
 *                as `RadiusMeasurement` at compile time (exit EXACTLY 2, TS2322,
 *                naming the type).
 *   BOUNDARY   — `{status:"measured"}` with `changed` omitted is rejected: the
 *                measured arm carries its payload or it is not that arm.
 *   ERROR      — a config-fatal project also exits 2 but with TS18003 and
 *                without TS2322, proving the exit-code assertions discriminate.
 *   STATE      — every isolated project is written fresh per case under
 *                `mkdtemp` and removed in `afterEach`; no shared mutable fixture.
 *   REGRESSION — the never-check diagnostic is pinned to `readStampVerdict`'s
 *                LINE RANGE and the exit code to EXACTLY 2, so a future
 *                compiler change or a relocated exhaustiveness check fails loud
 *                instead of degrading to "some error happened".
 *
 * Runner: vitest (`gate-predicates.ts` is pure and touches no `bun:sqlite`).
 * Measured cost 2026-08-23: ~1.3s per isolated `tsc` run, at most one run per
 * case — well inside vitest's configured 30s `testTimeout`, so no case declares
 * a timeout of its own.
 *
 * @spec_ref SPEC-143 C1, C2, C3; AC-CT-9(c);
 *   task-skill-test-two-axis-type-foundation-red-test-scenarios
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";

// ⛔ NOTHING here imports `@lore/core` at RUNTIME, and that omission is
// load-bearing. Measured 2026-08-23 inside a git worktree under
// `<main>/.claude/worktrees/`: the worktree has no `node_modules` of its own,
// so `@lore/core` resolves upward to `<main>/node_modules/@lore/core`, a
// symlink to `<main>/packages/core`. A runtime oracle written against that
// specifier therefore measures the MAIN CHECKOUT's source, not the checkout
// under test — it reads red for a correct implementation until the change
// reaches main, and would read green for a reverted one while the worktree
// still held it. Measured directly: with a correct reference implementation
// applied to THIS worktree, the `@lore/core` runtime read still reported
// the arming symbol missing while all fifteen other cases were green.
//
// A relative `../../../../core/src/index.js` import is not the fix either:
// `packages/lore/tsconfig.tests.json` sets `rootDir: "."`, so crossing the
// package boundary by relative path is `TS6059` and cascades over the whole
// `packages/core` graph (measured: `bun run typecheck` exit 2).
//
// So the `@lore/core` side of scenario 4 is asserted by the two mechanisms
// that DO read this checkout: the isolated compile-consumer project (which
// imports `STATE_BINDING_ARMED_ACTION`/`StateStamp` from this worktree's own
// `packages/core/src/index.js` and must type-check clean) and the fs-level
// import-graph scan below — the same relative-path approach
// `packages/lore/tests/unit/core/barrel-isolation.test.ts` takes.
import * as gatePredicatesNamespace from "../../../src/service/gate-predicates.js";

import {
  CORE_BARREL_RELATIVE,
  EXIT_CHECKED,
  EXIT_CLEAN,
  GATE_PREDICATES_RELATIVE,
  SIXTH_STAMP_CLASS_MEMBER,
  STAMP_BINDING_RELATIVE,
  TASK_WORKFLOW_RELATIVE,
  TS18003,
  TS2322,
  buildGatePredicatesProject,
  buildRealTypeConsumerProject,
  cleanupScratchDirs,
  collectImportClosure,
  filesDeclaring,
  isBunRuntimeSpecifier,
  isNodeBuiltinSpecifier,
  locateFunctionRange,
  makeScratchDir,
  parseDiagnostics,
  readRepoFile,
  repoFile,
  resolveRepoPaths,
  runTsc,
  writeIsolatedProject,
  type RepoPaths,
  type TscRun,
} from "./stamp-types-compile-fail.fixture.js";

// ─────────────────────────────────────────────────────────────────────────
// Local mirrors of the not-yet-existing contract types
//
// These exist ONLY for readability of the runtime cases below. They carry NO
// authority: the authoritative shape check is the green compile-consumer case
// in scenario 3, which constructs the SAME nine cells through the REAL
// exported types. If a mirror ever drifts from the real declaration, that case
// reddens — so the mirrors cannot silently diverge.
// ─────────────────────────────────────────────────────────────────────────

/** Mirror of SPEC-143 C2's STAMP axis — presence, split by the arming cutoff. */
type StampClassMirror = "stamped" | "unbound" | "legacy_unbound";

/** Mirror of SPEC-143 C2's RADIUS axis — same shape as `real-git-port.ts::BranchMeasurement`. */
type RadiusMeasurementMirror =
  | { readonly status: "measured"; readonly changed: boolean }
  | { readonly status: "unmeasured" };

/** Mirror of `stampCurrency`'s return: two orthogonal axes, never one enum. */
interface StampCurrencyMirror {
  readonly stamp: StampClassMirror;
  readonly radius: RadiusMeasurementMirror;
}

/** Mirror of the five terminal readings `readStampVerdict` projects. */
type StampVerdictMirror = "bound" | "stale" | "radius_unmeasured" | "unbound" | "legacy_unbound";

/** The five readings, as declared by SPEC-143 C2 / AC-CT-9(c). */
const DECLARED_READINGS: readonly StampVerdictMirror[] = [
  "bound",
  "stale",
  "radius_unmeasured",
  "unbound",
  "legacy_unbound",
];

const STAMP_CLASSES: readonly StampClassMirror[] = ["stamped", "unbound", "legacy_unbound"];

const MEASURED_UNCHANGED: RadiusMeasurementMirror = { status: "measured", changed: false };
const MEASURED_CHANGED: RadiusMeasurementMirror = { status: "measured", changed: true };
const UNMEASURED: RadiusMeasurementMirror = { status: "unmeasured" };

const RADIUS_ARMS: readonly RadiusMeasurementMirror[] = [
  MEASURED_UNCHANGED,
  MEASURED_CHANGED,
  UNMEASURED,
];

/** The five canonical cells AC-CT-9(c) enumerates, paired with their expected reading. */
const CANONICAL_CELLS: readonly {
  readonly cell: StampCurrencyMirror;
  readonly expected: StampVerdictMirror;
}[] = [
  { cell: { stamp: "stamped", radius: MEASURED_UNCHANGED }, expected: "bound" },
  { cell: { stamp: "stamped", radius: MEASURED_CHANGED }, expected: "stale" },
  { cell: { stamp: "stamped", radius: UNMEASURED }, expected: "radius_unmeasured" },
  { cell: { stamp: "unbound", radius: MEASURED_UNCHANGED }, expected: "unbound" },
  { cell: { stamp: "legacy_unbound", radius: MEASURED_UNCHANGED }, expected: "legacy_unbound" },
];

/** Every cell of the 3x3 product — what "total over the product" quantifies over. */
const FULL_PRODUCT: readonly StampCurrencyMirror[] = STAMP_CLASSES.flatMap((stamp) =>
  RADIUS_ARMS.map((radius) => ({ stamp, radius })),
);

// ─────────────────────────────────────────────────────────────────────────
// Runtime access to the not-yet-existing exports
// ─────────────────────────────────────────────────────────────────────────

const gateExports = gatePredicatesNamespace as unknown as Record<string, unknown>;

/**
 * Reads one named export, failing with a message that names the missing symbol
 * and its declared home rather than a bare `undefined is not a function`.
 *
 * ⛔ Never returns a stub or a default: a silently substituted no-op would let
 * every assertion below pass against nothing, which is the vacuous-pass class
 * SPEC-143 exists to refuse.
 */
function requireExport(
  namespaceObject: Record<string, unknown>,
  name: string,
  declaredHome: string,
): unknown {
  const value = namespaceObject[name];
  if (value === undefined) {
    throw new Error(
      `MISSING IMPLEMENTATION — \`${name}\` is not exported from ${declaredHome}. ` +
        `SPEC-143 (C1/C2, R9) declares it there; this is the RED-phase failure this test is ` +
        `designed to produce, not a test bug.`,
    );
  }
  return value;
}

/** The real `readStampVerdict`, or a loud RED-phase failure. */
function readStampVerdict(): (currency: StampCurrencyMirror) => StampVerdictMirror {
  const candidate = requireExport(gateExports, "readStampVerdict", GATE_PREDICATES_RELATIVE);
  if (typeof candidate !== "function") {
    throw new Error(
      `\`readStampVerdict\` is exported from ${GATE_PREDICATES_RELATIVE} but is a ` +
        `${typeof candidate}, not a function.`,
    );
  }
  return candidate as (currency: StampCurrencyMirror) => StampVerdictMirror;
}

/**
 * Turns an isolated project's unresolved-import diagnostics into an explicit
 * RED-phase report. Without this, a scenario-3 case would fail on "expected
 * output to contain TS2322" and read like a mis-written assertion, when the
 * real cause is that the type it imports does not exist yet.
 */
function assertImportsResolved(run: TscRun, label: string): void {
  if (run.output.includes("TS2305") || run.output.includes("TS2307")) {
    throw new Error(
      `MISSING IMPLEMENTATION — the isolated project for "${label}" could not resolve the ` +
        `two-axis exports (TS2305 "has no exported member" / TS2307 "cannot find module"). ` +
        `SPEC-143 C1/C2 has not landed yet; this is the RED-phase failure this test is designed ` +
        `to produce, not a test bug.\n\n--- tsc output ---\n${run.output}`,
    );
  }
}

let paths: RepoPaths;

beforeAll(() => {
  paths = resolveRepoPaths();
});

afterEach(() => {
  cleanupScratchDirs();
});

// ─────────────────────────────────────────────────────────────────────────
// Scenario 1 — five mutually-exclusive readings, total over the product
// ─────────────────────────────────────────────────────────────────────────

describe("SPEC-143 AC-CT-9(c) scenario 1: readStampVerdict projects five mutually-exclusive readings", () => {
  it("HAPPY: the five canonical (stamp, radius) cells project to bound / stale / radius_unmeasured / unbound / legacy_unbound, and the returned SET has size EXACTLY 5", () => {
    const project = readStampVerdict();

    const observed = CANONICAL_CELLS.map(({ cell }) => project(cell));

    // Per-cell mapping — the "respectively" half of the scenario.
    CANONICAL_CELLS.forEach(({ cell, expected }, index) => {
      expect(observed[index], `cell ${JSON.stringify(cell)}`).toBe(expected);
    });

    // The set-size half. This is the assertion five independent equalities
    // cannot make: it is what refuses two readings collapsing onto one name.
    expect(new Set(observed).size).toBe(5);
  });

  it("TOTALITY: every one of the nine (StampClass x RadiusMeasurement) cells returns a declared reading, and the whole product yields EXACTLY the five declared names — none missing, none extra", () => {
    const project = readStampVerdict();

    expect(FULL_PRODUCT).toHaveLength(9);

    const observed = FULL_PRODUCT.map((cell) => {
      const reading = project(cell);
      expect(
        DECLARED_READINGS as readonly string[],
        `cell ${JSON.stringify(cell)} projected an undeclared reading`,
      ).toContain(reading);
      return reading;
    });

    // Sorted comparison rather than a size check: this refuses BOTH an extra
    // sixth reading AND an unreachable declared one (a projection that can
    // never emit `radius_unmeasured` would still pass a bare size assertion on
    // the canonical five).
    expect([...new Set(observed)].sort()).toStrictEqual([...DECLARED_READINGS].sort());
  });

  it("AXIS ORDER: for `unbound` and `legacy_unbound` all three radius arms give the SAME reading — the radius axis never leaks into a stamp-axis reading (this is what makes the two axes orthogonal rather than one collapsed four-valued enum, R9)", () => {
    const project = readStampVerdict();

    for (const stamp of ["unbound", "legacy_unbound"] as const) {
      const readings = RADIUS_ARMS.map((radius) => project({ stamp, radius }));
      expect(new Set(readings).size, `stamp "${stamp}" is radius-sensitive`).toBe(1);
      expect(readings[0]).toBe(stamp);
    }

    // The control half: `stamped` MUST be radius-sensitive, otherwise the
    // assertion above is satisfied by a projection that ignores radius
    // entirely — which would silently drop `stale` and `radius_unmeasured`.
    const stampedReadings = RADIUS_ARMS.map((radius) => project({ stamp: "stamped", radius }));
    expect(new Set(stampedReadings).size).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Scenario 2 — a sixth StampClass member breaks the build at the never check
// ─────────────────────────────────────────────────────────────────────────

describe("SPEC-143 AC-CT-9(c) scenario 2: a sixth StampClass member fails the build at readStampVerdict's never check", () => {
  it("GREEN CONTROL: a VERBATIM copy of the real gate-predicates.ts compiles clean (exit 0) in the isolated project — so a failure in the widened case is attributable to the widening and nothing else", () => {
    const project = buildGatePredicatesProject(paths);
    const run = runTsc(paths, project.root);

    expect(run.status, `tsc output:\n${run.output}`).toBe(EXIT_CLEAN);
  });

  it("a sixth StampClass member makes tsc exit EXACTLY 2 with a `never` diagnostic INSIDE readStampVerdict's own line range, naming the injected member", () => {
    const project = buildGatePredicatesProject(paths, { widenWith: SIXTH_STAMP_CLASS_MEMBER });
    // Located in exactly the bytes tsc is about to compile — the widening
    // inserts no newline, so the range is directly comparable to the
    // diagnostics' line numbers.
    const range = locateFunctionRange(project.copiedSource, "readStampVerdict");

    const run = runTsc(paths, project.root);

    // Exactly 2, never "nonzero": a config fatal lands on 2 as well, which is
    // why the code, the member name and the line range are all asserted too.
    expect(run.status, `tsc output:\n${run.output}`).toBe(EXIT_CHECKED);
    expect(run.output).toContain(SIXTH_STAMP_CLASS_MEMBER);
    expect(run.output).not.toContain(TS18003);

    const insideFunction = parseDiagnostics(run.output).filter(
      (diagnostic) =>
        diagnostic.file.endsWith(project.copiedFileName) &&
        diagnostic.line >= range.startLine &&
        diagnostic.line <= range.endLine,
    );

    expect(
      insideFunction.length,
      `no diagnostic landed inside readStampVerdict (lines ${range.startLine}-${range.endLine}); ` +
        `tsc output:\n${run.output}`,
    ).toBeGreaterThan(0);

    // `never` covers both idiomatic forms of the check: `const _exhaustive:
    // never = c.stamp` (TS2322) and `assertNever(c.stamp)` (TS2345).
    expect(
      insideFunction.some((diagnostic) => diagnostic.message.includes("never")),
      `diagnostics inside readStampVerdict did not mention \`never\`: ` +
        `${JSON.stringify(insideFunction, null, 2)}`,
    ).toBe(true);
  });

  it("REVERSE CONTROL: a project whose `include` matches nothing ALSO exits 2, but with TS18003 and explicitly WITHOUT TS2322 — proving the exit code alone cannot discriminate a real detection from a config fatal", () => {
    const root = makeScratchDir();
    writeIsolatedProject(paths, root, { "src/index.ts": "export const noop = 1;\n" }, [
      "nonexistent/**/*.ts",
    ]);

    const run = runTsc(paths, root);

    expect(run.status).toBe(EXIT_CHECKED);
    expect(run.output).toContain(TS18003);
    expect(run.output).not.toContain(TS2322);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Scenario 3 — RadiusMeasurement's two arms, and what must NOT be one
// ─────────────────────────────────────────────────────────────────────────

/**
 * The compile-only consumer body. Constructs both radius arms, all three stamp
 * classes, the full nine-cell product, every reading through the real
 * `readStampVerdict`, plus a `StateStamp` and `STATE_BINDING_ARMED_ACTION` — all through the
 * PUBLIC exports. Doubles as scenario 3's green control and as the shape check
 * that keeps this file's local mirror types honest.
 */
const GREEN_CONSUMER_BODY = `
const measuredUnchanged: RadiusMeasurement = { status: "measured", changed: false };
const measuredChanged: RadiusMeasurement = { status: "measured", changed: true };
const unmeasured: RadiusMeasurement = { status: "unmeasured" };

const stamps: readonly StampClass[] = ["stamped", "unbound", "legacy_unbound"];
const arms: readonly RadiusMeasurement[] = [measuredUnchanged, measuredChanged, unmeasured];

const cells: readonly StampCurrency[] = stamps.flatMap((stamp) =>
  arms.map((radius) => ({ stamp, radius })),
);
const readings: readonly StampVerdict[] = cells.map((cell) => readStampVerdict(cell));

// Narrowing must work off the discriminant alone, with no cast.
function changedOf(radius: RadiusMeasurement): boolean | "unmeasured" {
  return radius.status === "measured" ? radius.changed : "unmeasured";
}

const stamp: StateStamp = {
  head_sha: "0000000000000000000000000000000000000000",
  worktree_dirty: false,
  corpus_rev: 6176,
};
const cutoff: string = STATE_BINDING_ARMED_ACTION;

export const probe = { readings, stamp, cutoff, changedOf };
`;

describe("SPEC-143 C2/C3 scenario 3: RadiusMeasurement is a discriminated union, not a primitive-plus-sentinel", () => {
  it("HAPPY (runtime): both arms are constructible and narrow off the `status` discriminant", () => {
    const describeArm = (radius: RadiusMeasurementMirror): string =>
      radius.status === "measured" ? `measured:${String(radius.changed)}` : "unmeasured";

    expect(describeArm(MEASURED_CHANGED)).toBe("measured:true");
    expect(describeArm(MEASURED_UNCHANGED)).toBe("measured:false");
    expect(describeArm(UNMEASURED)).toBe("unmeasured");
  });

  it("GREEN CONTROL (compile): a consumer constructing both arms, all nine cells and a StateStamp through the REAL public exports type-checks clean (exit 0)", () => {
    const project = buildRealTypeConsumerProject(paths, GREEN_CONSUMER_BODY);
    const run = runTsc(paths, project.root);

    assertImportsResolved(run, "green compile-consumer control");
    expect(run.status, `tsc output:\n${run.output}`).toBe(EXIT_CLEAN);
  });

  it("NEGATIVE (compile): a bare boolean is NOT assignable to RadiusMeasurement — exit EXACTLY 2, TS2322, naming the type", () => {
    const project = buildRealTypeConsumerProject(
      paths,
      'export const bad: RadiusMeasurement = true;\n',
    );
    const run = runTsc(paths, project.root);

    assertImportsResolved(run, "bare boolean rejection");
    expect(run.status, `tsc output:\n${run.output}`).toBe(EXIT_CHECKED);
    expect(run.output).toContain(TS2322);
    expect(run.output).toContain("RadiusMeasurement");
    expect(run.output).not.toContain(TS18003);
  });

  it('NEGATIVE (compile): the bare string "unmeasured" is NOT assignable to RadiusMeasurement — the exact `boolean | "unmeasured"` shape SPEC-143 C3 retired', () => {
    const project = buildRealTypeConsumerProject(
      paths,
      'export const bad: RadiusMeasurement = "unmeasured";\n',
    );
    const run = runTsc(paths, project.root);

    assertImportsResolved(run, 'bare "unmeasured" string rejection');
    expect(run.status, `tsc output:\n${run.output}`).toBe(EXIT_CHECKED);
    expect(run.output).toContain(TS2322);
    expect(run.output).toContain("RadiusMeasurement");
    expect(run.output).not.toContain(TS18003);
  });

  it("BOUNDARY (compile): the measured arm carries its payload — `{status:\"measured\"}` with `changed` omitted is rejected, naming `changed`", () => {
    const project = buildRealTypeConsumerProject(
      paths,
      'export const bad: RadiusMeasurement = { status: "measured" };\n',
    );
    const run = runTsc(paths, project.root);

    assertImportsResolved(run, "measured arm without `changed`");
    expect(run.status, `tsc output:\n${run.output}`).toBe(EXIT_CHECKED);
    expect(run.output).toContain("changed");
    expect(run.output).toContain("RadiusMeasurement");
    expect(run.output).not.toContain(TS18003);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Scenario 4 — StateStamp / the arming vocabulary stay inside the browser-safe barrel
// ─────────────────────────────────────────────────────────────────────────

describe("SPEC-143 C1 scenario 4: StateStamp and the arming vocabulary are reachable from @lore/core with no Node builtin in the barrel's closure", () => {
  it("R13: the shipped ARMING_REV literal is GONE from the barrel closure; the cutoff is a per-corpus audit row and only its action name is declared, in stamp-binding.ts", () => {
    const closure = collectImportClosure(repoFile(paths, CORE_BARREL_RELATIVE));

    expect(
      filesDeclaring(closure, "ARMING_REV"),
      "a shipped `ARMING_REV` literal is back in the @lore/core closure - SPEC-143 R13 removed it " +
        "because a literal never arms a consumer corpus",
    ).toStrictEqual([]);
    expect(filesDeclaring(closure, "STATE_BINDING_ARMED_ACTION")).toStrictEqual([
      repoFile(paths, STAMP_BINDING_RELATIVE),
    ]);
  });

  it("packages/core/src/task-workflow.ts is IN the browser-safe barrel's transitive closure and declares StateStamp - SPEC-143 C1 pins that file as its single home", () => {
    const closure = collectImportClosure(repoFile(paths, CORE_BARREL_RELATIVE));
    const taskWorkflow = repoFile(paths, TASK_WORKFLOW_RELATIVE);

    expect([...closure.files]).toContain(taskWorkflow);

    expect(
      filesDeclaring(closure, "StateStamp"),
      "no file in the @lore/core barrel closure declares `StateStamp` - SPEC-143 C1 requires it " +
        `in ${TASK_WORKFLOW_RELATIVE}; this is the RED-phase failure this test is designed to produce`,
    ).toStrictEqual([taskWorkflow]);
  });

  it("the barrel's transitive closure imports ZERO Node builtins and zero bun: modules — Vite's dev-mode fs stub throws at module-LOAD time, blanking the dashboard SPA before React mounts", () => {
    const closure = collectImportClosure(repoFile(paths, CORE_BARREL_RELATIVE));

    const offenders = [...closure.bareSpecifiers].filter(
      (specifier) => isNodeBuiltinSpecifier(specifier) || isBunRuntimeSpecifier(specifier),
    );

    expect(offenders).toStrictEqual([]);
  });

  it("LIVE CONTROL: the SAME scanner DOES find Node builtins in packages/core/src/node.ts's own closure — without this an inert detector would pass the assertion above trivially", () => {
    const closure = collectImportClosure(join(paths.repoRoot, "packages", "core", "src", "node.ts"));

    const found = [...closure.bareSpecifiers].filter((specifier) =>
      isNodeBuiltinSpecifier(specifier),
    );

    expect(found.length).toBeGreaterThan(0);
  });

  it("SANITY: the closure walk covers a non-trivial graph — a false pass on an empty or truncated graph is refused", () => {
    const closure = collectImportClosure(repoFile(paths, CORE_BARREL_RELATIVE));

    expect(closure.files.size).toBeGreaterThan(10);
    expect(closure.bareSpecifiers.size).toBeGreaterThan(0);
  });
});

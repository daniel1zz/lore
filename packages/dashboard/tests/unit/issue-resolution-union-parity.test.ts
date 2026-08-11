/**
 * Parity oracle for the dashboard's issue-resolution vocabulary
 * (`spec-the-defect-channel-cannot-be-honestly-maintained-an`, AC-DC-12).
 *
 * ## The defect this exists to make impossible
 *
 * `packages/dashboard/src/lib/api.ts` mirrors the server's `IssueResolution`
 * union by hand (it must — see "Why a mirror" below). Measured on this repo
 * 2026-08-11, BEFORE this file existed: that mirror carried FIVE members
 * (`open | resolving | fixed | rejected | wontfix`) while the server union
 * carried EIGHT — it silently lagged by THREE (`superseded`, `duplicate`,
 * `closed`), and `bun run typecheck` exited **0** anyway (persisted exit code,
 * all seven tsc projects clean). Nothing was mistyped: the `switch` statements
 * in `IssuesList.tsx` / `IssueDetail.tsx` were exhaustive over the *wrong*
 * union, so TypeScript had nothing to complain about.
 *
 * The user-visible consequence, measured by rendering the real component with a
 * `superseded` row: `resolutionBadgeVariant` fell off the end of its switch,
 * returned `undefined` in defiance of its own
 * `NonNullable<BadgeProps["variant"]>` return type, and CVA's
 * `defaultVariants.variant: "default"` absorbed it — so a **superseded** report
 * rendered with byte-identical classes to a **fixed** one
 * (`border-transparent bg-primary text-primary-foreground shadow
 * hover:bg-primary/80`), as did `duplicate` and `closed`. A non-derogatory
 * terminal state was painted as a success.
 *
 * ## What this file asserts, and why membership alone would be vacuous
 *
 * A test that merely checked "the mirror contains `superseded` and `duplicate`"
 * would pass against a RE-FROZEN hand mirror — i.e. against the very defect —
 * and would go green while the 9th member drifted. So the load-bearing
 * assertion here is not membership but COUPLING:
 *
 *   1. {@link DashboardResolutionVocabularyCovers} is a type-level assertion,
 *      instantiated below with the REAL server union, that `bun run typecheck`
 *      evaluates (this file is inside `packages/dashboard/tsconfig.tests.json`,
 *      which the root `typecheck` chain runs as `typecheck:dashboard-tests`).
 *      Add a member to the server union without touching the dashboard and this
 *      file stops compiling, with an error naming
 *      `packages/dashboard/src/lib/api.ts` and the missing member.
 *   2. The `synthetic member` describe block below is the falsification of (1):
 *      it writes a probe that instantiates THE SAME exported assertion with
 *      `CoreIssueResolution | "<synthetic member>"`, spawns the REAL `tsc`
 *      against the REAL project, and requires a failure that names the
 *      dashboard site — with a CONTROL run (no probe) that must be clean.
 *      Because the probe reuses the exported assertion rather than a copy,
 *      weakening the assertion in this file turns the probe green and FAILS
 *      that test. Control-green + mutant-red is what separates "coupled" from
 *      "currently in sync"; either half alone proves nothing.
 *   3. Runtime set-equality between the dashboard's `ISSUE_RESOLUTIONS` and the
 *      server's own exported member list, because `bunx vitest run` does NOT
 *      typecheck — without a runtime condition, (1) would be invisible to this
 *      file's own declared oracle command.
 *   4. Both `resolutionBadgeVariant` implementations return a DEFINED, known
 *      Badge variant for every member (the assertion that would have caught the
 *      original defect at its user-visible surface), never `destructive` for the
 *      two non-derogatory states, and throw loudly rather than returning
 *      `undefined` for an out-of-vocabulary value.
 *   5. Both switches are structurally exhaustive with a `never` check and carry
 *      NO `default:` clause — a `default` is precisely how this class of drift
 *      renders a wrong badge instead of failing.
 *
 * ## Why a mirror at all
 *
 * `packages/dashboard` imports `@lore/core` ONLY (browser-safe boundary,
 * `packages/dashboard/CLAUDE.md`: "`grep -r 'from \"@lore/lore\"' src/` -> 0"),
 * and `IssueResolution` lives in the server-only `packages/lore/src/service/`
 * tree. So the dashboard's *shipped* source cannot import it. Its TEST tree
 * can, and does — that is where the coupling lives.
 *
 * ⛔ The import below MUST use the `@lore/lore/src/...` package specifier, not a
 * relative `../../../lore/src/...` path. Measured 2026-08-11 with both forms:
 * `packages/dashboard/tsconfig.tests.json` sets `rootDir: "."`, so the relative
 * form reports `TS6059: File '.../packages/lore/src/service/issue-resolution.ts'
 * is not under 'rootDir'` and breaks `bun run typecheck` (this is exactly why
 * that config excludes `tests/e2e`, whose helpers use the relative form). The
 * package-specifier form resolves the same file through the workspace
 * `node_modules/@lore/lore` symlink and reports NO TS6059 — verified to resolve
 * the real type, not `any`, by a negative control (an invalid literal produced
 * `TS2322: Type '"not-a-real-resolution"' is not assignable to type
 * 'IssueResolution'`). This adds no dependency to `packages/dashboard/
 * package.json` and leaves the documented `src/` boundary check at 0.
 *
 * ## Six-dimension coverage
 *
 *   HAPPY:      the dashboard vocabulary is set-equal to the server union's
 *               member set, and both mappers return a known Badge variant for
 *               every member.
 *   NEGATIVE:   `superseded`/`duplicate` are NOT rendered in the derogatory
 *               (`destructive`) bucket — §M3's whole point — and no member maps
 *               to `undefined`.
 *   BOUNDARY:   the runtime enumeration's completeness w.r.t. the server TYPE is
 *               itself type-pinned, so a future NON-terminal state (the two
 *               non-terminal members exist only in the type, never in an
 *               exported value) cannot slip past the runtime comparison.
 *   ERROR:      handed an out-of-vocabulary value, each mapper THROWS rather
 *               than returning `undefined` (no silent fallback).
 *   STATE:      the tsc probe fixture is removed after every test in this file
 *               (`afterEach` plus `try/finally`), so a thrown assertion can
 *               never leave a file behind that reddens `bun run typecheck`.
 *   REGRESSION: the synthetic-member differential probe (control clean, mutant
 *               red naming the dashboard site), plus an assertion that the two
 *               duplicated mappers still agree member-for-member.
 *
 * @spec_ref spec-the-defect-channel-cannot-be-honestly-maintained-an AC-DC-12
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TERMINAL_ISSUE_RESOLUTION_LIST,
  type IssueResolution as CoreIssueResolution,
  type TerminalIssueResolution as CoreTerminalIssueResolution,
} from "@lore/lore/src/service/issue-resolution.js";
// ⛔ RELATIVE, not the `@/` alias the component tests use. `bun run test:changed`
// builds its reverse-dependency graph from an alias map derived solely from
// `packages/core/package.json`'s exports (`scripts/changed-tests.ts`:
// `loadCoreAliasMap`, covering `@lore/core` and `@lore/core/node`), so a `@/…`
// specifier resolves to NOTHING there and creates no edge. Measured 2026-08-11:
// with `@/lib/api` this file was selected only by the `changed-test` rule (i.e.
// only when it was itself edited), while `tests/unit/lib/api.test.ts` — which
// imports `../../../src/lib/api` relatively — WAS selected transitively from the
// same change. Relative specifiers make an edit to any of the three dashboard
// sites select this oracle.
import { ISSUE_RESOLUTIONS, type IssueResolution as DashboardIssueResolution } from "../../src/lib/api";
import { resolutionBadgeVariant as listBadgeVariant } from "../../src/components/IssuesList";
import { resolutionBadgeVariant as detailBadgeVariant } from "../../src/components/IssueDetail";

// ─── paths ───────────────────────────────────────────────────────────────────

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
/** `packages/dashboard` — two levels up from `tests/unit/`. */
const DASHBOARD_ROOT = resolve(THIS_DIR, "..", "..");
/** Repo root — two more levels up from `packages/dashboard`. */
const REPO_ROOT = resolve(DASHBOARD_ROOT, "..", "..");
const TSC_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsc");
const TSCONFIG_TESTS_JSON = join(DASHBOARD_ROOT, "tsconfig.tests.json");
/** Generated by `prebuild`, git-ignored — `src/main.tsx` imports it, so the project cannot resolve without it. */
const ROUTE_TREE_GEN = join(DASHBOARD_ROOT, "src", "routeTree.gen.ts");
const API_TS_RELATIVE = "packages/dashboard/src/lib/api.ts";
const ISSUES_LIST_TSX = join(DASHBOARD_ROOT, "src", "components", "IssuesList.tsx");
const ISSUE_DETAIL_TSX = join(DASHBOARD_ROOT, "src", "components", "IssueDetail.tsx");
/**
 * ⛔ NEVER dot-prefixed: TypeScript silently excludes dot-prefixed paths from a
 * wildcard `include` glob, which would make this fixture invisible to `tsc` and
 * turn the mutant run into a false green (the same trap
 * `typecheck-scope.test.ts` documents having fallen into). The `.probe.ts`
 * suffix also keeps it out of vitest's own test-file collection glob.
 */
const PROBE_FILE = join(THIS_DIR, "synthetic-resolution-member.probe.ts");
/** The member the falsification probe injects. Long and unmistakable so an assertion on it cannot match incidental text. */
const SYNTHETIC_MEMBER = "synthetic-thirteenth-resolution-member";

// ─── (1) the compile-time coupling ───────────────────────────────────────────

/**
 * The type-level coupling between the dashboard's resolution vocabulary and the
 * server's `IssueResolution` union. Resolves to `true` when the two vocabularies
 * are EXACTLY equal, and otherwise to an object type whose `ERROR` field names
 * the dashboard file that must be updated — so the compiler's own message points
 * a maintainer at the fix rather than at an anonymous `never`.
 *
 * Generic in `TCore` for one reason only: the falsification probe instantiates
 * THIS SAME assertion with a synthetically extended union
 * (`CoreIssueResolution | "<synthetic>"`). A non-generic assertion could only be
 * falsified by a copy of itself, which would prove nothing about this one.
 *
 * ⛔ Exported and load-bearing. Weakening it (e.g. dropping either `Exclude`
 * arm) makes the probe compile clean, which FAILS the synthetic-member test
 * below — the two are deliberately welded together.
 */
export type DashboardResolutionVocabularyCovers<TCore extends string> = [
  Exclude<TCore, DashboardIssueResolution>,
] extends [never]
  ? [Exclude<DashboardIssueResolution, TCore>] extends [never]
    ? true
    : {
        ERROR: "packages/dashboard/src/lib/api.ts ISSUE_RESOLUTIONS declares a resolution the server's IssueResolution union does not have — remove it there, or add it to packages/lore/src/service/issue-resolution.ts";
        extra_in_dashboard: Exclude<DashboardIssueResolution, TCore>;
      }
  : {
      ERROR: "packages/dashboard/src/lib/api.ts ISSUE_RESOLUTIONS is MISSING a member of the server's IssueResolution union — add it there, and add a case to resolutionBadgeVariant in packages/dashboard/src/components/IssuesList.tsx and packages/dashboard/src/components/IssueDetail.tsx";
      missing_from_dashboard: Exclude<TCore, DashboardIssueResolution>;
    };

/**
 * THE assertion. Instantiated with the real server union, evaluated by
 * `bun run typecheck` (`typecheck:dashboard-tests`). A 9th member added to
 * `packages/lore/src/service/issue-resolution.ts` stops this line compiling.
 */
const DASHBOARD_VOCABULARY_IS_TIED_TO_THE_SERVER_UNION: DashboardResolutionVocabularyCovers<CoreIssueResolution> =
  true;

/**
 * The two NON-terminal members of the server union. They exist only in that
 * union's TYPE (`"open" | "resolving" | TerminalIssueResolution`) — the server
 * exports an enumerable list of the TERMINAL members only — so a runtime
 * comparison has to name them here. {@link CORE_NON_TERMINAL_LIST_IS_COMPLETE}
 * type-pins that this hand-list plus the exported terminal list is the WHOLE
 * union, so this cannot become a third silent mirror.
 */
const CORE_NON_TERMINAL_RESOLUTIONS = ["open", "resolving"] as const;

/**
 * BOUNDARY: pins the completeness of the runtime enumeration itself. If the
 * server gains a third NON-terminal state, `CORE_NON_TERMINAL_RESOLUTIONS`
 * would silently under-count the union and the runtime set comparison below
 * would compare the wrong thing — this assertion fails to compile instead.
 */
const CORE_NON_TERMINAL_LIST_IS_COMPLETE: [
  Exclude<CoreIssueResolution, CoreTerminalIssueResolution | (typeof CORE_NON_TERMINAL_RESOLUTIONS)[number]>,
] extends [never]
  ? true
  : {
      ERROR: "the server's IssueResolution union gained a NON-terminal member — add it to CORE_NON_TERMINAL_RESOLUTIONS in this file so the runtime parity comparison stays complete";
      unaccounted: Exclude<
        CoreIssueResolution,
        CoreTerminalIssueResolution | (typeof CORE_NON_TERMINAL_RESOLUTIONS)[number]
      >;
    } = true;

/** The server union's full member set, assembled at RUNTIME from its own exported list plus the type-pinned non-terminal names. */
const CORE_VOCABULARY: readonly string[] = [...CORE_NON_TERMINAL_RESOLUTIONS, ...TERMINAL_ISSUE_RESOLUTION_LIST];

/** Every Badge variant that exists (`src/components/ui/badge.tsx`'s cva table). A mapper returning anything else is a bug even if it is defined. */
const KNOWN_BADGE_VARIANTS = ["default", "secondary", "destructive", "outline"] as const;

/** The two NON-derogatory terminal states (§M3). Rendering these in the same bucket as `rejected`/`wontfix` is the defect §M3 exists to fix. */
const NON_DEROGATORY_TERMINAL_RESOLUTIONS = ["superseded", "duplicate"] as const;

const MAPPERS = [
  { site: "packages/dashboard/src/components/IssuesList.tsx", fn: listBadgeVariant, source: ISSUES_LIST_TSX },
  { site: "packages/dashboard/src/components/IssueDetail.tsx", fn: detailBadgeVariant, source: ISSUE_DETAIL_TSX },
] as const;

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Flags shared by the control and mutant runs, so the ONLY difference between
 * them is the presence of the probe file.
 *
 * ⛔ `--noErrorTruncation` is load-bearing, not cosmetic. Measured 2026-08-11:
 * without it tsc elides long type text in a diagnostic, and the mutant's TS2322
 * printed `…missing_from_dashboard: "synthet...'` — the injected member's name
 * was cut off, so the assertion that the failure NAMES the drifted member could
 * not be evaluated at all. The flag changes only the compiler's output
 * verbosity; the assertions stay exactly as strict. (Note the real
 * `bun run typecheck` does not pass it, so a maintainer sees the actionable
 * `ERROR:` text in full and the member name truncated — which is the right way
 * round for a human, and why the `ERROR` field is declared first.)
 */
const SHARED_TSC_FLAGS = ["--noEmit", "--noErrorTruncation"] as const;

/** Spawns `tsc` and returns its exit status + combined output — never throws on a nonzero exit (that IS the signal under test). */
function runTsc(args: readonly string[]): { status: number; output: string } {
  try {
    const output = execFileSync(TSC_BIN, [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { status: 0, output };
  } catch (error) {
    const spawnError = error as { status?: number; stdout?: string; stderr?: string };
    return { status: spawnError.status ?? 1, output: `${spawnError.stdout ?? ""}${spawnError.stderr ?? ""}` };
  }
}

/**
 * `src/main.tsx` imports the git-ignored `routeTree.gen.ts`, so
 * `tsconfig.tests.json` cannot resolve without it and BOTH the control and the
 * mutant run would report an unrelated TS2307. `bun run typecheck` generates it
 * via `prebuild`; a bare `bunx vitest run <this file>` does not, so generate it
 * here when absent (idempotent, git-ignored, and NOT the thing under test — it
 * is a resolution prerequisite). ⛔ Fails loud if generation does not produce
 * it: a missing prerequisite must never be absorbed into "some tsc error".
 */
function ensureRouteTreeGenerated(): void {
  if (existsSync(ROUTE_TREE_GEN)) return;
  execFileSync("bunx", ["@tanstack/router-cli", "generate"], {
    cwd: DASHBOARD_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (!existsSync(ROUTE_TREE_GEN)) {
    throw new Error(
      `routeTree.gen.ts is still absent after 'bunx @tanstack/router-cli generate' — ${TSCONFIG_TESTS_JSON} cannot resolve, so no tsc verdict from it is meaningful`,
    );
  }
}

/** Fail-loud narrowing — never `!`, which trusts silently instead of naming the broken invariant. */
function definedOrThrow<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

/**
 * Extracts one `resolutionBadgeVariant` function body from a component source by
 * BRACE MATCHING from its signature, so the structural assertions below read
 * only that function and cannot be satisfied (or tripped) by an unrelated
 * `switch`/`default:` elsewhere in the file.
 */
function extractBadgeVariantBody(sourcePath: string): string {
  const source = readFileSync(sourcePath, "utf8");
  const signatureIndex = source.indexOf("function resolutionBadgeVariant(");
  if (signatureIndex === -1) {
    throw new Error(`no 'function resolutionBadgeVariant(' declaration found in ${sourcePath}`);
  }
  const openBrace = source.indexOf("{", signatureIndex);
  if (openBrace === -1) throw new Error(`no function body brace found after resolutionBadgeVariant in ${sourcePath}`);
  let depth = 0;
  for (let i = openBrace; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace, i + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting resolutionBadgeVariant from ${sourcePath}`);
}

function caseLabelsIn(body: string): string[] {
  return [...body.matchAll(/case\s+"([a-z-]+)"\s*:/g)].map((match) =>
    definedOrThrow(match[1], "a matched case label must carry a capture group"),
  );
}

/** Parses tsc's compact diagnostic lines into `{file, text}` pairs, so an assertion can say WHERE an error was, not merely that output contained a substring. */
function parseDiagnostics(output: string): { file: string; text: string }[] {
  return output
    .split("\n")
    .map((line) => line.match(/^(\S+?)\((\d+),(\d+)\): (error .*)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      file: definedOrThrow(match[1], "a matched diagnostic line must carry a file capture"),
      text: definedOrThrow(match[4], "a matched diagnostic line must carry a message capture"),
    }));
}

function removeProbeFixture(): void {
  if (existsSync(PROBE_FILE)) rmSync(PROBE_FILE, { force: true });
}

// STATE: the probe fixture is removed after EVERY test in this file, not only
// the one that writes it — a thrown assertion must never leave a file inside the
// real tests/ tree that reddens `bun run typecheck` for everyone afterwards.
afterEach(() => {
  removeProbeFixture();
});

// ─── (3) runtime vocabulary parity ───────────────────────────────────────────

describe("dashboard resolution vocabulary <-> server IssueResolution union (AC-DC-12)", () => {
  it("HAPPY: ISSUE_RESOLUTIONS is set-equal to the server union's member set", () => {
    // The type-level assertions are evaluated by `bun run typecheck`, not by
    // vitest; reading them here at least proves they were instantiated (and
    // keeps a reader from mistaking them for dead code).
    expect(DASHBOARD_VOCABULARY_IS_TIED_TO_THE_SERVER_UNION).toBe(true);
    expect(CORE_NON_TERMINAL_LIST_IS_COMPLETE).toBe(true);

    // Widened to `string[]` deliberately: comparing a narrow literal array
    // against `string` members is a TS2345, and the whole point is to compare
    // the two vocabularies as DATA rather than to let one side's type silence
    // the other.
    const dashboard: string[] = [...ISSUE_RESOLUTIONS].sort();
    const server: string[] = [...CORE_VOCABULARY].sort();

    // Named-difference assertions first: a bare toEqual on sorted arrays reports
    // "expected [...] to equal [...]" and leaves the reader to diff eight
    // strings by eye. These say WHICH member drifted and WHERE to fix it.
    const missingFromDashboard = server.filter((member) => !dashboard.includes(member));
    const extraInDashboard = dashboard.filter((member) => !server.includes(member));
    expect(
      missingFromDashboard,
      `${API_TS_RELATIVE}'s ISSUE_RESOLUTIONS is missing server resolution state(s): ${missingFromDashboard.join(", ")}`,
    ).toEqual([]);
    expect(
      extraInDashboard,
      `${API_TS_RELATIVE}'s ISSUE_RESOLUTIONS declares state(s) the server union does not have: ${extraInDashboard.join(", ")}`,
    ).toEqual([]);
    expect(dashboard).toEqual(server);

    // Guards the comparison itself: an empty-vs-empty comparison would satisfy
    // every assertion above. The server union has at least the two non-terminal
    // states plus the terminal list.
    expect(server.length).toBeGreaterThanOrEqual(CORE_NON_TERMINAL_RESOLUTIONS.length + 1);
    expect(new Set(dashboard).size).toBe(dashboard.length);
  });

  // ─── (4) both switches actually render every member ────────────────────────

  it.each(MAPPERS.map((mapper) => [mapper.site, mapper.fn] as const))(
    "HAPPY: %s's resolutionBadgeVariant returns a known Badge variant for every member",
    (site, fn) => {
      for (const resolution of CORE_VOCABULARY) {
        const variant = fn(resolution as DashboardIssueResolution);
        expect(variant, `${site} returned ${String(variant)} for resolution "${resolution}"`).toBeDefined();
        expect(KNOWN_BADGE_VARIANTS, `${site} returned an unknown Badge variant for "${resolution}"`).toContain(
          variant,
        );
      }
    },
  );

  it("NEGATIVE: the two non-derogatory terminal states are not rendered in the derogatory bucket, nor as the 'fixed' bucket", () => {
    for (const { site, fn } of MAPPERS) {
      const fixedVariant = fn("fixed");
      for (const resolution of NON_DEROGATORY_TERMINAL_RESOLUTIONS) {
        const variant = fn(resolution as DashboardIssueResolution);
        // ⛔ Load-bearing precondition, not decoration: without it `undefined`
        // satisfies BOTH `not.toBe` assertions below, so this test passed
        // against the very defect it exists to catch (measured on the red run,
        // 2026-08-11 — `fn("superseded")` returned `undefined` and this case
        // went green).
        expect(
          KNOWN_BADGE_VARIANTS,
          `${site} returned ${String(variant)} for "${resolution}" — an undefined/unknown variant would satisfy the inequality assertions below without rendering anything meaningful`,
        ).toContain(variant);
        expect(
          variant,
          `${site} renders the NON-derogatory "${resolution}" as "destructive" — the same bucket as rejected/wontfix, which is the "silent trash can indistinguishable from rejected" failure §M3 exists to fix`,
        ).not.toBe("destructive");
        expect(
          variant,
          `${site} renders "${resolution}" identically to "fixed" — the exact pre-2026-08-11 defect (undefined variant absorbed by CVA defaultVariants)`,
        ).not.toBe(fixedVariant);
      }
    }
  });

  it("REGRESSION: the two duplicated mappers agree member-for-member", () => {
    for (const resolution of CORE_VOCABULARY) {
      const cast = resolution as DashboardIssueResolution;
      const fromList = listBadgeVariant(cast);
      // ⛔ Same trap as the NEGATIVE case: two mappers that BOTH return
      // `undefined` "agree", so this test passed pre-fix. Pin the shared value
      // to a real variant before comparing.
      expect(
        KNOWN_BADGE_VARIANTS,
        `both mappers returned ${String(fromList)} for "${resolution}" — agreement on a non-variant is not agreement`,
      ).toContain(fromList);
      expect(detailBadgeVariant(cast), `the two resolutionBadgeVariant copies disagree on "${resolution}"`).toBe(
        fromList,
      );
    }
  });

  it("ERROR: handed an out-of-vocabulary value each mapper throws loudly rather than returning undefined", () => {
    const bogus = "definitely-not-a-resolution" as unknown as DashboardIssueResolution;
    for (const { site, fn } of MAPPERS) {
      expect(() => fn(bogus), `${site} silently absorbed an unknown resolution instead of failing loud`).toThrow(
        /definitely-not-a-resolution/,
      );
    }
  });

  // ─── (5) structural exhaustiveness of both switches ────────────────────────

  it.each(MAPPERS.map((mapper) => [mapper.site, mapper.source] as const))(
    "HAPPY: %s's switch is never-checked, has no default clause, and its case labels are exactly the vocabulary",
    (site, sourcePath) => {
      const body = extractBadgeVariantBody(sourcePath);
      expect(body.length, `extracted an empty resolutionBadgeVariant body from ${site}`).toBeGreaterThan(0);

      const labels = caseLabelsIn(body);
      expect([...labels].sort(), `${site}'s case labels are not exactly the resolution vocabulary`).toEqual(
        [...CORE_VOCABULARY].sort(),
      );

      expect(
        /:\s*never\s*=\s*resolution\b/.test(body),
        `${site}'s resolutionBadgeVariant has no 'never' exhaustiveness check — a member added to the union would fall through silently instead of failing to compile`,
      ).toBe(true);

      expect(
        /\bdefault\s*:/.test(body),
        `${site}'s resolutionBadgeVariant has a 'default:' clause — a default absorbs an unknown state instead of failing to compile, which is how this drift rendered a wrong badge in the first place`,
      ).toBe(false);
    },
  );

  // ─── (2) the falsification: a synthetic extra member must break compilation ─

  describe("synthetic member falsification — the assertion is coupling, not a frozen membership list", () => {
    it(
      "REGRESSION: a synthetic extra server member makes the REAL tsc project fail with an error naming the dashboard site, while the same project without the probe is clean",
      () => {
        ensureRouteTreeGenerated();

        // CONTROL first: without the probe the project must be clean. Without
        // this, a mutant "red" would be indistinguishable from a tree that was
        // already red for unrelated reasons.
        removeProbeFixture();
        const control = runTsc([...SHARED_TSC_FLAGS, "-p", TSCONFIG_TESTS_JSON]);
        expect(
          control.status,
          `control run of ${TSCONFIG_TESTS_JSON} is not clean, so no mutant verdict from it is meaningful:\n${control.output}`,
        ).toBe(0);
        expect(parseDiagnostics(control.output)).toEqual([]);

        // MUTANT: instantiate THE SAME exported assertion with the server union
        // plus one synthetic member. Note it imports the assertion rather than
        // restating it — that is what makes weakening the assertion fail this
        // test instead of quietly passing it.
        try {
          mkdirSync(dirname(PROBE_FILE), { recursive: true });
          writeFileSync(
            PROBE_FILE,
            [
              "/**",
              " * TRANSIENT fixture written and deleted by",
              " * `issue-resolution-union-parity.test.ts` (AC-DC-12). If you are reading",
              " * this in a committed tree, a test run was killed mid-flight — delete it.",
              " */",
              'import type { IssueResolution as CoreIssueResolution } from "@lore/lore/src/service/issue-resolution.js";',
              'import type { DashboardResolutionVocabularyCovers } from "./issue-resolution-union-parity.test.js";',
              "",
              `type ServerUnionWithSyntheticMember = CoreIssueResolution | "${SYNTHETIC_MEMBER}";`,
              "",
              "export const syntheticMemberMustBreakTheDashboard: DashboardResolutionVocabularyCovers<ServerUnionWithSyntheticMember> =",
              "  true;",
              "",
            ].join("\n"),
            "utf8",
          );

          const mutant = runTsc([...SHARED_TSC_FLAGS, "-p", TSCONFIG_TESTS_JSON]);
          expect(
            mutant.status,
            "a synthetic server resolution member did NOT break compilation — the dashboard vocabulary is NOT type-tied to the server union, it merely happens to match it today",
          ).not.toBe(0);

          const diagnostics = parseDiagnostics(mutant.output);
          expect(diagnostics.length).toBeGreaterThan(0);

          // Every error must come from the probe file — otherwise the mutant run
          // went red for a reason unrelated to the injected member.
          const foreign = diagnostics.filter((diagnostic) => !diagnostic.file.includes("synthetic-resolution-member"));
          expect(
            foreign,
            `the mutant run reported errors outside the probe file, so its red is not attributable to the synthetic member:\n${foreign.map((d) => `${d.file}: ${d.text}`).join("\n")}`,
          ).toEqual([]);

          const probeErrors = diagnostics.map((diagnostic) => diagnostic.text).join("\n");
          // The failure must NAME the dashboard site to update and the member
          // that drifted — "some error, somewhere" is not an actionable oracle.
          expect(probeErrors).toContain(API_TS_RELATIVE);
          expect(probeErrors).toContain(SYNTHETIC_MEMBER);
          expect(probeErrors).toContain("IssuesList.tsx");
          expect(probeErrors).toContain("IssueDetail.tsx");
          // And the failing file itself is under the dashboard, so the compiler
          // points a maintainer into this package.
          expect(diagnostics.every((diagnostic) => diagnostic.file.includes("packages/dashboard/"))).toBe(true);
        } finally {
          removeProbeFixture();
        }
      },
      // Explicit budget (spec-a-test-case-s-timeout-budget-must-be-declared-when-its):
      // this body spawns tsc twice over the whole dashboard program plus, on a
      // fresh checkout, the router codegen once. One tsc run measured 3.73s wall
      // on this machine (`/usr/bin/time -p`, 2026-08-11); 180s leaves ~24x
      // headroom over the two-run cost for a loaded machine running several
      // worktree suites, without masking a genuinely hung compiler.
      180_000,
    );
  });
});

// @spawns-external tsc type-checks a throwaway fixture project
// @spawns-external bunx generates the dashboard route tree (`@tanstack/router-cli generate`)
// @reads packages/dashboard/src/components/IssueDetail.tsx
// @reads packages/dashboard/src/components/IssuesList.tsx
// @reads packages/dashboard/src/routeTree.gen.ts
/**
 * Parity oracle for the dashboard's issue-resolution vocabulary
 * (`spec-the-defect-channel-cannot-be-honestly-maintained-an`, AC-DC-12).
 *
 * ## The defect this exists to make impossible
 *
 * `packages/dashboard/src/lib/api.ts` used to mirror the server's
 * `IssueResolution` union BY HAND. Measured on this repo 2026-08-11, before this
 * file existed: that mirror carried FIVE members
 * (`open | resolving | fixed | rejected | wontfix`) while the server union
 * carried EIGHT — it silently lagged by THREE (`superseded`, `duplicate`,
 * `closed`), and `bun run typecheck` exited **0** anyway (persisted exit code,
 * all seven tsc projects clean). Nothing was mistyped: the `switch` statements in
 * `IssuesList.tsx` / `IssueDetail.tsx` were exhaustive over the *wrong* union, so
 * TypeScript had nothing to complain about.
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
 * ## What changed on 2026-08-12: the coupling became STRUCTURAL
 *
 * The mirror existed because the union lived in the server-only
 * `packages/lore/src/service/` tree while `packages/dashboard/src/**` may import
 * `@lore/core` ONLY — so the SHIPPED bundle had nowhere browser-safe to import it
 * from. `task-relocate-the-issueresolution-vocabulary-into-lore-core-so` moved the
 * vocabulary into `@lore/core` (`issue-resolution-vocab.ts`, pure types + consts).
 * Consequences for this oracle:
 *
 *   - `api.ts` now RE-EXPORTS `@lore/core`'s array and union
 *     (`ISSUE_RESOLUTIONS` is reference-identical to `ISSUE_RESOLUTION_MEMBERS`),
 *     so there is no second list to drift. Asserted below by `toBe` identity, not
 *     by set comparison — a hand copy with today's contents would satisfy
 *     equality while being exactly the defect.
 *   - Both `resolutionBadgeVariant` switches are `never`-checked over the REAL
 *     union, so a member added to the vocabulary now fails to compile INSIDE
 *     `packages/dashboard/src/**` itself. Previously the only thing that failed
 *     was a type-level assertion living in THIS test file.
 *
 * The falsification below moved with it, and is strictly stronger than the one it
 * replaces. It no longer instantiates an assertion exported from this test with a
 * widened union; it OVERLAYS a widened `@lore/core` onto the REAL `src` project
 * through a `paths` mapping and requires `tsc` to fail INSIDE the two component
 * files. Measured 2026-08-12, that mutant produces exactly:
 *
 *   packages/dashboard/src/components/IssueDetail.tsx(90,9): error TS2322: Type
 *     '"synthetic-thirteenth-resolution-member"' is not assignable to type 'never'.
 *   packages/dashboard/src/components/IssuesList.tsx(85,9): error TS2322: Type
 *     '"synthetic-thirteenth-resolution-member"' is not assignable to type 'never'.
 *
 * ⛔ What the probe does and does not model: it widens the union the components
 * consume WITHOUT adding a `case`, which is precisely the drift shape under test
 * (vocabulary grows, badge switch does not). It deliberately does NOT prove that
 * `@lore/core` itself compiles — that is `typecheck:core`'s job — and its whole
 * red must be attributable to the injected member, which is why TWO controls run:
 * the untouched project must be clean, AND the same overlay with an UNWIDENED
 * union must be clean (isolating the red to the widening rather than to the
 * overlay machinery).
 *
 * ## Six-dimension coverage
 *
 *   HAPPY:      the dashboard vocabulary IS the core member array (reference
 *               identity, not equality), and both mappers return a known Badge
 *               variant for every member.
 *   NEGATIVE:   `superseded`/`duplicate` are NOT rendered in the derogatory
 *               (`destructive`) bucket — §M3's whole point — and no member maps
 *               to `undefined`.
 *   BOUNDARY:   the vocabulary is enumerated from ONE source, so there is no
 *               longer a hand-listed non-terminal half for a future third
 *               non-terminal state to slip past (that hand list, and the
 *               type-pin guarding it, were deleted with the relocation).
 *   ERROR:      handed an out-of-vocabulary value, each mapper THROWS rather
 *               than returning `undefined` (no silent fallback).
 *   STATE:      the tsc overlay fixture is removed after every test in this file
 *               (`afterEach` plus `try/finally`), so a thrown assertion can never
 *               leave files behind.
 *   REGRESSION: the synthetic-member differential probe (two controls clean,
 *               mutant red INSIDE both shipped switch files), the type-level
 *               identity pin on `api.ts`'s re-export, and an assertion that the
 *               two duplicated mappers still agree member-for-member.
 *
 * @spec_ref spec-the-defect-channel-cannot-be-honestly-maintained-an AC-DC-12
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ⛔ The vocabulary's OWNER, imported directly. `bun run test:changed` builds its
// reverse-dependency graph from an alias map derived from
// `packages/core/package.json`'s exports (`scripts/changed-tests.ts`:
// `loadCoreAliasMap`, covering `@lore/core` and `@lore/core/node`), so this
// specifier DOES create an edge — an edit to `packages/core/src/
// issue-resolution-vocab.ts` selects this oracle.
import { ISSUE_RESOLUTION_MEMBERS, type IssueResolution as CoreIssueResolution } from "@lore/core";
// ⛔ RELATIVE, not the `@/` alias the component tests use: a `@/…` specifier
// resolves to NOTHING in that same alias map and creates no edge. Measured
// 2026-08-11: with `@/lib/api` this file was selected only by the `changed-test`
// rule (i.e. only when it was itself edited), while `tests/unit/lib/api.test.ts`
// — which imports `../../../src/lib/api` relatively — WAS selected transitively
// from the same change. Relative specifiers make an edit to any of the three
// dashboard sites select this oracle.
import { ISSUE_RESOLUTIONS, type IssueResolution as DashboardIssueResolution } from "../../src/lib/api";
import { resolutionBadgeVariant as listBadgeVariant } from "../../src/components/IssuesList";
import { resolutionBadgeVariant as detailBadgeVariant } from "../../src/components/IssueDetail";

// ─── paths ───────────────────────────────────────────────────────────────────

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
/** `packages/dashboard` — two levels up from `tests/unit/`. */
const DASHBOARD_ROOT = resolve(THIS_DIR, "..", "..");
/** Repo root — two more levels up from `packages/dashboard`. */
const REPO_ROOT = resolve(DASHBOARD_ROOT, "..", "..");
const CORE_VOCAB_MODULE = join(REPO_ROOT, "packages", "core", "src", "issue-resolution-vocab.js");
const CORE_INDEX_MODULE = join(REPO_ROOT, "packages", "core", "src", "index.js");
const TSC_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsc");
/** The REAL shipped-source project — the one `bun run typecheck:dashboard` runs. */
const TSCONFIG_SRC_JSON = join(DASHBOARD_ROOT, "tsconfig.json");
/** Generated by `prebuild`, git-ignored — `src/main.tsx` imports it, so the project cannot resolve without it. */
const ROUTE_TREE_GEN = join(DASHBOARD_ROOT, "src", "routeTree.gen.ts");

const API_TS_RELATIVE = "packages/dashboard/src/lib/api.ts";
const ISSUES_LIST_RELATIVE = "packages/dashboard/src/components/IssuesList.tsx";
const ISSUE_DETAIL_RELATIVE = "packages/dashboard/src/components/IssueDetail.tsx";
const ISSUES_LIST_TSX = join(DASHBOARD_ROOT, "src", "components", "IssuesList.tsx");
const ISSUE_DETAIL_TSX = join(DASHBOARD_ROOT, "src", "components", "IssueDetail.tsx");

/**
 * Transient overlay fixture directory.
 *
 * ⛔ DOT-PREFIXED ON PURPOSE, which is the exact INVERSE of the rule the previous
 * probe in this file had to follow. TypeScript silently excludes dot-prefixed
 * paths from wildcard `include` globs — that made the old in-tree fixture
 * invisible to `tsc` and would have turned its mutant run into a false green.
 * This overlay must be the opposite: reachable ONLY through the explicit `paths`
 * mapping in the probe tsconfig, and part of NO real program — otherwise a
 * widened `@lore/core` alias would leak into `typecheck:dashboard-tests` (which
 * includes `tests/**` wholesale) and redden a run nobody asked to mutate.
 * Explicit `paths` entries resolve dot-prefixed files fine; wildcard includes do
 * not see them. Both halves of that asymmetry are load-bearing here.
 */
/**
 * ⛔ The overlay lives in an OS temp dir (`mkdtemp`), NEVER under the repo tree
 * (plan INV-3: tests do not write into the repo). An in-tree `.vocab-probe/`
 * appeared and vanished mid-run and made `grep -r packages/` in
 * `phase-write-lifecycle-doc-parity.test.ts` exit 2 (R0-9). Because the overlay
 * is outside the repo, every path in it is ABSOLUTE and `typeRoots` is pinned
 * (the extended config's `"types": ["node"]` would otherwise resolve from the
 * temp dir, which has no `node_modules`).
 */
/** The `@types` dir that holds `@types/node`, resolved the way tsc itself would from the dashboard package (walks up through hoisted/worktree layouts). */
const NODE_TYPES_ROOT = dirname(dirname(createRequire(join(DASHBOARD_ROOT, "package.json")).resolve("@types/node/package.json")));
const PROBE_PREFIX = "lore-vocab-probe-";
let probeDir: string | undefined;
function probeTsconfigPath(): string {
  return join(definedOrThrow(probeDir, "probe overlay not written yet"), "tsconfig.json");
}
/** The member the falsification probe injects. Long and unmistakable so an assertion on it cannot match incidental text. */
const SYNTHETIC_MEMBER = "synthetic-thirteenth-resolution-member";

// ─── (1) the compile-time identity pin on api.ts's re-export ─────────────────

/**
 * `api.ts`'s `IssueResolution` must BE `@lore/core`'s union, not a union that
 * currently agrees with it. Evaluated by `bun run typecheck`
 * (`typecheck:dashboard-tests`, which includes this file).
 *
 * ⛔ Not vacuous despite the re-export: replacing that re-export with a
 * hand-written union — the pre-2026-08-12 arrangement, and the single most likely
 * regression — makes exactly one of the two `Exclude` arms non-`never`, and this
 * line stops compiling with an `ERROR` field naming the file to fix. The
 * STRUCTURAL guarantee (a member added to the vocabulary breaks the shipped
 * switches) is proven separately, and much more strongly, by the overlay probe at
 * the bottom of this file.
 */
const DASHBOARD_UNION_IS_THE_CORE_UNION: [Exclude<CoreIssueResolution, DashboardIssueResolution>] extends [never]
  ? [Exclude<DashboardIssueResolution, CoreIssueResolution>] extends [never]
    ? true
    : {
        ERROR: "packages/dashboard/src/lib/api.ts declares a resolution @lore/core's IssueResolution union does not have — it must RE-EXPORT that union, never restate it";
        extra_in_dashboard: Exclude<DashboardIssueResolution, CoreIssueResolution>;
      }
  : {
      ERROR: "packages/dashboard/src/lib/api.ts's IssueResolution is MISSING a member of @lore/core's IssueResolution union — it must RE-EXPORT that union (export type { IssueResolution }), never restate it";
      missing_from_dashboard: Exclude<CoreIssueResolution, DashboardIssueResolution>;
    } = true;

/** Every Badge variant that exists (`src/components/ui/badge.tsx`'s cva table). A mapper returning anything else is a bug even if it is defined. */
const KNOWN_BADGE_VARIANTS = ["default", "secondary", "destructive", "outline"] as const;

/** The two NON-derogatory terminal states (§M3). Rendering these in the same bucket as `rejected`/`wontfix` is the defect §M3 exists to fix. */
const NON_DEROGATORY_TERMINAL_RESOLUTIONS = ["superseded", "duplicate"] as const;

const MAPPERS = [
  { site: ISSUES_LIST_RELATIVE, fn: listBadgeVariant, source: ISSUES_LIST_TSX },
  { site: ISSUE_DETAIL_RELATIVE, fn: detailBadgeVariant, source: ISSUE_DETAIL_TSX },
] as const;

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Flags shared by every tsc run, so the ONLY difference between control and
 * mutant is the overlaid union.
 *
 * ⛔ `--noErrorTruncation` is load-bearing, not cosmetic. Measured 2026-08-11:
 * without it tsc elides long type text in a diagnostic and the injected member's
 * name was cut off, so the assertion that the failure NAMES the drifted member
 * could not be evaluated at all. The flag changes only the compiler's output
 * verbosity; the assertions stay exactly as strict.
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
 * `src/main.tsx` imports the git-ignored `routeTree.gen.ts`, so the src project
 * cannot resolve without it and EVERY run below would report an unrelated
 * TS2307. `bun run typecheck` generates it via `prebuild`; a bare
 * `bunx vitest run <this file>` does not, so generate it here when absent
 * (idempotent, git-ignored, and NOT the thing under test — it is a resolution
 * prerequisite). ⛔ Fails loud if generation does not produce it: a missing
 * prerequisite must never be absorbed into "some tsc error".
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
      `routeTree.gen.ts is still absent after 'bunx @tanstack/router-cli generate' — the ${TSCONFIG_SRC_JSON} program cannot resolve, so no tsc verdict from it is meaningful`,
    );
  }
}

/**
 * Writes the overlay: a `@lore/core` stand-in that re-exports the real barrel and
 * (when `widen` is true) replaces ONLY `IssueResolution` with the real union plus
 * one synthetic member, plus a tsconfig that is the REAL src project with
 * `@lore/core` remapped to that stand-in.
 *
 * The stand-in's own local `export type IssueResolution` takes precedence over
 * the `export *` re-export (explicit exports shadow star exports), which is what
 * makes a one-member mutation possible without copying the barrel.
 *
 * ⛔ `paths` is REPLACED, not merged, by `extends` — `@/*` must be restated here
 * or every `@/…` import in `src/**` fails to resolve and the run reddens for a
 * reason that has nothing to do with the mutation.
 *
 * @param widen - `true` for the mutant, `false` for the machinery control
 */
function writeProbeOverlay(widen: boolean): void {
  removeProbeOverlay();
  const dir = mkdtempSync(join(tmpdir(), PROBE_PREFIX));
  probeDir = dir;
  const widenedUnion = widen ? `RealIssueResolution | "${SYNTHETIC_MEMBER}"` : "RealIssueResolution";
  writeFileSync(
    join(dir, "core-vocab.probe.ts"),
    [
      "/**",
      " * TRANSIENT fixture written and deleted by",
      " * `issue-resolution-union-parity.test.ts` (AC-DC-12), in an OS temp dir.",
      " */",
      `import type { IssueResolution as RealIssueResolution } from ${JSON.stringify(CORE_VOCAB_MODULE)};`,
      `export * from ${JSON.stringify(CORE_INDEX_MODULE)};`,
      `export type IssueResolution = ${widenedUnion};`,
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(dir, "tsconfig.json"),
    `${JSON.stringify(
      {
        extends: TSCONFIG_SRC_JSON,
        compilerOptions: {
          baseUrl: DASHBOARD_ROOT,
          typeRoots: [NODE_TYPES_ROOT],
          paths: { "@/*": ["./src/*"], "@lore/core": [join(dir, "core-vocab.probe.ts")] },
        },
        include: [join(DASHBOARD_ROOT, "src", "**", "*")],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function removeProbeOverlay(): void {
  if (probeDir === undefined) return;
  rmSync(probeDir, { recursive: true, force: true });
  probeDir = undefined;
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

// STATE: the overlay is removed after EVERY test in this file, not only the one
// that writes it — a thrown assertion must never leave files inside the package
// that a later reader mistakes for real source.
afterEach(() => {
  removeProbeOverlay();
});

// ─── (2) the vocabulary is ONE object, not two that agree ────────────────────

describe("dashboard resolution vocabulary <-> @lore/core IssueResolution union (AC-DC-12)", () => {
  it("HAPPY: ISSUE_RESOLUTIONS IS @lore/core's member array (reference identity, not a copy)", () => {
    // The type-level pin is evaluated by `bun run typecheck`, not by vitest;
    // reading it here proves it was instantiated (and keeps a reader from
    // mistaking it for dead code).
    expect(DASHBOARD_UNION_IS_THE_CORE_UNION).toBe(true);

    // ⛔ `toBe`, not `toEqual`: a hand-maintained array with today's contents
    // would satisfy deep equality while being precisely the second declaration
    // this AC forbids. Reference identity can only hold for a re-export.
    expect(
      ISSUE_RESOLUTIONS,
      `${API_TS_RELATIVE} must RE-EXPORT @lore/core's ISSUE_RESOLUTION_MEMBERS, not construct its own list`,
    ).toBe(ISSUE_RESOLUTION_MEMBERS);

    // Guards the comparison itself: an empty vocabulary would satisfy every
    // assertion above. Eight members today (2 non-terminal + 6 terminal); pinned
    // as a floor rather than an exact count so adding a state is not a
    // false-positive here — the exhaustive assertions live in the switch checks.
    expect(ISSUE_RESOLUTION_MEMBERS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(ISSUE_RESOLUTION_MEMBERS).size).toBe(ISSUE_RESOLUTION_MEMBERS.length);
  });

  // ─── (3) both switches actually render every member ────────────────────────

  it.each(MAPPERS.map((mapper) => [mapper.site, mapper.fn] as const))(
    "HAPPY: %s's resolutionBadgeVariant returns a known Badge variant for every member",
    (site, fn) => {
      for (const resolution of ISSUE_RESOLUTION_MEMBERS) {
        const variant = fn(resolution);
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
        const variant = fn(resolution);
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
    for (const resolution of ISSUE_RESOLUTION_MEMBERS) {
      const fromList = listBadgeVariant(resolution);
      // ⛔ Same trap as the NEGATIVE case: two mappers that BOTH return
      // `undefined` "agree", so this test passed pre-fix. Pin the shared value
      // to a real variant before comparing.
      expect(
        KNOWN_BADGE_VARIANTS,
        `both mappers returned ${String(fromList)} for "${resolution}" — agreement on a non-variant is not agreement`,
      ).toContain(fromList);
      expect(detailBadgeVariant(resolution), `the two resolutionBadgeVariant copies disagree on "${resolution}"`).toBe(
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

  // ─── (4) structural exhaustiveness of both switches ────────────────────────

  it.each(MAPPERS.map((mapper) => [mapper.site, mapper.source] as const))(
    "HAPPY: %s's switch is never-checked, has no default clause, and its case labels are exactly the vocabulary",
    (site, sourcePath) => {
      const body = extractBadgeVariantBody(sourcePath);
      expect(body.length, `extracted an empty resolutionBadgeVariant body from ${site}`).toBeGreaterThan(0);

      const labels = caseLabelsIn(body);
      expect([...labels].sort(), `${site}'s case labels are not exactly the resolution vocabulary`).toEqual(
        [...ISSUE_RESOLUTION_MEMBERS].sort(),
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

  // ─── (5) the falsification: a synthetic vocabulary member must break the
  //         SHIPPED components' compilation ──────────────────────────────────

  describe("synthetic member falsification — the switches are welded to the vocabulary, not merely in sync with it", () => {
    it(
      "REGRESSION: a synthetic @lore/core vocabulary member makes tsc fail INSIDE both shipped switch files, while the untouched project and an unwidened overlay are both clean",
      () => {
        ensureRouteTreeGenerated();

        // CONTROL A — the REAL project, no overlay: the shipped tree must be
        // clean, or no mutant verdict from it is meaningful.
        removeProbeOverlay();
        const realProject = runTsc([...SHARED_TSC_FLAGS, "-p", TSCONFIG_SRC_JSON]);
        expect(
          realProject.status,
          `the untouched ${TSCONFIG_SRC_JSON} project is not clean, so no mutant verdict is meaningful:\n${realProject.output}`,
        ).toBe(0);
        expect(parseDiagnostics(realProject.output)).toEqual([]);

        try {
          // CONTROL B — the overlay machinery with an UNWIDENED union. This is
          // what isolates the mutant's red to the injected member rather than to
          // the `paths` remap, the `export *` shadowing, or the tsconfig
          // synthesis. Without it, a broken overlay would look like a pass.
          writeProbeOverlay(false);
          const unwidened = runTsc([...SHARED_TSC_FLAGS, "-p", probeTsconfigPath()]);
          expect(
            unwidened.status,
            `the overlay with an UNWIDENED union is not clean, so the mutant's red cannot be attributed to the synthetic member:\n${unwidened.output}`,
          ).toBe(0);
          expect(parseDiagnostics(unwidened.output)).toEqual([]);

          // MUTANT — the same overlay, one extra union member, no new `case`.
          writeProbeOverlay(true);
          const mutant = runTsc([...SHARED_TSC_FLAGS, "-p", probeTsconfigPath()]);
          expect(
            mutant.status,
            "a synthetic resolution member did NOT break compilation — the dashboard switches are NOT welded to the @lore/core vocabulary, they merely happen to match it today",
          ).not.toBe(0);

          const diagnostics = parseDiagnostics(mutant.output);
          expect(diagnostics.length).toBeGreaterThan(0);

          // The failure must land IN the shipped switch files — that is the
          // upgrade over a test-tree assertion, and "some error, somewhere" is
          // not an actionable oracle.
          const failingFiles = diagnostics.map((diagnostic) => diagnostic.file);
          for (const site of [ISSUES_LIST_RELATIVE, ISSUE_DETAIL_RELATIVE]) {
            expect(
              failingFiles.some((file) => file.includes(site)),
              `the mutant run reported no error in ${site}, so that switch is not exhaustive over the real vocabulary:\n${mutant.output}`,
            ).toBe(true);
          }

          // Every diagnostic must be attributable to the injected member, and
          // every one must come from the dashboard's own shipped tree.
          const unattributable = diagnostics.filter((diagnostic) => !diagnostic.text.includes(SYNTHETIC_MEMBER));
          expect(
            unattributable,
            `the mutant run reported errors that do not mention the injected member, so its red is not attributable to it:\n${unattributable
              .map((d) => `${d.file}: ${d.text}`)
              .join("\n")}`,
          ).toEqual([]);
          expect(diagnostics.every((diagnostic) => diagnostic.file.includes("packages/dashboard/src/"))).toBe(true);
        } finally {
          removeProbeOverlay();
        }
      },
      // Explicit budget (spec-a-test-case-s-timeout-budget-must-be-declared-when-its):
      // this body spawns tsc THREE times over the dashboard src program plus, on a
      // fresh checkout, the router codegen once. One run measured 2.75s wall on
      // this machine (`/usr/bin/time -p`, 2026-08-12); 180s leaves ~21x headroom
      // over the three-run cost for a loaded machine running several worktree
      // suites, without masking a genuinely hung compiler.
      180_000,
    );
  });
});

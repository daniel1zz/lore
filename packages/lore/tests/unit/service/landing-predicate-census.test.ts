// @reads packages/lore/src/**
// @reads packages/core/src/**
/**
 * Census: ONE landing predicate (spec-lore-done-closes-a-commitless-task-through-an-audited-no).
 *
 * `landingOf` (packages/core/src/landing.ts) is the only place that decides whether claimed work has landed and of what kind.
 * Every closer (integrate's record and post-landing archive, `lore done`, plan close) and reader (evidence counting, milestone
 * review, `lore get`) goes through it or reads what it stored. This test scans the shipped source for every other way of
 * computing a landing, and fails when a new one appears, so the next one cannot slip in unseen:
 *
 *   1. who calls `landingOf(`;
 *   2. who produces a landing `kind` (a `"no-change"` / `"commits"` literal), as opposed to reading one;
 *   3. who asks git whether a recorded landing commit is on main (`landing_commit` beside a reachability call);
 *   4. who still carries the retired second computation (`startHead === landing.branch_head`, `"commits" as const`).
 *
 * Each allowlist entry names WHY the file may hold the construct, so widening it is a reviewed decision. A listed file that no
 * longer holds the construct fails too (a stale allowlist hides nothing).
 *
 * Coverage: HAPPY (the census matches), NEGATIVE (a planted second computation is found), BOUNDARY (a reader is not a producer),
 * STATE (the closers and readers are wired to the predicate), REGRESSION (the retired computations stay gone).
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const SOURCE_ROOTS = [join(REPO, "packages/lore/src"), join(REPO, "packages/core/src")];

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name) && !/\.(test|bun\.test)\.tsx?$/.test(name)) found.push(path);
  }
  return found;
}

const FILES = SOURCE_ROOTS.flatMap(sourceFiles).map((path) => ({ rel: relative(REPO, path), text: readFileSync(path, "utf8") }));

/** Files whose non-comment code matches `pattern`, as repo-relative paths (comment lines are ignored). */
function filesMatching(pattern: RegExp): string[] {
  return FILES.filter(({ text }) => codeLines(text).some((line) => pattern.test(line))).map(({ rel }) => rel).sort();
}

function codeLines(text: string): string[] {
  return text.split("\n").filter((line) => !/^\s*(\/\/|\/?\*)/.test(line));
}

const CALLS_LANDING_OF = /\blandingOf\(/;
/** A landing kind PRODUCED: a literal in a value position (`kind: "..."`, a ternary arm), not a comparison. */
const PRODUCES_KIND = /(kind:\s*\(?\s*["'](?:no-change|commits)["'])|(\?\s*\(?\s*["'](?:no-change|commits)["'])|(:\s*\(?\s*["'](?:no-change|commits)["']\s+as\s+const)/;
/** The set of kinds declared as a type or schema (a definition, not a computation). */
const DECLARES_KINDS = /["']no-change["']\s*,\s*["']commits["']|["']no-change["']\s*\|\s*["']commits["']/;
const COMPARES_KIND = /kind\s*[!=]==\s*["'](?:no-change|commits)["']/;
const REACHABILITY_OF_LANDING_COMMIT = /landing_commit[^\n]*(countCommits|is-ancestor|rev-list|merge-base|isOnIntegration|isAncestor)|(countCommits|is-ancestor|rev-list|merge-base|isOnIntegration|isAncestor)[^\n]*landing_commit/;

describe("the landing predicate census", () => {
  it("HAPPY: only the service that closes tasks calls landingOf (besides its definition)", () => {
    expect(filesMatching(CALLS_LANDING_OF)).toEqual([
      "packages/core/src/landing.ts", // the definition and its own doc example
      "packages/lore/src/service/task-workflow-service.ts", // measureLanding (done, evidence counting, BR-1337) and recordLanding (integrate)
    ]);
  });

  it("HAPPY: the landing kind is produced only by the predicate and the one-time back-fill", () => {
    const producers = filesMatching(PRODUCES_KIND);
    expect(producers).toEqual([
      "packages/core/src/landing.ts", // landingOf returns the kind
      // reason: the one-time back-fill (migration 039) stamps legacy landings once; it runs before any reader and never again
      "packages/lore/src/store/migrations/landing-backfill.ts",
    ]);
  });

  it("BOUNDARY: a reader that compares or declares a kind is not a producer", () => {
    const readers = filesMatching(COMPARES_KIND);
    expect(readers).toEqual([
      "packages/lore/src/adapters/cli/commands/get.ts", // prints `Landing: no-change` / `Landing: commits <tip>`
      "packages/lore/src/service/milestone-review.ts", // `if (landing.kind === "no-change") continue;`
      "packages/lore/src/service/task-commit-range.ts", // a no-change landing adds no commit range
      "packages/lore/src/service/task-workflow-service.ts", // a no-change landing needs no commit-range write at done
    ]);
    for (const file of readers) expect(filesMatching(PRODUCES_KIND)).not.toContain(file);
    expect(filesMatching(DECLARES_KINDS)).toEqual([
      "packages/core/src/landing.ts", // type LandingKind and measuredLandingSchema
      "packages/lore/src/service/task-commit-range.ts", // taskLandingSchema (the stored record's own shape)
    ]);
  });

  it("NEGATIVE: no source file asks git whether a recorded landing commit is on main (the verdict is landingOf's)", () => {
    expect(filesMatching(REACHABILITY_OF_LANDING_COMMIT)).toEqual([]);
  });

  it("REGRESSION: the retired second computations stay gone", () => {
    expect(filesMatching(/startHead\s*===\s*landing\.branch_head/)).toEqual([]);
    expect(filesMatching(/["']commits["']\s+as\s+const/)).toEqual([]);
    expect(filesMatching(/["']no-change["']\s+as\s+const/)).toEqual([]);
    // BR-1337 once re-derived "landed" from `landing_commit` through a probe count; it asks the predicate now
    const service = FILES.find((file) => file.rel.endsWith("service/task-workflow-service.ts"))?.text ?? "";
    const body = service.slice(service.indexOf("private async isLandingOnMain"), service.indexOf("private landingExtraFor"));
    expect(body).toContain("this.measureLanding(task)");
    expect(body).not.toMatch(/countCommits|isAncestor|integrationBranch/);
  });

  it("STATE: every closer and reader is wired to the predicate or to what it stored", () => {
    const text = (suffix: string): string => FILES.find((file) => file.rel.endsWith(suffix))?.text ?? "";
    const workflow = text("service/task-workflow-service.ts");
    // integrate's record: the kind, start and tip come from landingOf over the branch's facts
    const record = workflow.slice(workflow.indexOf("async recordLanding("));
    expect(record).toMatch(/landingOf\(\s*\{ start_head: startHead, branches: \[landing\.branch\]/);
    // lore done and evidence counting: one measurement feeds the floor, the counting rule and the landing write
    expect(workflow).toMatch(/const verdict: LandingVerdict = landingOf\(/);
    expect(workflow).toContain("countsAsLandedPass(");
    // milestone review: the literal skip the spec names
    expect(text("service/milestone-review.ts")).toContain('if (landing.kind === "no-change") continue;');
    // lore get: reads the stored measured landing, never recomputes it
    expect(text("adapters/cli/commands/get.ts")).toContain("readMeasuredLanding(doc.extra)");
    // the tool protocol and the post-landing archive reach the same done: no landing logic of their own
    expect(text("adapters/mcp/tools.ts")).toContain("taskWorkflowService.done(args.id_or_slug");
    expect(text("adapters/mcp/tools.ts")).not.toMatch(CALLS_LANDING_OF);
    expect(text("service/integrate-service.ts")).not.toMatch(CALLS_LANDING_OF);
  });

  it("NEGATIVE: the scanner finds a planted second computation (a census that matches nothing would pass vacuously)", () => {
    const planted = 'const verdict = { kind: "commits" as const };\nconst x = probe.countCommits(cwd, `${main}..${landing.landing_commit}`);';
    const lines = codeLines(planted);
    expect(lines.some((line) => PRODUCES_KIND.test(line))).toBe(true);
    expect(lines.some((line) => REACHABILITY_OF_LANDING_COMMIT.test(line))).toBe(true);
    expect(lines.some((line) => CALLS_LANDING_OF.test(line))).toBe(false);
  });
});

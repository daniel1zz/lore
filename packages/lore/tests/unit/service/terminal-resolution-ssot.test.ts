/**
 * AC-DC-9 (spec-the-defect-channel-cannot-be-honestly-maintained-an §M1) — the
 * terminal-issue-resolution MEMBER SET has exactly ONE construction site
 * repo-wide, and the `TERMINAL_ISSUE_RESOLUTIONS` export in
 * `packages/lore/src/service/issue-resolution.ts` DERIVES from it, consumed by
 * the `lore issues` listing filter. ⛔ It used to ALSO be consumed by
 * `IssueReportService`'s open-report rate-cap narrowing; that consumer was
 * deleted outright by spec-the-defect-channel-reaches-no-machine-but-its-
 * own-github P1 (see the in-flight correction comment further down in this
 * file, immediately before the "make-it-red control" case, for the measured
 * detail).
 *
 * ⛔ WHERE that one site lives changed on 2026-08-12 and this file's pinned path
 * moved with it (`task-relocate-the-issueresolution-vocabulary-into-lore-core-so`):
 * the member array now lives in `packages/core/src/issue-resolution-vocab.ts`.
 * Read the change honestly — it is a RELOCATION, not a relaxation:
 *   - the scan universe is unchanged (`packages/**`, tests included),
 *   - the asserted CARDINALITY is unchanged (exactly one file, exactly one site),
 *   - the member tokens are still DERIVED from the production export,
 *   - and the file gained a STRICTLY NEW assertion (`derives the member set`
 *     below) pinning that the service's `TERMINAL_ISSUE_RESOLUTIONS`/
 *     `TERMINAL_ISSUE_RESOLUTION_LIST` exports are reference-identical VIEWS of
 *     that one site rather than a second listing of it.
 * The relocation is what ELIMINATED the second construction site this oracle
 * caught on the merged tree: `packages/dashboard/src/lib/api.ts` had to hand-list
 * the members because `packages/dashboard/src/**` may import `@lore/core` ONLY
 * and the vocabulary lived in the server-only `packages/lore/src` tree. Moving
 * the vocabulary to `@lore/core` gave the dashboard something browser-safe to
 * import, so the copy is gone rather than tolerated.
 *
 * ⛔ Why a REPO-WIDE SCAN rather than an enumerated file list: the failure this
 * oracle must be able to observe is "a FOURTH copy of the member set appears in
 * a file nobody named". An enumerated list is structurally incapable of seeing
 * that (it can only re-check the files it already knows), which is why the spec
 * explicitly declares the enumerated form NOT the oracle.
 *
 * Scan universe: every `.ts`/`.tsx` file under `packages/**`, minus
 * `node_modules`/`dist`/generated `*.gen.ts`. Tests are INCLUDED — a member-set
 * copy in a test file is just as much a second definition site.
 *
 * What counts as a "construction site": a SET or ARRAY literal (`[...]`,
 * including the one inside `new Set([...])`) in which every hand-settable
 * terminal-resolution token co-occurs as a quoted string. Deliberately NOT
 * object literals: the reach/pointer table in `issue-resolution.ts` is a
 * `Record<TerminalIssueResolution, …>` whose KEYS are type-derived from the one
 * array literal below it, so it cannot drift from the member set without a
 * COMPILE error — a type-level guarantee is stronger than this scan, and
 * counting it would make the declared "exactly one" arithmetic unsatisfiable.
 * Comments are stripped before scanning: a doc comment mentioning the four
 * states is prose, not a construction (asserted by a control below).
 *
 * The member tokens are DERIVED from the production export
 * (`EXPLICIT_TERMINAL_RESOLUTIONS`), never written here as a remembered literal
 * — so (a) this file cannot self-match the scan it runs, and (b) adding a fifth
 * hand-settable state automatically widens what the scan looks for.
 *
 * Six-dimension coverage:
 *   HAPPY:      exactly one construction site, in the expected file, and the
 *               service's exported views are reference-identical to it
 *   NEGATIVE:   `commands/issues.ts` declares NO local terminal set and imports
 *               the shared export (independent second condition — the scan
 *               alone cannot see a leftover copy of the OLD 4-member set, whose
 *               tokens do not include superseded/duplicate)
 *   BOUNDARY:   the set has exactly the 6 expected members, and
 *               `EXPLICIT_TERMINAL_RESOLUTIONS` is its 4-member hand-settable
 *               subset (asserted member-by-member, never as one literal list)
 *   ERROR:      the scanner FIRES on a synthetic fourth copy (assembled at
 *               runtime, so this file still contains no such literal) — the
 *               "make it red" control, without which a scanner that matches
 *               nothing would pass vacuously
 *   STATE:      `computeIssueResolution` returns the two new explicit states
 *               from `extra.issue_report.resolution.state`
 *   REGRESSION: a comment mentioning every token is NOT a construction site,
 *               and neither is a `switch`/`case` block
 *
 * Source: spec-the-defect-channel-cannot-be-honestly-maintained-an §M1
 *   ("Declared uniqueness check"), AC-DC-9;
 *   task-one-terminal-resolution-ssot-two-non-derogatory-states-and.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
// The ONE site's own export, imported (never re-listed) so the derivation
// assertions below compare REFERENCES rather than remembered contents.
import { TERMINAL_ISSUE_RESOLUTION_MEMBERS } from "@lore/core";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
/** packages/lore/tests/unit/service -> repo root (5 levels up). */
const REPO_ROOT = resolve(TEST_DIR, "..", "..", "..", "..", "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/**
 * The ONE construction site of the member set — `@lore/core`'s vocabulary module
 * (browser-safe, so the dashboard's shipped tree imports it instead of mirroring
 * it). See this file's header on why the pin moved here.
 */
const VOCABULARY_REL = join("packages", "core", "src", "issue-resolution-vocab.ts");
const ISSUE_RESOLUTION_REL = join("packages", "lore", "src", "service", "issue-resolution.ts");
const ISSUES_COMMAND_REL = join("packages", "lore", "src", "adapters", "cli", "commands", "issues.ts");

/**
 * Fails loud if the 5-levels-up arithmetic above is wrong — an EMPTY scan
 * universe is the same shape as a clean one, so the universe's own root is
 * asserted rather than assumed (root CLAUDE.md, seventh false-oracle vector).
 */
function assertRepoRoot(): void {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as { name?: string };
  expect(pkg.name).toBe("lore-workspace");
}

// ─── Production surface under test (dynamically imported so a MISSING export
//     fails as an ASSERTION, never as an unhandled module-resolution error) ───

interface TerminalResolutionSurface {
  TERMINAL_ISSUE_RESOLUTIONS: ReadonlySet<string>;
  TERMINAL_ISSUE_RESOLUTION_LIST: readonly string[];
  EXPLICIT_TERMINAL_RESOLUTIONS: ReadonlySet<string>;
  computeIssueResolution: (
    issue: { extra?: unknown; status?: string },
    edges: ReadonlyArray<{ from_id: string }>,
    sources: ReadonlyArray<{ id: string; status: string }>,
    hasRecordedReviewRejection?: boolean,
  ) => string;
}

async function loadTerminalResolutionSurface(): Promise<TerminalResolutionSurface> {
  const mod = (await import("../../../src/service/issue-resolution.js")) as Record<string, unknown>;
  expect(mod["TERMINAL_ISSUE_RESOLUTIONS"], "issue-resolution.ts must export TERMINAL_ISSUE_RESOLUTIONS").toBeInstanceOf(
    Set,
  );
  expect(
    mod["EXPLICIT_TERMINAL_RESOLUTIONS"],
    "issue-resolution.ts must export EXPLICIT_TERMINAL_RESOLUTIONS (the hand-settable subset)",
  ).toBeInstanceOf(Set);
  expect(
    Array.isArray(mod["TERMINAL_ISSUE_RESOLUTION_LIST"]),
    "issue-resolution.ts must export TERMINAL_ISSUE_RESOLUTION_LIST (the ordered, typed view of the one member array)",
  ).toBe(true);
  expect(typeof mod["computeIssueResolution"]).toBe("function");
  return mod as unknown as TerminalResolutionSurface;
}

// ─── The scanner ──────────────────────────────────────────────────────────────

/** Every `.ts`/`.tsx` file under `dir`, skipping `node_modules`/`dist`/generated files. */
function collectSourceFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      collectSourceFiles(full, into);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".gen.ts")) continue;
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) into.push(full);
  }
  return into;
}

/**
 * Removes `//` and block comments, string-aware (a `//` inside a string literal
 * is not a comment). Replaces removed bytes with spaces so every surviving
 * character keeps its original offset.
 */
function stripComments(source: string): string {
  const out = source.split("");
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];
    if (quote !== null) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        out[index] = " ";
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] !== "\n") out[index] = " ";
        index += 1;
      }
      if (index < source.length) {
        out[index] = " ";
        out[index + 1] = " ";
        index += 2;
      }
      continue;
    }
    index += 1;
  }
  return out.join("");
}

interface LiteralSpan {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** Every balanced `[...]` span (string-aware), which is what a set/array literal is. */
function collectArrayLiteralSpans(source: string): LiteralSpan[] {
  const spans: LiteralSpan[] = [];
  const open: number[] = [];
  let index = 0;
  let quote: string | null = null;
  while (index < source.length) {
    const char = source[index] as string;
    if (quote !== null) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "[") open.push(index);
    else if (char === "]") {
      const start = open.pop();
      if (start !== undefined) {
        spans.push({ start, end: index, text: source.slice(start, index + 1) });
      }
    }
    index += 1;
  }
  return spans;
}

/** Does `text` carry `token` as a quoted string literal (any quote style)? */
function hasQuotedToken(text: string, token: string): boolean {
  return text.includes(`"${token}"`) || text.includes(`'${token}'`) || text.includes(`\`${token}\``);
}

/**
 * Innermost set/array literal spans in which EVERY member token co-occurs — one
 * entry per construction site. A span is dropped when a strictly-nested span
 * also matches (the inner one is the real site).
 */
function findMemberSetConstructionSites(source: string, memberTokens: readonly string[]): LiteralSpan[] {
  const spans = collectArrayLiteralSpans(stripComments(source));
  const matching = spans.filter((span) => memberTokens.every((token) => hasQuotedToken(span.text, token)));
  return matching.filter(
    (span) =>
      !matching.some(
        (other) => other !== span && other.start >= span.start && other.end <= span.end && other.text !== span.text,
      ),
  );
}

describe("AC-DC-9: one terminal-resolution definition site, consumed by the listing filter", () => {
  it("AC-DC-9: the terminal-resolution set is exported from issue-resolution.ts with exactly its 6 members", async () => {
    const surface = await loadTerminalResolutionSurface();

    // Asserted member-by-member ON PURPOSE: one array literal naming all four
    // hand-settable tokens here would make THIS file a second construction site
    // of the very set the scan below counts.
    expect(surface.TERMINAL_ISSUE_RESOLUTIONS.has("fixed")).toBe(true);
    expect(surface.TERMINAL_ISSUE_RESOLUTIONS.has("closed")).toBe(true);
    expect(surface.TERMINAL_ISSUE_RESOLUTIONS.has("rejected")).toBe(true);
    expect(surface.TERMINAL_ISSUE_RESOLUTIONS.has("wontfix")).toBe(true);
    expect(surface.TERMINAL_ISSUE_RESOLUTIONS.has("superseded")).toBe(true);
    expect(surface.TERMINAL_ISSUE_RESOLUTIONS.has("duplicate")).toBe(true);
    expect(surface.TERMINAL_ISSUE_RESOLUTIONS.size).toBe(6);

    // The hand-settable subset: the two COMPUTED-only states must NOT be in it
    // (there is no `lore issue resolve --state fixed`, by design).
    expect(surface.EXPLICIT_TERMINAL_RESOLUTIONS.has("rejected")).toBe(true);
    expect(surface.EXPLICIT_TERMINAL_RESOLUTIONS.has("wontfix")).toBe(true);
    expect(surface.EXPLICIT_TERMINAL_RESOLUTIONS.has("superseded")).toBe(true);
    expect(surface.EXPLICIT_TERMINAL_RESOLUTIONS.has("duplicate")).toBe(true);
    expect(surface.EXPLICIT_TERMINAL_RESOLUTIONS.has("fixed")).toBe(false);
    expect(surface.EXPLICIT_TERMINAL_RESOLUTIONS.has("closed")).toBe(false);
    expect(surface.EXPLICIT_TERMINAL_RESOLUTIONS.size).toBe(4);
  });

  it("AC-DC-9: exactly ONE member-set construction site exists under packages/**, and it is the @lore/core vocabulary module", async () => {
    assertRepoRoot();
    const surface = await loadTerminalResolutionSurface();
    const memberTokens = [...surface.EXPLICIT_TERMINAL_RESOLUTIONS];
    expect(memberTokens.length).toBe(4);

    const files = collectSourceFiles(PACKAGES_DIR);
    // Positive trace of execution — an empty universe would otherwise pass.
    expect(files.length).toBeGreaterThan(100);

    const sitesByFile = new Map<string, number>();
    for (const file of files) {
      const sites = findMemberSetConstructionSites(readFileSync(file, "utf8"), memberTokens);
      if (sites.length > 0) sitesByFile.set(relative(REPO_ROOT, file).split(sep).join(sep), sites.length);
    }

    expect(
      [...sitesByFile.entries()].map(([file, count]) => `${file} (${count})`),
      "exactly one file may construct the terminal-resolution member set",
    ).toEqual([`${VOCABULARY_REL} (1)`]);
  });

  it("AC-DC-9: the service's exported views DERIVE from that one site rather than re-listing it", async () => {
    assertRepoRoot();
    const surface = await loadTerminalResolutionSurface();

    // Reference identity, not deep equality: a hand-maintained copy with the
    // same contents would satisfy a `toEqual` while being exactly the second
    // declaration this AC forbids. `===` can only hold for the one array.
    expect(
      surface.TERMINAL_ISSUE_RESOLUTION_LIST,
      `${ISSUE_RESOLUTION_REL}'s TERMINAL_ISSUE_RESOLUTION_LIST must be @lore/core's TERMINAL_ISSUE_RESOLUTION_MEMBERS itself, not a copy of its contents`,
    ).toBe(TERMINAL_ISSUE_RESOLUTION_MEMBERS);

    // And the membership Set is built from that same array — every member of the
    // one site is in it, and it holds nothing else.
    for (const member of TERMINAL_ISSUE_RESOLUTION_MEMBERS) {
      expect(
        surface.TERMINAL_ISSUE_RESOLUTIONS.has(member),
        `${ISSUE_RESOLUTION_REL}'s TERMINAL_ISSUE_RESOLUTIONS is missing "${member}", which the one construction site declares`,
      ).toBe(true);
    }
    expect(surface.TERMINAL_ISSUE_RESOLUTIONS.size).toBe(TERMINAL_ISSUE_RESOLUTION_MEMBERS.length);

    // The service module reaches the vocabulary by IMPORT, so the two facts above
    // cannot be satisfied by a local re-declaration that happens to be re-exported.
    const source = readFileSync(join(REPO_ROOT, ISSUE_RESOLUTION_REL), "utf8");
    expect(source).toMatch(/import[\s\S]{0,400}TERMINAL_ISSUE_RESOLUTION_MEMBERS[\s\S]{0,400}from "@lore\/core"/);
  });

  it("AC-DC-9: commands/issues.ts imports the shared export and declares no local terminal set", async () => {
    assertRepoRoot();
    const source = readFileSync(join(REPO_ROOT, ISSUES_COMMAND_REL), "utf8");

    expect(source).toContain("TERMINAL_ISSUE_RESOLUTIONS");
    expect(source).toMatch(/from "\.\.\/\.\.\/\.\.\/service\/issue-resolution\.js"/);
    // The pre-M1 private copy, by its own name and by its construction shape.
    expect(source).not.toMatch(/TERMINAL_RESOLUTIONS\s*:/);
    expect(source).not.toMatch(/new Set<IssueResolution>/);
  });

  // ⛔ RETIRED IN-FLIGHT (spec-the-defect-channel-reaches-no-machine-but-its-
  // own-github P1, cap-removal task): this case used to assert that
  // issue-report-service.ts imports `TERMINAL_ISSUE_RESOLUTIONS` and consults
  // it (`.has(`) to narrow a per-reporter open-report rate cap. That cap
  // enforcement — and the `getResolution` read loop that fed it — is deleted
  // outright; the file no longer imports this SSOT export or calls `.has(` on
  // it at all. Re-running the exact original assertion —
  // `bunx vitest run packages/lore/tests/unit/service/terminal-resolution-ssot.test.ts
  // -t "issue-report-service.ts imports the shared export"` — now fails on
  // `expect(source).toMatch(/import[\s\S]{0,200}TERMINAL_ISSUE_RESOLUTIONS.../)`
  // (measured, confirmed red before this edit). This is a correction, not a
  // weakening: the OTHER cases in this describe block (one construction site;
  // the service's exported views deriving from it; `commands/issues.ts`
  // importing the shared export) still hold and are untouched — only the
  // illustration naming a now-nonexistent consumer is removed. AC-DC-9's own
  // invariant (exactly one member-set construction site repo-wide) is
  // unaffected by a consumer being deleted.

  it("AC-DC-9: the scanner FIRES on a synthetic fourth copy (make-it-red control)", async () => {
    const surface = await loadTerminalResolutionSurface();
    const memberTokens = [...surface.EXPLICIT_TERMINAL_RESOLUTIONS];

    // Assembled at RUNTIME from the production export, so this file itself never
    // contains a member-set literal — the control cannot poison the scan above.
    const arrayCopy = `const LOCAL_COPY = [${memberTokens.map((t) => JSON.stringify(t)).join(", ")}];`;
    const setCopy = `const LOCAL_SET = new Set([${memberTokens.map((t) => JSON.stringify(t)).join(", ")}]);`;

    expect(findMemberSetConstructionSites(arrayCopy, memberTokens).length).toBe(1);
    expect(findMemberSetConstructionSites(setCopy, memberTokens).length).toBe(1);
    // A 3-of-4 subset is NOT a member-set construction — the scan must not
    // over-match every partially-overlapping list in the repo.
    const partial = `const PARTIAL = [${memberTokens
      .slice(0, 3)
      .map((t) => JSON.stringify(t))
      .join(", ")}];`;
    expect(findMemberSetConstructionSites(partial, memberTokens).length).toBe(0);
  });

  it("AC-DC-9: prose and switch/case blocks are NOT construction sites (regression control)", async () => {
    const surface = await loadTerminalResolutionSurface();
    const memberTokens = [...surface.EXPLICIT_TERMINAL_RESOLUTIONS];
    const quoted = memberTokens.map((t) => JSON.stringify(t));

    const inComment = `/** every state: ${quoted.join(", ")} — mentioned in an array-looking [${quoted.join(", ")}] */\nconst x = 1;`;
    expect(findMemberSetConstructionSites(inComment, memberTokens).length).toBe(0);

    const inSwitch = `function badge(r: string) { switch (r) { ${quoted
      .map((q) => `case ${q}:`)
      .join(" ")} return "destructive"; } }`;
    expect(findMemberSetConstructionSites(inSwitch, memberTokens).length).toBe(0);
  });

  it("AC-DC-9: computeIssueResolution returns the two new explicit states from extra (state dimension)", async () => {
    const surface = await loadTerminalResolutionSurface();

    expect(
      surface.computeIssueResolution(
        { extra: { issue_report: { resolution: { state: "superseded", superseded_by: "01FIXSPEC" } } } },
        [],
        [],
      ),
    ).toBe("superseded");
    expect(
      surface.computeIssueResolution(
        { extra: { issue_report: { resolution: { state: "duplicate", duplicate_of: "01OTHERREPORT" } } } },
        [],
        [],
      ),
    ).toBe("duplicate");
    // Precedence rule 1 still holds: an explicit state outranks a terminal
    // resolves-edge source.
    expect(
      surface.computeIssueResolution(
        { extra: { issue_report: { resolution: { state: "superseded" } } } },
        [{ from_id: "spec-1" }],
        [{ id: "spec-1", status: "archived" }],
      ),
    ).toBe("superseded");
    // An unknown state is still no signal at all (defensive read, unchanged).
    expect(surface.computeIssueResolution({ extra: { issue_report: { resolution: { state: "nonsense" } } } }, [], [])).toBe(
      "open",
    );
  });
});

/**
 * Tests for `scripts/check-gap-namespace.ts` (AC-GD-3,
 * `spec-governance-defaults-must-ship-and-every-recorded-gap-must` D4/D4a/D4b/
 * D4c/D4d/D5/D6): the gap-namespace checker and its unowned-gap report.
 *
 * Three groups, by IO shape:
 *
 *   1. Pure fixture-content suites (`findFencedRegions` / `findBareTokenViolations` /
 *      `parseGapCommentFields` / `extractGapEntries` / `computeUnownedGapIds` /
 *      `checkGap19Scope` / `evaluateLedger`) — in-memory content strings, no
 *      subprocess, no corpus.
 *   2. An end-to-end SSOT fixture (`mkdtemp` + `lore init`, NEVER this repo's own
 *      `.lore/`) proving BOTH directions of AC-GD-3(d), each owning both ends of
 *      its own comparison rather than borrowing one from this repo's tree:
 *      direction 1 — an injected corpus doc with a bare token, mirror absent (a
 *      fresh throwaway corpus has no `docs/requirements/` at all), makes
 *      `main()` exit exactly 3; direction 2 — a clean corpus doc PLUS a mirror
 *      file the test itself writes under the same fixture root, deliberately
 *      stale (pre-rename `G1`, control-asserted right after writing), still
 *      makes `main()` exit 0 — corpus-keyed, never mirror-keyed.
 *   3. The real-repo-tree arming assertion (`describe("check-gap-namespace: real
 *      repo tree (task oracle) ...")`) — this repo's production wiring (this
 *      repo's established convention for a dev-repo-only static checker: armed
 *      by `bun run test` via a real-tree `main()` call, never `hooks/pre-push`
 *      — see the script's own module header and
 *      `task-three-of-five-static-checkers-are-inert-no-exported-main`) AND
 *      AC-GD-3(g)/(h) (exits 0 against the LIVE renamed ledger, GAP-19's scope
 *      line is correct). Whether this repo's OWN exported mirror happens to be
 *      stale or fresh at any given moment is irrelevant here and is no longer
 *      checked by this assertion — that comparison is owned entirely by the
 *      direction-2 fixture above, which cannot be reddened by repairing this
 *      repo's mirror.
 *
 * Six-dimension coverage:
 *   HAPPY:      GAP-<n> tokens never flagged; a well-formed entry parses with
 *               its four fields; a clean multi-entry document evaluates ok;
 *               the real live ledger evaluates ok via the real-tree test
 *   NEGATIVE:   a bare G<n> token anywhere (heading, prose cross-reference,
 *               table cell) is flagged and named; an entry missing
 *               owning_spec is rejected; an out-of-enum status is rejected;
 *               a GAP-19 scope line naming PENDING/mirror branch/a9f801dd is
 *               rejected
 *   BOUNDARY:   the SAME token inside vs. one line outside the legacy-alias
 *               fence; a qualified PRD-001 G<n> vs. a bare G<n> on the SAME
 *               line; a SECOND legacy-alias fence later in the document is
 *               NOT exempted; multiple bare tokens on one line all reported;
 *               GAP-5-shaped prose (cited, no heading/comment) contributes no
 *               entry and no violation
 *   ERROR:      a malformed metadata comment (status token with no `=`)
 *               degrades to the same "out-of-enum" violation, never a throw;
 *               empty content evaluates ok with zero entries; a `lore`
 *               subprocess failure (nonexistent slug) throws LedgerReadError
 *   STATE:      evaluateLedger composes bare-token + structured + GAP-19
 *               violations from ONE document into one non-ok result;
 *               computeUnownedGapIds distinguishes GAP-1-shaped (half-closed,
 *               carried) from GAP-11-shaped (half-closed, uncarried) entries
 *               that only a fourth field can tell apart
 *   REGRESSION: the real live ledger's unowned-gap set is asserted by SET
 *               EQUALITY against the spec's pinned membership, not just a
 *               count; a constructed clean-corpus-plus-stale-mirror fixture
 *               (both ends owned by the test) proves the checker stays
 *               exit-0 regardless of mirror state
 *
 * @spec_ref spec-governance-defaults-must-ship-and-every-recorded-gap-must (D4, D4a, D4b, D4c, D4d, D5, D6, AC-GD-3)
 * @spec_ref task-build-the-gap-namespace-checker-and-the-unowned-gap-report
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findFencedRegions,
  findLegacyAliasFenceRegion,
  findBareTokenViolations,
  parseGapCommentFields,
  extractGapEntries,
  computeUnownedGapIds,
  checkGap19Scope,
  evaluateLedger,
  readLedgerFromCorpus,
  main,
  LedgerReadError,
  LEDGER_SLUG,
  type GapEntry,
} from "../check-gap-namespace.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:gap-namespace-checker";

// ─── Pure: fence detection ───────────────────────────────────────────────────

describe("findFencedRegions / findLegacyAliasFenceRegion", () => {
  it("HAPPY: a single fenced region is found by open/close line index", () => {
    const lines = "before\n```legacy-gap-aliases\nG1 -> GAP-1\n```\nafter".split("\n");
    expect(findFencedRegions(lines, "legacy-gap-aliases")).toEqual([[1, 3]]);
  });

  it("BOUNDARY: a SECOND fenced region of the same language is a distinct entry in findFencedRegions (the exemption-limiting decision lives in findLegacyAliasFenceRegion, not here)", () => {
    const lines = "```legacy-gap-aliases\nA\n```\ngap\n```legacy-gap-aliases\nB\n```".split("\n");
    expect(findFencedRegions(lines, "legacy-gap-aliases")).toEqual([
      [0, 2],
      [4, 6],
    ]);
  });

  it("BOUNDARY: findLegacyAliasFenceRegion returns only the FIRST region — a second later fence is not the exempt one", () => {
    const lines = "```legacy-gap-aliases\nA\n```\ngap\n```legacy-gap-aliases\nB\n```".split("\n");
    expect(findLegacyAliasFenceRegion(lines)).toEqual([0, 2]);
  });

  it("NEGATIVE: an unclosed fence reports no region at all (no matching close before EOF)", () => {
    const lines = "```legacy-gap-aliases\nG1 -> GAP-1".split("\n");
    expect(findFencedRegions(lines, "legacy-gap-aliases")).toEqual([]);
  });

  it("BOUNDARY: a fence with a DIFFERENT language tag is not matched", () => {
    const lines = "```js\nconsole.log(1)\n```".split("\n");
    expect(findFencedRegions(lines, "legacy-gap-aliases")).toEqual([]);
  });
});

// ─── Pure: bare-token scan (a)(b)(c) ─────────────────────────────────────────

describe("findBareTokenViolations", () => {
  it("HAPPY: GAP-<n> is never flagged, in a heading or in prose", () => {
    const content = "## GAP-7 (test)\n<!-- gap: id=GAP-7 status=open owning_spec=none -->\n\nGAP-7's shape recurred in GAP-4's fix.\n";
    expect(findBareTokenViolations(content)).toEqual([]);
  });

  it("NEGATIVE (a): a bare G<n> in a heading is flagged and names the entry", () => {
    const content = "## G7 (test)\n<!-- gap: id=GAP-7 status=open owning_spec=none -->\n";
    const violations = findBareTokenViolations(content);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.token).toBe("G7");
    expect(violations[0]?.line).toBe(1);
  });

  it("NEGATIVE (a): a bare G<n> in a PROSE cross-reference (not a heading) is flagged — whole-document, not heading-only", () => {
    const content = "## GAP-13 (test)\n<!-- gap: id=GAP-13 status=closed owning_spec=none -->\n\nG4's shape RECURRED in the very code that fixed G4.\n";
    const violations = findBareTokenViolations(content);
    expect(violations.map((v) => v.token)).toEqual(["G4", "G4"]);
    expect(violations[0]?.heading).toBe("## GAP-13 (test)");
  });

  it("NEGATIVE (a): a bare G<n> inside a markdown TABLE CELL is flagged — cross-references run through tables too", () => {
    const content = "## Problem\n\n| id | note |\n|---|---|\n| G8 | overwrites reason |\n";
    const violations = findBareTokenViolations(content);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.token).toBe("G8");
  });

  it("BOUNDARY: multiple bare tokens on the SAME line are all reported individually", () => {
    const content = "G7 and G8 are both open.\n";
    const violations = findBareTokenViolations(content);
    expect(violations.map((v) => v.token)).toEqual(["G7", "G8"]);
  });

  it("BOUNDARY: GAP-1 and GAP-17 adjacent never falsely match a bare token (G in GAP is followed by A, not a digit)", () => {
    const content = "GAP-1's unclosed half was carried into GAP-17.\n";
    expect(findBareTokenViolations(content)).toEqual([]);
  });

  it("BOUNDARY (b, fence exemption, direction 1 — inside exits clean): the SAME token inside the fenced legacy-gap-aliases region is exempt", () => {
    const content = "## Legacy id aliases\n\n```legacy-gap-aliases\nG1 -> GAP-1\n```\n";
    expect(findBareTokenViolations(content)).toEqual([]);
  });

  it("NEGATIVE (b, fence exemption, direction 2 — one line outside still fails): the SAME token one line OUTSIDE the fence is flagged even though the fence exists", () => {
    const content = "## Legacy id aliases\n\n```legacy-gap-aliases\nG1 -> GAP-1\n```\n\nSee G1 again here, outside the fence.\n";
    const violations = findBareTokenViolations(content);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.token).toBe("G1");
    expect(violations[0]?.text).toContain("outside the fence");
  });

  it("BOUNDARY: a SECOND legacy-gap-aliases fence later in the document is NOT exempted — only the first fence is the exemption region", () => {
    const content =
      "```legacy-gap-aliases\nG1 -> GAP-1\n```\n\n" + // first fence: exempt
      "## Suspicious second fence\n\n```legacy-gap-aliases\nG2 -> GAP-2\n```\n"; // second fence: NOT exempt
    const violations = findBareTokenViolations(content);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.token).toBe("G2");
  });

  it("HAPPY (c, qualifier exemption, direction 1 — qualified is lawful anywhere): PRD-001 G8 is never flagged", () => {
    const content = "## Problem\n\nPRD-001 G8 is 'Output contract live'.\n";
    expect(findBareTokenViolations(content)).toEqual([]);
  });

  it("NEGATIVE (c, qualifier exemption, direction 2 — a bare token beside a qualified one on the SAME line still fails): only the bare occurrence is flagged", () => {
    const content = "## Problem\n\nPRD-001 G8 blocks G8 the gap.\n";
    const violations = findBareTokenViolations(content);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.token).toBe("G8");
    expect(violations[0]?.text).toBe("PRD-001 G8 blocks G8 the gap.");
  });

  it("BOUNDARY: the qualifier must be the LITERAL 'PRD-001 ' immediately before the token — mentioning PRD-001 earlier in the line does not launder a later bare token", () => {
    const content = "Per PRD-001, the gap is G8.\n";
    const violations = findBareTokenViolations(content);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.token).toBe("G8");
  });
});

// ─── Pure: structured entry parsing (e) ─────────────────────────────────────

describe("parseGapCommentFields", () => {
  it("HAPPY: parses id/status/owning_spec/open_half_carried_by from a real-shaped comment line", () => {
    const line = "<!-- gap: id=GAP-1 status=half-closed owning_spec=spec-x open_half_carried_by=GAP-17 -->";
    expect(parseGapCommentFields(line)).toEqual({
      id: "GAP-1",
      status: "half-closed",
      owning_spec: "spec-x",
      open_half_carried_by: "GAP-17",
    });
  });

  it("NEGATIVE: a non-comment line returns null", () => {
    expect(parseGapCommentFields("## GAP-7 (test)")).toBeNull();
  });

  it("BOUNDARY: a comment with only id/status/owning_spec (no carrier) omits that key entirely", () => {
    const line = "<!-- gap: id=GAP-7 status=open owning_spec=none -->";
    expect(parseGapCommentFields(line)).toEqual({ id: "GAP-7", status: "open", owning_spec: "none" });
  });
});

describe("extractGapEntries", () => {
  it("HAPPY: a well-formed entry parses with all four fields", () => {
    const content = "## GAP-1 (test)\n<!-- gap: id=GAP-1 status=half-closed owning_spec=spec-x open_half_carried_by=GAP-17 -->\n";
    const { entries, violations } = extractGapEntries(content);
    expect(violations).toEqual([]);
    expect(entries).toEqual([
      { id: "GAP-1", status: "half-closed", owningSpec: "spec-x", openHalfCarriedBy: "GAP-17", line: 2 },
    ]);
  });

  it("NEGATIVE (e): an entry MISSING owning_spec is rejected (exit-3-worthy), never silently accepted", () => {
    const content = "## GAP-7 (test)\n<!-- gap: id=GAP-7 status=open -->\n";
    const { entries, violations } = extractGapEntries(content);
    expect(entries).toEqual([]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("missing required field 'owning_spec'");
    expect(violations[0]?.reason).toContain("GAP-7");
  });

  it("NEGATIVE (e): an OUT-OF-ENUM status is rejected", () => {
    const content = "## GAP-7 (test)\n<!-- gap: id=GAP-7 status=bogus owning_spec=none -->\n";
    const { entries, violations } = extractGapEntries(content);
    expect(entries).toEqual([]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("out-of-enum 'status'");
    expect(violations[0]?.reason).toContain("bogus");
  });

  it("ERROR: a malformed comment (status token with no '=') degrades to the SAME out-of-enum violation, never a throw", () => {
    const content = "## GAP-7 (test)\n<!-- gap: id=GAP-7 status owning_spec=none -->\n";
    expect(() => extractGapEntries(content)).not.toThrow();
    const { entries, violations } = extractGapEntries(content);
    expect(entries).toEqual([]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("(missing)");
  });

  it("BOUNDARY: GAP-5-shaped prose (cited, no heading, no comment) contributes NO entry and NO violation", () => {
    const content = "## Scope\n\nGAP-5 is cited only here as spec-covered; it has no entry of its own.\n";
    const { entries, violations } = extractGapEntries(content);
    expect(entries).toEqual([]);
    expect(violations).toEqual([]);
  });

  it("ERROR: content with zero metadata comments returns empty entries/violations, never throws", () => {
    expect(() => extractGapEntries("just some prose\n")).not.toThrow();
    expect(extractGapEntries("just some prose\n")).toEqual({ entries: [], violations: [] });
  });

  it("HAPPY: every valid status enum value is accepted", () => {
    const statuses = ["open", "half-closed", "closed", "corrected-record", "not-a-lore-gap"];
    for (const status of statuses) {
      const content = `<!-- gap: id=GAP-X status=${status} owning_spec=none -->`;
      const { entries, violations } = extractGapEntries(content);
      expect(violations).toEqual([]);
      expect(entries[0]?.status).toBe(status);
    }
  });
});

// ─── Pure: unowned-gap report predicate (f, D5) ─────────────────────────────

describe("computeUnownedGapIds", () => {
  const entries: GapEntry[] = [
    // GAP-1-shaped: half-closed, but its unclosed half is CARRIED into another entry -> excluded
    { id: "GAP-1", status: "half-closed", owningSpec: "spec-x", openHalfCarriedBy: "GAP-17", line: 1 },
    // GAP-11-shaped: half-closed, no carrier -> included (this is exactly why status alone cannot decide it)
    { id: "GAP-11", status: "half-closed", owningSpec: "none", openHalfCarriedBy: null, line: 2 },
    // GAP-17-shaped: open, unowned -> included
    { id: "GAP-17", status: "open", owningSpec: "none", openHalfCarriedBy: null, line: 3 },
    // closed, half-closed's sibling states that must never appear
    { id: "GAP-2", status: "closed", owningSpec: "spec-x", openHalfCarriedBy: null, line: 4 },
    { id: "GAP-9", status: "not-a-lore-gap", owningSpec: "none", openHalfCarriedBy: null, line: 5 },
    { id: "GAP-3", status: "corrected-record", owningSpec: "none", openHalfCarriedBy: null, line: 6 },
    // open but OWNED -> excluded
    { id: "GAP-99", status: "open", owningSpec: "spec-owns-it", openHalfCarriedBy: null, line: 7 },
  ];

  it("STATE: distinguishes GAP-1-shaped (half-closed, carried) from GAP-11-shaped (half-closed, uncarried) — only the fourth field can tell them apart", () => {
    const result = computeUnownedGapIds(entries);
    expect(result).not.toContain("GAP-1");
    expect(result).toContain("GAP-11");
  });

  it("HAPPY: the full pinned worked example from D5's spec text (GAP-1 excluded, GAP-11/GAP-17 included, closed/corrected-record/not-a-lore-gap/owned-open all excluded)", () => {
    expect(computeUnownedGapIds(entries)).toEqual(["GAP-11", "GAP-17"]);
  });

  it("NEGATIVE: an open entry whose owning_spec is a real spec slug (not 'none') is never listed", () => {
    expect(computeUnownedGapIds(entries)).not.toContain("GAP-99");
  });

  it("BOUNDARY: an empty entries array reports an empty (not undefined/throwing) list", () => {
    expect(computeUnownedGapIds([])).toEqual([]);
  });

  it("REJECTED-FORM REGRESSION: the naive 'open && no owning_spec' phrasing alone would wrongly EXCLUDE a half-closed-uncarried gap — confirm our predicate does NOT do that", () => {
    const onlyHalfClosedUncarried: GapEntry[] = [
      { id: "GAP-11", status: "half-closed", owningSpec: "none", openHalfCarriedBy: null, line: 1 },
    ];
    expect(computeUnownedGapIds(onlyHalfClosedUncarried)).toEqual(["GAP-11"]);
  });

  it("REJECTED-FORM REGRESSION: the second-attempt 'half-closed (unconditional)' phrasing would wrongly INCLUDE a carried half-closed gap — confirm our predicate excludes it", () => {
    const onlyHalfClosedCarried: GapEntry[] = [
      { id: "GAP-1", status: "half-closed", owningSpec: "spec-x", openHalfCarriedBy: "GAP-17", line: 1 },
    ];
    expect(computeUnownedGapIds(onlyHalfClosedCarried)).toEqual([]);
  });
});

// ─── Pure: GAP-19 scope-line check (h, D6) ──────────────────────────────────

describe("checkGap19Scope", () => {
  it("HAPPY: a scope line containing 'main' and none of the forbidden tokens is ok", () => {
    const content = "## GAP-19 (SCOPE: present on `main`, corrected) — test\n";
    const result = checkGap19Scope(content);
    expect(result).toEqual({ present: true, ok: true, line: 1, text: "## GAP-19 (SCOPE: present on `main`, corrected) — test", reasons: [] });
  });

  it("NEGATIVE: a scope line naming PENDING/mirror branch/a9f801dd and missing 'main' fails with all reasons named", () => {
    const content = "## GAP-19 (SCOPE: PENDING mirror branch a9f801dd) — test\n";
    const result = checkGap19Scope(content);
    expect(result.present).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual([
      "scope line does not contain 'main'",
      "scope line contains forbidden token 'PENDING'",
      "scope line contains forbidden token 'mirror branch'",
      "scope line contains forbidden token 'a9f801dd'",
    ]);
  });

  it("NEGATIVE: containing 'main' does not excuse ALSO containing a forbidden token", () => {
    const content = "## GAP-19 (present on `main`, but see the PENDING mirror branch) — test\n";
    const result = checkGap19Scope(content);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("scope line contains forbidden token 'PENDING'");
  });

  it("BOUNDARY: no GAP-19 heading at all is vacuously ok (most fixtures exercising other clauses have none)", () => {
    const result = checkGap19Scope("## GAP-7 (test)\n<!-- gap: id=GAP-7 status=open owning_spec=none -->\n");
    expect(result).toEqual({ present: false, ok: true, line: null, text: null, reasons: [] });
  });
});

// ─── Pure: full evaluator composition ───────────────────────────────────────

describe("evaluateLedger", () => {
  it("HAPPY: a clean multi-entry document evaluates ok with the correct unowned set", () => {
    const content = [
      "## Legacy id aliases",
      "",
      "```legacy-gap-aliases",
      "G1 -> GAP-1",
      "```",
      "",
      "## GAP-1 (test)",
      "<!-- gap: id=GAP-1 status=half-closed owning_spec=spec-x open_half_carried_by=GAP-17 -->",
      "",
      "## GAP-17 (test)",
      "<!-- gap: id=GAP-17 status=open owning_spec=none -->",
      "",
      "## GAP-2 (test)",
      "<!-- gap: id=GAP-2 status=closed owning_spec=spec-x -->",
      "",
    ].join("\n");
    const result = evaluateLedger(content);
    expect(result.ok).toBe(true);
    expect(result.bareTokenViolations).toEqual([]);
    expect(result.structuredViolations).toEqual([]);
    expect(result.unownedGapIds).toEqual(["GAP-17"]);
  });

  it("STATE: a document with a bare token AND a missing-owning_spec entry AND a bad GAP-19 scope composes ALL THREE violation categories into one non-ok result", () => {
    const content = [
      "## GAP-7 (test)",
      "<!-- gap: id=GAP-7 status=open -->", // missing owning_spec
      "",
      "See G8 for context.", // bare token
      "",
      "## GAP-19 (SCOPE: PENDING) — test", // bad scope
      "<!-- gap: id=GAP-19 status=open owning_spec=none -->",
      "",
    ].join("\n");
    const result = evaluateLedger(content);
    expect(result.ok).toBe(false);
    expect(result.bareTokenViolations).toHaveLength(1);
    expect(result.structuredViolations).toHaveLength(1);
    expect(result.gap19Scope.ok).toBe(false);
  });

  it("ERROR: empty content evaluates ok with zero entries, never throws", () => {
    expect(() => evaluateLedger("")).not.toThrow();
    const result = evaluateLedger("");
    expect(result.ok).toBe(true);
    expect(result.entries).toEqual([]);
    expect(result.unownedGapIds).toEqual([]);
  });
});

// ─── IO: SSOT fixture (mkdtemp + lore init, never this repo's own .lore/) ───

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", LORE_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: "1" },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

function initFixtureCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-gap-namespace-fixture-"));
  const init = runLore(["init", "--json"], dir);
  if (init.exitCode !== 0) {
    throw new Error(`fixture setup: lore init failed (exit ${init.exitCode}): ${init.stderr}`);
  }
  return dir;
}

function createKnowledgeDoc(cwd: string, title: string, content: string): { id: string; slug: string } {
  const result = runLore(
    ["create", "knowledge", "--title", title, "--content", content, "--sub-type", "reference", "--json"],
    cwd,
  );
  if (result.exitCode !== 0) {
    throw new Error(`fixture setup: create knowledge failed (exit ${result.exitCode}): ${result.stderr}\n${result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout) as { data: { id: string; slug: string } };
  return { id: parsed.data.id, slug: parsed.data.slug };
}

describe("check-gap-namespace: SSOT fixture (mkdtemp + lore init, never this repo's own .lore/) — AC-GD-3(d) direction 1", () => {
  it("NEGATIVE (RED first): an injected corpus doc with a bare G<n> token, mirror ABSENT (a fresh throwaway corpus has no docs/requirements/ at all), makes main() exit exactly 3", () => {
    const cwd = initFixtureCorpus();
    try {
      const doc = createKnowledgeDoc(
        cwd,
        "Fixture gap ledger with a bare token",
        "## GAP-7 (fixture)\n<!-- gap: id=GAP-7 status=open owning_spec=none -->\n\nSee G7 for details.\n",
      );
      expect(main(cwd, doc.slug)).toBe(3);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("HAPPY (GREEN control): the SAME fixture shape with GAP-7 instead of G7 makes main() exit 0", () => {
    const cwd = initFixtureCorpus();
    try {
      const doc = createKnowledgeDoc(
        cwd,
        "Fixture gap ledger, clean",
        "## GAP-7 (fixture)\n<!-- gap: id=GAP-7 status=open owning_spec=none -->\n\nSee GAP-7 for details.\n",
      );
      expect(main(cwd, doc.slug)).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("ERROR: a nonexistent slug throws LedgerReadError rather than reporting a false clean/dirty verdict", () => {
    const cwd = initFixtureCorpus();
    try {
      expect(() => readLedgerFromCorpus(cwd, "knowledge-does-not-exist-at-all-zzz")).toThrow(LedgerReadError);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});

describe("check-gap-namespace: SSOT fixture (mkdtemp + lore init, never this repo's own .lore/) — AC-GD-3(d) direction 2", () => {
  it("HAPPY: a clean corpus doc PLUS a mirror file the test itself writes under the SAME fixture root, deliberately stale (pre-rename G1), still makes main() exit 0 — corpus-keyed, not mirror-keyed", () => {
    const cwd = initFixtureCorpus();
    try {
      // Clean end of the comparison: the corpus doc `main()` actually reads uses
      // the post-rename GAP-1 spelling throughout.
      const doc = createKnowledgeDoc(
        cwd,
        "Fixture gap ledger, clean (direction 2)",
        "## GAP-1 (HALF-CLOSED) — fixture\n<!-- gap: id=GAP-1 status=half-closed owning_spec=none open_half_carried_by=GAP-2 -->\n",
      );

      // Dirty end of the comparison: constructed by the test, not borrowed from
      // this repo's own docs/requirements/ — a mirror file under the fixture's
      // OWN root, deliberately left at the pre-rename G1 spelling.
      const mirrorDir = join(cwd, "docs/requirements/knowledge");
      mkdirSync(mirrorDir, { recursive: true });
      const mirrorPath = join(mirrorDir, "KN-fixture-stale-mirror.md");
      writeFileSync(
        mirrorPath,
        "## G1 (HALF-CLOSED) — fixture\n<!-- gap: id=G1 status=half-closed owning_spec=none open_half_carried_by=G2 -->\n",
        "utf8",
      );

      // Control: read the fixture mirror back and confirm it really is stale —
      // a file the test failed to write is the same shape as a clean one.
      const mirrorContent = readFileSync(mirrorPath, "utf8");
      expect(mirrorContent).toContain("## G1 (HALF-CLOSED");
      expect(mirrorContent).not.toContain("## GAP-1 (HALF-CLOSED");

      expect(main(cwd, doc.slug)).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});

// ─── Arming: the REAL repo tree + REAL corpus (task oracle) ────────────────
//
// This is this checker's PRODUCTION WIRING (see the script's own module
// header: this repo's established convention for a dev-repo-only static
// checker — task-three-of-five-static-checkers-are-inert-no-exported-main —
// is a real-tree main() call armed by `bun run test`, never `hooks/pre-push`,
// which is byte-identical to the file shipped into every consumer project
// and would break there since this checker's target doc does not exist in
// any `lore init`-created project).
//
// It is ALSO AC-GD-3(g)/(h) (exits 0 against the LIVE renamed ledger; GAP-19's
// scope line is correct). Whether this repo's OWN exported mirror happens to
// be stale or fresh right now is irrelevant to this assertion and is
// deliberately NOT checked here — that comparison (corpus-keyed, not
// mirror-keyed) is owned entirely by the direction-2 fixture above, which
// constructs both ends itself and so cannot be reddened by repairing this
// repo's mirror.
//
// READ-ONLY against this repo's own `.lore/`: `main()`'s only corpus access
// is one `lore get <slug> --json` (a GET), so this creates, edits, and
// deletes exactly zero corpus docs.

describe("check-gap-namespace: real repo tree (task oracle) — AC-GD-3(g)(h)", () => {
  it("REGRESSION/HAPPY: exits 0 against the LIVE renamed ledger via the corpus (D4b)", () => {
    const exitCode = main(); // production defaults: this repo's root + the real LEDGER_SLUG
    expect(exitCode).toBe(0);
  }, 30000);

  it("REGRESSION: the live ledger's unowned-gap report is exactly the pinned set — SET EQUALITY, not just a count", () => {
    const content = readLedgerFromCorpus(REPO_ROOT, LEDGER_SLUG);
    const { entries } = extractGapEntries(content);
    const unowned = computeUnownedGapIds(entries);
    expect(new Set(unowned)).toEqual(
      new Set(["GAP-7", "GAP-8", "GAP-11", "GAP-15", "GAP-16", "GAP-17", "GAP-18", "GAP-19"]),
    );
  }, 30000);

  it("HAPPY: GAP-19's live scope line contains 'main' and none of PENDING/mirror branch/a9f801dd", () => {
    const content = readLedgerFromCorpus(REPO_ROOT, LEDGER_SLUG);
    const scope = checkGap19Scope(content);
    expect(scope.present).toBe(true);
    expect(scope.ok).toBe(true);
  }, 30000);
});

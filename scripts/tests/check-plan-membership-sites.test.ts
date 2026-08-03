/**
 * Unit + fixture-tree + real-tree suite for `scripts/check-plan-membership-sites.ts`
 * (`task-plan-membership-has-ten-known-sites-and-no-enumeration`) — the
 * enumeration guard for this corpus's deepest recurring defect family: ten
 * plan-membership sites found ONE AT A TIME, with nothing enumerating the
 * population.
 *
 * ## The contrast this suite exists to pin
 *
 * `packages/lore/tests/unit/service/isplanmember-single-definition.test.ts`
 * counts DEFINITION SITES by the literal substring `"function isPlanMember"`.
 * An arrow-const second definition
 * (`const isPlanMember = (t, p) => t.extra["plan_id"] === p`) satisfies that
 * count while violating the property. `LEGACY_DEFINITION_PREDICATE` below
 * mirrors that predicate EXACTLY so both halves of the diff can be measured on
 * the SAME fixture: legacy blind, new rule loud. That contrast IS the defect —
 * `describe("RED-first contrast …")`.
 *
 * The mirror cannot silently drift: `justifies the mirrored legacy predicate`
 * asserts the real legacy test still contains that literal, so strengthening it
 * fails this suite loudly rather than leaving a stale mirror behind.
 *
 * ## Why the real-tree assertion pins a SET rather than exit 0
 *
 * The oracle's first real-tree run found a LIVE, unfixed site
 * (`session-service.ts:251` — `bootstrap`'s active-plan task listing keyed on
 * `d.parent_id === plan.id`; the eight-site sweep fixed `computeReadinessPointer`
 * in the same file and its table mislabelled that one "bootstrap"). Fixing it was
 * a production behaviour change owned by its own task
 * (`task-the-eleventh-plan-member-site-found-by-enumeration`), and that task
 * landed: {@link KNOWN_OPEN_SITES} is now EMPTY and the arming assertion below is
 * a plain `expect(main()).toBe(0)`. The set-equality shape is KEPT, because it is
 * what makes a NEW site fail here by construction.
 *
 * ⛔ {@link KNOWN_OPEN_SITES} is a TEST-LEVEL LEDGER, never an allowlist. The
 * oracle itself still reports every site it finds and still exits 3 — `bun run
 * check:plan-member-sites` names it on every run. The ledger only pins "the open
 * set is exactly this, and no larger": a NEW site fails this suite, and so does
 * fixing a listed one (which forces the ledger to retire with the defect
 * instead of outliving it — as it just did). Adding an entry here to quiet a NEW
 * finding would defeat the guard.
 *
 * Coverage (six dimensions):
 *   HAPPY — each of the three rules flags its canonical form; a clean fixture
 *     tree exits 0; the real tree is scanned (292+ files at authoring time) and
 *     every rule has a live tree-wide match.
 *   NEGATIVE — the same patterns quoted in JSDoc/line comments are NOT flagged
 *     (this codebase's own rationale prose quotes them verbatim); `parent_id`
 *     compared to `null`/`undefined`/a non-plan id is not flagged; the
 *     deliberately-excluded `scopePlan.id` shape is not flagged.
 *   BOUNDARY — a `//` inside a string literal does not blank the rest of the
 *     line; string CONTENT survives the strip (R2's primary form is a string
 *     key); every declared pattern has a canonical self-test example.
 *   ERROR — a missing scan root, zero files walked, a rule matching nothing
 *     tree-wide, and an unterminated block comment are all loud
 *     (`PlanMembershipScanError` / `main() === 4`), never a clean verdict.
 *   STATE — `main()` is read-only and idempotent.
 *   REGRESSION — `*.test.ts` / `*.bun.test.ts` / `tests/` are excluded;
 *     `packages/core/src` IS scanned (the legacy test's blind spot 3); every
 *     allowlist entry is load-bearing on the REAL tree, proven by removing it.
 *
 * @spec_ref task-plan-membership-has-ten-known-sites-and-no-enumeration
 * @spec_ref task-the-tenth-plan-member-site-is-a-write-path-create-time
 * @spec_ref task-three-byte-identical-copies-of-isplanmember-survive
 * @spec_ref task-the-eleventh-plan-member-site-found-by-enumeration
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  collectViolationsInFile,
  isScannableSourceFile,
  main,
  PlanMembershipScanError,
  RULES,
  scanRepo,
  SCAN_ROOTS,
  SHARED_PREDICATE_MODULE,
  stripCommentsPreservingLines,
  type PlanMembershipRule,
} from "../check-plan-membership-sites.js";

const REPO_ROOT = join(__dirname, "..", "..");

/** Rule names, as printed. Kept as constants so a rename breaks compilation, not a string match. */
const R1 = "second-predicate-definition";
const R2 = "raw-membership-comparison";
const R3 = "plan-scope-on-parent-id-proxy";

/** One ledger row: the identity triple `checkLedger`-style matching compares, nothing more. */
interface KnownOpenSite {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
}

/**
 * The COMPLETE set of plan-membership sites this oracle reports on the real
 * tree today: **EMPTY**, measured 2026-08-03 after
 * `task-the-eleventh-plan-member-site-found-by-enumeration` converted BOTH of
 * `bootstrap`'s proxy-keyed derivations to {@link isPlanMember} — the R3
 * comparison at `session-service.ts:251` (the single row this ledger ever
 * carried) and its `.has()`-shaped `active_sessions` sibling, which R3
 * structurally cannot see. With the ledger empty, the real-tree assertions below
 * say "this tree is clean", which is the state the oracle exists to hold.
 *
 * ⛔ A ledger, NOT an allowlist — see this file's header. Remove an entry only
 * when its site is genuinely fixed; never add one to quiet a new finding.
 */
const KNOWN_OPEN_SITES: readonly KnownOpenSite[] = [];

// ─── Legacy-mechanism mirror ────────────────────────────────────────────────

/** The literal the legacy single-definition test keys on — its entire detection surface. */
const LEGACY_DEFINITION_LITERAL = "function isPlanMember";
const LEGACY_TEST_FILE = "packages/lore/tests/unit/service/isplanmember-single-definition.test.ts";

/** Mirrors the legacy test's predicate: does this source count as a definition site? */
function LEGACY_DEFINITION_PREDICATE(source: string): boolean {
  return source.includes(LEGACY_DEFINITION_LITERAL);
}

// ─── Fixture helpers ────────────────────────────────────────────────────────

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeScratchDir(prefix = "check-plan-member-sites-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function writeFixtureFile(root: string, relPath: string, content: string): void {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/**
 * A throwaway tree that satisfies every loud-zero precondition: both scan roots
 * exist, and each rule has a tree-wide sentinel inside a file its own allowlist
 * exempts (so a clean fixture genuinely exits 0, not 4).
 */
function makeSentinelTree(extraFiles: Record<string, string> = {}): string {
  const root = makeScratchDir();
  writeFixtureFile(
    root,
    SHARED_PREDICATE_MODULE,
    'export function isPlanMember(task, planId) {\n  return task.extra["plan_id"] === planId;\n}\n',
  );
  writeFixtureFile(
    root,
    "packages/lore/src/service/task-workflow-service.ts",
    "export const diverged = (tasks, plan) =>\n" +
      "  tasks.filter((t) => t.parent_id === plan.id && !isPlanMember(t, plan.id));\n",
  );
  writeFixtureFile(root, "packages/core/src/placeholder.ts", "export const placeholder = 1;\n");
  for (const [relPath, content] of Object.entries(extraFiles)) writeFixtureFile(root, relPath, content);
  return root;
}

/** `RULES` with one allowlist entry removed — the load-bearing control. */
function rulesWithoutAllowlistEntry(ruleName: string, file: string): readonly PlanMembershipRule[] {
  return RULES.map((rule) =>
    rule.name === ruleName ? { ...rule, allowlist: rule.allowlist.filter((e) => e.file !== file) } : rule,
  );
}

const ARROW_CONST_COPY = 'const isPlanMember = (t, p) => t.extra["plan_id"] === p;\nexport const use = isPlanMember;\n';
const BARE_PARENT_ID_FILTER =
  "export const tasksOf = (docs, plan) =>\n  docs.filter((t) => t.type === \"task\" && t.parent_id === plan.id);\n";

// ─── RED-first: the contrast that IS the defect ──────────────────────────────

describe("RED-first contrast: the legacy mechanism is blind where R1 is loud", () => {
  it("R1 flags an arrow-const second definition that the legacy predicate MISSES", () => {
    const violations = collectViolationsInFile("packages/lore/src/service/second-copy.ts", ARROW_CONST_COPY);

    // RED half — the legacy mechanism sees no definition site here at all.
    expect(LEGACY_DEFINITION_PREDICATE(ARROW_CONST_COPY)).toBe(false);

    // GREEN half — the new rule names it, by form.
    const flagged = violations.filter((v) => v.rule === R1);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.form).toBe("arrow-or-value-binding");
    expect(flagged[0]?.line).toBe(1);
  });

  it("CONTROL: the legacy predicate is not simply broken — it DOES see the sanctioned `function` form", () => {
    // reason: without this control, the RED half above would also pass if
    // LEGACY_DEFINITION_PREDICATE never matched anything at all.
    expect(LEGACY_DEFINITION_PREDICATE(readFileSync(join(REPO_ROOT, SHARED_PREDICATE_MODULE), "utf8"))).toBe(true);
  });

  it("justifies the mirrored legacy predicate: the real legacy test still keys on that literal", () => {
    // reason: if the legacy test is ever strengthened past a substring match,
    // this mirror stops describing it — fail loudly rather than drift.
    const legacySource = readFileSync(join(REPO_ROOT, LEGACY_TEST_FILE), "utf8");
    expect(legacySource).toContain(`includes("${LEGACY_DEFINITION_LITERAL}")`);
  });

  it("RED-first: a bare `t.parent_id === plan.id` plan-scoped filter is flagged by R3", () => {
    const violations = collectViolationsInFile("packages/lore/src/service/some-service.ts", BARE_PARENT_ID_FILTER);
    const flagged = violations.filter((v) => v.rule === R3);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.form).toBe("proxy-comparison-left");
    expect(flagged[0]?.line).toBe(2);
  });

  it("end-to-end: the arrow-const copy takes a clean fixture tree from exit 0 to exit 3", () => {
    const clean = makeSentinelTree();
    expect(main(clean)).toBe(0); // control: the fixture is genuinely green first

    const dirty = makeSentinelTree({ "packages/lore/src/service/second-copy.ts": ARROW_CONST_COPY });
    expect(main(dirty)).toBe(3);
    const reported = scanRepo(dirty).violations.filter((v) => v.rule === R1);
    expect(reported.map((v) => v.file)).toEqual(["packages/lore/src/service/second-copy.ts"]);
  });
});

// ─── R1: every definition form ───────────────────────────────────────────────

describe("R1 second-predicate-definition — all four syntactic forms", () => {
  it.each([
    ["function-declaration", "export function isPlanMember(t, p) { return true; }\n"],
    ["arrow-or-value-binding", "const isPlanMember = (t, p) => true;\n"],
    ["arrow-or-value-binding", "let isPlanMember: (t: unknown, p: string) => boolean = () => true;\n"],
    ["member-method-shorthand", "class Q {\n  private isPlanMember(t, p) { return true; }\n}\n"],
    ["member-property", "const helpers = {\n  isPlanMember: (t, p) => true,\n};\n"],
  ])("flags the %s form", (form, source) => {
    const flagged = collectViolationsInFile("packages/core/src/x.ts", source).filter((v) => v.rule === R1);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.form).toBe(form);
  });

  it("NEGATIVE: an ordinary CALL to the shared predicate is not a definition", () => {
    const source = 'import { isPlanMember } from "./plan-membership.js";\nexport const f = (d, p) => d.filter((t) => isPlanMember(t, p.id));\n';
    expect(collectViolationsInFile("packages/lore/src/service/x.ts", source).filter((v) => v.rule === R1)).toEqual([]);
  });
});

// ─── R2: raw membership comparison ───────────────────────────────────────────

describe("R2 raw-membership-comparison — bracket, dot, reversed, negated, optional-chained", () => {
  it.each([
    ["field-left", 'export const f = (t, p) => t.extra["plan_id"] === p;\n'],
    ["field-left", "export const f = (t, p) => t.extra.plan_id !== p;\n"],
    ["field-left", 'export const f = (t, p) => t.extra?.["plan_id"] === p;\n'],
    ["field-left", "export const f = (t, p) => t.extra?.plan_id === p;\n"],
    ["field-right", 'export const f = (t, p) => p === t.extra["plan_id"];\n'],
    ["field-right", "export const f = (t, p) => p !== t.extra.plan_id;\n"],
    ["field-right", "export const f = (t, p) => p === t.extra?.plan_id;\n"],
  ])("flags the %s form", (form, source) => {
    const flagged = collectViolationsInFile("packages/lore/src/service/x.ts", source).filter((v) => v.rule === R2);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.form).toBe(form);
  });

  it("NEGATIVE: a non-comparison read of the field is not flagged", () => {
    const source = 'export const f = (t) => String(t.extra["plan_id"] ?? "");\n';
    expect(collectViolationsInFile("packages/lore/src/service/x.ts", source).filter((v) => v.rule === R2)).toEqual([]);
  });

  it("NEGATIVE: an unrelated extra key comparison is not flagged", () => {
    const source = 'export const f = (t, p) => t.extra["phase"] === p;\n';
    expect(collectViolationsInFile("packages/lore/src/service/x.ts", source).filter((v) => v.rule === R2)).toEqual([]);
  });
});

// ─── R3: plan scope on the parent_id proxy ───────────────────────────────────

describe("R3 plan-scope-on-parent-id-proxy — comparison spellings and its deliberate limits", () => {
  it.each([
    ["proxy-comparison-left", "export const f = (t, plan) => t.parent_id === plan.id;\n"],
    ["proxy-comparison-left", "export const f = (t, planId) => t.parent_id !== planId;\n"],
    ["proxy-comparison-left", "export const f = (t, planDoc) => t.parent_id === planDoc.id;\n"],
    ["proxy-comparison-left", "export const f = (t, self) => t.parent_id === self.plan.id;\n"],
    ["proxy-comparison-right", "export const f = (t, plan) => plan.id === t.parent_id;\n"],
    ["proxy-comparison-right", "export const f = (t, planId) => planId !== t.doc.parent_id;\n"],
  ])("flags the %s form", (form, source) => {
    const flagged = collectViolationsInFile("packages/lore/src/service/x.ts", source).filter((v) => v.rule === R3);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.form).toBe(form);
  });

  it.each([
    ["a null guard", "export const f = (t) => t.parent_id === null;\n"],
    ["an undefined guard", "export const f = (t) => t.parent_id !== undefined;\n"],
    ["a non-plan id", "export const f = (t, d) => t.parent_id === d.id;\n"],
    ["a filter field", "export const f = (t, filters) => t.parent_id !== filters.parent_id;\n"],
    ["a plan's OWN parent", "export const f = (plan) => plan.parent_id !== null;\n"],
  ])("NEGATIVE: %s is not flagged", (_label, source) => {
    expect(collectViolationsInFile("packages/lore/src/service/x.ts", source).filter((v) => v.rule === R3)).toEqual([]);
  });

  it("REGRESSION: the DOCUMENTED limit — a plan variable not named `plan…` is deliberately not flagged", () => {
    // reason: `session-service.ts:630` is `doc.parent_id !== scopePlan.id` over
    // HANDOFF docs, whose plan link genuinely IS parent_id. Widening the
    // right-hand side to any identifier containing "plan" would flag it and
    // force a whole-file allowlist entry for session-service.ts — which would
    // blind this rule to the REAL violation at :251 in the same file. Pinned so
    // the narrowness reads as a measured decision, not an oversight.
    const source = "export const f = (doc, scopePlan) => doc.parent_id !== scopePlan.id;\n";
    expect(collectViolationsInFile("packages/lore/src/service/x.ts", source).filter((v) => v.rule === R3)).toEqual([]);
  });
});

// ─── Comment / string handling ───────────────────────────────────────────────

describe("comment stripping — prose is exempt, code and string keys are not", () => {
  it("NEGATIVE: the same three patterns quoted in JSDoc and line comments are not flagged", () => {
    const source =
      "/**\n" +
      " * Membership is `t.extra[\"plan_id\"] === planId`, never `t.parent_id === plan.id`.\n" +
      " * A second `function isPlanMember` would be a regression.\n" +
      " */\n" +
      "// const isPlanMember = (t, p) => t.extra.plan_id === p;\n" +
      "export const ok = 1;\n";
    expect(collectViolationsInFile("packages/lore/src/service/x.ts", source)).toEqual([]);
  });

  it("BOUNDARY: a `//` inside a string literal does not blank the rest of the line", () => {
    const source = 'export const f = (t, plan) => { const u = "https://x"; return t.parent_id === plan.id; };\n';
    const flagged = collectViolationsInFile("packages/lore/src/service/x.ts", source).filter((v) => v.rule === R3);
    expect(flagged).toHaveLength(1);
  });

  it("BOUNDARY: string CONTENT survives the strip — R2's primary form IS a string key", () => {
    const stripped = stripCommentsPreservingLines('return task.extra["plan_id"] === planId; // note\n');
    expect(stripped).toContain('extra["plan_id"] === planId');
    expect(stripped).not.toContain("note");
  });

  it("BOUNDARY: line count and length are preserved exactly, so reported line numbers stay true", () => {
    const source = "a();\n/* two\n   lines */\nb();\n";
    const stripped = stripCommentsPreservingLines(source);
    expect(stripped.length).toBe(source.length);
    expect(stripped.split("\n")).toHaveLength(source.split("\n").length);
  });

  it("ERROR: an unterminated block comment is loud, never a clean file", () => {
    expect(() => stripCommentsPreservingLines("a();\n/* never closed\n")).toThrow(PlanMembershipScanError);
  });
});

// ─── Per-pattern arming (no silently-inert sub-pattern) ─────────────────────

describe("every declared pattern is armed by a canonical example", () => {
  /** One example per `form` declared in RULES — the anti-inert-subpattern table. */
  const EXAMPLES: Record<string, string> = {
    "function-declaration": "function isPlanMember(t, p) { return true; }",
    "arrow-or-value-binding": "const isPlanMember = (t, p) => true;",
    "member-method-shorthand": "  isPlanMember(t, p) { return true; }",
    "member-property": "  isPlanMember: (t, p) => true,",
    "field-left": 'return t.extra["plan_id"] === planId;',
    "field-right": 'return planId === t.extra["plan_id"];',
    "proxy-comparison-left": "docs.filter((t) => t.parent_id === plan.id);",
    "proxy-comparison-right": "docs.filter((t) => plan.id === t.parent_id);",
  };

  it("the example table covers EVERY form declared in RULES (a new pattern cannot ship untested)", () => {
    const declared = RULES.flatMap((rule) => rule.patterns.map((p) => p.form)).sort();
    expect([...new Set(declared)]).toEqual(Object.keys(EXAMPLES).sort());
  });

  it.each(RULES.flatMap((rule) => rule.patterns.map((p) => [rule.name, p.form, p.pattern] as const)))(
    "%s / %s matches its canonical example",
    (_ruleName, form, pattern) => {
      expect(pattern.test(EXAMPLES[form] as string)).toBe(true);
    },
  );
});

// ─── Scan scope ─────────────────────────────────────────────────────────────

describe("scan scope", () => {
  it.each([
    ["packages/lore/src/service/plan-membership.ts", true],
    ["packages/core/src/schemas.ts", true],
    ["packages/lore/src/service/x.test.ts", false],
    ["packages/lore/src/store/x.bun.test.ts", false],
    ["packages/lore/src/x.d.ts", false],
    ["packages/lore/tests/unit/x.ts", false],
    ["packages/lore/src/generated/x.ts", false],
    ["packages/lore/src/service/x.js", false],
  ])("%s scannable=%s", (relPath, expected) => {
    expect(isScannableSourceFile(relPath)).toBe(expected);
  });

  it("REGRESSION: packages/core/src IS scanned — the legacy test's third blind spot", () => {
    const root = makeSentinelTree({ "packages/core/src/plan-helpers.ts": BARE_PARENT_ID_FILTER });
    expect(main(root)).toBe(3);
    expect(scanRepo(root).violations.map((v) => v.file)).toEqual(["packages/core/src/plan-helpers.ts"]);
  });

  it("REGRESSION: a violation inside a *.test.ts file is never reported", () => {
    const root = makeSentinelTree({ "packages/lore/src/service/x.test.ts": ARROW_CONST_COPY });
    expect(main(root)).toBe(0);
  });
});

// ─── Loud-zero ──────────────────────────────────────────────────────────────

describe("loud-zero — an unmeasurable scan is exit 4, never 0", () => {
  it("ERROR: an EMPTY directory exits 4 (the exit VALUE, not merely non-zero)", () => {
    expect(main(makeScratchDir("check-plan-member-sites-empty-"))).toBe(4);
  });

  it("ERROR: a missing scan root throws with reason 'missing-root'", () => {
    const root = makeScratchDir();
    writeFixtureFile(root, "packages/lore/src/service/plan-membership.ts", "export const a = 1;\n");
    // packages/core/src deliberately absent
    expect(() => scanRepo(root)).toThrow(PlanMembershipScanError);
    try {
      scanRepo(root);
      expect.unreachable("scanRepo must throw on a missing scan root");
    } catch (error) {
      expect((error as PlanMembershipScanError).reason).toBe("missing-root");
      expect((error as Error).message).toContain(SCAN_ROOTS[1]);
    }
  });

  it("ERROR: both roots present but ZERO scannable files exits 4", () => {
    const root = makeScratchDir();
    mkdirSync(join(root, SCAN_ROOTS[0]), { recursive: true });
    mkdirSync(join(root, SCAN_ROOTS[1]), { recursive: true });
    writeFixtureFile(root, `${SCAN_ROOTS[0]}/notes.md`, "not a source file\n");
    expect(main(root)).toBe(4);
  });

  it("ERROR: a rule that matches NOTHING tree-wide exits 4 — a renamed field must not read as clean", () => {
    const root = makeScratchDir();
    // Both roots populated with real source, but no isPlanMember and no
    // parent_id/plan comparison anywhere: every rule is inert.
    writeFixtureFile(root, "packages/lore/src/service/x.ts", "export const a = 1;\n");
    writeFixtureFile(root, "packages/core/src/y.ts", "export const b = 2;\n");
    expect(main(root)).toBe(4);
    try {
      scanRepo(root);
      expect.unreachable("scanRepo must throw when a rule matches nothing tree-wide");
    } catch (error) {
      expect((error as PlanMembershipScanError).reason).toBe("rule-matches-nothing");
      const message = (error as Error).message;
      for (const rule of RULES) expect(message).toContain(rule.name);
    }
  });

  it("BOUNDARY: a tree-wide match inside an ALLOWLISTED file satisfies loud-zero (that is the point)", () => {
    const root = makeSentinelTree();
    const report = scanRepo(root);
    expect(report.violations).toEqual([]);
    for (const rule of RULES) expect(report.treeWideMatchCounts[rule.name]).toBeGreaterThanOrEqual(1);
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("main() is read-only and idempotent", () => {
  it("STATE: two consecutive runs over an unchanged fixture report the identical code, and the tree is untouched", () => {
    const root = makeSentinelTree();
    const before = readdirSync(join(root, "packages/lore/src/service")).sort();
    expect(main(root)).toBe(main(root));
    expect(readdirSync(join(root, "packages/lore/src/service")).sort()).toEqual(before);
  });
});

// ─── Real repo tree (task oracle) ───────────────────────────────────────────

describe("check-plan-membership-sites: real repo tree (task oracle)", () => {
  it("HAPPY: the guard actually runs against THIS checkout — both roots walked, a real file count", () => {
    const report = scanRepo();
    expect(report.files.length).toBeGreaterThan(200);
    for (const root of SCAN_ROOTS) {
      expect(report.files.some((file) => file.startsWith(`${root}/`))).toBe(true);
    }
  });

  it("HAPPY: every rule is LIVE on the real tree (loud-zero armed, not vacuous)", () => {
    const counts = scanRepo().treeWideMatchCounts;
    for (const rule of RULES) expect(counts[rule.name]).toBeGreaterThanOrEqual(1);
  });

  it("the real-tree open set is EXACTLY the known ledger — a NEW site fails here", () => {
    const found = scanRepo().violations.map((v) => ({ file: v.file, line: v.line, rule: v.rule }));
    expect(found).toEqual(KNOWN_OPEN_SITES.map((site) => ({ file: site.file, line: site.line, rule: site.rule })));
  });

  it("main() with NO injected root reports a CLEAN tree", () => {
    // The ledger retired with its defect (see this file's header), so the real
    // tree must scan clean: 0 — never 3 (a live site) and never 4 (a scan that
    // could not measure what it claims).
    expect(main()).toBe(0);
  });

  it("CONTROL: the shared predicate module itself is never reported", () => {
    expect(scanRepo().violations.filter((v) => v.file === SHARED_PREDICATE_MODULE)).toEqual([]);
  });

  it("CONTROL: every allowlisted file exists and is actually inside the scanned set", () => {
    // reason: a typo'd allowlist path exempts nothing and would go unnoticed —
    // the rule would keep reporting the real file, but the entry's reason would
    // silently stop describing anything.
    const scanned = new Set(scanRepo().files);
    for (const rule of RULES) {
      for (const entry of rule.allowlist) {
        expect(statSync(join(REPO_ROOT, entry.file)).isFile()).toBe(true);
        expect(scanned.has(entry.file)).toBe(true);
        expect(entry.reason.trim().length).toBeGreaterThan(40);
      }
    }
  });

  it.each(RULES.flatMap((rule) => rule.allowlist.map((entry) => [rule.name, entry.file] as const)))(
    "REGRESSION: allowlist entry %s / %s is LOAD-BEARING — removing it makes the file reported",
    (ruleName, file) => {
      // Exempted today…
      expect(scanRepo().violations.filter((v) => v.rule === ruleName && v.file === file)).toEqual([]);
      // …and the exemption is doing real work, not decorating.
      const revealed = scanRepo(REPO_ROOT, rulesWithoutAllowlistEntry(ruleName, file)).violations.filter(
        (v) => v.rule === ruleName && v.file === file,
      );
      expect(revealed.length).toBeGreaterThanOrEqual(1);
    },
  );
});

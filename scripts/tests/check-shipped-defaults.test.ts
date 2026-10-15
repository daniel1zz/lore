/**
 * Unit + fixture-driven suite for `scripts/check-shipped-defaults.ts`
 * (`spec-governance-defaults-must-ship-and-every-recorded-gap-must` D1/D2,
 * `task-raise-capture-timeout-ms-and-max-diff-chars-to-the-values` AC-GD-1).
 *
 * Every `main()` case below drives the REAL IO shell against an injected
 * `mkdtemp` fixture tree (never this repo's own `.lore/config.yaml` — see
 * the "fresh-install clause" describe block for the one place a REAL
 * subprocess `lore init`/`lore setup --project` is exercised, and note it
 * too provisions into its OWN throwaway `mkdtemp` corpus). The pure-function
 * suites above it drive each algorithm directly against literal fixtures —
 * mirrors `scripts/tests/check-test-budgets.test.ts`'s established split
 * between algorithm unit tests and a "real repo tree" `main()` case.
 *
 * Coverage (six dimensions):
 *   HAPPY — a duplicate override is harmless (ABSENCE-only predicate); an
 *     allowlisted key is never flagged; a realistic post-fix fixture
 *     mirroring this repo's REAL `.lore/config.yaml` exits 0 end-to-end.
 *   NEGATIVE — an override the shipped surface does not carry exits exactly
 *     3, naming the offending path; an entirely-absent `.lore/config.yaml`
 *     is zero overrides, never a scan failure.
 *   BOUNDARY — the THREE pinned rationale probes (whitespace-only,
 *     placeholder, 19-char) each independently trip exit 3; a 20-char
 *     non-placeholder rationale does not.
 *   ERROR — a missing template file, malformed template YAML, and malformed
 *     `.lore/config.yaml` are SCAN FAILURES (thrown `ShippedDefaultsCheckError`),
 *     never silently reported as clean.
 *   STATE — every pure function is idempotent across repeated calls on the
 *     same input.
 *   REGRESSION — `main()` against THIS repo's real template + a fixture
 *     copy of its real `.lore/config.yaml` content exits 0 (the actual
 *     "post-fix tree" this task landed); `main()` against this worktree's
 *     own (real, uninjected) repo root also exits 0.
 *
 * @spec_ref spec-governance-defaults-must-ship-and-every-recorded-gap-must
 *   §Acceptance Criteria AC-GD-1
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveCaptureTimeoutMs, AiConfigSchema } from "@lore/core";
import { loadConfig } from "@lore/core/node";
import {
  PROJECT_SPECIFIC_KEYS,
  RATIONALE_MIN_LENGTH,
  RATIONALE_PLACEHOLDER_TOKENS,
  ShippedDefaultsCheckError,
  computeCodeDefaults,
  deepEqualJsonValue,
  deepMergeShippedSurface,
  findAllowlistRationaleViolations,
  findShippedDefaultDrift,
  flattenLeaves,
  getAtPath,
  isAllowlistedKey,
  main,
  meetsRationaleMinimalShape,
  type ProjectSpecificKeyEntry,
} from "../check-shipped-defaults.js";

const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

/** Real repo template content, verbatim, so fixture-based tests never read this repo's own file. */
const REAL_TEMPLATE_TEXT = `workflow:
  verification_profiles:
    design:
      required_oracles:
        - e2e
      required_uat: true
    feature:
      required_oracles:
        - test
    tech:
      required_oracles:
        - test
    domain-overview:
      min_acs: 0

ai:
  providers:
    claude-cli:
      command: claude
      args: ["-p"]
      timeout_ms: 180000
`;

/** A minimal, valid template with no seeded keys at all — the "nothing shipped" baseline. */
const EMPTY_TEMPLATE_TEXT = "project_placeholder_never_a_real_key_do_not_seed: true\n";

/** `project` is REQUIRED (no Zod default) — every minimal fixture config.yaml below needs this prefix. */
const TEST_PROJECT_HEADER = "project:\n  name: fixture-project\n  author: fixture-author\n";

const activeTmpDirs: string[] = [];

/** Builds a fixture repoRoot with `.lore/config.yaml` (omit for "no override file") and a template. */
function buildFixtureRepo(configYaml: string | undefined, templateYaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "check-shipped-defaults-fixture-"));
  activeTmpDirs.push(dir);
  mkdirSync(join(dir, "assets", "project"), { recursive: true });
  writeFileSync(join(dir, "assets", "project", "lore-config-template.yaml"), templateYaml, "utf8");
  if (configYaml !== undefined) {
    mkdirSync(join(dir, ".lore"), { recursive: true });
    writeFileSync(join(dir, ".lore", "config.yaml"), configYaml, "utf8");
  }
  return dir;
}

afterEach(() => {
  while (activeTmpDirs.length > 0) {
    const dir = activeTmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// ─── meetsRationaleMinimalShape / findAllowlistRationaleViolations ────────

describe("meetsRationaleMinimalShape: BOUNDARY — the three pinned probes (AC-GD-1c)", () => {
  it("whitespace-only rationale fails", () => {
    expect(meetsRationaleMinimalShape("                    ")).toBe(false);
  });

  it("a placeholder token (case-insensitive, whole-value) fails", () => {
    expect(meetsRationaleMinimalShape("todo")).toBe(false);
    expect(meetsRationaleMinimalShape("TODO")).toBe(false);
    expect(meetsRationaleMinimalShape("N/A")).toBe(false);
    expect(meetsRationaleMinimalShape("-")).toBe(false);
    expect(meetsRationaleMinimalShape("?")).toBe(false);
  });

  it("a 19-char rationale (one under the floor) fails", () => {
    const nineteenChars = "123456789012345678x";
    expect(nineteenChars.length).toBe(19); // sanity: the probe really is 19 chars
    expect(meetsRationaleMinimalShape(nineteenChars)).toBe(false);
  });

  it("a 20-char, non-placeholder rationale passes (the floor itself)", () => {
    const twentyChars = "1234567890123456789x";
    expect(twentyChars.length).toBe(20);
    expect(meetsRationaleMinimalShape(twentyChars)).toBe(true);
  });
});

describe("meetsRationaleMinimalShape: NEGATIVE — a placeholder token embedded in a longer string is NOT a whole-value match", () => {
  it("a real rationale that happens to CONTAIN the word 'todo' still passes (substring, not whole-value)", () => {
    expect(meetsRationaleMinimalShape("the todo list for this key is intentionally empty")).toBe(true);
  });
});

describe("findAllowlistRationaleViolations: HAPPY / NEGATIVE / STATE", () => {
  it("every real PROJECT_SPECIFIC_KEYS entry passes (0 violations) — REGRESSION", () => {
    expect(findAllowlistRationaleViolations(PROJECT_SPECIFIC_KEYS)).toEqual([]);
  });

  it("an injected entry with an empty rationale is reported by key", () => {
    const entries: ProjectSpecificKeyEntry[] = [{ key: "some.key", rationale: "" }];
    const violations = findAllowlistRationaleViolations(entries);
    expect(violations).toEqual([{ key: "some.key", rationale: "" }]);
  });

  it("is idempotent across repeated calls on the same input", () => {
    const entries: ProjectSpecificKeyEntry[] = [{ key: "a", rationale: "?" }];
    expect(findAllowlistRationaleViolations(entries)).toEqual(findAllowlistRationaleViolations(entries));
  });

  it("RATIONALE_MIN_LENGTH is 20 and every placeholder token is present (sanity on the pinned constants)", () => {
    expect(RATIONALE_MIN_LENGTH).toBe(20);
    expect(RATIONALE_PLACEHOLDER_TOKENS).toEqual(["TODO", "TBD", "FIXME", "N/A", "-", "?"]);
  });
});

// ─── deepEqualJsonValue ────────────────────────────────────────────────────

describe("deepEqualJsonValue: HAPPY / NEGATIVE / BOUNDARY", () => {
  it("identical primitives, arrays, and nested objects are equal", () => {
    expect(deepEqualJsonValue(80000, 80000)).toBe(true);
    expect(deepEqualJsonValue(["-p"], ["-p"])).toBe(true);
    expect(deepEqualJsonValue({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
  });

  it("object key ORDER does not matter", () => {
    expect(deepEqualJsonValue({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("array ELEMENT order DOES matter", () => {
    expect(deepEqualJsonValue(["-p", "-x"], ["-x", "-p"])).toBe(false);
  });

  it("a shorter array is never equal to a longer one even with a shared prefix", () => {
    expect(deepEqualJsonValue(["-p"], ["-p", "--setting-sources", "project"])).toBe(false);
  });

  it("undefined is never equal to a concrete value (the 'shipped surface lacks it entirely' case)", () => {
    expect(deepEqualJsonValue("claude", undefined)).toBe(false);
    expect(deepEqualJsonValue(undefined, undefined)).toBe(true);
  });

  it("an object is never equal to an array even with matching enumerable content", () => {
    expect(deepEqualJsonValue({ 0: "x" }, ["x"])).toBe(false);
  });
});

// ─── flattenLeaves / getAtPath ─────────────────────────────────────────────

describe("flattenLeaves: HAPPY / BOUNDARY", () => {
  it("flattens nested plain objects into dotted-path leaves", () => {
    expect(flattenLeaves({ ai: { assess: { max_diff_chars: 80000 } } })).toEqual([
      { path: "ai.assess.max_diff_chars", value: 80000 },
    ]);
  });

  it("treats an array as a LEAF value, never recursing into its elements", () => {
    expect(flattenLeaves({ workflow: { verification_profiles: { design: { required_oracles: ["e2e"] } } } })).toEqual(
      [{ path: "workflow.verification_profiles.design.required_oracles", value: ["e2e"] }],
    );
  });

  it("an empty plain object at any depth contributes ZERO leaves", () => {
    expect(flattenLeaves({ defaults: {} })).toEqual([]);
  });
});

describe("getAtPath: HAPPY / NEGATIVE", () => {
  it("resolves a nested path that exists", () => {
    expect(getAtPath({ ai: { assess: { max_diff_chars: 80000 } } }, "ai.assess.max_diff_chars")).toBe(80000);
  });

  it("returns undefined the moment a segment is missing, never throws", () => {
    expect(getAtPath({ ai: {} }, "ai.providers.claude-cli.args")).toBeUndefined();
    expect(getAtPath({}, "workflow.evidence.capture_timeout_ms")).toBeUndefined();
  });

  it("returns undefined when a path segment resolves to a non-object (cannot descend further)", () => {
    expect(getAtPath({ ai: { provider: "claude-cli" } }, "ai.provider.nested")).toBeUndefined();
  });
});

// ─── deepMergeShippedSurface ────────────────────────────────────────────────

describe("deepMergeShippedSurface: HAPPY / NEGATIVE / STATE", () => {
  it("merges nested plain objects recursively, override wins on conflict", () => {
    const result = deepMergeShippedSurface({ ai: { providers: {}, provider: "claude-cli" } }, { ai: { providers: { "claude-cli": { args: ["-p"] } } } });
    expect(result).toEqual({ ai: { providers: { "claude-cli": { args: ["-p"] } }, provider: "claude-cli" } });
  });

  it("an array in override REPLACES the base array wholesale, never element-merged", () => {
    const result = deepMergeShippedSurface({ workflow: { verification_profiles: { design: { required_oracles: ["test"] } } } }, { workflow: { verification_profiles: { design: { required_oracles: ["e2e"] } } } });
    expect(getAtPath(result, "workflow.verification_profiles.design.required_oracles")).toEqual(["e2e"]);
  });

  it("neither input is mutated", () => {
    const base = { a: { b: 1 } };
    const override = { a: { c: 2 } };
    deepMergeShippedSurface(base, override);
    expect(base).toEqual({ a: { b: 1 } });
    expect(override).toEqual({ a: { c: 2 } });
  });

  it("is idempotent — merging the same inputs twice yields structurally identical results", () => {
    const base = { a: 1 };
    const override = { b: 2 };
    expect(deepMergeShippedSurface(base, override)).toEqual(deepMergeShippedSurface(base, override));
  });
});

// ─── isAllowlistedKey ───────────────────────────────────────────────────────

describe("isAllowlistedKey: HAPPY / NEGATIVE / BOUNDARY", () => {
  const allowlist: ProjectSpecificKeyEntry[] = [
    { key: "project.name", rationale: "x".repeat(20) },
    { key: "workflow.gates", rationale: "x".repeat(20) },
  ];

  it("matches an EXACT leaf key", () => {
    expect(isAllowlistedKey("project.name", allowlist)).toBe(true);
  });

  it("matches anything nested UNDER a prefix entry", () => {
    expect(isAllowlistedKey('workflow.gates."plan-close".prd_sync.enabled', allowlist)).toBe(true);
  });

  it("does NOT match an unrelated key", () => {
    expect(isAllowlistedKey("workflow.evidence.capture_timeout_ms", allowlist)).toBe(false);
  });

  it("does NOT match a sibling key that merely shares a string prefix without the separating dot", () => {
    // "project.nameplate" must not match "project.name" — the boundary is at the literal "." separator.
    expect(isAllowlistedKey("project.nameplate", allowlist)).toBe(false);
  });
});

// ─── computeCodeDefaults ────────────────────────────────────────────────────

describe("computeCodeDefaults: HAPPY / REGRESSION", () => {
  it("materialises the RAISED code defaults for both named values (D2)", () => {
    const defaults = computeCodeDefaults();
    expect(getAtPath(defaults, "workflow.evidence.capture_timeout_ms")).toBe(1_200_000);
    expect(getAtPath(defaults, "ai.assess.max_diff_chars")).toBe(80_000);
  });

  it("materialises the raised verify.default_timeout_ms too (third back-catalogue instance)", () => {
    expect(getAtPath(computeCodeDefaults(), "verify.default_timeout_ms")).toBe(900_000);
  });

  it("never throws (every ZOD_DEFAULTABLE_SECTIONS entry parses `{}` cleanly)", () => {
    expect(() => computeCodeDefaults()).not.toThrow();
  });

  it("does not carry an ai.providers.claude-cli entry (that value ships via the template, not the code default)", () => {
    expect(getAtPath(computeCodeDefaults(), "ai.providers.claude-cli")).toBeUndefined();
  });
});

// ─── findShippedDefaultDrift ────────────────────────────────────────────────

describe("findShippedDefaultDrift: HAPPY (ABSENCE-only predicate) / NEGATIVE / STATE", () => {
  it("a repo override that DUPLICATES the shipped value is harmless — zero violations", () => {
    const repoConfig = { workflow: { evidence: { capture_timeout_ms: 1_200_000 } } };
    const shipped = { workflow: { evidence: { capture_timeout_ms: 1_200_000 } } };
    expect(findShippedDefaultDrift(repoConfig, shipped, [])).toEqual([]);
  });

  it("a repo override the shipped surface carries a DIFFERENT value for is a violation", () => {
    const repoConfig = { ai: { assess: { max_diff_chars: 999_999 } } };
    const shipped = { ai: { assess: { max_diff_chars: 80_000 } } };
    expect(findShippedDefaultDrift(repoConfig, shipped, [])).toEqual([
      { path: "ai.assess.max_diff_chars", repoValue: 999_999, shippedValue: 80_000 },
    ]);
  });

  it("a repo override at a path the shipped surface does not carry AT ALL is a violation (shippedValue undefined)", () => {
    const repoConfig = { ai: { providers: { "claude-cli": { command: "claude" } } } };
    const shipped = { ai: { providers: {} } };
    expect(findShippedDefaultDrift(repoConfig, shipped, [])).toEqual([
      { path: "ai.providers.claude-cli.command", repoValue: "claude", shippedValue: undefined },
    ]);
  });

  it("an allowlisted key is skipped even though it diverges from the shipped surface", () => {
    const repoConfig = { project: { name: "lore" } };
    const shipped = { project: { name: "shipped-default-probe" } };
    const allowlist: ProjectSpecificKeyEntry[] = [{ key: "project.name", rationale: "x".repeat(20) }];
    expect(findShippedDefaultDrift(repoConfig, shipped, allowlist)).toEqual([]);
  });

  it("is idempotent across repeated calls on the same input", () => {
    const repoConfig = { a: { b: 1 } };
    const shipped = { a: { b: 2 } };
    expect(findShippedDefaultDrift(repoConfig, shipped, [])).toEqual(findShippedDefaultDrift(repoConfig, shipped, []));
  });
});

// ─── main(): fixture-driven end-to-end (AC-GD-1a/b/c) ──────────────────────

describe("main(): NEGATIVE — AC-GD-1(a) exits exactly 3 naming an unshipped override", () => {
  it("a repo override the shipped surface does not carry exits 3", () => {
    const root = buildFixtureRepo(`${TEST_PROJECT_HEADER}ai:\n  assess:\n    max_diff_chars: 999999\n`, EMPTY_TEMPLATE_TEXT);
    expect(main(root)).toBe(3);
  });
});

describe("main(): HAPPY — AC-GD-1(a)/(b) duplicate values and allowlisted keys are never flagged", () => {
  it("a repo override that duplicates the RAISED code default exits 0", () => {
    const root = buildFixtureRepo(
      `${TEST_PROJECT_HEADER}workflow:\n  evidence:\n    capture_timeout_ms: 1200000\n`,
      EMPTY_TEMPLATE_TEXT,
    );
    expect(main(root)).toBe(0);
  });

  it("an allowlisted key (feedback.upstream, named in the governing spec) is never flagged even with a value the shipped surface cannot carry", () => {
    const root = buildFixtureRepo(
      `${TEST_PROJECT_HEADER}feedback:\n  upstream:\n    corpus_path: "/some/other/repo"\n    root_prd: "prd-example"\n`,
      EMPTY_TEMPLATE_TEXT,
    );
    expect(main(root)).toBe(0);
  });

  it("an entirely absent .lore/config.yaml is zero overrides, not a scan failure", () => {
    const root = buildFixtureRepo(undefined, EMPTY_TEMPLATE_TEXT);
    expect(main(root)).toBe(0);
  });

  it("a value the template (not the code default) carries is treated as shipped", () => {
    const root = buildFixtureRepo(
      `${TEST_PROJECT_HEADER}workflow:\n  verification_profiles:\n    design:\n      required_oracles:\n        - e2e\n`,
      "workflow:\n  verification_profiles:\n    design:\n      required_oracles:\n        - e2e\n",
    );
    expect(main(root)).toBe(0);
  });
});

describe("main(): REGRESSION — issue #219: workflow.turn_end.main_session_source_edits is a per-project opt-in", () => {
  // spec-interception-moves-off-every-tool-call-one-turn-end-review: default `off`;
  // a project whose discipline has the main agent dispatch all code (this repo) sets `block`.
  const turnEndConfig = `${TEST_PROJECT_HEADER}workflow:\n  turn_end:\n    main_session_source_edits: block\n`;
  const realTemplateText = readFileSync(join(REPO_ROOT, "assets", "project", "lore-config-template.yaml"), "utf8");

  it("the real shipped template, with the key set to block, exits 0 and reports no DRIFT for it", () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      const root = buildFixtureRepo(turnEndConfig, realTemplateText);
      expect(main(root)).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(errors.join("\n")).not.toContain("workflow.turn_end.main_session_source_edits");
  });

  it("CONTROL: with the allowlist lacking the key, the same fixture exits 3 naming DRIFT for it — the assertion above is discriminating", () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    try {
      const root = buildFixtureRepo(turnEndConfig, realTemplateText);
      const withoutKey = PROJECT_SPECIFIC_KEYS.filter((e) => e.key !== "workflow.turn_end.main_session_source_edits");
      expect(main(root, withoutKey)).toBe(3);
    } finally {
      spy.mockRestore();
    }
    expect(errors.join("\n")).toContain("DRIFT workflow.turn_end.main_session_source_edits");
  });
});

describe("main(): BOUNDARY — AC-GD-1(c) the three pinned rationale probes, each independently, via main()'s own IO shell", () => {
  // `allowlist` is injectable on `main()` PRECISELY so this suite can prove the IO
  // shell itself (not just the pure findAllowlistRationaleViolations predicate above)
  // surfaces an invalid rationale as exit 3 — a FRESH config file with ZERO overrides
  // per case, so the exit-3 provably comes from the allowlist check alone, never drift.

  it("a whitespace-only rationale exits 3", () => {
    const root = buildFixtureRepo(undefined, EMPTY_TEMPLATE_TEXT);
    const allowlist: ProjectSpecificKeyEntry[] = [{ key: "some.key", rationale: "                    " }];
    expect(main(root, allowlist)).toBe(3);
  });

  it("a placeholder-token rationale exits 3", () => {
    const root = buildFixtureRepo(undefined, EMPTY_TEMPLATE_TEXT);
    const allowlist: ProjectSpecificKeyEntry[] = [{ key: "some.key", rationale: "TBD" }];
    expect(main(root, allowlist)).toBe(3);
  });

  it("a 19-char rationale (one under the floor) exits 3", () => {
    const root = buildFixtureRepo(undefined, EMPTY_TEMPLATE_TEXT);
    const allowlist: ProjectSpecificKeyEntry[] = [{ key: "some.key", rationale: "123456789012345678x" }];
    expect(main(root, allowlist)).toBe(3);
  });

  it("CONTROL: a 20-char, non-placeholder rationale on the SAME key exits 0 — proves the three probes above are discriminating, not a permanently-broken fixture", () => {
    const root = buildFixtureRepo(undefined, EMPTY_TEMPLATE_TEXT);
    const allowlist: ProjectSpecificKeyEntry[] = [{ key: "some.key", rationale: "1234567890123456789x" }];
    expect(main(root, allowlist)).toBe(0);
  });
});

describe("main(): ERROR — a scan failure is never reported as clean", () => {
  it("a missing template file throws ShippedDefaultsCheckError", () => {
    const root = mkdtempSync(join(tmpdir(), "check-shipped-defaults-fixture-"));
    activeTmpDirs.push(root);
    expect(() => main(root)).toThrow(ShippedDefaultsCheckError);
  });

  it("a malformed template YAML throws ShippedDefaultsCheckError", () => {
    const root = buildFixtureRepo(undefined, "not: valid: yaml: [unterminated");
    expect(() => main(root)).toThrow(ShippedDefaultsCheckError);
  });

  it("a template that parses to a non-object (a bare scalar) throws ShippedDefaultsCheckError", () => {
    const root = buildFixtureRepo(undefined, "just a bare scalar string\n");
    expect(() => main(root)).toThrow(ShippedDefaultsCheckError);
  });

  it("a malformed .lore/config.yaml (fails LoreConfigSchema) throws ShippedDefaultsCheckError", () => {
    const root = buildFixtureRepo("project:\n  name: x\n  author: y\nunknown_top_level_key: true\n", EMPTY_TEMPLATE_TEXT);
    expect(() => main(root)).toThrow(ShippedDefaultsCheckError);
  });
});

// ─── main(): REGRESSION — real repo tree ───────────────────────────────────

describe("main(): REGRESSION — this repo's real template + a fixture copy of the real .lore/config.yaml (task Acceptance Criterion)", () => {
  it("exits 0 against a fixture reconstructing this repo's ACTUAL .lore/config.yaml content (the genuine post-D2 tree, not a vacuous empty-file pass)", () => {
    // .lore/config.yaml is gitignored (untracked) — this worktree's own copy is
    // therefore ABSENT, which would make a real-tree main() call here vacuous.
    // This fixture reconstructs the REAL content read from the main checkout on
    // 2026-08-11 (this task's closing report cites the exact read), so this
    // assertion is a genuine "does the post-fix tree pass" proof, not a
    // "there was nothing to check" false confidence.
    const realConfigSnapshot = `project:
  name: lore
  author: owner
ai:
  assess:
    max_diff_chars: 80000
  providers:
    claude-cli:
      command: claude
      args: ["-p"]
      timeout_ms: 180000
context:
  memory_files:
    root:
      max_lines: 220
      max_bytes: 24576
audit:
  verify_since: "2026-07-06T12:02:00Z"
verify:
  default_timeout_ms: 900000
workflow:
  evidence:
    capture_timeout_ms: 1200000
  verification_profiles:
    design:
      required_oracles:
        - e2e
      required_uat: true
    feature:
      required_oracles:
        - test
    tech:
      required_oracles:
        - test
    domain-overview:
      min_acs: 0
  gates:
    plan-close:
      prd_sync:
        enabled: true
`;
    const root = buildFixtureRepo(realConfigSnapshot, REAL_TEMPLATE_TEXT);
    expect(main(root)).toBe(0);
  });

  it("REGRESSION control: the SAME fixture minus the ai.providers.claude-cli disposition (i.e. the pre-fix template) exits 3 — proves the assertion above is discriminating, not vacuous", () => {
    const realConfigSnapshot = `project:
  name: fixture-project
  author: fixture-author
ai:
  providers:
    claude-cli:
      command: claude
      args: ["-p"]
      timeout_ms: 180000
`;
    const preFixTemplate = "workflow:\n  verification_profiles:\n    design:\n      required_oracles:\n        - e2e\n";
    const root = buildFixtureRepo(realConfigSnapshot, preFixTemplate);
    expect(main(root)).toBe(3);
  });

  it("main() against THIS worktree's own real repo root (no injected repoRoot) does not throw and exits 0 (no .lore/config.yaml here — untracked, per-worktree state)", () => {
    expect(main()).toBe(0);
  });
});

// ─── AC-GD-1 fresh-install clause: resolver AND field paths pinned ────────

describe("AC-GD-1 fresh-install clause: a genuinely fresh corpus materialises 1200000 / 80000 via the REAL resolution consumers, never THIS repo's own config", () => {
  it(
    "mkdtemp -> lore init -> lore setup --project -> loadConfig(dir) from @lore/core/node, read through " +
      "resolveCaptureTimeoutMs and the SAME config?.ai ?? AiConfigSchema.parse({}) pattern createApp uses",
    () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "check-shipped-defaults-fresh-install-"));
      activeTmpDirs.push(tmpDir);

      // git init first: `lore setup --project` writes core.hooksPath, which needs a
      // git working tree to succeed cleanly — without it the command still scaffolds
      // config.yaml but exits 1 on the unrelated git step, which would make an exit-code
      // assertion here flaky/misleading. A real fresh project IS normally a git repo.
      const gitInit = spawnSync("git", ["init", "-q"], { cwd: tmpDir, encoding: "utf8", timeout: 10_000 });
      expect(gitInit.status).toBe(0);

      const initResult = spawnSync("bun", ["run", LORE_ENTRY, "init"], {
        cwd: tmpDir,
        encoding: "utf8",
        timeout: 20_000,
        env: { ...process.env, CLAUDECODE: "1" },
      });
      expect(initResult.status).toBe(0);

      const setupResult = spawnSync("bun", ["run", LORE_ENTRY, "setup", "--project", "--yes"], {
        cwd: tmpDir,
        encoding: "utf8",
        timeout: 20_000,
        env: { ...process.env, CLAUDECODE: "1" },
      });
      expect(setupResult.status).toBe(0);

      // ⛔ MEASURED 2026-08-11: `lore status --json` does NOT surface either field (an
      // earlier spec draft named it and left this clause with no runnable oracle at
      // all) — `loadConfig` is the entry point server code itself calls.
      const loaded = loadConfig(tmpDir);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) throw new Error("unreachable — asserted above");

      // ⛔ MEASURED 2026-08-11: a fresh corpus's config.yaml carries NO `workflow:` key
      // at all (the template does not seed it, and lore init never writes it), so
      // `loaded.value.workflow` is `undefined` — reading `value.workflow.evidence.
      // capture_timeout_ms` directly would THROW on this exact tree, never merely
      // fail an equality check. `resolveCaptureTimeoutMs` is the REAL per-key
      // resolution seam production code calls (`packages/lore/src/adapters/
      // evidence-capture.ts`, `adapters/cli/commands/evidence.ts`,
      // `adapters/mcp/tools.ts`) — calling it here exercises that resolution, it does
      // not re-derive the merge by hand.
      expect(resolveCaptureTimeoutMs(loaded.value)).toBe(1_200_000);

      // Same shape for ai.assess.max_diff_chars: `loaded.value.ai` is also `undefined`
      // on a fresh corpus (no `ai:` key seeded). `config?.ai ?? AiConfigSchema.parse({})`
      // is the EXACT expression `createApp` (packages/lore/src/app.ts) evaluates to
      // build `aiConfig` before constructing `AIProviderService` — reusing it here
      // calls the same Zod defaulting the real consumer calls, not a hand-rebuilt merge.
      const effectiveAi = loaded.value.ai ?? AiConfigSchema.parse({});
      expect(effectiveAi.assess.max_diff_chars).toBe(80_000);
    },
  );

  it("REGRESSION control: reading the pinned (but unrunnable) literal field path workflow.gates.capture_timeout_ms would be undefined on this exact fresh tree — proves the corrected path above is not interchangeable prose", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "check-shipped-defaults-fresh-install-control-"));
    activeTmpDirs.push(tmpDir);
    spawnSync("git", ["init", "-q"], { cwd: tmpDir, encoding: "utf8", timeout: 10_000 });
    spawnSync("bun", ["run", LORE_ENTRY, "init"], { cwd: tmpDir, encoding: "utf8", timeout: 20_000, env: { ...process.env, CLAUDECODE: "1" } });
    spawnSync("bun", ["run", LORE_ENTRY, "setup", "--project", "--yes"], { cwd: tmpDir, encoding: "utf8", timeout: 20_000, env: { ...process.env, CLAUDECODE: "1" } });

    const loaded = loadConfig(tmpDir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("unreachable — asserted above");

    // `workflow` itself is `undefined` on this fresh tree — `workflow.gates` (the
    // literally-pinned-but-wrong field path) is unreachable via optional chaining,
    // never mind the WRONG field name (the real leaf lives at `workflow.evidence.*`,
    // not `workflow.gates.*` — `gates` is a per-checkpoint map keyed by checkpoint
    // NAME, e.g. "task-claim", and has no `capture_timeout_ms` field at any key).
    // (`lore setup --project` now seeds a `workflow:` section, so the section itself is
    // no longer undefined; the literal pinned path is still unreachable.)
    const gates: Record<string, unknown> | undefined = loaded.value.workflow?.gates;
    expect(gates?.capture_timeout_ms).toBeUndefined();
  });
});

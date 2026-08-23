/**
 * RED-phase tests for AC-GRAM-1 of
 * `spec-claude-md-governance-content-dimension-checks-wire-the` (N4: the
 * reference-grammar repair — the paired implementation task is a sibling in
 * the same plan/phase). Pure unit suite: it calls `checkReferenceExistence`
 * directly (AC-GRAM-1 is explicitly EXEMPTED from the spec's "every wiring
 * AC drives the CLI subprocess" binding — it is a unit-level grammar
 * assertion, not a wiring assertion).
 *
 * RED baseline, measured empirically against this worktree before writing
 * this file (see the probe reproduced in the module below): running
 * TODAY's `checkReferenceExistence` over this repo's ten real memory files
 * (root CLAUDE.md + nine module CLAUDE.md files, discovered via the real
 * `discoverMemoryFiles`) with a real-filesystem `fileExists` yields 101
 * `reference_missing` findings, dozens of which are exactly the five
 * measured false-positive classes this spec exists to exclude — e.g. root
 * CLAUDE.md alone reports `@lore/core`, `@libsql/client`, `hooks/**`,
 * `assets/**`, `~/.claude/`, `docs/requirements/{prd,spec,adr,knowledge,
 * plan,task}/`, `@core/*`, `@store/*`, `@service/*`, `@adapters/*`. None of
 * the five classes are excluded today; `MemoryFileRole` module-relative
 * candidates like `commands/set.ts` (measured in
 * `adapters/cli/CLAUDE.md`, the spec's OWN worked example) are checked
 * against the repo root, not the file's own directory, so they report a
 * false dangling reference despite `packages/lore/src/adapters/cli/
 * commands/set.ts` genuinely existing.
 *
 * ⛔ Module-relative resolution requires the SCANNED FILE's own directory —
 * information TODAY's 2-parameter `checkReferenceExistence(content,
 * fileExists)` has no way to receive. This suite exercises a THIRD,
 * OPTIONAL parameter (`filePath` — the file's own repo-relative path, the
 * same value `MemoryFileRecord.path` already carries) that the grammar
 * repair must add for module-relative resolution to be possible at all.
 * `checkReferenceExistence` is loaded via a non-literal dynamic `import()`
 * specifier (mirrors `claude-md-admission.test.ts`'s established dodge) so
 * this suite's own 3-arg calls (typed against the ADDED param, per this
 * file's local `CheckReferenceExistenceFn`) never fight `tsc --noEmit` over
 * an argument-count mismatch against TODAY's real 2-arg export — at runtime
 * a plain JS function silently ignores a 3rd argument it doesn't declare,
 * which is exactly the correct RED failure mode here (the resolution never
 * happens, not a thrown arity error).
 *
 * Coverage dimensions: HAPPY (all four exclude classes silent AND a
 * genuinely dangling path still reported, combined in one fixture —
 * defeats a blanket "exclude everything" cheat) / NEGATIVE (each of the
 * four exclude classes tested in isolation; the task's pinned non-path
 * noise — command/verb enumerations, code fragments — also silent) /
 * BOUNDARY (module-relative resolution succeeds only against the file's
 * OWN directory, not the repo root; a module-relative candidate missing
 * everywhere is still reported) / ERROR (empty content never throws; a
 * `..`-escaping candidate is silently skipped per the existing SPEC-042
 * normalization contract) / STATE (the combined fixture proves classes and
 * the genuine control coexist in one scan without cross-contaminating each
 * other's verdict) / REGRESSION (a real-repo sweep: none of the four
 * exclude-class token shapes remain in `reference_missing` findings across
 * all ten real memory files; the AC's own worked example, `commands/set.ts`
 * in `adapters/cli/CLAUDE.md`, stops being reported once resolved against
 * its own directory).
 *
 * @spec_ref spec-claude-md-governance-content-dimension-checks-wire-the
 * @ac_ref AC-GRAM-1
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { discoverMemoryFiles } from "../../../src/adapters/real-memory-file-probe.js";

// ─── Local type for the NOT-YET-EXISTING 3-arg signature ───────────────────
//
// Deliberately loose (`[key: string]: unknown`) — this suite pins the
// behavioral contract (kind/path/reference/message-shape), NOT the
// implementer's exact extra fields.

interface ReferenceMissingFindingLike {
  kind: string;
  path?: string;
  reference?: string;
  message: string;
  [key: string]: unknown;
}

type CheckReferenceExistenceFn = (
  content: string,
  fileExists: (p: string) => boolean,
  /**
   * The scanned file's own repo-relative path (e.g.
   * `"packages/lore/src/adapters/cli/CLAUDE.md"`) — the same value
   * `MemoryFileRecord.path` already carries. OPTIONAL, backward-compatible:
   * this is the third parameter N4's module-relative resolution rule
   * requires and TODAY's real export does not declare.
   */
  filePath?: string,
) => ReferenceMissingFindingLike[];

/**
 * Loads `checkReferenceExistence` via a NON-LITERAL dynamic import
 * specifier — see the module header for why: this suite's local
 * `CheckReferenceExistenceFn` type declares a 3rd param the real export
 * does not, and a literal static import would make every 3-arg call in
 * this file a `tsc --noEmit` argument-count error against the REAL type.
 * The dynamic import resolves to `any`, so this file's own cast to
 * {@link CheckReferenceExistenceFn} is what the compiler checks calls
 * against — never the real (narrower) exported type.
 */
async function loadCheckReferenceExistence(): Promise<CheckReferenceExistenceFn> {
  const modulePathParts = ["..", "..", "..", "src", "service", "claude-md-admission.js"];
  const modulePath = modulePathParts.join("/");
  const mod = (await import(modulePath)) as { checkReferenceExistence: CheckReferenceExistenceFn };
  return mod.checkReferenceExistence;
}

/** A `fileExists` stand-in that reports every path as absent — worst case for exclusion tests. */
const NOTHING_EXISTS = (): boolean => false;

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

describe("reference grammar — five exclusion classes with a genuine-dangling control", () => {
  // ── Class 1: npm scope names + retired path aliases ──────────────────────

  it("NEGATIVE: excludes npm scope names measured in this repo's own memory files (@lore/core, @libsql/client, @lore/core/node, @lore/dashboard)", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const content =
      "Depends on `@lore/core`, `@libsql/client`, `@lore/core/node`, and `@lore/dashboard`.\n";

    const findings = checkReferenceExistence(content, NOTHING_EXISTS);

    expect(findings).toEqual([]);
  });

  it("NEGATIVE: excludes retired path aliases measured in this repo's own memory files (@core/*, @store/*, @service/*, @adapters/*)", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const content = "Retired aliases: `@core/*`, `@store/*`, `@service/*`, `@adapters/*`.\n";

    const findings = checkReferenceExistence(content, NOTHING_EXISTS);

    expect(findings).toEqual([]);
  });

  // ── Class 2: glob metacharacters ──────────────────────────────────────────

  it("NEGATIVE: excludes glob-metacharacter paths measured in this repo's own memory files (hooks/**, assets/**, packages/lore/**, scripts/**)", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const content = "Closed for `hooks/**`, `assets/**`, `packages/lore/**`, and `scripts/**`.\n";

    const findings = checkReferenceExistence(content, NOTHING_EXISTS);

    expect(findings).toEqual([]);
  });

  // ── Class 3: brace expansion ──────────────────────────────────────────────

  it("NEGATIVE: excludes a brace-expansion path measured in this repo's own memory files (docs/requirements/{prd,spec,adr,knowledge,plan,task}/)", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const content = "Mirrors live under `docs/requirements/{prd,spec,adr,knowledge,plan,task}/`.\n";

    const findings = checkReferenceExistence(content, NOTHING_EXISTS);

    expect(findings).toEqual([]);
  });

  // ── Class 4: tilde home paths ─────────────────────────────────────────────

  it("NEGATIVE: excludes tilde home paths measured in this repo's own memory files (~/.claude/, ~/.claude/docman-mcp)", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const content = "See `~/.claude/` and the frozen `~/.claude/docman-mcp` predecessor.\n";

    const findings = checkReferenceExistence(content, NOTHING_EXISTS);

    expect(findings).toEqual([]);
  });

  // ── Class 5: module-relative path resolution ──────────────────────────────

  it("BOUNDARY: resolves a module-relative candidate against the scanned file's own directory (the AC's own worked example: commands/set.ts inside adapters/cli/CLAUDE.md)", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const content = "Every subcommand lives in its own `commands/<name>.ts`, e.g. `commands/set.ts`.\n";
    const resolvedRepoPath = "packages/lore/src/adapters/cli/commands/set.ts";
    // Exists ONLY at the module-relative resolved location — a repo-root-relative
    // check for the bare "commands/set.ts" would report this as absent.
    const fileExists = (p: string): boolean => p === resolvedRepoPath;

    const findings = checkReferenceExistence(
      content,
      fileExists,
      "packages/lore/src/adapters/cli/CLAUDE.md",
    );

    expect(findings).toEqual([]);
  });

  it("NEGATIVE: still reports a module-relative candidate that is missing from both the repo root AND its own directory (module-relative resolution is not a blanket exclusion)", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const content = "See `commands/definitely-nonexistent-xyz.ts` for the implementation.\n";

    const findings = checkReferenceExistence(
      content,
      NOTHING_EXISTS,
      "packages/lore/src/adapters/cli/CLAUDE.md",
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.reference).toBe("commands/definitely-nonexistent-xyz.ts");
  });

  // ── Non-path noise pinned by the task (not one of the five classes, but
  // measured false-positive noise in real module docs that must not
  // reappear) ────────────────────────────────────────────────────────────

  it("NEGATIVE: does not treat backtick-quoted subcommand/verb enumerations as path candidates (add/list/rm/rename, status/checklist/track, lore_create/get/set/search/list/tree/link/pending/approve)", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const content =
      "`add/list/rm/rename` — plan-level verbs.\n" +
      "`status/checklist/track` — phase-document verbs.\n" +
      "`lore_create/get/set/search/list/tree/link/pending/approve` — MCP tool names.\n";

    const findings = checkReferenceExistence(content, NOTHING_EXISTS);

    expect(findings).toEqual([]);
  });

  it("NEGATIVE: does not treat backtick-quoted code fragments as path candidates (<Skeleton/>, Path=/api, )/, $XDG_STATE_HOME/lore)", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const content = "`<Skeleton/>`\n`Path=/api`\n`)/`\n`$XDG_STATE_HOME/lore`\n";

    const findings = checkReferenceExistence(content, NOTHING_EXISTS);

    expect(findings).toEqual([]);
  });

  // ── Positive control — the discriminating case that a blanket
  // "exclude everything" implementation cannot satisfy ──────────────────────

  it("HAPPY + STATE: reports EXACTLY the genuinely dangling path when every excluded-class token appears in the SAME content (defeats a blanket exclude-everything implementation)", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const genuineDanglingPath = "packages/lore/src/service/this-file-genuinely-does-not-exist-control.ts";
    const content = [
      "npm scope names: `@lore/core`, `@libsql/client`, `@lore/core/node`, `@lore/dashboard`.",
      "retired path aliases: `@core/*`, `@store/*`, `@service/*`, `@adapters/*`.",
      "glob metacharacters: `hooks/**`, `assets/**`, `packages/lore/**`, `scripts/**`.",
      "brace expansion: `docs/requirements/{prd,spec,adr,knowledge,plan,task}/`.",
      "tilde home paths: `~/.claude/`, `~/.claude/docman-mcp`.",
      `See \`${genuineDanglingPath}\` for details.`,
    ].join("\n");

    const findings = checkReferenceExistence(content, NOTHING_EXISTS);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe(genuineDanglingPath);
  });

  // ── ERROR handling ─────────────────────────────────────────────────────────

  it("ERROR: empty content never throws and returns an empty array", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();

    const findings = checkReferenceExistence("", NOTHING_EXISTS);

    expect(findings).toEqual([]);
  });

  it("ERROR (REGRESSION of existing behavior): a candidate that fails SPEC-042 normalization (a `..`-escaping segment) is silently skipped, not reported", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const content = "See `../escape/outside-repo.ts` for the mechanism.\n";

    const findings = checkReferenceExistence(content, NOTHING_EXISTS);

    expect(findings).toEqual([]);
  });

  // ── REGRESSION — real-repo sweep ───────────────────────────────────────────
  //
  // Deliberately NOT "zero findings total": this repo's real memory files
  // carry a small number of genuinely unresolvable cross-module prose
  // references (measured 2026-08-23 — e.g. `core/` in
  // `packages/lore/src/eval/CLAUDE.md` means `packages/core/`, not a child
  // of `eval/`'s own directory) that module-relative resolution cannot and
  // should not paper over ("misses acceptable, false alarms not" — this
  // module's own stated risk posture). What must be a hard zero is the
  // FOUR EXCLUDE-CLASS SHAPES themselves (npm-scope-like, glob
  // metacharacter, brace expansion, tilde home path) — asserting THAT is a
  // real-world-scale, environment-independent measurement of the fix
  // (never depends on build artifacts like `dist/lore`, which exists in a
  // built checkout but not in a bare worktree).

  it("REGRESSION: none of the four excluded-pattern-class token shapes remain in reference_missing findings across every real memory file in this repo", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const files = discoverMemoryFiles(REPO_ROOT, ["CLAUDE.md"]);
    // Sanity: the sweep actually walked the repo's real memory files (root +
    // nine module docs, measured 2026-08-23) — a broken fixture returning []
    // would otherwise make every assertion below vacuously true.
    expect(files.length).toBeGreaterThanOrEqual(10);

    const classifiers: ReadonlyArray<{ name: string; test: (ref: string) => boolean }> = [
      { name: "npm scope name / retired path alias (starts with @)", test: (r) => r.startsWith("@") },
      { name: "glob metacharacter (contains *)", test: (r) => r.includes("*") },
      { name: "brace expansion (contains { or })", test: (r) => r.includes("{") || r.includes("}") },
      { name: "tilde home path (starts with ~)", test: (r) => r.startsWith("~") },
    ];

    const offenders: Array<{ file: string; reference: string; class: string }> = [];
    for (const file of files) {
      const findings = checkReferenceExistence(
        file.content,
        (p) => existsSync(join(REPO_ROOT, p)),
        file.path,
      );
      for (const finding of findings) {
        const ref = finding.reference ?? "";
        for (const classifier of classifiers) {
          if (classifier.test(ref)) offenders.push({ file: file.path, reference: ref, class: classifier.name });
        }
      }
    }

    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);
  });

  it("REGRESSION: the AC's own worked example (commands/set.ts in adapters/cli/CLAUDE.md) is no longer reported once resolved against its own directory", async () => {
    const checkReferenceExistence = await loadCheckReferenceExistence();
    const files = discoverMemoryFiles(REPO_ROOT, ["CLAUDE.md"]);
    const cliDoc = files.find((f) => f.path === "packages/lore/src/adapters/cli/CLAUDE.md");

    expect(cliDoc, "adapters/cli/CLAUDE.md not discovered — sweep fixture broken").toBeDefined();
    expect(
      (cliDoc as { content: string }).content,
      "adapters/cli/CLAUDE.md no longer references `commands/set.ts` — update this pinned regression case",
    ).toContain("`commands/set.ts`");

    const findings = checkReferenceExistence(
      (cliDoc as { content: string }).content,
      (p) => existsSync(join(REPO_ROOT, p)),
      (cliDoc as { path: string }).path,
    );

    const stillReported = findings.some((f) => f.reference === "commands/set.ts");
    expect(stillReported).toBe(false);
  });
});

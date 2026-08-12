/**
 * Unit tests for `resolveCorpusProvenance` (AC-CP-1,
 * spec-corpus-resolution-carries-provenance-and-a-foreign-write §Design D1/D2).
 *
 * The oracle measures the MODULE under test, not this test file: the second
 * describe block below statically walks `corpus-provenance.ts`'s own
 * transitive import graph (never this file's imports, which prove nothing
 * about the module) and asserts it never reaches a `fs`/`path`/`os`/
 * `child_process`/`node:*` builtin specifier, and never calls
 * `process.exit`/`process.cwd` anywhere in that graph.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-CP-1
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCorpusProvenance } from "../src/corpus-provenance.js";
import type { CorpusProvenanceGitFacts } from "../src/corpus-provenance.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = resolvePath(HERE, "..", "src");
const RESOLVER_MODULE_PATH = resolvePath(CORE_SRC, "corpus-provenance.ts");

/** Default fact set — every case below overrides only what it needs. */
function facts(overrides: Partial<CorpusProvenanceGitFacts>): CorpusProvenanceGitFacts {
  return {
    callerTreeRoot: "/repo",
    resolved: true,
    isLinkedWorktree: false,
    mainCheckoutRoot: null,
    ...overrides,
  };
}

// ─── AC-CP-1 row (a) — HAPPY ────────────────────────────────────────────────

describe("HAPPY — row (a): own", () => {
  it("finds .lore/lore.db at or above cwd, still inside the caller worktree root", () => {
    const result = resolveCorpusProvenance({
      cwd: "/repo/packages/lore/src",
      probeExists: (p) => p === "/repo/.lore/lore.db",
      gitFacts: facts({ callerTreeRoot: "/repo" }),
    });
    expect(result).toEqual({ path: "/repo/.lore/lore.db", provenance: "own" });
  });

  it("walks multiple ancestor levels, not just cwd itself", () => {
    const result = resolveCorpusProvenance({
      cwd: "/repo/packages/lore/src/adapters/cli",
      probeExists: (p) => p === "/repo/.lore/lore.db",
      gitFacts: facts({ callerTreeRoot: "/repo" }),
    });
    expect(result).toEqual({ path: "/repo/.lore/lore.db", provenance: "own" });
  });
});

// ─── AC-CP-1 row (b) — git_common_dir ───────────────────────────────────────

describe("row (b): git_common_dir", () => {
  it("no hit inside the worktree, resolved+isLinkedWorktree true, corpus found under the main-checkout root", () => {
    const result = resolveCorpusProvenance({
      cwd: "/repo/.claude/worktrees/agent-x",
      probeExists: (p) => p === "/main-checkout/.lore/lore.db",
      gitFacts: facts({
        callerTreeRoot: "/repo/.claude/worktrees/agent-x",
        resolved: true,
        isLinkedWorktree: true,
        mainCheckoutRoot: "/main-checkout",
      }),
    });
    expect(result).toEqual({ path: "/main-checkout/.lore/lore.db", provenance: "git_common_dir" });
  });
});

// ─── AC-CP-1 row (c) — ERROR (unresolved git probe) ────────────────────────

describe("ERROR — row (c): undetermined", () => {
  it("no hit inside the worktree and gitFacts.resolved is false yields undetermined, never a guessed crossing", () => {
    const result = resolveCorpusProvenance({
      cwd: "/repo/.claude/worktrees/agent-x",
      probeExists: () => false,
      gitFacts: facts({
        callerTreeRoot: "/repo/.claude/worktrees/agent-x",
        resolved: false,
        // Stale/leftover values from a failed probe — resolved: false MUST win
        // regardless of what these carry (mirrors resolveVerifyExecutionRoot's
        // own NEGATIVE case).
        isLinkedWorktree: true,
        mainCheckoutRoot: "/main-checkout",
      }),
    });
    expect(result).toEqual({ path: "/repo/.claude/worktrees/agent-x", provenance: "undetermined" });
  });

  it("never picks own or git_common_dir when unresolved, even if the main-checkout corpus would have been found", () => {
    const result = resolveCorpusProvenance({
      cwd: "/repo/.claude/worktrees/agent-x",
      // A probe that WOULD find the main-checkout corpus if consulted -- but an
      // unresolved probe must never reach for it.
      probeExists: (p) => p === "/main-checkout/.lore/lore.db",
      gitFacts: facts({
        callerTreeRoot: "/repo/.claude/worktrees/agent-x",
        resolved: false,
        isLinkedWorktree: true,
        mainCheckoutRoot: "/main-checkout",
      }),
    });
    expect(result?.provenance).toBe("undetermined");
  });
});

// ─── AC-CP-1 row (d) — NEGATIVE ─────────────────────────────────────────────

describe("NEGATIVE — row (d): undefined", () => {
  it("(d1) no hit inside the worktree, resolved true, isLinkedWorktree false — no legitimate crossing route", () => {
    const result = resolveCorpusProvenance({
      cwd: "/repo/src",
      probeExists: () => false,
      gitFacts: facts({ callerTreeRoot: "/repo", resolved: true, isLinkedWorktree: false }),
    });
    expect(result).toBeUndefined();
  });

  it("(d2) resolved+isLinkedWorktree true but the common-dir corpus is absent", () => {
    const result = resolveCorpusProvenance({
      cwd: "/repo/.claude/worktrees/agent-x",
      probeExists: () => false,
      gitFacts: facts({
        callerTreeRoot: "/repo/.claude/worktrees/agent-x",
        resolved: true,
        isLinkedWorktree: true,
        mainCheckoutRoot: "/main-checkout",
      }),
    });
    expect(result).toBeUndefined();
  });

  it("(d3) mainCheckoutRoot null despite isLinkedWorktree true — inconsistent fact set never guessed", () => {
    const result = resolveCorpusProvenance({
      cwd: "/repo/.claude/worktrees/agent-x",
      // No own hit anywhere in [cwd, callerTreeRoot]; mainCheckoutRoot is null so
      // the crossing candidate can never even be COMPUTED, regardless of what
      // probeExists would have said about it.
      probeExists: () => false,
      gitFacts: facts({
        callerTreeRoot: "/repo/.claude/worktrees/agent-x",
        resolved: true,
        isLinkedWorktree: true,
        mainCheckoutRoot: null,
      }),
    });
    expect(result).toBeUndefined();
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY", () => {
  it("cwd exactly equal to callerTreeRoot — the walk still checks the boundary itself, not just above it", () => {
    const result = resolveCorpusProvenance({
      cwd: "/repo",
      probeExists: (p) => p === "/repo/.lore/lore.db",
      gitFacts: facts({ callerTreeRoot: "/repo" }),
    });
    expect(result).toEqual({ path: "/repo/.lore/lore.db", provenance: "own" });
  });

  it("a hit exactly AT the boundary in a linked worktree still resolves own, never crossing", () => {
    const result = resolveCorpusProvenance({
      cwd: "/repo/.claude/worktrees/agent-x/deep/nested/dir",
      probeExists: (p) => p === "/repo/.claude/worktrees/agent-x/.lore/lore.db",
      gitFacts: facts({
        callerTreeRoot: "/repo/.claude/worktrees/agent-x",
        resolved: true,
        isLinkedWorktree: true,
        mainCheckoutRoot: "/repo",
      }),
    });
    expect(result).toEqual({
      path: "/repo/.claude/worktrees/agent-x/.lore/lore.db",
      provenance: "own",
    });
  });

  it("cwd outside its own claimed callerTreeRoot (inconsistent facts) never guesses own, falls through to the resolved/crossing checks", () => {
    const result = resolveCorpusProvenance({
      cwd: "/unrelated/dir",
      probeExists: () => false,
      gitFacts: facts({ callerTreeRoot: "/repo", resolved: true, isLinkedWorktree: false }),
    });
    expect(result).toBeUndefined();
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("STATE — identical cwd/probeExists resolve differently purely based on gitFacts", () => {
  it("flips from own to git_common_dir to undetermined to undefined as gitFacts change, cwd/corpus layout held fixed", () => {
    const cwd = "/repo/.claude/worktrees/agent-x";
    const probeExists = (p: string): boolean =>
      p === "/repo/.claude/worktrees/agent-x/.lore/lore.db" || p === "/main-checkout/.lore/lore.db";

    // own: the worktree DOES have its own .lore/lore.db
    const asOwn = resolveCorpusProvenance({
      cwd,
      probeExists,
      gitFacts: facts({ callerTreeRoot: cwd, resolved: true, isLinkedWorktree: true, mainCheckoutRoot: "/main-checkout" }),
    });
    expect(asOwn?.provenance).toBe("own");

    // Same cwd/corpus layout, but now the worktree's OWN candidate is absent —
    // isolate a fresh probeExists that only knows the main-checkout corpus.
    const probeExistsNoOwn = (p: string): boolean => p === "/main-checkout/.lore/lore.db";

    const asCrossed = resolveCorpusProvenance({
      cwd,
      probeExists: probeExistsNoOwn,
      gitFacts: facts({ callerTreeRoot: cwd, resolved: true, isLinkedWorktree: true, mainCheckoutRoot: "/main-checkout" }),
    });
    expect(asCrossed?.provenance).toBe("git_common_dir");

    const asUndetermined = resolveCorpusProvenance({
      cwd,
      probeExists: probeExistsNoOwn,
      gitFacts: facts({ callerTreeRoot: cwd, resolved: false, isLinkedWorktree: true, mainCheckoutRoot: "/main-checkout" }),
    });
    expect(asUndetermined?.provenance).toBe("undetermined");

    const asNothing = resolveCorpusProvenance({
      cwd,
      probeExists: () => false,
      gitFacts: facts({ callerTreeRoot: cwd, resolved: true, isLinkedWorktree: true, mainCheckoutRoot: "/main-checkout" }),
    });
    expect(asNothing).toBeUndefined();
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — ordinary main-checkout caller with no corpus anywhere", () => {
  it("resolved true, isLinkedWorktree false, no corpus found -- returns exactly undefined, no object at all", () => {
    const result = resolveCorpusProvenance({
      cwd: "/some/repo/src",
      probeExists: () => false,
      gitFacts: facts({ callerTreeRoot: "/some/repo", resolved: true, isLinkedWorktree: false, mainCheckoutRoot: null }),
    });
    expect(result).toBeUndefined();
  });
});

// ─── CONTROL — a resolver that always answers "undetermined" must go RED ───

describe("CONTROL", () => {
  it("rows (a), (b) and (d) all return a DEFINITE (non-undetermined) answer", () => {
    const own = resolveCorpusProvenance({
      cwd: "/repo/packages/lore/src",
      probeExists: (p) => p === "/repo/.lore/lore.db",
      gitFacts: facts({ callerTreeRoot: "/repo" }),
    });
    expect(own).not.toBeUndefined();
    expect(own?.provenance).not.toBe("undetermined");
    expect(own?.provenance).toBe("own");

    const crossed = resolveCorpusProvenance({
      cwd: "/repo/.claude/worktrees/agent-x",
      probeExists: (p) => p === "/main-checkout/.lore/lore.db",
      gitFacts: facts({
        callerTreeRoot: "/repo/.claude/worktrees/agent-x",
        resolved: true,
        isLinkedWorktree: true,
        mainCheckoutRoot: "/main-checkout",
      }),
    });
    expect(crossed).not.toBeUndefined();
    expect(crossed?.provenance).not.toBe("undetermined");
    expect(crossed?.provenance).toBe("git_common_dir");

    const nothing = resolveCorpusProvenance({
      cwd: "/repo/src",
      probeExists: () => false,
      gitFacts: facts({ callerTreeRoot: "/repo", resolved: true, isLinkedWorktree: false }),
    });
    // A resolver that always answers "undetermined" would fail this: `undefined`
    // has no `.provenance` field to even be "undetermined" -- it is a DIFFERENT,
    // definite answer (absence of any corpus at all), not the indefinite one.
    expect(nothing).toBeUndefined();
  });
});

// ─── PURITY ORACLE — walks the RESOLVER MODULE's own import graph ──────────

/**
 * Strips `/* ... *\/` block comments and `// ...` line comments before
 * scanning — WITHOUT this, `corpus-provenance.ts`'s own JSDoc module header
 * (which quotes `process.exit()`/`process.cwd()` and `fs`/`path`/`os`/
 * `child_process` in PROSE, describing what the module must NOT do) would
 * trip this very census against comment text rather than real code.
 */
function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Matches any `import`/`export ... from "<specifier>"` clause, capturing the specifier. */
const FROM_CLAUSE_RE = /(?:import|export)[^;]*?from\s+["']([^"']+)["']/g;

/** Matches a dynamic `import("<specifier>")` call. */
const DYNAMIC_IMPORT_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** The exact builtin-specifier set this module must never reach (AC-CP-1's PURITY ORACLE). */
const FORBIDDEN_BUILTIN_SPECIFIER_RE = /^(node:.+|fs|path|os|child_process)$/;

function collectImportSpecifiers(source: string): string[] {
  const stripped = stripComments(source);
  const specifiers: string[] = [];
  for (const match of stripped.matchAll(FROM_CLAUSE_RE)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  for (const match of stripped.matchAll(DYNAMIC_IMPORT_RE)) {
    if (match[1] !== undefined) specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveRelativeModule(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const withoutExtension = specifier.endsWith(".js") ? specifier.slice(0, -3) : specifier;
  return `${resolvePath(dirname(fromFile), withoutExtension)}.ts`;
}

/**
 * BFS over `entry`'s transitive relative-import closure (`./`/`../` imports
 * only — a Node builtin can only ever be reached from this graph via a
 * literal specifier, never through an intermediate bare package import).
 *
 * @returns file path -> raw source text, for EVERY visited module (including `entry`).
 */
function walkImportGraph(entry: string): Map<string, string> {
  const visited = new Map<string, string>();
  const queue: string[] = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || visited.has(file)) continue;
    const source = readFileSync(file, "utf8");
    visited.set(file, source);

    for (const specifier of collectImportSpecifiers(source)) {
      const resolved = resolveRelativeModule(file, specifier);
      if (resolved !== null && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return visited;
}

describe("PURITY ORACLE — corpus-provenance.ts's own transitive import graph", () => {
  it("reaches zero fs/path/os/child_process/node: builtin specifiers, with a positive visited-module count", () => {
    const visited = walkImportGraph(RESOLVER_MODULE_PATH);

    // A traversal that visited nothing cannot pass -- assert a POSITIVE count.
    expect(visited.size).toBeGreaterThan(0);

    const offenders: Array<{ file: string; specifier: string }> = [];
    for (const [file, source] of visited) {
      for (const specifier of collectImportSpecifiers(source)) {
        if (FORBIDDEN_BUILTIN_SPECIFIER_RE.test(specifier)) {
          offenders.push({ file, specifier });
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("contains zero process.exit and zero process.cwd occurrences anywhere in that graph", () => {
    const visited = walkImportGraph(RESOLVER_MODULE_PATH);
    expect(visited.size).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const [file, source] of visited) {
      const stripped = stripComments(source);
      if (/process\s*\.\s*exit\s*\(/.test(stripped)) offenders.push(`${file}: process.exit(`);
      if (/process\s*\.\s*cwd\s*\(/.test(stripped)) offenders.push(`${file}: process.cwd(`);
    }
    expect(offenders).toEqual([]);
  });

  it("NEGATIVE (self-check): the builtin-specifier detector actually fires on a known offending specifier", () => {
    const offending = collectImportSpecifiers('import { existsSync } from "node:fs";\nimport { z } from "zod";');
    const flagged = offending.filter((s) => FORBIDDEN_BUILTIN_SPECIFIER_RE.test(s));
    expect(flagged).toEqual(["node:fs"]);
  });

  it("NEGATIVE (self-check): the process.exit/cwd detector fires on real occurrences and ignores prose in comments", () => {
    const source = [
      "/** This module must never call process.exit() or process.cwd(). */",
      "export function real() {",
      "  return process.exit(1);",
      "}",
    ].join("\n");
    const stripped = stripComments(source);
    expect(/process\s*\.\s*exit\s*\(/.test(stripped)).toBe(true);
    // The comment-only mention of process.cwd() must NOT survive stripping.
    expect(/process\s*\.\s*cwd\s*\(/.test(stripped)).toBe(false);
  });
});

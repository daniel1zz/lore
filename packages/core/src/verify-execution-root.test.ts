/**
 * Unit tests for `resolveVerifyExecutionRoot` (SPEC-063 §Design Decisions D1).
 *
 * The bug this closes: `VerifyRunnerService`'s `config.repoRoot` was always
 * the CORPUS root (`dirname(dirname(dbPath))`) — a linked git worktree carries
 * no `.lore/` of its own, so `findLoreDbPath` always resolves the corpus in
 * the main checkout, even when the caller is standing inside a worktree. This
 * resolver is the pure decision layer that fixes it: given already-resolved
 * git facts (never probed here — that's the CLI adapter's job), decide
 * whether AC commands should spawn from the worktree instead.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-063-1
 */

import { describe, it, expect } from "vitest";
import { resolveVerifyExecutionRoot } from "./verify-execution-root.js";
import type { VerifyGitFacts, ResolveVerifyExecutionRootInput } from "./verify-execution-root.js";

const CORPUS_ROOT = "/repo";

function facts(overrides: Partial<VerifyGitFacts>): VerifyGitFacts {
  return { resolved: true, isLinkedWorktree: false, worktreeRoot: null, ...overrides };
}

// ─── AC-063-1 — table-driven, ≥6 cases ─────────────────────────────────────

describe("AC-063-1 — resolveVerifyExecutionRoot table-driven cases", () => {
  const cases: Array<{
    name: string;
    input: ResolveVerifyExecutionRootInput;
    expectedRoot: string;
    expectedMode: "corpus_root" | "worktree";
    expectWarning: boolean;
  }> = [
    {
      name: "main checkout, not a linked worktree at all",
      input: {
        corpusRoot: CORPUS_ROOT,
        callerCwd: CORPUS_ROOT,
        gitFacts: facts({ isLinkedWorktree: false, worktreeRoot: null }),
      },
      expectedRoot: CORPUS_ROOT,
      expectedMode: "corpus_root",
      expectWarning: false,
    },
    {
      name: "linked worktree whose root differs from corpusRoot — the SPEC-063 fix",
      input: {
        corpusRoot: CORPUS_ROOT,
        callerCwd: "/repo/.worktrees/t1",
        gitFacts: facts({ isLinkedWorktree: true, worktreeRoot: "/repo/.worktrees/t1" }),
      },
      expectedRoot: "/repo/.worktrees/t1",
      expectedMode: "worktree",
      expectWarning: false,
    },
    {
      name: "callerCwd is a NESTED path under the worktree root (still contained)",
      input: {
        corpusRoot: CORPUS_ROOT,
        callerCwd: "/repo/.worktrees/t1/packages/lore",
        gitFacts: facts({ isLinkedWorktree: true, worktreeRoot: "/repo/.worktrees/t1" }),
      },
      expectedRoot: "/repo/.worktrees/t1",
      expectedMode: "worktree",
      expectWarning: false,
    },
    {
      name: "git facts unresolved (probe failed) — fail-safe, ERROR dimension",
      input: {
        corpusRoot: CORPUS_ROOT,
        callerCwd: "/repo/.worktrees/t1",
        gitFacts: { resolved: false, isLinkedWorktree: false, worktreeRoot: null },
      },
      expectedRoot: CORPUS_ROOT,
      expectedMode: "corpus_root",
      expectWarning: true,
    },
    {
      name: "linked worktree whose root happens to EQUAL corpusRoot — degenerate, BOUNDARY",
      input: {
        corpusRoot: CORPUS_ROOT,
        callerCwd: CORPUS_ROOT,
        gitFacts: facts({ isLinkedWorktree: true, worktreeRoot: CORPUS_ROOT }),
      },
      expectedRoot: CORPUS_ROOT,
      expectedMode: "corpus_root",
      expectWarning: false,
    },
    {
      name: "isLinkedWorktree true but worktreeRoot unresolved (null) — degrades same as false",
      input: {
        corpusRoot: CORPUS_ROOT,
        callerCwd: "/repo/.worktrees/t1",
        gitFacts: facts({ isLinkedWorktree: true, worktreeRoot: null }),
      },
      expectedRoot: CORPUS_ROOT,
      expectedMode: "corpus_root",
      expectWarning: false,
    },
    {
      name: "callerCwd is OUTSIDE the reported worktree root — inconsistent facts, ERROR dimension",
      input: {
        corpusRoot: CORPUS_ROOT,
        callerCwd: "/somewhere/else",
        gitFacts: facts({ isLinkedWorktree: true, worktreeRoot: "/repo/.worktrees/t1" }),
      },
      expectedRoot: CORPUS_ROOT,
      expectedMode: "corpus_root",
      expectWarning: true,
    },
    {
      name: "trailing-slash normalization — worktreeRoot with trailing slash equals corpusRoot without one",
      input: {
        corpusRoot: CORPUS_ROOT,
        callerCwd: `${CORPUS_ROOT}/`,
        gitFacts: facts({ isLinkedWorktree: true, worktreeRoot: `${CORPUS_ROOT}/` }),
      },
      expectedRoot: CORPUS_ROOT,
      expectedMode: "corpus_root",
      expectWarning: false,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = resolveVerifyExecutionRoot(c.input);
      expect(result.root).toBe(c.expectedRoot);
      expect(result.mode).toBe(c.expectedMode);
      if (c.expectWarning) {
        expect(typeof result.warning).toBe("string");
        expect(result.warning!.length).toBeGreaterThan(0);
      } else {
        expect(result.warning).toBeUndefined();
      }
    });
  }
});

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY", () => {
  it("returns exactly {root, mode} with no warning key at all for an ordinary worktree resolution", () => {
    const result = resolveVerifyExecutionRoot({
      corpusRoot: CORPUS_ROOT,
      callerCwd: "/repo/.worktrees/t1",
      gitFacts: facts({ isLinkedWorktree: true, worktreeRoot: "/repo/.worktrees/t1" }),
    });
    expect(result).toEqual({ root: "/repo/.worktrees/t1", mode: "worktree" });
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE", () => {
  it("an unresolved probe never reports mode: worktree, regardless of the other fields' values", () => {
    const result = resolveVerifyExecutionRoot({
      corpusRoot: CORPUS_ROOT,
      callerCwd: "/repo/.worktrees/t1",
      // A probe that failed but still carries stale/leftover isLinkedWorktree/worktreeRoot
      // values from a prior attempt — resolved: false MUST win regardless.
      gitFacts: { resolved: false, isLinkedWorktree: true, worktreeRoot: "/repo/.worktrees/t1" },
    });
    expect(result.mode).toBe("corpus_root");
    expect(result.root).toBe(CORPUS_ROOT);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY — worktree root exactly equal to corpusRoot", () => {
  it("degenerate fact set (linked worktree claiming the corpus root itself) falls back to corpus_root", () => {
    const result = resolveVerifyExecutionRoot({
      corpusRoot: "/repo",
      callerCwd: "/repo",
      gitFacts: facts({ isLinkedWorktree: true, worktreeRoot: "/repo" }),
    });
    expect(result).toEqual({ root: "/repo", mode: "corpus_root" });
  });

  it("callerCwd exactly equal to worktreeRoot (not nested) still counts as contained", () => {
    const result = resolveVerifyExecutionRoot({
      corpusRoot: CORPUS_ROOT,
      callerCwd: "/repo/.worktrees/t1",
      gitFacts: facts({ isLinkedWorktree: true, worktreeRoot: "/repo/.worktrees/t1" }),
    });
    expect(result.mode).toBe("worktree");
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("ERROR — git facts missing/unavailable never guesses a worktree root", () => {
  it("gitFacts.resolved === false always yields corpus_root with an advisory warning", () => {
    const result = resolveVerifyExecutionRoot({
      corpusRoot: CORPUS_ROOT,
      callerCwd: "/anything",
      gitFacts: { resolved: false, isLinkedWorktree: false, worktreeRoot: null },
    });
    expect(result.mode).toBe("corpus_root");
    expect(result.warning).toBeDefined();
  });

  it("an internally-inconsistent fact set (callerCwd outside the claimed worktreeRoot) falls back with a warning naming both paths", () => {
    const result = resolveVerifyExecutionRoot({
      corpusRoot: CORPUS_ROOT,
      callerCwd: "/unrelated/dir",
      gitFacts: facts({ isLinkedWorktree: true, worktreeRoot: "/repo/.worktrees/t1" }),
    });
    expect(result.mode).toBe("corpus_root");
    expect(result.warning).toContain("/unrelated/dir");
    expect(result.warning).toContain("/repo/.worktrees/t1");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE — the same corpusRoot/callerCwd pair resolves differently as gitFacts change", () => {
  it("identical corpusRoot+callerCwd flip from corpus_root to worktree purely based on gitFacts", () => {
    const corpusRoot = "/repo";
    const callerCwd = "/repo/.worktrees/t1";

    const asMainCheckout = resolveVerifyExecutionRoot({
      corpusRoot,
      callerCwd,
      gitFacts: facts({ isLinkedWorktree: false, worktreeRoot: null }),
    });
    expect(asMainCheckout.mode).toBe("corpus_root");

    const asLinkedWorktree = resolveVerifyExecutionRoot({
      corpusRoot,
      callerCwd,
      gitFacts: facts({ isLinkedWorktree: true, worktreeRoot: callerCwd }),
    });
    expect(asLinkedWorktree.mode).toBe("worktree");
    expect(asLinkedWorktree.root).toBe(callerCwd);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION — main-checkout facts are byte-identical to pre-SPEC-063 behavior", () => {
  it("a plain main-checkout resolution returns exactly {root: corpusRoot, mode: 'corpus_root'}, no extra keys", () => {
    const result = resolveVerifyExecutionRoot({
      corpusRoot: "/some/repo",
      callerCwd: "/some/repo",
      gitFacts: facts({ isLinkedWorktree: false, worktreeRoot: null }),
    });
    expect(Object.keys(result).sort()).toEqual(["mode", "root"]);
    expect(result.root).toBe("/some/repo");
    expect(result.mode).toBe("corpus_root");
  });
});

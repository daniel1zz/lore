/**
 * @spec_ref task-lore-evidence-self-reported-pass-lacks-oracle-file AC-1
 *
 * Unit tests for the pure `lore evidence` missing-oracle-file precheck helpers
 * (`../../../src/adapters/cli/evidence-precheck.ts`): `extractTestFileTokens`,
 * `extractCdPrefixTarget`, and their composition `findMissingOracleFiles`.
 *
 * Pure module (no fs/bun:sqlite) — runs under vitest, not bun test.
 *
 * Six-dimension coverage:
 *   HAPPY:      single/multiple test-file tokens extracted; cd-prefix recognized;
 *               a token that exists under a candidate root is not reported missing
 *   NEGATIVE:   a command with no test-file token extracts to []; no cd-prefix → null
 *   BOUNDARY:   -t filter values never match; quoted paths strip their quotes; a
 *               cd-prefix NOT at the start of the command is not recognized; token
 *               dedup; absolute-path tokens checked as-is (no root joining)
 *   ERROR:      every candidate root fails existence → token reported missing
 *   STATE:      multiple tokens, some present some missing → only the missing ones
 *               are returned
 *   REGRESSION: no extractable token → findMissingOracleFiles never calls fileExists
 *               and always returns [] (fail-open, never blocks an unrelated command)
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import {
  extractTestFileTokens,
  extractCdPrefixTarget,
  describeDerivedCdTarget,
  describePrecheckRoots,
  findMissingOracleFiles,
  findCaptureFlagConflict,
} from "../../../src/adapters/cli/evidence-precheck.js";

// ─── extractTestFileTokens — HAPPY ──────────────────────────────────────────

describe("extractTestFileTokens — HAPPY", () => {
  it("extracts a single .test.ts path from a vitest command", () => {
    expect(
      extractTestFileTokens("bunx vitest run packages/lore/tests/foo.test.ts"),
    ).toEqual(["packages/lore/tests/foo.test.ts"]);
  });

  it("extracts multiple test-file tokens across suffix variants", () => {
    expect(
      extractTestFileTokens(
        "bunx vitest run a.test.ts b.spec.ts c.bun.test.ts d.test.tsx",
      ),
    ).toEqual(["a.test.ts", "b.spec.ts", "c.bun.test.ts", "d.test.tsx"]);
  });
});

// ─── extractTestFileTokens — NEGATIVE ───────────────────────────────────────

describe("extractTestFileTokens — NEGATIVE", () => {
  it("returns [] for a command referencing no test file", () => {
    expect(extractTestFileTokens("bun run typecheck")).toEqual([]);
  });

  it("returns [] for an empty command string", () => {
    expect(extractTestFileTokens("")).toEqual([]);
  });
});

// ─── extractTestFileTokens — BOUNDARY ───────────────────────────────────────

describe("extractTestFileTokens — BOUNDARY", () => {
  it("does not treat a -t filter value as a path token", () => {
    expect(
      extractTestFileTokens(
        'bunx vitest run -t "AC-1 happy path" packages/x.test.ts',
      ),
    ).toEqual(["packages/x.test.ts"]);
  });

  it("strips surrounding quotes from a quoted path token", () => {
    expect(
      extractTestFileTokens('bun test "packages/lore/tests/foo.bun.test.ts"'),
    ).toEqual(["packages/lore/tests/foo.bun.test.ts"]);
  });

  it("de-duplicates a token repeated in the same command", () => {
    expect(extractTestFileTokens("vitest run a.test.ts a.test.ts")).toEqual([
      "a.test.ts",
    ]);
  });
});

// ─── extractCdPrefixTarget — HAPPY ──────────────────────────────────────────

describe("extractCdPrefixTarget — HAPPY", () => {
  it("recognizes a leading `cd <dir> &&` prefix", () => {
    expect(
      extractCdPrefixTarget(
        "cd packages/lore && bun test tests/foo.bun.test.ts",
      ),
    ).toBe("packages/lore");
  });

  it("recognizes a leading `cd <dir>;` prefix", () => {
    expect(extractCdPrefixTarget("cd packages/lore; bun test x.test.ts")).toBe(
      "packages/lore",
    );
  });
});

// ─── extractCdPrefixTarget — NEGATIVE ───────────────────────────────────────

describe("extractCdPrefixTarget — NEGATIVE", () => {
  it("returns null when the command has no cd-prefix", () => {
    expect(extractCdPrefixTarget("bunx vitest run foo.test.ts")).toBeNull();
  });
});

// ─── extractCdPrefixTarget — BOUNDARY ───────────────────────────────────────

describe("extractCdPrefixTarget — BOUNDARY", () => {
  it("strips quotes from a quoted cd target", () => {
    expect(
      extractCdPrefixTarget('cd "packages/lore" && bun test x.test.ts'),
    ).toBe("packages/lore");
  });

  it("recognizes a cd that is NOT the first command in the chain", () => {
    // reason: this exact case was the defect
    // (task-evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a). The
    // pre-fix regex was anchored at `^`, so it returned null here and the
    // precheck resolved the test path against the repo root — a FALSE refusal
    // of a correct command. Do not re-anchor this at the start of the string.
    expect(
      extractCdPrefixTarget("echo hi && cd packages/lore && bun test x.test.ts"),
    ).toBe("packages/lore");
  });
});

// ─── extractCdPrefixTarget — chain scanning (task-evidence-precheck-only- ────
// ─── sees-a-cd-in-the-first-segment-of-a) ────────────────────────────────
//
// Six-dimension coverage for the multi-segment scan:
//   HAPPY:      this repo's own mandated `bun run build && cd packages/lore &&
//               bun test <e2e file>` form derives `packages/lore`
//   NEGATIVE:   a chain with no cd segment at all still derives null; a bare
//               `cd` with no target derives null; `cd` inside a quoted filter
//               value is not a cd segment
//   BOUNDARY:   two cd segments resolve to the LAST (by value); a cd AFTER the
//               test invocation is NOT applied (shell semantics); a separator
//               inside a quoted cd target does not split the segment
//   ERROR:      a `cd` segment carrying extra words (`cd a b`) is not a
//               recognized cd segment (same as pre-fix)
//   STATE:      last-cd-wins across MIXED `&&`/`;` separators
//   REGRESSION: the leading-cd and no-cd forms keep their pre-fix values;
//               the module imports no Node builtin

describe("extractCdPrefixTarget — chain scanning HAPPY", () => {
  it("derives the cd target from this repo's mandated build-then-cd e2e form", () => {
    expect(
      extractCdPrefixTarget(
        "bun run build && cd packages/lore && bun test tests/e2e/resume-coverage-compiled.bun.test.ts",
      ),
    ).toBe("packages/lore");
  });

  it("derives the cd target from the mandated fresh-worktree install-then-cd form", () => {
    expect(
      extractCdPrefixTarget(
        "bun install && cd packages/lore && bun test tests/unit/store/sqlite-store.bun.test.ts",
      ),
    ).toBe("packages/lore");
  });
});

describe("extractCdPrefixTarget — chain scanning NEGATIVE", () => {
  it("returns null for a multi-segment chain carrying no cd segment", () => {
    expect(
      extractCdPrefixTarget("bun run build && bun test tests/x.bun.test.ts"),
    ).toBeNull();
  });

  it("returns null for a bare `cd` with no target", () => {
    expect(extractCdPrefixTarget("cd && bun test x.test.ts")).toBeNull();
  });

  it("does not treat `cd` inside a quoted filter value as a cd segment", () => {
    expect(
      extractCdPrefixTarget('bunx vitest run -t "cd packages/lore" x.test.ts'),
    ).toBeNull();
  });
});

describe("extractCdPrefixTarget — chain scanning BOUNDARY", () => {
  it("resolves two cd segments against the LAST one, by value", () => {
    expect(extractCdPrefixTarget("cd a && cd b && bun test f.test.ts")).toBe("b");
  });

  it("resolves three cd segments against the LAST one, by value", () => {
    expect(
      extractCdPrefixTarget("cd a && cd b && cd c && bun test f.test.ts"),
    ).toBe("c");
  });

  it("does NOT apply a cd that comes AFTER the test invocation", () => {
    // reason: shell semantics — the runner resolves `f.test.ts` before the
    // trailing `cd` ever executes, so that cd is not the file's base
    // directory. Without this bound the fix would widen into "any cd
    // anywhere", adding a candidate root that can only produce a FALSE
    // ACCEPT (the task's own AC-4 anti-degradation control).
    expect(extractCdPrefixTarget("bun test f.test.ts && cd packages/lore")).toBeNull();
  });

  it("keeps a separator inside a quoted cd target from splitting the segment", () => {
    expect(
      extractCdPrefixTarget('cd "weird;dir" && bun test f.test.ts'),
    ).toBe("weird;dir");
  });

  it("keeps a quoted `&&` inside a filter value from splitting the segment", () => {
    expect(
      extractCdPrefixTarget(
        'cd packages/lore && bunx vitest run -t "a && b" f.test.ts',
      ),
    ).toBe("packages/lore");
  });
});

describe("extractCdPrefixTarget — chain scanning ERROR", () => {
  it("does not recognize a cd segment carrying extra words", () => {
    expect(
      extractCdPrefixTarget("cd a b && bun test f.test.ts"),
    ).toBeNull();
  });
});

describe("extractCdPrefixTarget — chain scanning STATE", () => {
  it("applies last-cd-wins across MIXED && and ; separators", () => {
    expect(extractCdPrefixTarget("cd a; cd b && bun test f.test.ts")).toBe("b");
  });

  it("treats `;` separators exactly like `&&` in a multi-segment chain", () => {
    expect(
      extractCdPrefixTarget(
        "bun run build; cd packages/lore; bun test tests/e2e/x.bun.test.ts",
      ),
    ).toBe("packages/lore");
  });
});

describe("extractCdPrefixTarget — chain scanning REGRESSION", () => {
  it("keeps the pre-fix value for the leading-cd and no-cd forms", () => {
    expect(
      extractCdPrefixTarget("cd packages/lore && bun test tests/foo.bun.test.ts"),
    ).toBe("packages/lore");
    expect(extractCdPrefixTarget("bunx vitest run foo.test.ts")).toBeNull();
  });

  it("keeps the module free of Node builtins so it stays vitest-importable", () => {
    // reason: the module header promises "pure (no IO, no fs, no process
    // access) — vitest-safe". A `node:fs`/`node:path` import added for
    // convenience would break every vitest consumer of this file, so the
    // promise gets a grep-shaped oracle rather than only prose.
    const source = readFileSync(
      new URL("../../../src/adapters/cli/evidence-precheck.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+"node:/);
    expect(source).not.toMatch(/require\(/);
  });
});

// ─── describeDerivedCdTarget ────────────────────────────────────────────────
//
// Six-dimension coverage:
//   HAPPY:      names the derived target
//   NEGATIVE:   says "none" when no cd segment precedes the named test file
//   BOUNDARY:   names the LAST target of a multi-cd chain, not the first
//   ERROR:      a command with no extractable target still yields a non-empty
//               diagnosable sentence (never an empty string)
//   STATE:      the sentence tracks the same value extractCdPrefixTarget derives
//   REGRESSION: adapter-neutral wording — no CLI-only or MCP-only flag spelling,
//               so both refusal surfaces can append it verbatim

describe("describeDerivedCdTarget — HAPPY", () => {
  it("names the derived cd target", () => {
    expect(
      describeDerivedCdTarget(
        "bun run build && cd packages/lore && bun test tests/e2e/x.bun.test.ts",
      ),
    ).toContain("packages/lore");
  });
});

describe("describeDerivedCdTarget — NEGATIVE", () => {
  it("says none when no cd segment precedes the named test file", () => {
    const described = describeDerivedCdTarget("bunx vitest run foo.test.ts");
    expect(described).toContain("none");
    expect(described).not.toContain("packages/lore");
  });
});

describe("describeDerivedCdTarget — BOUNDARY", () => {
  it("names the LAST cd target of a multi-cd chain, not the first", () => {
    const described = describeDerivedCdTarget("cd first && cd second && bun test f.test.ts");
    expect(described).toContain("second");
    expect(described).not.toContain("first");
  });
});

describe("describeDerivedCdTarget — ERROR", () => {
  it("returns a non-empty diagnosable sentence even with an empty command", () => {
    expect(describeDerivedCdTarget("").trim().length).toBeGreaterThan(0);
  });
});

describe("describeDerivedCdTarget — STATE", () => {
  it("tracks the same value extractCdPrefixTarget derives, for every shape", () => {
    for (const command of [
      "bun run build && cd packages/lore && bun test tests/x.bun.test.ts",
      "cd a; cd b && bun test f.test.ts",
      "bunx vitest run foo.test.ts",
      "bun test f.test.ts && cd trailing",
    ]) {
      const target = extractCdPrefixTarget(command);
      const described = describeDerivedCdTarget(command);
      if (target === null) expect(described).toContain("none");
      else expect(described).toContain(target);
    }
  });
});

describe("describeDerivedCdTarget — REGRESSION", () => {
  it("stays adapter-neutral so both refusal surfaces can append it verbatim", () => {
    // reason: the CLI refusal spells flags `--command`/`--oracle manual` while
    // the MCP one spells them `"command"`/`oracle: "manual"`. This clause is
    // shared SSOT between both, so it must name NEITHER spelling — otherwise
    // one surface renders wording that does not exist on its own interface.
    const described = describeDerivedCdTarget("cd packages/lore && bun test f.test.ts");
    expect(described).not.toContain("--command");
    expect(described).not.toContain("--oracle");
    expect(described).not.toContain('oracle: "manual"');
  });
});

// ─── findMissingOracleFiles — HAPPY ─────────────────────────────────────────

describe("findMissingOracleFiles — HAPPY", () => {
  it("returns [] when the token exists relative to cwd", () => {
    const fileExists = vi.fn((p: string) => p === "/repo/x.test.ts");
    expect(
      findMissingOracleFiles("bunx vitest run x.test.ts", {
        cwd: "/repo",
        fileExists,
      }),
    ).toEqual([]);
  });

  it("resolves relative to the cd target when a cd-prefix is present", () => {
    const fileExists = vi.fn(
      (p: string) => p === "/repo/packages/lore/tests/foo.bun.test.ts",
    );
    const missing = findMissingOracleFiles(
      "cd packages/lore && bun test tests/foo.bun.test.ts",
      { cwd: "/repo", fileExists },
    );
    expect(missing).toEqual([]);
    // reason: the cd-target-joined candidate is the ONE that must have been probed —
    // pins the "resolve relative to the cd target when present" AC boundary case.
    expect(fileExists).toHaveBeenCalledWith(
      "/repo/packages/lore/tests/foo.bun.test.ts",
    );
  });

  it("falls back to corpusRoot when the token does not exist relative to cwd", () => {
    const fileExists = vi.fn(
      (p: string) => p === "/corpus-root/spec/foo.test.ts",
    );
    expect(
      findMissingOracleFiles("bunx vitest run spec/foo.test.ts", {
        cwd: "/repo/worktree",
        corpusRoot: "/corpus-root",
        fileExists,
      }),
    ).toEqual([]);
  });
});

// ─── findMissingOracleFiles — NEGATIVE / REGRESSION ─────────────────────────

describe("findMissingOracleFiles — NEGATIVE / REGRESSION", () => {
  it("returns [] and never probes fileExists when no token is extractable", () => {
    const fileExists = vi.fn(() => false);
    expect(
      findMissingOracleFiles("bun run typecheck", {
        cwd: "/repo",
        fileExists,
      }),
    ).toEqual([]);
    expect(fileExists).not.toHaveBeenCalled();
  });
});

// ─── findMissingOracleFiles — ERROR ─────────────────────────────────────────

describe("findMissingOracleFiles — ERROR", () => {
  it("reports a token missing when every candidate root fails existence", () => {
    const fileExists = vi.fn(() => false);
    expect(
      findMissingOracleFiles("bunx vitest run nonexistent.test.ts", {
        cwd: "/repo",
        corpusRoot: "/corpus-root",
        fileExists,
      }),
    ).toEqual(["nonexistent.test.ts"]);
  });

  it("checks an absolute-path token as-is, without joining any root", () => {
    const fileExists = vi.fn((p: string) => p === "/repo/other.test.ts");
    expect(
      findMissingOracleFiles("bunx vitest run /elsewhere/x.test.ts", {
        cwd: "/repo",
        fileExists,
      }),
    ).toEqual(["/elsewhere/x.test.ts"]);
    expect(fileExists).toHaveBeenCalledWith("/elsewhere/x.test.ts");
  });
});

// ─── findMissingOracleFiles — STATE ─────────────────────────────────────────

describe("findMissingOracleFiles — STATE", () => {
  it("returns only the tokens that are missing when some tokens exist", () => {
    const fileExists = vi.fn((p: string) => p === "/repo/present.test.ts");
    expect(
      findMissingOracleFiles(
        "bunx vitest run present.test.ts absent.test.ts",
        { cwd: "/repo", fileExists },
      ),
    ).toEqual(["absent.test.ts"]);
  });
});

// ─── findMissingOracleFiles / describePrecheckRoots — multi-segment cd ──────
// ─── (task-evidence-precheck-only-sees-a-cd-in-the-first-segment-of-a) ───
//
// The composition-level half of the same six dimensions: the parser fix only
// matters if it changes which ROOTS the existence check actually probes.
//   HAPPY:      the mandated build-then-cd form resolves under the cd target
//   NEGATIVE:   a no-cd command's root list is unchanged
//   BOUNDARY:   a two-cd chain probes the LAST target's root, by value
//   ERROR:      a cd-prefixed command naming a nonexistent file is STILL refused
//   STATE:      the cd-joined root is ordered before the bare cwd root
//   REGRESSION: the leading-cd root list is byte-identical to its pre-fix value

describe("findMissingOracleFiles — multi-segment cd HAPPY", () => {
  it("accepts the mandated build-then-cd e2e form when the file exists under the cd target", () => {
    const fileExists = vi.fn(
      (p: string) => p === "/repo/packages/lore/tests/e2e/x.bun.test.ts",
    );
    const missing = findMissingOracleFiles(
      "bun run build && cd packages/lore && bun test tests/e2e/x.bun.test.ts",
      { cwd: "/repo", fileExists },
    );
    expect(missing).toEqual([]);
    expect(fileExists).toHaveBeenCalledWith(
      "/repo/packages/lore/tests/e2e/x.bun.test.ts",
    );
  });
});

describe("findMissingOracleFiles — multi-segment cd NEGATIVE", () => {
  it("leaves a no-cd command's candidate roots exactly as they were", () => {
    expect(
      describePrecheckRoots("bunx vitest run tests/x.test.ts", {
        cwd: "/repo",
        corpusRoot: "/main",
      }),
    ).toEqual(["/repo", "/main"]);
  });
});

describe("findMissingOracleFiles — multi-segment cd BOUNDARY", () => {
  it("probes the LAST cd target's root, by value", () => {
    expect(
      describePrecheckRoots("cd a && cd b && bun test f.test.ts", {
        cwd: "/repo",
      }),
    ).toEqual(["/repo/b", "/repo"]);
  });

  it("treats `;` separators exactly like `&&` at the composition level", () => {
    expect(
      describePrecheckRoots(
        "bun run build; cd packages/lore; bun test tests/x.bun.test.ts",
        { cwd: "/repo" },
      ),
    ).toEqual(["/repo/packages/lore", "/repo"]);
  });
});

describe("findMissingOracleFiles — multi-segment cd ERROR", () => {
  it("STILL refuses a cd-prefixed command naming a genuinely nonexistent file", () => {
    // reason: the anti-degradation control (task's own AC-4) — a fix that
    // widened cd recognition must not turn the precheck into "always accept".
    // fileExists resolves a DIFFERENT real file, so this is not the trivial
    // always-false case: the port is live and still finds nothing for the
    // named token under ANY candidate root.
    const fileExists = vi.fn(
      (p: string) => p === "/repo/packages/lore/tests/e2e/present.bun.test.ts",
    );
    expect(
      findMissingOracleFiles(
        "bun run build && cd packages/lore && bun test tests/e2e/absent.bun.test.ts",
        { cwd: "/repo", corpusRoot: "/main", fileExists },
      ),
    ).toEqual(["tests/e2e/absent.bun.test.ts"]);
    expect(fileExists).toHaveBeenCalledWith(
      "/repo/packages/lore/tests/e2e/absent.bun.test.ts",
    );
  });

  it("STILL refuses when only a trailing cd could have rescued the path", () => {
    // reason: the trailing cd is not applied (shell semantics), so a file that
    // exists ONLY under it must stay refused — the false-accept direction the
    // chain scan must not open.
    const fileExists = vi.fn((p: string) => p === "/repo/packages/lore/f.test.ts");
    expect(
      findMissingOracleFiles("bun test f.test.ts && cd packages/lore", {
        cwd: "/repo",
        fileExists,
      }),
    ).toEqual(["f.test.ts"]);
  });
});

describe("findMissingOracleFiles — multi-segment cd STATE", () => {
  it("orders the cd-joined root before the bare cwd root", () => {
    const roots = describePrecheckRoots(
      "bun install && cd packages/lore && bun test tests/x.bun.test.ts",
      { cwd: "/repo", corpusRoot: "/main" },
    );
    expect(roots).toEqual(["/repo/packages/lore", "/repo", "/main"]);
  });
});

describe("findMissingOracleFiles — multi-segment cd REGRESSION", () => {
  it("keeps the leading-cd root list byte-identical to its pre-fix value", () => {
    expect(
      describePrecheckRoots("cd packages/lore && bun test tests/x.bun.test.ts", {
        cwd: "/repo",
        corpusRoot: "/main",
      }),
    ).toEqual(["/repo/packages/lore", "/repo", "/main"]);
  });

  it("keeps naming no roots at all when the command extracts no test-file token", () => {
    expect(
      describePrecheckRoots("cd packages/lore && bun run typecheck", {
        cwd: "/repo",
      }),
    ).toEqual([]);
  });
});

// ─── findCaptureFlagConflict — task-a-non-empty-output-tail-can-be-hand- ────
// ─── authored-prose-and-the ──────────────────────────────────────────────
//
// Six-dimension coverage:
//   HAPPY:      --capture alone (no tail flags, non-manual oracle) is legal
//   NEGATIVE:   --capture not requested → always null, regardless of other flags
//   BOUNDARY:   --capture + --output-tail-file (not just --output-tail) conflicts;
//               --oracle "manual" (exact match) conflicts, a similar-but-different
//               oracle string does not
//   ERROR:      --capture + --output-tail together is refused, naming the flag
//   STATE:      both conflicts present at once still returns the output-tail
//               conflict first (checked before the oracle-manual conflict)
//   REGRESSION: --capture with neither output-tail flag and a non-manual oracle
//               stays legal across the oracle enum's other members

describe("findCaptureFlagConflict — HAPPY", () => {
  it("returns null for --capture alone with a non-manual oracle", () => {
    expect(
      findCaptureFlagConflict({ oracle: "test", capture: true }),
    ).toBeNull();
  });
});

describe("findCaptureFlagConflict — NEGATIVE", () => {
  it("returns null when --capture was not requested, even with tail flags present", () => {
    expect(
      findCaptureFlagConflict({
        oracle: "test",
        capture: false,
        outputTail: "some prose",
      }),
    ).toBeNull();
  });

  it("returns null when --capture was not requested and oracle is manual", () => {
    expect(
      findCaptureFlagConflict({ oracle: "manual", capture: false }),
    ).toBeNull();
  });
});

describe("findCaptureFlagConflict — BOUNDARY", () => {
  it("conflicts on --capture + --output-tail-file (not just --output-tail)", () => {
    const result = findCaptureFlagConflict({
      oracle: "test",
      capture: true,
      outputTailFile: "/tmp/some-log.txt",
    });
    expect(result?.code).toBe("VALIDATION_ERROR");
    if (result?.code !== "VALIDATION_ERROR") return;
    expect(result.field).toBe("capture");
  });

  it("conflicts on --oracle manual exactly", () => {
    const result = findCaptureFlagConflict({ oracle: "manual", capture: true });
    expect(result?.code).toBe("VALIDATION_ERROR");
    if (result?.code !== "VALIDATION_ERROR") return;
    expect(result.message).toContain("--oracle manual");
  });

  it("does not conflict on an oracle string merely containing 'manual' as a substring", () => {
    expect(
      findCaptureFlagConflict({ oracle: "manually-run-e2e", capture: true }),
    ).toBeNull();
  });
});

describe("findCaptureFlagConflict — ERROR", () => {
  it("refuses --capture combined with --output-tail, naming the capture field", () => {
    const result = findCaptureFlagConflict({
      oracle: "test",
      capture: true,
      outputTail: "hand-typed text",
    });
    expect(result).not.toBeNull();
    if (result?.code !== "VALIDATION_ERROR") throw new Error("expected VALIDATION_ERROR");
    expect(result.field).toBe("capture");
    expect(result.message).toContain("--output-tail");
  });
});

describe("findCaptureFlagConflict — STATE", () => {
  it("reports the output-tail conflict first when BOTH conflicts are present", () => {
    const result = findCaptureFlagConflict({
      oracle: "manual",
      capture: true,
      outputTail: "hand-typed text",
    });
    if (result?.code !== "VALIDATION_ERROR") throw new Error("expected VALIDATION_ERROR");
    expect(result.message).toContain("--output-tail");
    expect(result.message).not.toContain("--oracle manual");
  });
});

describe("findCaptureFlagConflict — REGRESSION", () => {
  it("stays legal for --capture across every non-manual oracle kind", () => {
    for (const oracle of ["tsc", "test", "lint", "build", "e2e", "other"]) {
      expect(findCaptureFlagConflict({ oracle, capture: true })).toBeNull();
    }
  });
});

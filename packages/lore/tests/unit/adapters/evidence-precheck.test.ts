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

import { describe, it, expect, vi } from "vitest";
import {
  extractTestFileTokens,
  extractCdPrefixTarget,
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

  it("does not recognize cd when it is not the first command in the chain", () => {
    expect(
      extractCdPrefixTarget("echo hi && cd packages/lore && bun test x.test.ts"),
    ).toBeNull();
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

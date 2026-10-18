/**
 * Interpreter/runner script-path extraction and unchecked-segment reporting (AC-EI-2,
 * spec-evidence-identity-an-attested-row-counts-only-for-the; baseline AS-17).
 *
 * Dimension mapping:
 *   HAPPY:      bun/node/sh/bash/tsx and bunx|npx + bun|node|tsx hand a script path -> extracted
 *   NEGATIVE:   inline code, expansion, package-script names, bunx vitest -> no script path
 *   BOUNDARY:   value-taking flags, quotes, `bun run <file>`, `bun test`, dedupe with test tokens
 *   ERROR:      unclassifiable segments are LISTED (never silently clean); benign builtins are not
 *   STATE:      findMissingOracleFiles now reports a missing script, and a present one is clean
 */
import { describe, it, expect } from "vitest";
import {
  extractInterpreterScript,
  extractOraclePathTokens,
  findMissingOracleFiles,
  findUncheckedOracleSegments,
} from "../../src/oracle-file-existence.js";

describe("extractOraclePathTokens", () => {
  it.each([
    ["bun scripts/measure-test-wall.ts --max-seconds 600", ["scripts/measure-test-wall.ts"]],
    ["node ./tools/check.mjs", ["./tools/check.mjs"]],
    ["sh scripts/a.sh && echo ok", ["scripts/a.sh"]],
    ["bash -e scripts/b.sh arg", ["scripts/b.sh"]],
    ["tsx scripts/c.ts", ["scripts/c.ts"]],
    ["bunx --bun tsx scripts/d.ts", ["scripts/d.ts"]],
    ["npx -y node scripts/e.js", ["scripts/e.js"]],
    ["bunx bun scripts/f.ts", ["scripts/f.ts"]],
    ["bun run scripts/g.ts", ["scripts/g.ts"]],
    ["node --require ./preload.js scripts/h.js", ["scripts/h.js"]],
    ['bun "scripts/with space.ts"', ["scripts/with space.ts"]],
  ])("HAPPY: %s", (command, expected) => {
    expect(extractOraclePathTokens(command)).toEqual(expected);
  });

  it("BOUNDARY: a script and a test file in one chain are both extracted, once each", () => {
    expect(extractOraclePathTokens("bun scripts/x.ts && bunx --bun vitest run a.test.ts a.test.ts")).toEqual([
      "scripts/x.ts",
      "a.test.ts",
    ]);
  });

  it.each([
    "bun run typecheck",
    "bun test",
    "bunx --bun vitest run",
    "node -e 'process.exit(0)'",
    "sh -c 'exit 1'",
    "bash $SCRIPT",
    "echo bun scripts/x.ts",
  ])("NEGATIVE: %s yields no path", (command) => {
    expect(extractOraclePathTokens(command)).toEqual([]);
  });
});

describe("extractInterpreterScript", () => {
  it("reports inline code as unresolved and a non-interpreter segment as null", () => {
    expect(extractInterpreterScript("node -e 'x'")).toEqual({ kind: "unresolved" });
    expect(extractInterpreterScript("python3 x.py")).toBeNull();
  });
});

describe("findUncheckedOracleSegments", () => {
  it("ERROR: an unclassifiable segment is listed verbatim (trimmed)", () => {
    expect(findUncheckedOracleSegments("python3 check.py && echo done")).toEqual(["python3 check.py"]);
    expect(findUncheckedOracleSegments("sh -c 'exit 1'")).toEqual(["sh -c 'exit 1'"]);
    expect(findUncheckedOracleSegments("bun scripts/a.ts ; ./weird --run")).toEqual(["./weird --run"]);
  });

  it("HAPPY: fully understood chains list nothing", () => {
    expect(findUncheckedOracleSegments("bunx --bun vitest run a.test.ts && echo 'AC PASS'")).toEqual([]);
    expect(findUncheckedOracleSegments("cd packages/lore && bun test x.bun.test.ts")).toEqual([]);
    expect(findUncheckedOracleSegments("bun scripts/a.ts && test -f out.txt")).toEqual([]);
  });
});

describe("findMissingOracleFiles with script paths", () => {
  const exists = (present: string[]) => (p: string) => present.includes(p);

  it("STATE: a missing script is reported; the same command with the script present is clean", () => {
    expect(findMissingOracleFiles("bun scripts/x.ts", { cwd: "/r", fileExists: exists([]) })).toEqual(["scripts/x.ts"]);
    expect(findMissingOracleFiles("bun scripts/x.ts", { cwd: "/r", fileExists: exists(["/r/scripts/x.ts"]) })).toEqual([]);
  });

  it("BOUNDARY: a cd before the interpreter segment joins the script root", () => {
    expect(
      findMissingOracleFiles("cd pkg && node run.js", { cwd: "/r", fileExists: exists(["/r/pkg/run.js"]) }),
    ).toEqual([]);
  });
});

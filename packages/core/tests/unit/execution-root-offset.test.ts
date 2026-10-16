/**
 * AC-CRIT-9 — spec-close-the-eight-verified-critical-defects-no-judge-listing §Design F7:
 * `commandRunsFileUnfiltered` and `findMissingOracleFiles` fold an ATTESTED execution
 * root (caller-supplied; never parsed from `--cwd` in the command text) into the
 * `cd` offset when resolving a command's test-file tokens.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */
import { describe, it, expect } from "vitest";
import { commandRunsFileUnfiltered } from "../../src/attestation-completeness.js";
import { findMissingOracleFiles } from "../../src/oracle-file-existence.js";

const ANCHOR = "packages/lore/tests/x.bun.test.ts";

describe("AC-CRIT-9 commandRunsFileUnfiltered executionRoot", () => {
  it("HAPPY: root-relative command + executionRoot=packages/lore matches the repo-relative anchor", () => {
    expect(commandRunsFileUnfiltered("bun test tests/x.bun.test.ts", ANCHOR, { executionRoot: "packages/lore" })).toBe(true);
  });
  it("NEGATIVE: the same command without a root is false", () => {
    expect(commandRunsFileUnfiltered("bun test tests/x.bun.test.ts", ANCHOR)).toBe(false);
  });
  it("combined: executionRoot=packages + `cd lore && ...` joins both offsets", () => {
    expect(
      commandRunsFileUnfiltered("cd lore && bun test tests/x.bun.test.ts", ANCHOR, { executionRoot: "packages" }),
    ).toBe(true);
  });
  it("NEGATIVE: a wrong root does not match", () => {
    expect(commandRunsFileUnfiltered("bun test tests/x.bun.test.ts", ANCHOR, { executionRoot: "packages/core" })).toBe(false);
  });
  it("BOUNDARY: root '.' and trailing slash are neutral", () => {
    expect(commandRunsFileUnfiltered(`bun test ${ANCHOR}`, ANCHOR, { executionRoot: "." })).toBe(true);
    expect(commandRunsFileUnfiltered("bun test tests/x.bun.test.ts", ANCHOR, { executionRoot: "packages/lore/" })).toBe(true);
  });
  it("BOUNDARY: an absolute recorded root matches by whole-segment suffix of the anchor", () => {
    expect(commandRunsFileUnfiltered("bun test tests/x.bun.test.ts", ANCHOR, { executionRoot: "/a/b/packages/lore" })).toBe(true);
    expect(commandRunsFileUnfiltered("bun test tests/x.bun.test.ts", ANCHOR, { executionRoot: "/a/b/xpackages/lore" })).toBe(false);
  });
  it("REGRESSION: a case filter still defeats the match even with a root", () => {
    expect(
      commandRunsFileUnfiltered("bun test tests/x.bun.test.ts -t 'one'", ANCHOR, { executionRoot: "packages/lore" }),
    ).toBe(false);
  });
});

describe("AC-CRIT-9 findMissingOracleFiles executionRoot", () => {
  const exists = (p: string): boolean => p === "/repo/packages/lore/tests/x.bun.test.ts";
  it("HAPPY: with the root, the file resolves and nothing is missing", () => {
    expect(
      findMissingOracleFiles("bun test tests/x.bun.test.ts", { cwd: "/repo", executionRoot: "packages/lore", fileExists: exists }),
    ).toEqual([]);
  });
  it("NEGATIVE: without the root the token is reported missing", () => {
    expect(findMissingOracleFiles("bun test tests/x.bun.test.ts", { cwd: "/repo", fileExists: exists })).toEqual([
      "tests/x.bun.test.ts",
    ]);
  });
  it("combined: root + cd offset resolves", () => {
    expect(
      findMissingOracleFiles("cd lore && bun test tests/x.bun.test.ts", { cwd: "/repo", executionRoot: "packages", fileExists: exists }),
    ).toEqual([]);
  });
  it("ERROR: a genuinely missing file stays missing under a root", () => {
    expect(
      findMissingOracleFiles("bun test tests/nope.bun.test.ts", { cwd: "/repo", executionRoot: "packages/lore", fileExists: exists }),
    ).toEqual(["tests/nope.bun.test.ts"]);
  });
});

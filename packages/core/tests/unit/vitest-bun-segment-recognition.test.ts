/**
 * Regression (CT-4 follow-up): `bunx --bun vitest run <f>` — the one-runner form 322 AC commands
 * use since T23 — must classify as a vitest segment, so `extractTestFileTokens` (missing-oracle
 * detection, attestation-completeness, evidence precheck, AC-CT-4 radius) sees its test file.
 * Parsers audited and found NOT blind: evidence-precheck.ts (`\bvitest\s+run\b`),
 * scripts/check-unclaimed-oracle.ts::extractTestFilePaths (whitespace tokens, runner-agnostic),
 * check-ac-oracle-ownership.ts (delegates to the former), changed-tests.ts (spawns, parses no AC command).
 */
import { describe, expect, it } from "vitest";
import { classifyCommandSegment, extractTestFileTokens } from "../../src/oracle-file-existence.js";

const FILE = "packages/x/tests/a.test.ts";

describe("vitest segment recognition across runner spellings", () => {
  it.each([
    [`bunx --bun vitest run ${FILE}`],
    [`bunx vitest run ${FILE}`],
    [`vitest run ${FILE}`],
    [`bunx --bun vitest run --config vitest.node.config.ts ${FILE}`],
    [`cd packages/x && bunx --bun vitest run ${FILE}`],
    [`bunx --bun vitest run -t "AC-1" ${FILE} 2>&1 && echo "PASS ${FILE}.x"`],
  ])("yields the file token: %s", (command) => {
    expect(extractTestFileTokens(command)).toEqual([FILE]);
  });

  it("classifies the --bun spelling as the vitest runner", () => {
    expect(classifyCommandSegment(`bunx --bun vitest run ${FILE}`).runner).toBe("vitest");
  });

  it("negative: prose and non-runner segments stay unclassified", () => {
    expect(classifyCommandSegment(`echo bunx --bun vitest run ${FILE}`).runner).toBe("unclassified");
    expect(extractTestFileTokens(`bunx --bun other run ${FILE}`)).toEqual([]);
    expect(extractTestFileTokens("bun run typecheck")).toEqual([]);
  });
});

/**
 * evidenceRanMissingOracle (TG-22, spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-6): a pass
 * counts against a vanished oracle only when its command RAN that file, compared as normalised locations
 * under the same candidate roots (cd target, execution root) findMissingOracleFiles uses.
 *
 * Dimension mapping:
 *   HAPPY:      identical spelling -> true
 *   NEGATIVE:   a different file -> false
 *   BOUNDARY:   `./x` vs `x`; `a/../x`; empty missing list
 *   STATE:      package-relative path + attested execution_root vs a repo-relative AC path -> true; no root -> false
 */
import { describe, it, expect } from "vitest";
import { evidenceRanMissingOracle } from "../../src/oracle-file-existence.js";

const CTX = { cwd: "/repo" } as const;
const AC = (command: string, missingPaths: string[]) => ({ command, missingPaths });

describe("evidenceRanMissingOracle", () => {
  it("HAPPY: the same path spelled the same way ran the missing file", () => {
    expect(evidenceRanMissingOracle({ command: "bun test later.test.ts" }, AC("bun test later.test.ts", ["later.test.ts"]), CTX)).toBe(true);
  });

  it("NEGATIVE: a pass of a different file did not run the missing one", () => {
    expect(evidenceRanMissingOracle({ command: "bun test other.test.ts" }, AC("bun test later.test.ts", ["later.test.ts"]), CTX)).toBe(false);
  });

  it("BOUNDARY: a leading ./ is the same file as the bare path", () => {
    expect(evidenceRanMissingOracle({ command: "bun test ./later.test.ts" }, AC("bun test later.test.ts", ["later.test.ts"]), CTX)).toBe(true);
  });

  it("BOUNDARY: dot-dot segments normalise away", () => {
    expect(evidenceRanMissingOracle({ command: "bun test sub/../later.test.ts" }, AC("bun test later.test.ts", ["later.test.ts"]), CTX)).toBe(true);
  });

  it("BOUNDARY: no missing paths -> false", () => {
    expect(evidenceRanMissingOracle({ command: "bun test later.test.ts" }, AC("bun test later.test.ts", []), CTX)).toBe(false);
  });

  it("STATE: a package-relative pass with an attested execution_root matches the repo-relative AC path", () => {
    const ac = AC("bun test packages/lore/tests/x.test.ts", ["packages/lore/tests/x.test.ts"]);
    expect(evidenceRanMissingOracle({ command: "bun test tests/x.test.ts", executionRoot: "packages/lore" }, ac, CTX)).toBe(true);
  });

  it("STATE: the same package-relative command WITHOUT the execution_root is a different location", () => {
    const ac = AC("bun test packages/lore/tests/x.test.ts", ["packages/lore/tests/x.test.ts"]);
    expect(evidenceRanMissingOracle({ command: "bun test tests/x.test.ts" }, ac, CTX)).toBe(false);
  });

  it("STATE: an absolute execution_root that points elsewhere does not match", () => {
    const ac = AC("bun test packages/lore/tests/x.test.ts", ["packages/lore/tests/x.test.ts"]);
    expect(evidenceRanMissingOracle({ command: "bun test tests/x.test.ts", executionRoot: "/elsewhere/lore" }, ac, CTX)).toBe(false);
  });
});

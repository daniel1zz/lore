// @reads packages/core/src/ac-quality.ts
/**
 * Source-scan regression test for @lore/core ac-quality's zero-LLM invariant
 * (AC-ACQ-2). Runs under `bun test` (reads the source file from disk via
 * `fs.readFileSync`, which the pure module itself never does) — NOT vitest,
 * per this repo's `.bun.test.ts` convention.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      the module imports no AI/provider symbol and calls no
 *               generate(...) — proven by grep-shaped assertions over the
 *               actual on-disk source, not by trusting the module's own docs
 *   NEGATIVE:   n/a — a single deterministic scan, no negative input space
 *   BOUNDARY:   n/a
 *   ERROR:      n/a — file read failure would throw loudly, which is the
 *               correct behavior for a missing source file
 *   STATE:      n/a
 *   REGRESSION: guards against a future edit silently wiring an AI/provider
 *               call into what must stay a deterministic, zero-cost lint
 *
 * @spec_ref SPEC AC-Quantifiability Gate §Acceptance Criteria AC-ACQ-2
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(__dirname, "..", "..", "src", "ac-quality.ts");

describe("ac-quality.ts — zero-LLM by construction (AC-ACQ-2)", () => {
  const source = readFileSync(SOURCE_PATH, "utf-8");

  it("imports no AIProvider symbol", () => {
    expect(source).not.toMatch(/AIProvider/);
  });

  it("calls no generate(...) (the provider invocation shape used across this codebase)", () => {
    expect(source).not.toMatch(/\bgenerate\(/);
  });

  it("imports nothing from an ai/provider-shaped module path", () => {
    // reason: catches `import ... from "./ai.js"` / "../ai/*" / any path
    // segment literally named "provider" — the two shapes every AI-calling
    // module in this codebase uses (ai-provider-service.ts, ai/*-template.ts).
    expect(source).not.toMatch(/from\s+["'][^"']*\/ai[./"']/);
    expect(source).not.toMatch(/from\s+["'][^"']*provider[^"']*["']/i);
  });

  it("declares itself pure in its module header", () => {
    expect(source).toMatch(/Side-effect class:\s*pure/);
  });

  it("runs lintAcQuantifiability to completion with zero provider dependency injected", async () => {
    const { lintAcQuantifiability } = await import("../../src/ac-quality.js");
    const findings = lintAcQuantifiability([
      {
        id: "AC-SMOKE-1",
        statement: "the smoke check exits 0",
        verify: { mode: "script", oracle: "test", command: "true" },
      },
    ]);
    expect(Array.isArray(findings)).toBe(true);
  });
});

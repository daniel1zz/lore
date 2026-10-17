// @reads packages/lore/src/service/ai-provider-service.ts
// @reads packages/lore/src/adapters/cli/commands/assess.ts
// @reads packages/lore/src/adapters/mcp/tools.ts
/**
 * AC-JV-6 (spec-judgment-surfaces-must-verify-before-they-certify-machine): a comment
 * that records a wiring gap must be updated in lockstep with the gap being closed.
 *
 * The diffSource gap IS closed: both production callers (`adapters/cli/commands/assess.ts`
 * and `adapters/mcp/tools.ts`) pass `diffSource` into `assessPlan`. This suite proves
 * (a) that wiring is really present, so the comment check is not vacuous; (b) each stale
 * phrase that claimed otherwise is ABSENT from `ai-provider-service.ts`; (c) the
 * replacement text names both live call sites in a form a reader can grep.
 *
 * Six-dimension coverage:
 *   HAPPY:      both call sites thread diffSource; replacement names both
 *   NEGATIVE:   each of the five stale phrases is absent
 *   BOUNDARY:   the normaliser joins wrapped comment lines, so a phrase split across lines is still caught
 *   ERROR:      the normaliser self-test shows a stale phrase WOULD be detected (not a vacuous grep)
 *   STATE:      n/a (static source text)
 *   REGRESSION: the mechanism-is-live statement (verification pass fully live) survives the rewrite
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src");
const read = (rel: string): string => readFileSync(resolve(SRC, rel), "utf8");

/** Strips JSDoc/line-comment prefixes and joins lines, so a phrase wrapped across lines still matches. */
export function normaliseComments(source: string): string {
  return source
    .split("\n")
    .map((l) => l.replace(/^\s*(\/\/|\*|\/\*\*)\s?/, "").trim())
    .join(" ")
    .replace(/\s+/g, " ");
}

const STALE_PHRASES: readonly RegExp[] = [
  /supplied by NO production caller/,
  /so every live `lore assess` run today resolves to `paths_verified\.unchecked`/,
  /Still NOT THREADED by either production caller/,
  /a follow-up task must have the CLI\/MCP layer pass its already-resolved `diffSource` local through here/,
  /no production caller supplies it yet/,
];

describe("AC-JV-6 ai-provider-service.ts comment currency", () => {
  const service = normaliseComments(read("service/ai-provider-service.ts"));

  it("HAPPY: both production callers really pass diffSource into assessPlan", () => {
    expect(read("adapters/cli/commands/assess.ts")).toMatch(/assessPlan\(bundle, \{[\s\S]*?\bdiffSource,/);
    expect(read("adapters/mcp/tools.ts")).toMatch(/assessPlan\([\s\S]*?\bdiffSource,/);
  });

  for (const phrase of STALE_PHRASES) {
    it(`NEGATIVE: stale phrase is absent — ${phrase.source.slice(0, 60)}`, () => {
      expect(service).not.toMatch(phrase);
    });
  }

  it("HAPPY: the replacement text names both live call sites", () => {
    expect(service).toContain("adapters/cli/commands/assess.ts");
    expect(service).toContain("adapters/mcp/tools.ts");
  });

  it("ERROR: the normaliser detects a stale phrase split across wrapped comment lines (the grep is not vacuous)", () => {
    const wrapped = " *     `opts.diffSource` is currently supplied by NO production\n *     caller (x)";
    expect(normaliseComments(wrapped)).toMatch(STALE_PHRASES[0]!);
  });

  it("REGRESSION: the rewrite keeps the statement that the verification mechanism itself is live", () => {
    expect(service).toMatch(/verifyFindingPaths/);
    expect(service).not.toMatch(/the mechanism is inert\b(?!")/);
  });
});

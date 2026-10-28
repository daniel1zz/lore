// @reads packages/lore/src/adapters/cli/**
// @reads assets/project/lore-config-template.yaml
/**
 * BR-1344 (replaces the corrupt site-map-value refusal of AC-BCG-1): a refusal site whose code declares a rule id that no live rule
 * holds is REPORTED by `lore baseline coverage`, naming the id, its status and file:line, and never refuses: exit exactly 0, the
 * unmapped site is not counted as mapped, and a retired rule reads as `retired`, not `unknown`.
 *
 * Fixture: the throwaway mini lore checkout of coverage-mini-corpus. Never touches the repo's .lore/.
 * Dimensions: NEGATIVE (unknown id reported, never mapped), STATE (the same declaration reads `retired` once its rule retires),
 * BOUNDARY (the report stays exit 0), HAPPY (a live own rule at the same site maps).
 */
import { afterEach, describe, expect, it } from "vitest";
import { MINI_CLI, buildMiniCorpus, type MiniCorpus } from "../../helpers/coverage-mini-corpus";
import { DECIDED_FLAGS } from "../../helpers/decision-flags";

const corpora: MiniCorpus[] = [];
afterEach(() => {
  for (const c of corpora.splice(0)) c.dispose();
});

const sharedWith = (rule: string): string => `import { err } from "./result.js";\nexport function checkShared() {\n  return err({ code: "ALPHA_BAD", rule: "${rule}" });\n}\n`;

interface LeafReport {
  slug: string;
  ok: boolean;
  mapped_sites: { rule: string }[];
  invalid_declarations: { rule: string; status: string; file: string; line: number }[];
}

async function coverage(c: MiniCorpus): Promise<{ exitCode: number; leafA: LeafReport; text: string }> {
  const json = await c.run(["baseline", "coverage", c.root, "--json"]);
  const leaves = (JSON.parse(json.stdout) as { data: { leaves: LeafReport[] } }).data.leaves;
  const text = await c.run(["baseline", "coverage", c.root]);
  return { exitCode: json.exitCode, leafA: leaves.find((l) => l.slug === c.leafA) as LeafReport, text: text.stdout };
}

describe("coverage reports a declaration naming a dead rule", () => {
  it("an id no baseline node holds is reported unknown with file:line, not mapped, exit 0", async () => {
    const c = await buildMiniCorpus();
    corpora.push(c);
    c.writeSource(`${MINI_CLI}/lib/shared.ts`, sharedWith("BR-99999"));
    const r = await coverage(c);
    expect(r.exitCode).toBe(0);
    expect(r.leafA.mapped_sites).toEqual([]);
    expect(r.leafA.invalid_declarations).toEqual([expect.objectContaining({ rule: "BR-99999", status: "unknown", file: `${MINI_CLI}/lib/shared.ts`, line: 3 })]);
    expect(r.leafA.ok).toBe(false);
    expect(r.text).toContain("BR-99999");
  }, 120_000);

  it("the same site maps once it declares the leaf's own live rule; retiring that rule turns the report to retired", async () => {
    const c = await buildMiniCorpus();
    corpora.push(c);
    const rule = c.ruleOf.get(c.leafA) as string;
    c.writeSource(`${MINI_CLI}/lib/shared.ts`, sharedWith(rule));
    const live = await coverage(c);
    expect(live.leafA.mapped_sites).toEqual([expect.objectContaining({ rule })]);
    expect(live.leafA.invalid_declarations).toEqual([]);
    const retired = await c.run(["rule", "set", rule, "--lifecycle", "retired", "--note", "gone", ...DECIDED_FLAGS]);
    expect(retired.exitCode, retired.stdout + retired.stderr).toBe(0);
    const after = await coverage(c);
    expect(after.exitCode).toBe(0);
    expect(after.leafA.mapped_sites).toEqual([]);
    expect(after.leafA.invalid_declarations).toEqual([expect.objectContaining({ rule, status: "retired" })]);
  }, 120_000);
});

// @reads packages/lore/src/adapters/cli/**
/**
 * AC-BCR-2: a corpus where one unaccounted (site, leaf) pair was fixed and another was added (the total number of
 * unaccounted pairs is unchanged) is NOT complete: `lore baseline coverage <root>` exits exactly 1, names the NEW
 * pair and the `lore baseline map <leaf> --site <key> ...` fix command for its leaf. A count-based ratchet would
 * read "1 gap before, 1 gap now" as no regression; the absolute check does not.
 *
 * Fixture: tests/helpers/coverage-mini-corpus.ts (throwaway mini checkout + corpus; never the repo's .lore/).
 * Not vacuous: the same corpus with the new pair also accounted for exits 0.
 *
 * @spec_ref spec-baseline-coverage-cannot-silently-regress-one-program#AC-BCR-2
 */
import { afterEach, describe, expect, it } from "vitest";
import { MINI_CLI, buildMiniCorpus, type MiniCorpus } from "../../helpers/coverage-mini-corpus";

const corpora: MiniCorpus[] = [];
afterEach(() => {
  for (const c of corpora.splice(0)) c.dispose();
});

const SHARED = `${MINI_CLI}/lib/shared.ts`;

/** `checkShared` with one failure site per code, so a code is one census site of the `alpha` command. */
function sharedWith(codes: string[]): string {
  const sites = codes.map((code) => `  if (flag === "${code}") return err({ code: "${code}" });`).join("\n");
  return `import { err } from "./result.js";\nexport function checkShared(flag: string = "") {\n${sites}\n  return err({ code: "ALPHA_BAD" });\n}\n`;
}

const keyFor = (code: string): string => `${SHARED}#checkShared#${code}`;

describe("AC-BCR-2 a swapped unaccounted pair is not complete", () => {
  it("fixing one gap while adding another (count unchanged) exits 1, naming the new pair and its fix", async () => {
    const c = await buildMiniCorpus();
    corpora.push(c);
    c.writeSource(SHARED, sharedWith(["ALPHA_OLD"]));
    await c.mapAllSites(c.leafB, "beta");
    await c.mapSite(c.leafA, keyFor("ALPHA_BAD"));

    // before: exactly one unaccounted pair (ALPHA_OLD on leaf A)
    const before = await c.run(["baseline", "coverage", c.root, "--json"]);
    expect(before.exitCode, before.stdout + before.stderr).toBe(1);
    const beforeGaps = (JSON.parse(before.stdout) as { data: { leaves: { slug: string; gaps: string[] }[] } }).data.leaves.flatMap((l) => l.gaps);
    expect(beforeGaps).toEqual([keyFor("ALPHA_OLD")]);

    // swap: the old pair is accounted for, a new one appears in the source
    await c.mapSite(c.leafA, keyFor("ALPHA_OLD"));
    c.writeSource(SHARED, sharedWith(["ALPHA_OLD", "ALPHA_NEW"]));
    const after = await c.run(["baseline", "coverage", c.root]);
    expect(after.exitCode, after.stdout + after.stderr).toBe(1);
    expect(after.stdout).toContain(keyFor("ALPHA_NEW"));
    expect(after.stdout).toContain(`lore baseline map ${c.leafA} --site ${keyFor("ALPHA_NEW")}`);
    expect(after.stdout).not.toContain(`gap          ${keyFor("ALPHA_OLD")}`);

    const afterJson = await c.run(["baseline", "coverage", c.root, "--json"]);
    const afterGaps = (JSON.parse(afterJson.stdout) as { data: { leaves: { gaps: string[] }[] } }).data.leaves.flatMap((l) => l.gaps);
    expect(afterGaps).toHaveLength(beforeGaps.length);
    expect(afterGaps).toEqual([keyFor("ALPHA_NEW")]);
  }, 180_000);

  it("control: the new pair also accounted for -> exit 0", async () => {
    const c = await buildMiniCorpus();
    corpora.push(c);
    c.writeSource(SHARED, sharedWith(["ALPHA_OLD", "ALPHA_NEW"]));
    await c.mapAllSites(c.leafB, "beta");
    await c.mapAllSites(c.leafA, "alpha");
    const r = await c.run(["baseline", "coverage", c.root]);
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
  }, 180_000);
});

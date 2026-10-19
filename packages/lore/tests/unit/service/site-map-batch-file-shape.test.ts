// @layer cli-baseline-map AC-BMB-3
// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
/**
 * AC-BMB-3: a `--sites-file` that is not valid JSON, is not an array, has a malformed row, or repeats a site key
 * is refused with VALIDATION_ERROR (exit 4) naming the problem; nothing is written (version and site map unchanged).
 *
 * Dimensions: NEGATIVE (each bad shape), ERROR (exact code + exit 4), STATE (nothing written), BOUNDARY (empty
 * array, duplicate against `--site`, missing file), HAPPY (a well-formed file next to the bad ones still works).
 * @spec_ref spec-one-baseline-map-call-maps-many-sites-of-a-leaf-as-one#AC-BMB-3
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMapFixture, type MapFixture } from "../../helpers/baseline-map-cli-fixture.js";

let fx: MapFixture;

beforeAll(async () => {
  fx = await buildMapFixture();
}, 120_000);
afterAll(() => fx.dispose());

interface Refusal {
  readonly name: string;
  readonly content: string;
  readonly mention: string;
  readonly extraArgs?: string[];
}

const REFUSALS: Refusal[] = [
  { name: "not valid JSON", content: "{not json", mention: "not valid JSON" },
  { name: "a JSON object, not an array", content: JSON.stringify({ site: "a#b#c", rules: ["BR-1"] }), mention: "JSON array" },
  { name: "an empty array", content: "[]", mention: "at least one row" },
  { name: "a row that is not an object", content: JSON.stringify(["a#b#c"]), mention: "row 1" },
  { name: "a row without a site", content: JSON.stringify([{ rules: ["BR-1"] }]), mention: "row 1" },
  { name: "a row without rules", content: JSON.stringify([{ site: "a#b#c" }]), mention: "BR-655" },
  { name: "a row with a key other than site and rules", content: JSON.stringify([{ site: "a#b#c", rules: ["BR-1"], reason: "x" }]), mention: "unknown key 'reason'" },
  { name: "a duplicate site key", content: JSON.stringify([{ site: "dup#f#1", rules: ["BR-1"] }, { site: "ok#f#2", rules: ["BR-1"] }, { site: "dup#f#1", rules: ["BR-1"] }]), mention: "dup#f#1" },
];

describe("--sites-file shape errors (AC-BMB-3)", () => {
  for (const c of REFUSALS) {
    it(`${c.name}: exit 4, VALIDATION_ERROR naming the problem, nothing written`, async () => {
      const file = fx.sitesFile(`shape-${REFUSALS.indexOf(c)}.json`, c.content);
      const before = await fx.leafState();
      const r = await fx.run(["baseline", "map", fx.leaf, "--sites-file", file, "--json"]);
      expect(r.exitCode).toBe(4);
      const body = JSON.parse(r.stdout) as { ok: boolean; error: { code: string; message: string } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain(c.mention);
      const after = await fx.leafState();
      expect(after.version).toBe(before.version);
      expect(after.siteMap).toEqual(before.siteMap);
    }, 120_000);
  }

  it("a site repeated between the file and --site is a duplicate: exit 4, nothing written", async () => {
    const file = fx.sitesFile("dup-flag.json", JSON.stringify([{ site: "same#f#1", rules: [fx.ownRule] }]));
    const before = await fx.leafState();
    const r = await fx.run(["baseline", "map", fx.leaf, "--sites-file", file, "--site", "same#f#1", "--rule", fx.ownRule, "--json"]);
    expect(r.exitCode).toBe(4);
    const body = JSON.parse(r.stdout) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("same#f#1");
    expect(await fx.leafState()).toEqual(before);
  }, 120_000);

  it("a missing file: exit 4 naming the path, nothing written", async () => {
    const before = await fx.leafState();
    const r = await fx.run(["baseline", "map", fx.leaf, "--sites-file", `${fx.dir}/nope.json`, "--json"]);
    expect(r.exitCode).toBe(4);
    const body = JSON.parse(r.stdout) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("nope.json");
    expect(await fx.leafState()).toEqual(before);
  }, 120_000);

  it("a well-formed file still writes after the refusals (they left no residue)", async () => {
    const file = fx.sitesFile("good.json", JSON.stringify([{ site: "good#f#1", rules: [fx.ownRule] }]));
    const r = await fx.run(["baseline", "map", fx.leaf, "--sites-file", file]);
    expect(r.exitCode).toBe(0);
    expect(Object.keys((await fx.leafState()).siteMap)).toEqual(["good#f#1"]);
  }, 120_000);
});

// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-landing-does-the-bookkeeping-claims-start-from-main-parked  AC-LB-3;
 *   business rule BR-1355 (anchors follow moved files at landing; a deleted anchored path refuses).
 *
 * Throwaway repo + corpus, real `lore` subprocesses (helpers/own-diff-fixture.ts, main-ref guard installed, floor
 * command `true`, each fixture claim under its own CLAUDE_CODE_SESSION_ID with the ambient one stripped).
 *
 * Coverage: (1) HAPPY a rename lands and the spec's code anchors follow it, one new version, `#Symbol` suffix kept;
 * (2) NEGATIVE a deleted anchored path refuses (exit 4, BR-1355, the doc and the path, main unchanged);
 * (3) STATE the same branch lands once the anchor is removed. REGRESSION (simplest green-but-broken): a rename read
 * without rename detection looks like delete+add and is refused under (2); (1) must land.
 */
import { afterEach, describe, expect, it } from "vitest";
import { OwnDiffFixture } from "../helpers/own-diff-fixture.js";

const X_SOURCE = "export function alpha(): number {\n  return 1;\n}\n\nexport function beta(): number {\n  return 2;\n}\n";
const BASE = { "src/x.ts": X_SOURCE, "src/z.ts": "export const z = 1;\n", "src/w.ts": "export const w = 1;\n" };

let fx: OwnDiffFixture | undefined;

afterEach(() => {
  fx?.dispose();
  fx = undefined;
});

function specAnchors(f: OwnDiffFixture, spec: string): string[] {
  return f.extraOf(spec)["code_anchors"] as string[];
}

function versionOf(f: OwnDiffFixture, slug: string): number {
  const payload = JSON.parse(f.mustLore(["get", slug, "--json"]).stdout) as { data: { doc: { version: number } } };
  return payload.data.doc.version;
}

describe("AC-LB-3 — anchors follow moved files at landing", () => {
  it("(1) a rename lands and the spec's anchors follow; (2) a deleted anchored path refuses; (3) it lands once the anchor is removed", () => {
    const f = new OwnDiffFixture();
    fx = f;
    f.commitOnMain(BASE, "base sources");
    const spec = f.parseSlug(
      f.mustLore(["create", "spec", "--title", "Anchored spec", "--content", "## Overview\nx", "--no-ai", "--code-anchor", "src/x.ts#alpha", "--code-anchor", "src/x.ts", "--code-anchor", "src/z.ts"]).stdout,
    );
    expect(specAnchors(f, spec)).toEqual(["src/x.ts#alpha", "src/x.ts", "src/z.ts"]);

    // (1) branch X renames src/x.ts to src/y.ts
    f.makeBranch("branch-x", { "src/x.ts": null, "src/y.ts": X_SOURCE });
    const taskX = f.createTask("TX", ["src/y.ts", "src/x.ts"]);
    f.claim(taskX, "branch-x");
    const versionBefore = versionOf(f, spec);

    const landed = f.integrate("branch-x");

    expect(landed.exitCode, landed.text).toBe(0);
    expect(specAnchors(f, spec)).toEqual(["src/y.ts#alpha", "src/y.ts", "src/z.ts"]);
    expect(specAnchors(f, spec)).not.toContain("src/x.ts");
    expect(versionOf(f, spec)).toBe(versionBefore + 1);

    // (2) branch W deletes src/z.ts, which the spec anchors
    f.makeBranch("branch-w", { "src/z.ts": null });
    const taskW = f.createTask("TW", ["src/z.ts"]);
    f.claim(taskW, "branch-w");
    const before = f.observableState();

    const refused = f.integrate("branch-w");

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.stderr).toContain("BR-1355");
    expect(refused.stderr).toContain(spec);
    expect(refused.stderr).toContain("src/z.ts");
    expect(f.observableState()).toBe(before);
    expect(specAnchors(f, spec)).toContain("src/z.ts");

    // (3) the anchor is removed, the same branch lands
    f.mustLore(["anchor", "rm", spec, "src/z.ts"]);

    const relanded = f.integrate("branch-w");

    expect(relanded.exitCode, relanded.text).toBe(0);
  }, 300_000);

  it("a knowledge doc's anchor follows a rename like a spec's, and a document anchoring nothing moved is not rewritten", () => {
    const f = new OwnDiffFixture();
    fx = f;
    f.commitOnMain(BASE, "base sources");
    const knowledge = f.parseSlug(
      f.mustLore(["create", "knowledge", "--title", "Anchored fact", "--sub-type", "reference", "--content", "w is one", "--no-ai"]).stdout,
    );
    f.mustLore(["anchor", "add", knowledge, "src/w.ts#w"]);
    const knowledgeVersion = versionOf(f, knowledge);
    const bystander = f.parseSlug(
      f.mustLore(["create", "spec", "--title", "Bystander spec", "--content", "## Overview\nx", "--no-ai", "--code-anchor", "src/z.ts"]).stdout,
    );
    const bystanderVersion = versionOf(f, bystander);
    f.makeBranch("branch-r", { "src/w.ts": null, "src/w2.ts": "export const w = 1;\n" });
    const task = f.createTask("TR", ["src/w2.ts"]);
    f.claim(task, "branch-r");

    const landed = f.integrate("branch-r");

    expect(landed.exitCode, landed.text).toBe(0);
    expect(specAnchors(f, knowledge)).toEqual(["src/w2.ts#w"]);
    expect(versionOf(f, knowledge)).toBe(knowledgeVersion + 1);
    expect(versionOf(f, bystander)).toBe(bystanderVersion);
    expect(specAnchors(f, bystander)).toEqual(["src/z.ts"]);
  }, 300_000);
});

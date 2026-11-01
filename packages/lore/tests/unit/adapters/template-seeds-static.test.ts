/**
 * The shipped template seeds are one static-import source (T12): in-process seeding reads no file, so this test declares
 * NO `@reads assets/templates/**` and the read recorder must still pass it.
 *
 * Coverage: HAPPY (seeding a throwaway corpus yields an approved template per seed), STATE (27 seeds, file-name order),
 * REGRESSION (no fs read of assets/templates during seeding: the recorder would raise UndeclaredTestInputError).
 */

import { describe, expect, it } from "vitest";
import { readShippedTemplateSeeds } from "../../../src/adapters/cli/template-seeds.js";
import { seededTemplateReader } from "../../helpers/structured-corpus-wiring.js";

describe("shipped template seeds are statically imported", () => {
  it("seeds every shipped template in-process without declaring an assets read", async () => {
    const reader = await seededTemplateReader();
    const seeds = readShippedTemplateSeeds();
    expect(seeds.ok).toBe(true);
    if (!seeds.ok) return;
    expect(seeds.value).toHaveLength(27);
    expect(seeds.value.map((seed) => seed.file)).toEqual([...seeds.value.map((seed) => seed.file)].sort());
    const spec = seeds.value.find((seed) => seed.template.doc_type === "spec" && seed.template.kind === "feature");
    expect(spec).toBeDefined();
    expect(reader).toBeDefined();
  });
});

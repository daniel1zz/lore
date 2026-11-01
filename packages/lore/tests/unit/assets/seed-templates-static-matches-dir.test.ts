// @reads assets/templates/**
/**
 * Drift guard (assets-ssot style): the statically imported seed set is exactly `assets/templates/*.json`, with the same
 * parsed content. A seed added to or removed from the directory without updating `template-seeds.ts` fails here.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTemplate } from "@lore/core";
import { readShippedTemplateSeeds, SHIPPED_TEMPLATE_SEED_FILES } from "../../../src/adapters/cli/template-seeds.js";

const templatesDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "assets", "templates");

describe("static seed imports match assets/templates", () => {
  it("lists exactly the directory's json files", () => {
    const onDisk = readdirSync(templatesDir).filter((name) => name.endsWith(".json")).sort();
    expect([...SHIPPED_TEMPLATE_SEED_FILES].sort()).toEqual(onDisk);
  });

  it("carries the same parsed content as each file", () => {
    const seeds = readShippedTemplateSeeds();
    expect(seeds.ok).toBe(true);
    if (!seeds.ok) return;
    for (const seed of seeds.value) {
      const fromDisk = parseTemplate(JSON.parse(readFileSync(join(templatesDir, seed.file), "utf8")));
      expect(fromDisk.ok, seed.file).toBe(true);
      if (fromDisk.ok) expect(seed.template, seed.file).toEqual(fromDisk.value);
    }
  });
});

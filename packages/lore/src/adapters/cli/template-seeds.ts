/**
 * Reader for the shipped template seeds (`assets/templates/*.json`).
 *
 * Purpose: hand `TemplateSeedService` the parsed seeds; the file reading is an adapter concern (the services read no
 *   assets), and the contents are read from the resolved assets root at runtime, like `assets/context/`.
 * Public surface: {@link readShippedTemplateSeeds}.
 * Invariants:
 *   - Every `*.json` in the directory is a seed; a file that is not JSON or fails the core meta-schema is a loud
 *     VALIDATION_ERROR naming the file, never skipped (a skipped seed would leave a type with no template).
 *   - Order is the file-name order, so previews and outcomes are deterministic.
 * Side-effect class: IO (reads the directory).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, parseTemplate, type LoreError, type Result } from "@lore/core";
import { seedFileError, type TemplateSeed } from "../../service/template-seed-service.js";

/**
 * Read and parse every shipped seed.
 *
 * @param assetsRoot - the resolved `assets/` root
 * @returns the seeds in file-name order, or the first invalid seed as an error naming its file
 */
export function readShippedTemplateSeeds(assetsRoot: string): Result<TemplateSeed[], LoreError> {
  const dir = join(assetsRoot, "templates");
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  } catch (cause) {
    return err({ code: "STORE_ERROR", message: `cannot read the shipped template seeds in ${dir}: ${cause instanceof Error ? cause.message : String(cause)}` });
  }
  const seeds: TemplateSeed[] = [];
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (cause) {
      return err(seedFileError(file, `not valid JSON (${cause instanceof Error ? cause.message : String(cause)})`));
    }
    const parsed = parseTemplate(raw);
    if (!parsed.ok) return err(seedFileError(file, parsed.error.map((issue) => `${issue.path}: ${issue.problem}`).join("; ")));
    seeds.push({ file, template: parsed.value });
  }
  return ok(seeds);
}

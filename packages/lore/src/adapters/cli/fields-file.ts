/**
 * `--fields-file` reader shared by `lore create` and `lore set`.
 *
 * Purpose: turn a YAML or JSON file into the structured content of a templated document.
 * Public surface: {@link readFieldsFile}, {@link FieldsFileContent}.
 * Invariants:
 *   - The file is an object with an optional `fields` object and an optional `dimensions` array; any other top-level
 *     key is refused by name (so a typo such as `field:` cannot silently drop a whole section).
 *   - Parsing only: nothing is validated against a template here. The one validating path is `CorpusService`.
 *   - Never throws; every failure is a VALIDATION_ERROR naming the file.
 * Side-effect class: IO (reads one file).
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { err, ok, validationError, type LoreError, type Result } from "@lore/core";

/** The accepted shape; `.strict()` refuses unknown top-level keys. */
const fieldsFileSchema = z
  .object({
    fields: z.record(z.unknown()).optional(),
    dimensions: z.array(z.unknown()).optional(),
  })
  .strict();

/** Parsed content of a `--fields-file`. */
export type FieldsFileContent = z.infer<typeof fieldsFileSchema>;

/**
 * Read and parse a fields file.
 *
 * @param path - file path (`.yaml`, `.yml` or `.json`; YAML parsing accepts JSON, so the extension is not trusted)
 * @returns the parsed content, or a VALIDATION_ERROR naming the file and the problem
 */
export function readFieldsFile(path: string): Result<FieldsFileContent, LoreError> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    return err(validationError("fields-file", `cannot read --fields-file '${path}': ${cause instanceof Error ? cause.message : String(cause)}`, path));
  }
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (cause) {
    return err(validationError("fields-file", `--fields-file '${path}' is not valid YAML or JSON: ${cause instanceof Error ? cause.message : String(cause)}`, path));
  }
  const parsed = fieldsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`).join("; ");
    return err(validationError("fields-file", `--fields-file '${path}' must be an object with \`fields\` and/or \`dimensions\`: ${problems}`, path));
  }
  return ok(parsed.data);
}

/**
 * Test helper: create a templated document with FIELDS, never a body (spec-every-document-is-stored-as-structured-fields-validated-by).
 *
 * Purpose: the one place a shared fixture gets the arguments of a structured create. For a (type, kind) it fills the approved
 *   template (the shipped seed `lore init` seeds, through `fillTemplate`), merges the caller's overrides, writes a fields file
 *   and returns the `--fields-file <path>` args; the service-path twin returns the `extra` a `CorpusService.create` takes.
 *   A fixture built on it works with `workflow.structured_documents.require_create` ON or OFF.
 * Public surface: {@link templatedFill}, {@link templatedFieldsArgs}, {@link templatedExtra}, {@link TemplatedFillOptions}.
 * Invariants:
 *   - Filled values are the minimal deterministic ones of `fillTemplate`; `fields` overrides replace top-level keys.
 *   - A fields file is written once per call under one process-lifetime temp directory (or the `dir` the caller names); the
 *     directory is removed at process exit. Nothing is written inside any corpus.
 *   - A (type, kind) with no shipped template throws (a fixture fault), never falls back to a body.
 * Side-effect class: IO (a fields file in a temp directory).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DimensionAnswer } from "@lore/core";
import { fillShippedTemplate } from "./structured-corpus-wiring.js";

/** What a caller may say about the filled content. */
export interface TemplatedFillOptions {
  /** The template's kind (spec `--kind`, knowledge `--sub-type`, baseline `--node`); omit for a type with none. */
  readonly kind?: string;
  /** Merged OVER the filled fields (top-level keys replace). */
  readonly fields?: Record<string, unknown>;
  /** Replaces the filled dimension answers when given. */
  readonly dimensions?: DimensionAnswer[];
  /** The ref a dimension that needs one cites (default: the fillTemplate fixture ref). */
  readonly refTarget?: string;
  /** Directory the fields file goes into (default: a process-lifetime temp directory). */
  readonly dir?: string;
}

let sharedDir: string | undefined;
let fileSeq = 0;

function fieldsDir(): string {
  if (sharedDir === undefined) {
    const made = mkdtempSync(join(tmpdir(), "lore-templated-fields-"));
    sharedDir = made;
    process.once("exit", () => rmSync(made, { recursive: true, force: true }));
  }
  return sharedDir;
}

/**
 * The filled `{fields, dimensions}` of a (type, kind), overrides applied.
 *
 * @param type - the document type
 * @param options - kind and overrides
 * @returns valid fields and dimension answers
 * @throws when no shipped template matches
 */
export function templatedFill(type: string, options: TemplatedFillOptions = {}): { fields: Record<string, unknown>; dimensions: DimensionAnswer[] } {
  const filled = fillShippedTemplate(type, options.kind, options.refTarget);
  return { fields: { ...filled.fields, ...(options.fields ?? {}) }, dimensions: options.dimensions ?? filled.dimensions };
}

/**
 * The CLI arguments of a structured create: `["--fields-file", <path>]`, the file holding the filled template.
 *
 * @param type - the document type
 * @param options - kind, overrides and the directory for the file
 * @returns the two arguments to append to a `lore create` / `lore baseline add` command
 * @throws when no shipped template matches
 */
export function templatedFieldsArgs(type: string, options: TemplatedFillOptions = {}): string[] {
  const path = join(options.dir ?? fieldsDir(), `fields-${type}-${String(++fileSeq)}.json`);
  writeFileSync(path, JSON.stringify(templatedFill(type, options), null, 2));
  return ["--fields-file", path];
}

/**
 * The service-path twin: the `fields` and `dimensions` a `CorpusService.create` takes inside `extra`.
 *
 * @param type - the document type
 * @param options - kind and overrides
 * @returns `{fields, dimensions}`, to spread into `extra`
 * @throws when no shipped template matches
 */
export function templatedExtra(type: string, options: TemplatedFillOptions = {}): { fields: Record<string, unknown>; dimensions: DimensionAnswer[] } {
  return templatedFill(type, options);
}

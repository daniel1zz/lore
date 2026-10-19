/**
 * Test-only adapter that lets the pre-existing predicate-style reference tests
 * (`claude-md-admission.test.ts`, `claude-md-reference-grammar.test.ts`) keep driving the
 * production path: `extractCodeReferences` (admission grammar) feeding
 * `resolveCodeReferences` (the one core resolver). It owns no logic of its own beyond
 * turning an existence predicate into the `FsProbe` port the resolver reads through.
 *
 * Side-effect class: pure (reads only through the injected predicate / reader).
 */

import { resolveCodeReferences, type FsProbe } from "@lore/core";
import { extractCodeReferences } from "../../../src/service/claude-md-admission.js";

/** One unresolved reference in the shape the legacy suites assert on. */
export type UnresolvedReference = {
  kind: "reference_unresolved";
  drift_kind: string;
  path: string;
  reference: string;
  message: string;
};

/**
 * @param content - Memory file text.
 * @param fileExists - Existence predicate; a path is a directory when only `<path>/` exists.
 * @param filePath - The scanned file's own path (module-relative resolution).
 * @param readFile - Content reader for `#Symbol` / script references; `null` = unreadable.
 * @returns One finding per reference the resolver could not verify.
 */
export function checkReferenceExistence(
  content: string,
  fileExists: (p: string) => boolean,
  filePath?: string,
  readFile: (p: string) => string | null = () => null,
): UnresolvedReference[] {
  const probe: FsProbe = {
    stat: (p) => (fileExists(p) ? "file" : fileExists(`${p}/`) ? "dir" : "missing"),
    readFile,
    listDir: () => ["child"],
  };
  return resolveCodeReferences(extractCodeReferences(content, filePath), probe).map(({ reference, kind }) => ({
    kind: "reference_unresolved" as const,
    drift_kind: kind,
    path: reference.path,
    reference: reference.raw,
    message: `${reference.raw} (${kind})`,
  }));
}

/**
 * The ONE reverse index of code references (spec-prose-about-code-is-bound-to-what-it-describes-one,
 * D2): answers "which documents bind to this path" over spec and knowledge `code_anchors`
 * AND the references written in memory files and context fragments, each entry naming the
 * document, the line and the bound path / symbol / script. `lore refs <path>` reads it, and
 * so will every later consumer; nothing builds a second index.
 *
 * Public surface:
 *   - {@link buildReferenceIndex} — collect every binding from the supplied sources.
 *   - {@link findBindings} — the bindings that bind a given repo-relative path.
 *   - {@link ReferenceBinding} / {@link ReferenceIndexSources}.
 *
 * Invariants:
 *   - Prose references are extracted with `extractCodeReferences` (the same grammar the
 *     memory-file check uses) and a reference that exists only at an ancestor-relative path
 *     binds to the path that exists, never to the root-relative guess.
 *   - A folder anchor binds every path under it; any other binding matches its path exactly.
 *   - A script binding's path is the governing package.json, with `script` naming the script.
 *   - Output order is deterministic: document kind, document, line.
 *
 * Side-effect class: pure (filesystem observations come through the injected `FsProbe`).
 */

import { err, normalizeFileAnchors, ok, type DriftInputEntry, type FsProbe, type LoreError, type Result } from "@lore/core";
import { extractCodeReferences } from "./claude-md-admission.js";

/** Which kind of document holds a binding. */
export const REFERENCE_DOCUMENT_KINDS = ["spec", "knowledge", "memory_file", "fragment"] as const;
export type ReferenceDocumentKind = (typeof REFERENCE_DOCUMENT_KINDS)[number];

/** One statement in one document that binds to code. */
export interface ReferenceBinding {
  /** Slug for a spec or knowledge document; repo-relative file path for a memory file or fragment. */
  document: string;
  document_kind: ReferenceDocumentKind;
  /** The raw anchor or the raw backticked reference as written. */
  reference: string;
  /** Normalized repo-relative path the reference binds to (no trailing slash). */
  path: string;
  /** 1-based line in a memory file or fragment; absent for a spec/knowledge anchor (a field, not a line). */
  line?: number;
  symbol?: string;
  script?: string;
  /** True when the binding is a folder anchor / folder reference (binds everything beneath `path`). */
  folder?: true;
}

/** Everything the index is built from. */
export interface ReferenceIndexSources {
  /** `DriftCheckService.listDeclaredAnchors()` output. */
  declaredAnchors: readonly DriftInputEntry[];
  /** Memory files (root, module, rules). */
  memoryFiles: ReadonlyArray<{ path: string; content: string }>;
  /** Context fragments, raw file text. */
  fragments: ReadonlyArray<{ path: string; content: string }>;
  /** Names of the governing package.json scripts; lets a bare backticked script name bind. */
  knownScripts: ReadonlySet<string>;
  /** Filesystem port used to pick which candidate path an ancestor-relative reference means. */
  probe: FsProbe;
}

/** The built index; opaque to callers beyond {@link findBindings}. */
export interface ReferenceIndex {
  readonly bindings: readonly ReferenceBinding[];
}

const KIND_ORDER: Readonly<Record<ReferenceDocumentKind, number>> = {
  spec: 0,
  knowledge: 1,
  memory_file: 2,
  fragment: 3,
};

function anchorBinding(entry: DriftInputEntry): ReferenceBinding {
  const { anchor } = entry;
  return {
    document: entry.doc_slug,
    document_kind: entry.doc_type === "spec" ? "spec" : "knowledge",
    reference: anchor.raw,
    path: anchor.path,
    ...(anchor.symbol === undefined ? {} : { symbol: anchor.symbol }),
    ...(anchor.isDir ? { folder: true as const } : {}),
  };
}

function proseBindings(
  documents: ReadonlyArray<{ path: string; content: string }>,
  kind: "memory_file" | "fragment",
  knownScripts: ReadonlySet<string>,
  probe: FsProbe,
): ReferenceBinding[] {
  const bindings: ReferenceBinding[] = [];
  for (const document of documents) {
    for (const reference of extractCodeReferences(document.content, document.path, knownScripts)) {
      const candidates = [reference.path, ...(reference.alternativePaths ?? [])];
      const boundPath = candidates.find((candidate) => probe.stat(candidate) !== "missing") ?? reference.path;
      bindings.push({
        document: document.path,
        document_kind: kind,
        reference: reference.raw,
        path: boundPath,
        line: reference.line,
        ...(reference.symbol === undefined ? {} : { symbol: reference.symbol }),
        ...(reference.script === undefined ? {} : { script: reference.script }),
        ...(reference.isDir ? { folder: true as const } : {}),
      });
    }
  }
  return bindings;
}

/**
 * Builds the reverse index from every source of code references.
 *
 * @param sources - Declared anchors, memory files, fragments, known scripts and a probe.
 * @returns The index, bindings ordered by document kind, document, then line.
 * @example
 * buildReferenceIndex({ declaredAnchors: [], memoryFiles: [{ path: "CLAUDE.md", content: "See `a/b.ts`." }],
 *   fragments: [], knownScripts: new Set(), probe });
 * // => { bindings: [{ document: "CLAUDE.md", document_kind: "memory_file", reference: "a/b.ts", path: "a/b.ts", line: 1 }] }
 */
export function buildReferenceIndex(sources: ReferenceIndexSources): ReferenceIndex {
  const bindings = [
    ...sources.declaredAnchors.map(anchorBinding),
    ...proseBindings(sources.memoryFiles, "memory_file", sources.knownScripts, sources.probe),
    ...proseBindings(sources.fragments, "fragment", sources.knownScripts, sources.probe),
  ];
  bindings.sort(
    (a, b) =>
      KIND_ORDER[a.document_kind] - KIND_ORDER[b.document_kind] ||
      a.document.localeCompare(b.document) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      a.reference.localeCompare(b.reference),
  );
  return { bindings };
}

/**
 * Normalizes a user-supplied path to the index's path form (repo-relative, forward slashes,
 * no trailing slash) with the same normalizer task file anchors use.
 *
 * @param raw - Path as typed (`./a/b.ts`, `a//b.ts`, `a/`).
 * @returns The normalized path, or a VALIDATION_ERROR naming the offending value.
 */
export function normalizeQueryPath(raw: string): Result<string, LoreError> {
  const normalized = normalizeFileAnchors([raw]);
  const first = normalized.ok ? normalized.value[0] : undefined;
  if (!normalized.ok || first === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "path",
      message: `"${raw}" is not a repo-relative path`,
      value: raw,
    });
  }
  return ok(first.replace(/\/$/, ""));
}

/**
 * The bindings that bind `path`: an exact path match, or a folder binding that contains it.
 * A path with no binding yields an empty array (never an error).
 *
 * @param index - The built index.
 * @param path - Normalized path from {@link normalizeQueryPath}.
 * @returns Matching bindings in index order.
 */
export function findBindings(index: ReferenceIndex, path: string): ReferenceBinding[] {
  return index.bindings.filter(
    (binding) => binding.path === path || (binding.folder === true && path.startsWith(`${binding.path}/`)),
  );
}


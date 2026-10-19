/**
 * The ONE resolver for code references (spec-prose-about-code-is-bound-to-what-it-describes-one,
 * D1): a spec/knowledge `code_anchors` entry and a reference written in a memory file or
 * context fragment (a path, `path#Symbol`, or a package.json script) are classified by the
 * same function, `computeDrift` in `code-anchors.ts`. This module owns the two pieces around
 * it: collecting filesystem probes through the {@link FsProbe} port, and resolving prose
 * references (which carry a line number and may resolve module-relative).
 *
 * Public surface:
 *   - {@link FsProbe} — the read-only filesystem port (stat / readFile / listDir).
 *   - {@link collectAnchorProbes} — probe each distinct anchor path once, as `computeDrift` needs.
 *   - {@link CodeReference} / {@link resolveCodeReferences} — resolve prose references to
 *     {@link ReferenceFinding}s.
 *
 * Invariants:
 *   - Never reads the filesystem itself; every observation comes through `FsProbe`.
 *   - A probe that throws or returns null is a `probe_error` finding, never "fine".
 *   - A prose path reference is satisfied by a file OR a directory (prose says `commands/`
 *     and `set.ts` loosely); a spec anchor's file/dir strictness is unchanged.
 *   - One finding per distinct reference (path, symbol, script), first occurrence kept.
 *
 * Side-effect class: pure (all IO is behind the injected `FsProbe`).
 */

import { computeDrift } from "./code-anchors.js";
import type { AnchorProbe, DriftInputEntry, DriftKind, ExportedNames, ParsedCodeAnchor } from "./code-anchors.js";

/** Read-only filesystem port; paths are repo-relative, forward-slash, no trailing slash. */
export interface FsProbe {
  stat(path: string): "file" | "dir" | "missing";
  readFile(path: string): string | null;
  listDir(path: string): string[] | null;
  /**
   * Decides which names `content` (the text of the repo-relative file `path`) exports, by parsing it
   * (BR-417). Optional because the parser cannot live in this browser-safe package; a probe without
   * it makes every symbol anchor "not measured" — never a guess. May follow re-exports through the
   * probe's own `readFile`. Must not throw for unparseable input: it returns `notMeasured` instead.
   */
  readExportedNames?(path: string, content: string): ExportedNames;
}

/** package.json that governs every script reference (the repo root one). */
export const GOVERNING_PACKAGE_JSON = "package.json";

/** Shape `collectAnchorProbes` needs from an anchor: which probe calls it requires. */
type ProbedAnchor = Pick<ParsedCodeAnchor, "path" | "isDir" | "symbol" | "title" | "script">;

function describeCaught(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * Probes every DISTINCT anchor path once, collecting only what the anchors on that path
 * need (children for a directory anchor, content for a symbol/title/script anchor).
 *
 * @param anchors - Every anchor to be classified.
 * @param probe - The filesystem port.
 * @returns Probe results keyed by anchor path; a failed call sets `error` on that path.
 */
export function collectAnchorProbes(anchors: readonly ProbedAnchor[], probe: FsProbe): Map<string, AnchorProbe> {
  const descriptors = new Map<string, { needsListDir: boolean; needsContent: boolean; needsExports: boolean }>();
  for (const anchor of anchors) {
    const existing = descriptors.get(anchor.path) ?? { needsListDir: false, needsContent: false, needsExports: false };
    if (anchor.isDir) existing.needsListDir = true;
    if (anchor.symbol !== undefined || anchor.title !== undefined || anchor.script !== undefined) {
      existing.needsContent = true;
    }
    if (anchor.symbol !== undefined) existing.needsExports = true;
    descriptors.set(anchor.path, existing);
  }

  const probes = new Map<string, AnchorProbe>();
  for (const [path, descriptor] of descriptors) {
    const result: AnchorProbe = {};
    try {
      result.stat = probe.stat(path);
    } catch (caught) {
      result.error = describeCaught(caught);
      probes.set(path, result);
      continue;
    }

    if (result.stat === "dir" && descriptor.needsListDir) {
      try {
        const children = probe.listDir(path);
        if (children === null) result.error = `listDir returned null for "${path}"`;
        else result.children = children;
      } catch (caught) {
        result.error = describeCaught(caught);
      }
    }

    if (result.stat === "file" && descriptor.needsContent) {
      try {
        const content = probe.readFile(path);
        if (content === null) result.error = `readFile returned null for "${path}"`;
        else result.content = content;
      } catch (caught) {
        result.error = describeCaught(caught);
      }
    }

    if (result.content !== undefined && descriptor.needsExports) {
      if (probe.readExportedNames === undefined) {
        result.exported = { names: new Set(), notMeasured: "this probe has no export reader" };
      } else {
        try {
          result.exported = probe.readExportedNames(path, result.content);
        } catch (caught) {
          result.error = describeCaught(caught);
        }
      }
    }
    probes.set(path, result);
  }
  return probes;
}

/** One reference found in a memory file or fragment, already grammar-checked and normalized. */
export interface CodeReference {
  /** The raw backticked text, `#Symbol` included (`bun run x` references carry the script name). */
  raw: string;
  /** Normalized repo-relative path without trailing slash; {@link GOVERNING_PACKAGE_JSON} for a script reference. */
  path: string;
  /** True when the prose wrote a trailing slash. */
  isDir: boolean;
  symbol?: string;
  script?: string;
  /** 1-based line of the reference in its document. */
  line: number;
  /** The same reference resolved against each ancestor directory of the document (nearest first); consulted only when `path` is missing. */
  alternativePaths?: readonly string[];
}

/** A reference the resolver could not affirmatively verify. */
export interface ReferenceFinding {
  reference: CodeReference;
  kind: DriftKind;
  detail?: string;
}

/** Identity tag the resolver gives each reference so a drift row maps back to it. */
const REFERENCE_DOC_TYPE = "knowledge" as const;

function toDriftEntry(tag: string, anchor: ParsedCodeAnchor): DriftInputEntry {
  return { doc_id: tag, doc_slug: tag, doc_type: REFERENCE_DOC_TYPE, doc_status: "reference", anchor };
}

function toAnchor(reference: CodeReference, path: string, isDir: boolean): ParsedCodeAnchor {
  return {
    raw: reference.raw,
    path,
    isDir,
    ...(reference.symbol === undefined ? {} : { symbol: reference.symbol }),
    ...(reference.script === undefined ? {} : { script: reference.script }),
  };
}

/**
 * Resolves prose references with `computeDrift`. A path-only reference is satisfied by a
 * file or a directory (the probe decides which `isDir` to classify with); a reference
 * missing at its repo-relative `path` gets one more chance at each of `alternativePaths`.
 * References are de-duplicated by (path, symbol, script); the first occurrence is kept.
 *
 * @param references - References extracted from one or more documents.
 * @param probe - The filesystem port.
 * @returns One finding per reference that did not verify, in input order.
 * @example
 * resolveCodeReferences([{ raw: "a/b.ts#Gone", path: "a/b.ts", isDir: false, symbol: "Gone", line: 3 }], probe);
 * // => [{ reference: {...}, kind: "symbol_missing" }]
 */
export function resolveCodeReferences(references: readonly CodeReference[], probe: FsProbe): ReferenceFinding[] {
  const seen = new Set<string>();
  const distinct: CodeReference[] = [];
  for (const reference of references) {
    const key = `${reference.path}\u0000${reference.symbol ?? ""}\u0000${reference.script ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(reference);
  }

  // Candidate anchors: the primary one plus the module-relative alternative.
  const primary = distinct.map((reference) => toAnchor(reference, reference.path, reference.isDir));
  const probes = collectAnchorProbes(primary, probe);
  // A prose path may name a directory without a trailing slash (or a file with one): classify
  // by what the probe observed so only absence is a finding.
  const classified = distinct.map((reference, index) => {
    const anchor = primary[index] as ParsedCodeAnchor;
    if (reference.symbol !== undefined || reference.script !== undefined) return anchor;
    const observed = probes.get(anchor.path)?.stat;
    return observed === "dir" ? { ...anchor, isDir: true } : { ...anchor, isDir: false };
  });
  const dirsNeedingChildren = classified.filter((anchor) => anchor.isDir);
  for (const [path, extra] of collectAnchorProbes(dirsNeedingChildren, probe)) probes.set(path, extra);

  const { drifts } = computeDrift(
    classified.map((anchor, index) => toDriftEntry(String(index), anchor)),
    probes,
  );

  const findings: ReferenceFinding[] = [];
  for (const drift of drifts) {
    const reference = distinct[Number(drift.doc_id)] as CodeReference;
    if (isMissingKind(drift.kind) && reference.alternativePaths !== undefined) {
      const { alternativePaths, ...withoutAlternatives } = reference;
      const resolvesElsewhere = alternativePaths.some(
        (path) => resolveCodeReferences([{ ...withoutAlternatives, path }], probe).length === 0,
      );
      if (resolvesElsewhere) continue;
    }
    findings.push({ reference, kind: drift.kind, ...(drift.detail === undefined ? {} : { detail: drift.detail }) });
  }
  return findings;
}

function isMissingKind(kind: DriftKind): boolean {
  return kind === "file_missing" || kind === "dir_missing";
}

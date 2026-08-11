/**
 * Six-dimension tests for the code-anchors pure layer (SPEC-045 §Design Decisions D1,
 * D2, D3) — `parseCodeAnchor`, `serializeCodeAnchor`, `normalizeCodeAnchorEntries`,
 * `scanExportedSymbols`, `computeDrift`.
 *
 * Dimension mapping:
 *   HAPPY:      parseCodeAnchor parses plain/dir/symbol anchors; scanExportedSymbols
 *               matches every D3 form; computeDrift classifies a fully-consistent
 *               anchor set with no drift rows
 *   NEGATIVE:   dir+symbol rejected; Unicode symbol rejected; malformed symbol chars
 *               rejected; `..`-path rejected; scanExportedSymbols does not match
 *               commented-out or mid-line occurrences; `export type {}` and
 *               destructured exports produce symbol_missing (not a crash, not a
 *               false consistent)
 *   BOUNDARY:   last-# split on a path containing an earlier `#`; reserved-word
 *               symbols (e.g. "default", "class") are admitted by the grammar;
 *               a bare `export default` matches regardless of trailing form
 *   ERROR:      probe_error kind when a probe carries `error`, when no probe is
 *               recorded for a path, and when a file anchor with a symbol has no
 *               collected content
 *   STATE:      per-entry parse never batch-normalizes — "a.ts#Foo" + "a.ts#Bar" both
 *               survive as distinct declared anchors (review S3 regression guard)
 *   REGRESSION: computeDrift's `consistent` flips to false on ANY single drift row;
 *               all six drift kinds are independently reachable, including
 *               node_type_mismatch in both directions
 *
 * @spec_ref SPEC-045 §Design Decisions D1, D2, D3; AC-DR-1
 */

import { describe, it, expect } from "vitest";
import {
  parseCodeAnchor,
  serializeCodeAnchor,
  normalizeCodeAnchorEntries,
  scanExportedSymbols,
  computeDrift,
  type DriftInputEntry,
  type AnchorProbe,
  type ParsedCodeAnchor,
} from "../src/code-anchors.js";

function makeEntry(overrides: Partial<DriftInputEntry> = {}): DriftInputEntry {
  const anchor: ParsedCodeAnchor =
    overrides.anchor ?? { raw: "src/a.ts", path: "src/a.ts", isDir: false };
  return {
    spec_id: "01SPEC000000000000000001",
    doc_slug: "spec-x",
    // The default fixture is a SPEC-owned anchor. The knowledge-owned population and
    // the per-row doc_type attribution live in
    // packages/lore/tests/unit/service/drift-population-reporting.test.ts.
    doc_type: "spec",
    spec_status: "approved",
    ...overrides,
    anchor,
  };
}

// ─── HAPPY — parseCodeAnchor / serializeCodeAnchor ─────────────────────────

describe("HAPPY — parseCodeAnchor", () => {
  it("parses a plain file path with no symbol", () => {
    const result = parseCodeAnchor("src/a.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ raw: "src/a.ts", path: "src/a.ts", isDir: false });
    }
  });

  it("parses a file path with a #Symbol", () => {
    const result = parseCodeAnchor("src/a.ts#Exported");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        raw: "src/a.ts#Exported",
        path: "src/a.ts",
        isDir: false,
        symbol: "Exported",
      });
    }
  });

  it("parses a directory scope anchor (trailing slash, no symbol)", () => {
    const result = parseCodeAnchor("src/dir/");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ raw: "src/dir/", path: "src/dir", isDir: true });
    }
  });

  it("normalizes the path part via the shared file-anchors rules (./ collapse)", () => {
    const result = parseCodeAnchor("./src/a.ts#Foo");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.path).toBe("src/a.ts");
  });
});

describe("HAPPY — serializeCodeAnchor round-trip", () => {
  it("round-trips a plain file anchor", () => {
    const parsed = parseCodeAnchor("src/a.ts");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeCodeAnchor(parsed.value)).toBe("src/a.ts");
  });

  it("round-trips a symbol anchor", () => {
    const parsed = parseCodeAnchor("src/a.ts#Foo");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeCodeAnchor(parsed.value)).toBe("src/a.ts#Foo");
  });

  it("round-trips a dir anchor with the trailing slash restored", () => {
    const parsed = parseCodeAnchor("src/dir/");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(serializeCodeAnchor(parsed.value)).toBe("src/dir/");
  });
});

// ─── NEGATIVE — parseCodeAnchor grammar rejection ──────────────────────────

describe("NEGATIVE — parseCodeAnchor rejects malformed grammar", () => {
  it("rejects a directory anchor carrying a #Symbol (dir+symbol)", () => {
    const result = parseCodeAnchor("src/dir/#Foo");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a Unicode symbol", () => {
    const result = parseCodeAnchor("src/a.ts#名前");
    expect(result.ok).toBe(false);
  });

  it("rejects a symbol starting with a digit", () => {
    const result = parseCodeAnchor("src/a.ts#1Foo");
    expect(result.ok).toBe(false);
  });

  it("rejects an empty symbol (bare trailing #)", () => {
    const result = parseCodeAnchor("src/a.ts#");
    expect(result.ok).toBe(false);
  });

  it("rejects a symbol containing a hyphen", () => {
    const result = parseCodeAnchor("src/a.ts#Foo-Bar");
    expect(result.ok).toBe(false);
  });

  it("rejects a `..` path segment (reuses file-anchors path rules)", () => {
    const result = parseCodeAnchor("../escape.ts#Foo");
    expect(result.ok).toBe(false);
  });

  it("rejects an absolute path", () => {
    const result = parseCodeAnchor("/etc/passwd#Foo");
    expect(result.ok).toBe(false);
  });

  it("the error names the offending raw anchor", () => {
    const result = parseCodeAnchor("src/dir/#Foo");
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.code === "VALIDATION_ERROR") {
      expect(String(result.error.value)).toBe("src/dir/#Foo");
    }
  });
});

// ─── BOUNDARY — last-# split, reserved words ───────────────────────────────

describe("BOUNDARY — parseCodeAnchor last-# split + reserved-word admission", () => {
  it("splits on the LAST # when the path itself contains an earlier #", () => {
    const result = parseCodeAnchor("src/a.ts#Foo#Bar");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.path).toBe("src/a.ts#Foo");
      expect(result.value.symbol).toBe("Bar");
    }
  });

  it("admits the reserved word 'default' as a symbol (meaningful, D3)", () => {
    const result = parseCodeAnchor("src/a.ts#default");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.symbol).toBe("default");
  });

  it("admits the reserved word 'class' as a symbol (regex doesn't keyword-filter)", () => {
    const result = parseCodeAnchor("src/a.ts#class");
    expect(result.ok).toBe(true);
  });

  it("admits $ and _ as valid identifier leading characters", () => {
    expect(parseCodeAnchor("src/a.ts#$Foo").ok).toBe(true);
    expect(parseCodeAnchor("src/a.ts#_Foo").ok).toBe(true);
  });
});

// ─── STATE — per-entry parse never batch-normalizes (review S3) ───────────

describe("STATE — normalizeCodeAnchorEntries never batch-collapses same-path symbols", () => {
  it("a.ts#Foo and a.ts#Bar BOTH survive normalization (never dropped as a path 'duplicate')", () => {
    const result = normalizeCodeAnchorEntries(["a.ts#Foo", "a.ts#Bar"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["a.ts#Foo", "a.ts#Bar"]);
    }
  });

  it("exact-string duplicates ARE dropped, first occurrence wins, order preserved", () => {
    const result = normalizeCodeAnchorEntries(["a.ts#Foo", "./a.ts#Foo", "b.ts"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(["a.ts#Foo", "b.ts"]);
    }
  });

  it("aborts the whole call on the first grammar failure (no partial write)", () => {
    const result = normalizeCodeAnchorEntries(["a.ts#Foo", "bad/dir/#Bar"]);
    expect(result.ok).toBe(false);
  });
});

// ─── HAPPY — scanExportedSymbols (D3 forms) ────────────────────────────────

describe("HAPPY — scanExportedSymbols matches every D3 form", () => {
  it("matches export const/let/var", () => {
    const src = "export const A = 1;\nexport let B = 2;\nexport var C = 3;\n";
    const found = scanExportedSymbols(src);
    expect(found.has("A")).toBe(true);
    expect(found.has("B")).toBe(true);
    expect(found.has("C")).toBe(true);
  });

  it("matches export function and export async function", () => {
    const src = "export function foo() {}\nexport async function bar() {}\n";
    const found = scanExportedSymbols(src);
    expect(found.has("foo")).toBe(true);
    expect(found.has("bar")).toBe(true);
  });

  it("matches export class and export abstract class", () => {
    const src = "export class Foo {}\nexport abstract class Bar {}\n";
    const found = scanExportedSymbols(src);
    expect(found.has("Foo")).toBe(true);
    expect(found.has("Bar")).toBe(true);
  });

  it("matches export type/interface/enum", () => {
    const src = "export type Foo = string;\nexport interface Bar {}\nexport enum Baz {}\n";
    const found = scanExportedSymbols(src);
    expect(found.has("Foo")).toBe(true);
    expect(found.has("Bar")).toBe(true);
    expect(found.has("Baz")).toBe(true);
  });

  it("matches export default (any trailing form) as symbol 'default'", () => {
    expect(scanExportedSymbols("export default function foo() {}").has("default")).toBe(true);
    expect(scanExportedSymbols("export default class Foo {}").has("default")).toBe(true);
    expect(scanExportedSymbols("export default 42;").has("default")).toBe(true);
  });

  it("matches a single-line export { A, B as C } brace list, alias exports the ALIAS", () => {
    const found = scanExportedSymbols("export { A, B as C };\n");
    expect(found.has("A")).toBe(true);
    expect(found.has("C")).toBe(true);
    expect(found.has("B")).toBe(false);
  });

  it("matches a MULTI-LINE export { ... } brace list", () => {
    const src = "export {\n  A,\n  B as C,\n};\n";
    const found = scanExportedSymbols(src);
    expect(found.has("A")).toBe(true);
    expect(found.has("C")).toBe(true);
  });

  it("allows leading whitespace before export (indented, still line-anchored)", () => {
    const src = "  export const Indented = 1;\n";
    expect(scanExportedSymbols(src).has("Indented")).toBe(true);
  });
});

// ─── NEGATIVE — scanExportedSymbols exclusions ─────────────────────────────

describe("NEGATIVE — scanExportedSymbols does not match excluded forms", () => {
  it("does not match a commented-out export (// export const X)", () => {
    const found = scanExportedSymbols("// export const Hidden = 1;\n");
    expect(found.has("Hidden")).toBe(false);
  });

  it("does not match a mid-line export occurrence", () => {
    const found = scanExportedSymbols("const y = 1; export const MidLine = 1;\n");
    expect(found.has("MidLine")).toBe(false);
  });

  it("does not match `export type { X }` (type-only brace list, documented FP)", () => {
    const found = scanExportedSymbols("export type { TypeOnly };\n");
    expect(found.has("TypeOnly")).toBe(false);
  });

  it("does not match a destructured export (documented FP)", () => {
    const found = scanExportedSymbols("export const { a, b } = obj;\n");
    expect(found.has("a")).toBe(false);
    expect(found.has("b")).toBe(false);
  });

  it("does not match `export * from './other'`", () => {
    const found = scanExportedSymbols("export * from './other';\n");
    expect(found.size).toBe(0);
  });

  it("does not match a block-commented export (/* export const X */)", () => {
    const found = scanExportedSymbols("/* export const Blocked = 1; */\n");
    expect(found.has("Blocked")).toBe(false);
  });
});

// ─── computeDrift — six kinds ───────────────────────────────────────────────

describe("HAPPY — computeDrift: fully consistent anchor set has no drift", () => {
  it("consistent === true when every anchor affirmatively verifies", () => {
    const declared: DriftInputEntry[] = [
      makeEntry({ anchor: { raw: "src/a.ts", path: "src/a.ts", isDir: false } }),
      makeEntry({
        anchor: { raw: "src/a.ts#Foo", path: "src/a.ts", isDir: false, symbol: "Foo" },
      }),
      makeEntry({ anchor: { raw: "src/dir/", path: "src/dir", isDir: true } }),
    ];
    const probes = new Map<string, AnchorProbe>([
      ["src/a.ts", { stat: "file", content: "export const Foo = 1;\n" }],
      ["src/dir", { stat: "dir", children: ["x.ts", ".gitkeep"] }],
    ]);
    const result = computeDrift(declared, probes);
    expect(result.consistent).toBe(true);
    expect(result.drifts).toEqual([]);
  });
});

describe("REGRESSION — computeDrift classifies all six drift kinds", () => {
  it("file_missing: a file anchor whose path does not exist", () => {
    const declared = [makeEntry({ anchor: { raw: "src/a.ts", path: "src/a.ts", isDir: false } })];
    const probes = new Map<string, AnchorProbe>([["src/a.ts", { stat: "missing" }]]);
    const result = computeDrift(declared, probes);
    expect(result.consistent).toBe(false);
    expect(result.drifts).toHaveLength(1);
    expect(result.drifts[0]?.kind).toBe("file_missing");
  });

  it("dir_missing: a dir anchor whose path does not exist", () => {
    const declared = [makeEntry({ anchor: { raw: "src/dir/", path: "src/dir", isDir: true } })];
    const probes = new Map<string, AnchorProbe>([["src/dir", { stat: "missing" }]]);
    const result = computeDrift(declared, probes);
    expect(result.drifts[0]?.kind).toBe("dir_missing");
  });

  it("dir_empty: a dir anchor whose only child is a dotfile (.gitkeep-only)", () => {
    const declared = [makeEntry({ anchor: { raw: "src/dir/", path: "src/dir", isDir: true } })];
    const probes = new Map<string, AnchorProbe>([
      ["src/dir", { stat: "dir", children: [".gitkeep"] }],
    ]);
    const result = computeDrift(declared, probes);
    expect(result.drifts[0]?.kind).toBe("dir_empty");
  });

  it("dir_empty: a dir anchor with zero children at all", () => {
    const declared = [makeEntry({ anchor: { raw: "src/dir/", path: "src/dir", isDir: true } })];
    const probes = new Map<string, AnchorProbe>([["src/dir", { stat: "dir", children: [] }]]);
    const result = computeDrift(declared, probes);
    expect(result.drifts[0]?.kind).toBe("dir_empty");
  });

  it("symbol_missing: file exists but the declared symbol is not exported", () => {
    const declared = [
      makeEntry({
        anchor: { raw: "src/a.ts#Missing", path: "src/a.ts", isDir: false, symbol: "Missing" },
      }),
    ];
    const probes = new Map<string, AnchorProbe>([
      ["src/a.ts", { stat: "file", content: "export const Foo = 1;\n" }],
    ]);
    const result = computeDrift(declared, probes);
    expect(result.drifts[0]?.kind).toBe("symbol_missing");
  });

  it("symbol_missing: export type {} and destructured exports never crash, never falsely consistent", () => {
    const declared = [
      makeEntry({
        anchor: { raw: "src/a.ts#TypeOnly", path: "src/a.ts", isDir: false, symbol: "TypeOnly" },
      }),
    ];
    const probes = new Map<string, AnchorProbe>([
      ["src/a.ts", { stat: "file", content: "export type { TypeOnly };\n" }],
    ]);
    expect(() => computeDrift(declared, probes)).not.toThrow();
    const result = computeDrift(declared, probes);
    expect(result.consistent).toBe(false);
    expect(result.drifts[0]?.kind).toBe("symbol_missing");
  });

  it("node_type_mismatch: a dir anchor resolves to a plain file on disk", () => {
    const declared = [makeEntry({ anchor: { raw: "src/dir/", path: "src/dir", isDir: true } })];
    const probes = new Map<string, AnchorProbe>([["src/dir", { stat: "file" }]]);
    const result = computeDrift(declared, probes);
    expect(result.drifts[0]?.kind).toBe("node_type_mismatch");
  });

  it("node_type_mismatch: a file anchor resolves to a directory on disk", () => {
    const declared = [makeEntry({ anchor: { raw: "src/a.ts", path: "src/a.ts", isDir: false } })];
    const probes = new Map<string, AnchorProbe>([["src/a.ts", { stat: "dir", children: ["x"] }]]);
    const result = computeDrift(declared, probes);
    expect(result.drifts[0]?.kind).toBe("node_type_mismatch");
  });

  it("probe_error: a probe carrying an explicit error becomes a probe_error row for that anchor, scan continues", () => {
    const declared = [
      makeEntry({
        doc_slug: "spec-a",
        anchor: { raw: "src/a.ts", path: "src/a.ts", isDir: false },
      }),
      makeEntry({
        doc_slug: "spec-b",
        anchor: { raw: "src/b.ts", path: "src/b.ts", isDir: false },
      }),
    ];
    const probes = new Map<string, AnchorProbe>([
      ["src/a.ts", { error: "EACCES: permission denied" }],
      ["src/b.ts", { stat: "file" }],
    ]);
    const result = computeDrift(declared, probes);
    expect(result.consistent).toBe(false);
    expect(result.drifts).toHaveLength(1);
    expect(result.drifts[0]?.kind).toBe("probe_error");
    expect(result.drifts[0]?.doc_slug).toBe("spec-a");
    expect(result.drifts[0]?.doc_type).toBe("spec");
    expect(result.drifts[0]?.detail).toContain("EACCES");
  });
});

// ─── ERROR — probe_error edge cases ─────────────────────────────────────────

describe("ERROR — computeDrift probe_error edge cases", () => {
  it("no probe recorded at all for a declared anchor's path -> probe_error, not a silent pass", () => {
    const declared = [makeEntry({ anchor: { raw: "src/a.ts", path: "src/a.ts", isDir: false } })];
    const result = computeDrift(declared, new Map());
    expect(result.consistent).toBe(false);
    expect(result.drifts[0]?.kind).toBe("probe_error");
  });

  it("a file+symbol anchor whose probe never collected content -> probe_error (can't verify)", () => {
    const declared = [
      makeEntry({
        anchor: { raw: "src/a.ts#Foo", path: "src/a.ts", isDir: false, symbol: "Foo" },
      }),
    ];
    const probes = new Map<string, AnchorProbe>([["src/a.ts", { stat: "file" }]]);
    const result = computeDrift(declared, probes);
    expect(result.drifts[0]?.kind).toBe("probe_error");
  });
});

// @reads packages/lore/src/service/export-reader.ts
/**
 * task-drift-check-decides-exported-names-by-parsing-the-file-not (BR-417): the export reader's own
 * contract over in-memory files (the forms the retired text scan matched, plus what it could not).
 * End-to-end behaviour through the drift check lives in export-names-decided-by-parsing.test.ts.
 *
 * Six-dimension coverage:
 *   HAPPY:      every declaration form, default, brace list with alias, indented export
 *   NEGATIVE:   commented-out, block-commented, mid-expression and non-exported declarations are not exports
 *   BOUNDARY:   a star chain at MAX_STAR_DEPTH, `.mjs`/`.cjs` remapping, `export * as`
 *   ERROR:      unsupported extension, syntax error, package star, missing star target, `export =`
 *   STATE:      repeated reads give equal answers (no cross-call state)
 *   REGRESSION: type-only brace list and destructuring, the retired scanner's documented false positives
 */

import { describe, expect, it } from "vitest";
import { createExportReader, MAX_STAR_DEPTH } from "../../../src/service/export-reader.js";

function readerOver(files: Record<string, string>) {
  const read = createExportReader((path) => files[path] ?? null);
  return (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`fixture ${path} missing`);
    return read(path, content);
  };
}

const namesOf = (r: { names: ReadonlySet<string> }): string[] => [...r.names].sort();

describe("HAPPY — declaration forms", () => {
  it("reads const/let/var, function, class, type, interface, enum and default", () => {
    const read = readerOver({
      "a.ts": [
        "export const A = 1;",
        "export let B = 2;",
        "export var C = 3;",
        "export function f() {}",
        "export async function g() {}",
        "export class K {}",
        "export abstract class L {}",
        "export type T = string;",
        "export interface I {}",
        "export enum E {}",
        "  export const Indented = 1;",
        "export default 42;",
      ].join("\n"),
    });
    const result = read("a.ts");
    expect(result.notMeasured).toBeUndefined();
    expect(namesOf(result)).toEqual(["A", "B", "C", "E", "I", "Indented", "K", "L", "T", "default", "f", "g"].sort());
  });

  it("exports the ALIAS of `{ B as C }`, single-line and multi-line", () => {
    const read = readerOver({ "a.ts": "export { A, B as C };\nexport {\n  D,\n  E as F,\n};\n" });
    expect(namesOf(read("a.ts"))).toEqual(["A", "C", "D", "F"]);
  });
});

describe("NEGATIVE — text that only looks like an export", () => {
  it("ignores line comments, block comments, non-exported declarations and nested exports in strings", () => {
    const read = readerOver({
      "a.ts": "// export const X = 1;\n/* export const Y = 1; */\nconst Z = 1;\nconst s = 'export const W = 1;';\nfunction h() { return `\nexport const V = 1;\n`; }\n",
    });
    const result = read("a.ts");
    expect(namesOf(result)).toEqual([]);
    expect(result.notMeasured).toBeUndefined();
  });
});

describe("BOUNDARY — star chains", () => {
  it("follows a chain of exactly MAX_STAR_DEPTH stars and reports one deeper as not measured", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= MAX_STAR_DEPTH + 1; i += 1) {
      files[`f${i}.ts`] = i === MAX_STAR_DEPTH + 1 ? "export const bottom = 1;" : `export * from './f${i + 1}.js';`;
    }
    const result = readerOver(files)("f0.ts");
    expect(result.names.has("bottom")).toBe(false);
    expect(result.notMeasured).toContain(String(MAX_STAR_DEPTH));

    const shallow: Record<string, string> = {};
    for (let i = 0; i <= MAX_STAR_DEPTH; i += 1) {
      shallow[`f${i}.ts`] = i === MAX_STAR_DEPTH ? "export const bottom = 1;" : `export * from './f${i + 1}.js';`;
    }
    const ok = readerOver(shallow)("f0.ts");
    expect(ok.names.has("bottom")).toBe(true);
    expect(ok.notMeasured).toBeUndefined();
  });

  it("maps .mjs to .mts and reads `export * as ns` as the one name ns", () => {
    const read = readerOver({
      "a.ts": "export * from './m.mjs';\nexport * as ns from './m.mjs';\n",
      "m.mts": "export const inner = 1;\n",
    });
    expect(namesOf(read("a.ts"))).toEqual(["inner", "ns"]);
  });
});

describe("ERROR — not measured, never guessed", () => {
  it("flags an unsupported extension", () => {
    const result = readerOver({ "run.py": "def main(): pass\n" })("run.py");
    expect(namesOf(result)).toEqual([]);
    expect(result.notMeasured).toContain(".py");
  });

  it("flags a file with syntax errors", () => {
    const result = readerOver({ "a.ts": "export const = ;\n" })("a.ts");
    expect(result.notMeasured).toContain("syntax errors");
  });

  it("flags a package star, a missing star target and `export =`", () => {
    const read = readerOver({
      "p.ts": "export * from 'pkg';\n",
      "m.ts": "export * from './nope.js';\n",
      "e.ts": "const x = 1;\nexport = x;\n",
    });
    expect(read("p.ts").notMeasured).toContain("pkg");
    expect(read("m.ts").notMeasured).toContain("nope");
    expect(read("e.ts").notMeasured).toContain("export =");
  });
});

describe("STATE — no cross-call state", () => {
  it("answers the same twice and does not leak names between files", () => {
    const read = readerOver({ "a.ts": "export const A = 1;\n", "b.ts": "export const B = 1;\n" });
    expect(namesOf(read("a.ts"))).toEqual(["A"]);
    expect(namesOf(read("b.ts"))).toEqual(["B"]);
    expect(namesOf(read("a.ts"))).toEqual(["A"]);
  });
});

describe("REGRESSION — forms the retired text scan reported as missing", () => {
  it("finds `export type { X }`, destructured and array-destructured names", () => {
    const read = readerOver({
      "a.ts": "export type { TypeOnly };\nexport const { a, b: renamed } = obj;\nexport const [x, ...rest] = list;\n",
    });
    expect(namesOf(read("a.ts"))).toEqual(["TypeOnly", "a", "renamed", "rest", "x"]);
  });
});

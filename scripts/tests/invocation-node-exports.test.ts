/** @spec_ref AC-IV-7 */
/**
 * @layer script-unit AS-26 guard — the allowlisted entry file `packages/core/src/invocation-node.ts` exports
 * nothing that reads ambient process state for someone else.
 *
 * Why: the ambient-read check exempts that file ("the entry reads"). If it also exported `readFoo()` helpers,
 * every caller could read the process through them and the check would count none of it, which empties the
 * AC-IV-7 ledger without removing a single read. Only `resolveInvocation` (and the types it takes) may be exported.
 *
 * Six-dimension coverage:
 *   HAPPY:      the real file's export list equals the explicit allow-set.
 *   NEGATIVE:   a planted `export function readOsUsername` is reported by the export parser (the guard can fail).
 *   BOUNDARY:   `export type`, `export interface`, `export async function`, `export const` and `export { a, b as c }` forms.
 *   ERROR:      an unreadable file path throws (never an empty, passing export list).
 *   STATE:      none (pure text parse).
 *   REGRESSION: the helpers `readProcessAmbient`, `readOsUsername`, `resolveActorFromProcess` stay out.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages/core/src/invocation-node.ts");

/** The ONLY exports allowed: the entry function and the resolver policy type it takes. */
const ALLOWED_EXPORTS = new Set(["resolveInvocation", "InvocationResolvers"]);

/** Names exported by `source`, in any declaration form. */
function exportedNames(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm)) {
    names.push(m[1] as string);
  }
  for (const m of source.matchAll(/^export\s*(?:type\s*)?\{([^}]*)\}/gm)) {
    for (const part of (m[1] as string).split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name !== undefined && name !== "") names.push(name);
    }
  }
  return names;
}

describe("invocation-node.ts export surface (AS-26 guard)", () => {
  it("HAPPY/REGRESSION: exports exactly the allow-set — no ambient-reading helper for other files to call", () => {
    const names = exportedNames(readFileSync(FILE, "utf8"));
    const extra = names.filter((n) => !ALLOWED_EXPORTS.has(n));
    expect(extra).toEqual([]);
    expect(names).toContain("resolveInvocation");
  });

  it("NEGATIVE: the parser sees a planted helper in every export form (the guard can fail)", () => {
    const planted = [
      "export function readOsUsername(): string { return ''; }",
      "export async function readLater(): Promise<void> {}",
      "export const readProcessAmbient = () => ({});",
      "export interface ProcessAmbient { a: 1 }",
      "export type { Foo, Bar as Baz } from './x.js';",
    ].join("\n");
    expect(exportedNames(planted)).toEqual(["readOsUsername", "readLater", "readProcessAmbient", "ProcessAmbient", "Foo", "Baz"]);
  });

  it("ERROR: a missing file throws instead of yielding an empty (passing) export list", () => {
    expect(() => readFileSync(`${FILE}.does-not-exist`, "utf8")).toThrow();
  });
});

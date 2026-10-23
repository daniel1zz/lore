// @reads packages/lore/tests/**
// @reads packages/core/tests/**
// @reads packages/dashboard/tests/**
// @reads scripts/tests/**
/**
 * @spec_ref BR-926
 *
 * Scan test: no test writes a project `.lore/config.yaml` except through `patchLoreConfig`
 * (`tests/helpers/patch-lore-config.ts`). A fixture that appends a second `workflow:` block after
 * `lore init` (which seeds one) produces a duplicate key; the loader refuses such a file, and before
 * BR-926 it was dropped in silence so the fixture's gates came back on.
 *
 * What counts as a write: a `writeFileSync` / `appendFileSync` / `writeFile` / `appendFile` / `Bun.write`
 * call whose first argument names the project config (the literal `.lore` + `config.yaml`, or an
 * identifier bound to such a path in the same file), or a shell redirect into it.
 *
 * Allowlist: files whose JOB is to hand the loader bytes `patchLoreConfig` refuses to produce (a broken,
 * empty, legacy-keyed or exact-bytes file). Each entry carries its reason; the list must not grow for
 * convenience.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(new URL("../../../../", import.meta.url).pathname);
const HELPER = "packages/lore/tests/helpers/patch-lore-config.ts";
const SELF = "packages/lore/tests/unit/test-config-writers-scan.test.ts";

/** Repo-relative path -> why raw writes are legitimate there. */
const RAW_WRITE_ALLOWLIST: Readonly<Record<string, string>> = {
  "packages/lore/tests/integration/config-unparsable-loud.bun.test.ts": "writes a deliberately broken config (the BR-926 subject)",
  "packages/lore/tests/integration/ai-config-fail-loud.bun.test.ts": "writes a deliberately schema-invalid ai block (SPEC-030 AC-HJ-3)",
  "packages/lore/tests/integration/memory-file-limits-always-enforced.test.ts": "writes retired-key (adoption) and flow-style bytes whose exact text the migration and the refusal are about",
  "packages/lore/tests/integration/setup-user-once-marker.bun.test.ts": "an injected fs-port stub of the unit under test (SetupService), not a write to a real file",
  "scripts/tests/check-shipped-defaults.test.ts": "the checker's INPUT: a config.yaml fixture written exactly as the checker should read it, in a root with no lore init",
  "packages/lore/tests/unit/core/config-io.test.ts": "loadConfig/saveConfig I/O tests: exact bytes incl. empty and whitespace-only files",
};

// Any callee that writes, appends, copies, renames, seeds, saves or puts — a local helper such as `writeRepoFile(repo,
// ".lore/config.yaml", ...)` is a writer too. `patchLoreConfig` is the one sanctioned writer and is skipped by name.
const WRITE_CALL = /\b(?:Bun\.write|\w*(?:[Ww]rite|[Aa]ppend|[Cc]opy|[Cc]p|[Rr]ename|[Ss]eed|[Ss]ave|[Pp]ut)\w*)\s*\(/g;
const SANCTIONED_WRITER = "patchLoreConfig";
/** Reads inside a write call's arguments (`join(.., readFileSync(configPath))`) are not writes to the config. */
const READ_SUBCALL = /\b(?:readFileSync|readFile|existsSync|statSync|readdirSync)\s*\((?:[^()]|\([^()]*\))*\)/g;

function listTestFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "fixtures" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listTestFiles(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

// reason: `(?<![.\w])` — `fx.repo` is a property read, not the local `repo` binding.
const mentionsAny = (text: string, ids: readonly string[]): boolean => ids.some((id) => new RegExp(`(?<![.\\w])${id}\\b`).test(text));

/** Text that names the PROJECT config: `config.yaml` under a `.lore` directory (literal, or via a `.lore`-bound identifier). */
const namesProjectConfig = (text: string, loreDirIds: readonly string[]): boolean =>
  /config\.yaml/.test(text) && (/\.lore/.test(text) || mentionsAny(text, loreDirIds));

/** The expression starting at `start`: to the end of its line, or to the close of its brackets when it opens more than it closes. */
function expressionFrom(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if ((ch === "\n" && depth <= 0) || ch === ";") return source.slice(start, i);
  }
  return source.slice(start);
}

/** `source` with comments blanked (newlines kept, so line numbers stay true): a comment is never a write. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/.*$/gm, (_m, lead: string) => lead);
}

/** Every `name = <expr>` binding in `source` (declaration optional, type annotation tolerated, arrow/function bodies included). */
function bindings(source: string): Array<readonly [string, string]> {
  const found: Array<readonly [string, string]> = [];
  for (const match of source.matchAll(/\b(\w+)\s*(?::[^=;\n]+)?=(?![=>])\s*/g)) {
    found.push([match[1] ?? "", expressionFrom(source, (match.index ?? 0) + match[0].length)]);
  }
  for (const match of source.matchAll(/function\s+(\w+)\s*\([^)]*\)[^{]*\{([^}]*)\}/g)) found.push([match[1] ?? "", match[2] ?? ""]);
  return found.filter(([name]) => name !== "");
}

/** Identifiers bound to an expression naming the project config. */
function projectConfigIdentifiers(source: string): string[] {
  const all = bindings(source);
  const loreDirIds = all.filter(([, expr]) => /\.lore/.test(expr) && !/config\.yaml/.test(expr)).map(([name]) => name);
  // reason: `const text = readFileSync(configPath)` binds the config's CONTENT, not a path to write to.
  return [...new Set(all.filter(([, expr]) => namesProjectConfig(expr.replace(READ_SUBCALL, ""), loreDirIds)).map(([name]) => name))];
}

/** Every argument of the call opened at `openParen` (balanced to its closing bracket), as one text. */
function callArguments(source: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }
  return source.slice(openParen + 1);
}

/** Repo-relative `path:line` of every project-config write in `source`. */
export function findProjectConfigWrites(rawSource: string): number[] {
  const source = stripComments(rawSource);
  const identifiers = projectConfigIdentifiers(source);
  const all = bindings(source);
  const loreDirIds = all.filter(([, expr]) => /\.lore/.test(expr) && !/config\.yaml/.test(expr)).map(([name]) => name);
  const lines: number[] = [];
  const lineOf = (index: number): number => source.slice(0, index).split("\n").length;
  for (const match of source.matchAll(WRITE_CALL)) {
    if (match[0].startsWith(SANCTIONED_WRITER)) continue;
    // reason: a callee-looking name INSIDE a string literal (`"this.writer.writeDoc("`) is text, not a call.
    const lineHead = source.slice(source.lastIndexOf("\n", match.index ?? 0) + 1, match.index ?? 0);
    if ([`"`, `'`, "`"].some((quote) => lineHead.split(quote).length % 2 === 0)) continue;
    const open = (match.index ?? 0) + match[0].length - 1;
    const args = callArguments(source, open).replace(READ_SUBCALL, "");
    if (namesProjectConfig(args, loreDirIds) || mentionsAny(args, identifiers)) lines.push(lineOf(match.index ?? 0));
  }
  for (const match of source.matchAll(/>>?\s*["']?[^\s"'|;]*\.lore\/config\.yaml/g)) lines.push(lineOf(match.index ?? 0));
  return lines;
}

describe("no test writes .lore/config.yaml except through patchLoreConfig (BR-926)", () => {
  it("the detector flags the append-after-init pattern and ignores the helper call", () => {
    const appendCase = 'appendFileSync(join(dir, ".lore", "config.yaml"), "workflow:\\n");';
    const viaVariable = 'const cfgPath = join(dir, ".lore", "config.yaml");\nwriteFileSync(cfgPath, "x");';
    const helperCase = 'patchLoreConfig(dir, "workflow:\\n");';
    const globalConfig = 'writeFileSync(join(xdg, "lore", "config.yaml"), "x");';
    expect(findProjectConfigWrites(appendCase)).toEqual([1]);
    expect(findProjectConfigWrites(viaVariable)).toEqual([2]);
    const viaLoreDir = 'const loreDir = join(dir, ".lore");\nwriteFileSync(join(loreDir, "config.yaml"), "x");';
    expect(findProjectConfigWrites(viaLoreDir)).toEqual([2]);
    const viaLocalHelper = 'writeRepoFile(repo, ".lore/config.yaml", "x");';
    const viaCopy = 'copyFileSync(template, join(dir, ".lore", "config.yaml"));';
    const readOnly = 'const text = readFileSync(join(dir, ".lore", "config.yaml"), "utf8");\nwriteFileSync(join(dir, "copy.txt"), text);';
    expect(findProjectConfigWrites(viaLocalHelper)).toEqual([1]);
    expect(findProjectConfigWrites(viaCopy)).toEqual([1]);
    expect(findProjectConfigWrites(readOnly)).toEqual([]);
    expect(findProjectConfigWrites(helperCase)).toEqual([]);
    expect(findProjectConfigWrites(globalConfig)).toEqual([]);
  });

  it("every other test file writes the project config only via the helper", () => {
    const offenders: string[] = [];
    for (const testsRoot of ["packages/core/tests", "packages/dashboard/tests", "packages/lore/tests", "scripts/tests"]) {
      const testsDir = join(REPO_ROOT, testsRoot);
      let isDir = false;
      try {
        isDir = statSync(testsDir).isDirectory();
      } catch {
        isDir = false;
      }
      if (!isDir) continue;
      for (const file of listTestFiles(testsDir)) {
        const rel = relative(REPO_ROOT, file);
        if (rel === HELPER || rel === SELF || rel in RAW_WRITE_ALLOWLIST) continue;
        for (const line of findProjectConfigWrites(readFileSync(file, "utf8"))) offenders.push(`${rel}:${line}`);
      }
    }
    expect(offenders, `raw .lore/config.yaml writes (use patchLoreConfig):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every allowlisted file still exists and still writes the config raw (a stale entry is dropped)", () => {
    for (const rel of Object.keys(RAW_WRITE_ALLOWLIST)) {
      expect(findProjectConfigWrites(readFileSync(join(REPO_ROOT, rel), "utf8")).length, rel).toBeGreaterThan(0);
    }
  });
});

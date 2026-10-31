#!/usr/bin/env bun
/**
 * check:test-spawns (task-s2-check-test-spawns-refuses-an-undeclared-spawn-at, AC-SC-2, standards AS-24 / AS-17):
 * a test file that starts a process, in its own source or through any module it statically imports
 * (followed transitively), must say so in its leading comment block.
 *
 * Purpose: the run-time read recorder only sees spawn targets that resolve to a repository file and only for tests
 * that RUN; a test spawning `lore` from PATH, or a test that is never selected, escapes it. This static check refuses
 * the landing instead.
 *
 * Declaration on a helper: a NON-test module whose header carries `@spawns-external` and no `@spawns` covers its own spawn
 * sites for every test that imports it (external programs cannot select tests; see `externalOnlyHelpers`); `lore` from
 * PATH is never covered that way. Everything else is carried by the test file.
 * Rule: a test file (`*.test.ts` / `*.test.tsx` under packages/<pkg>/tests/** or scripts/**) that reaches a spawn site
 * needs at least one `@spawns <path>` or `@spawns-external <program> <reason>` header line; if any reached site spawns
 * `lore` from PATH it needs a `@spawns` line matching `dist/lore`. A reached module is any NON-production module:
 * everything under packages/<pkg>/tests/** and scripts/**. Production modules (packages/<pkg>/src/**) are neither
 * scanned nor followed: `@spawns` of the product already covers their spawns.
 * Recognised spawn APIs (what it could NOT see is named, AS-17): child_process `spawn/spawnSync/exec/execSync/execFile/
 * execFileSync/fork` (named, namespace, default, require and dynamic-import bindings), `Bun.spawn/spawnSync/$` (also
 * imported from "bun"), `execa`. A command built from a variable is not recognised, and `lore` is recognised only as a
 * literal first argument/command word.
 *
 * Usage: bun scripts/check-test-spawns.ts [--changed [<base>]] [--root <dir>]
 *   --changed  check only changed test files plus every test whose import closure holds a changed non-production module
 * Exit: 0 clean, 1 at least one violation (each names the test file, the spawn call site and the import chain), 2 cannot run.
 * Public surface: scanSpawnSites, parseSpawnDeclarations, collectSpawnFileMap, findSpawnViolations, selectChangedTests,
 * formatViolation, SpawnCheckError, main. Side-effect class: pure except `collectSpawnFileMap` / `main` (disk, git).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { leadingCommentLines } from "../packages/lore/src/service/leading-comment.js";
import {
  extractImportSpecifiers,
  getChangedFiles,
  getRepoRoot,
  isTestFile,
  resolveBaseRef,
  resolveImportSpecifier,
  type FileMap,
} from "./changed-tests.js";
import { DeclaredInputsError, matchesAnyPattern, parseDeclaredInputs } from "./test-declared-inputs.js";

/** Typed failure: the check could not run (never a violation). */
export class SpawnCheckError extends Error {
  constructor(
    public readonly reason: "no-test-files" | "bad-arguments",
    message: string,
    public readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SpawnCheckError";
  }
}

/** One recognised process-spawning call. */
export interface SpawnSite {
  readonly line: number;
  /** The spawn API as written, e.g. `spawnSync`, `Bun.spawn`, `Bun.$`, `execa`. */
  readonly api: string;
  /** `true` when the command is the literal `lore`: resolved from PATH, so it spawns `dist/lore`. */
  readonly loreFromPath: boolean;
}

/** A test file that spawns without the declaration the rule requires. */
export interface SpawnViolation {
  readonly testFile: string;
  readonly site: SpawnSite & { readonly file: string };
  /** Import chain from the test file to the spawning module (just the test file when it spawns itself). */
  readonly chain: readonly string[];
  readonly missing: "any-declaration" | "dist-lore" | "malformed-declaration";
  readonly detail?: string;
}

const CHILD_PROCESS_MODULES = ["node:child_process", "child_process"];
const CHILD_PROCESS_APIS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];
const SPAWN_MODULES = [...CHILD_PROCESS_MODULES, "bun", "execa"];

/**
 * Blank comments (always) and string / template / regex literal contents (when `keepStrings` is false) with spaces,
 * keeping every newline and every offset, so a match position maps to a line and back into the other variant.
 */
function blankLiterals(source: string, keepStrings: boolean): string {
  const out: string[] = [];
  const templateDepth: number[] = []; // brace depth at which each open `${` resumes the template
  let braceDepth = 0;
  let lastSignificant = "";
  let i = 0;
  const blank = (ch: string): string => (ch === "\n" ? "\n" : " ");
  const regexMayStart = (): boolean => lastSignificant === "" || "(,=:[!&|?{};+-*%<>~^".includes(lastSignificant);
  const readTemplate = (): void => {
    // positioned just after an opening backtick or a closing `}` of `${...}`; consume literal text
    while (i < source.length) {
      const ch = source[i]!;
      if (ch === "\\") {
        out.push(keepStrings ? ch : " ", keepStrings ? (source[i + 1] ?? "") : blank(source[i + 1] ?? ""));
        i += 2;
      } else if (ch === "`") {
        out.push("`");
        i += 1;
        return;
      } else if (ch === "$" && source[i + 1] === "{") {
        out.push(keepStrings ? "${" : "  ");
        i += 2;
        templateDepth.push(braceDepth);
        braceDepth += 1;
        return;
      } else {
        out.push(keepStrings ? ch : blank(ch));
        i += 1;
      }
    }
  };
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") (out.push(" "), (i += 1));
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i++) out.push(blank(source[i]!));
    } else if (ch === '"' || ch === "'") {
      out.push(ch);
      i += 1;
      while (i < source.length && source[i] !== ch && source[i] !== "\n") {
        if (source[i] === "\\") {
          out.push(keepStrings ? "\\" : " ", keepStrings ? (source[i + 1] ?? "") : blank(source[i + 1] ?? ""));
          i += 2;
        } else {
          out.push(keepStrings ? source[i]! : " ");
          i += 1;
        }
      }
      if (i < source.length && source[i] === ch) (out.push(ch), (i += 1));
      lastSignificant = ch;
    } else if (ch === "`") {
      out.push("`");
      i += 1;
      readTemplate();
      lastSignificant = "`";
    } else if (ch === "/" && regexMayStart()) {
      out.push("/");
      i += 1;
      let inClass = false;
      while (i < source.length && source[i] !== "\n" && (inClass || source[i] !== "/")) {
        const c = source[i]!;
        if (c === "\\") {
          out.push(keepStrings ? c : " ", keepStrings ? (source[i + 1] ?? "") : blank(source[i + 1] ?? ""));
          i += 2;
          continue;
        }
        if (c === "[") inClass = true;
        if (c === "]") inClass = false;
        out.push(keepStrings ? c : " ");
        i += 1;
      }
      if (i < source.length && source[i] === "/") (out.push("/"), (i += 1));
      lastSignificant = "/";
    } else {
      if (ch === "{") braceDepth += 1;
      if (ch === "}") {
        braceDepth -= 1;
        if (templateDepth.length > 0 && templateDepth[templateDepth.length - 1] === braceDepth) {
          templateDepth.pop();
          out.push(keepStrings ? "}" : " ");
          i += 1;
          readTemplate();
          lastSignificant = "`";
          continue;
        }
      }
      out.push(ch);
      i += 1;
      if (!/\s/.test(ch)) lastSignificant = ch;
    }
  }
  return out.join("");
}

interface SpawnBindings {
  /** local name -> spawn API it stands for (child_process / bun named imports). */
  readonly functions: Map<string, string>;
  /** local names bound to the whole child_process module. */
  readonly namespaces: Set<string>;
  /** local names that are `$` from bun or any execa binding (callable and tagged-template). */
  readonly shells: Map<string, string>;
}

function parseNamedList(list: string): Array<{ imported: string; local: string }> {
  return list
    .split(",")
    .map((part) => part.trim().replace(/^type\s+/, ""))
    .filter((part) => part.length > 0)
    .map((part) => {
      const [imported, local] = part.split(/\s+as\s+|\s*:\s*/);
      return { imported: imported!.trim(), local: (local ?? imported)!.trim() };
    });
}

function collectBindings(withStrings: string): SpawnBindings {
  const bindings: SpawnBindings = { functions: new Map(), namespaces: new Set(), shells: new Map() };
  const bind = (moduleName: string, kind: "named" | "namespace", imported: string, local: string): void => {
    const childProcess = CHILD_PROCESS_MODULES.includes(moduleName);
    if (kind === "namespace") {
      if (childProcess) bindings.namespaces.add(local);
      else if (moduleName === "execa") bindings.shells.set(local, "execa");
      return;
    }
    if (childProcess && CHILD_PROCESS_APIS.includes(imported)) bindings.functions.set(local, imported);
    else if (moduleName === "bun" && (imported === "spawn" || imported === "spawnSync")) bindings.functions.set(local, `Bun.${imported}`);
    else if (moduleName === "bun" && imported === "$") bindings.shells.set(local, "Bun.$");
    else if (moduleName === "execa") bindings.shells.set(local, imported === "default" ? "execa" : imported);
  };
  const moduleAlternation = SPAWN_MODULES.map((m) => m.replace(/[.]/g, "\\.")).join("|");
  const importRe = new RegExp(`import\\s+(?!type\\b)([^;"'\`]*?)\\s+from\\s+["'](${moduleAlternation})["']`, "g");
  for (const match of withStrings.matchAll(importRe)) {
    const clause = match[1]!;
    const moduleName = match[2]!;
    const braces = /\{([^}]*)\}/.exec(clause);
    const withoutBraces = clause.replace(/\{[^}]*\}/, "");
    const star = /\*\s*as\s+([\w$]+)/.exec(withoutBraces);
    if (star !== null) bind(moduleName, "namespace", "*", star[1]!);
    const defaultName = /^\s*([\w$]+)\s*,?\s*$/.exec(withoutBraces.replace(/\*\s*as\s+[\w$]+/, ""));
    if (defaultName !== null) {
      // a default import of child_process is the namespace object; of execa it is the function
      bind(moduleName, CHILD_PROCESS_MODULES.includes(moduleName) ? "namespace" : "named", "default", defaultName[1]!);
    }
    if (braces !== null) for (const { imported, local } of parseNamedList(braces[1]!)) bind(moduleName, "named", imported, local);
  }
  // `createRequire(import.meta.url)("node:child_process")` is a require too (test helpers use it to dodge a mocked module)
  const loaderRe = `(?:await\\s+)?(?:require|import|createRequire\\([^)]*\\))\\(\\s*["'](${moduleAlternation})["']\\s*\\)`;
  for (const match of withStrings.matchAll(new RegExp(`(?:const|let|var)\\s*\\{([^}]*)\\}\\s*=\\s*${loaderRe}`, "g"))) {
    for (const { imported, local } of parseNamedList(match[1]!)) bind(match[2]!, "named", imported, local);
  }
  for (const match of withStrings.matchAll(new RegExp(`(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*${loaderRe}`, "g"))) {
    bind(match[2]!, "namespace", "*", match[1]!);
  }
  return bindings;
}

/** Lore from PATH: the text after a spawn call's `(` (or a `$` template's backtick) starts with the literal command `lore`. */
function startsWithLoreCommand(after: string): boolean {
  return /^\s*\(?\s*\[?\s*["'`]\s*lore(?:["'`\s])/.test(after) || /^\s*lore\s/.test(after);
}

function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * Every recognised spawn call in one module's source. Comments and string / template / regex contents are ignored, so a
 * fixture embedded in a template string or a mention in a comment is not a spawn.
 * @param content - the module source
 * @returns the call sites in source order (empty when the module spawns nothing recognisable)
 */
export function scanSpawnSites(content: string): SpawnSite[] {
  const code = blankLiterals(content, false);
  const withStrings = blankLiterals(content, true);
  const bindings = collectBindings(withStrings);
  const found: Array<{ offset: number; api: string; loreFromPath: boolean }> = [];
  const push = (offset: number, api: string, argStart: number, template: boolean): void => {
    const after = withStrings.slice(argStart, argStart + 80);
    found.push({ offset, api, loreFromPath: startsWithLoreCommand(template ? after.replace(/^\s*`/, "\"") : after) });
  };
  for (const match of code.matchAll(/(?<![\w$.])Bun\s*\.\s*(spawnSync|spawn)\s*\(/g)) push(match.index!, `Bun.${match[1]!}`, match.index! + match[0].length, false);
  for (const match of code.matchAll(/(?<![\w$.])Bun\s*\.\s*\$\s*(`|\()/g)) push(match.index!, "Bun.$", match.index! + match[0].length - (match[1] === "`" ? 1 : 0), match[1] === "`");
  for (const [local, api] of bindings.functions) {
    for (const match of code.matchAll(new RegExp(`(?<![\\w$.])${local.replace(/\$/g, "\\$")}\\s*\\(`, "g"))) push(match.index!, api, match.index! + match[0].length, false);
  }
  for (const [local, api] of bindings.shells) {
    for (const match of code.matchAll(new RegExp(`(?<![\\w$.])${local.replace(/\$/g, "\\$")}\\s*(\`|\\()`, "g"))) {
      push(match.index!, api, match.index! + match[0].length - (match[1] === "`" ? 1 : 0), match[1] === "`");
    }
  }
  for (const local of bindings.namespaces) {
    for (const match of code.matchAll(new RegExp(`(?<![\\w$.])${local.replace(/\$/g, "\\$")}\\s*\\.\\s*(${CHILD_PROCESS_APIS.join("|")})\\s*\\(`, "g"))) {
      push(match.index!, match[1]!, match.index! + match[0].length, false);
    }
  }
  // `(await import("node:child_process")).spawnSync(...)` / `require("child_process").execSync(...)`: the call hangs off the loader
  const loaderCall = new RegExp(`(?:require|import|createRequire\\([^)]*\\))\\(\\s*["'](?:${CHILD_PROCESS_MODULES.join("|")})["']\\s*\\)\\s*\\)?\\s*\\.\\s*(${CHILD_PROCESS_APIS.join("|")})\\s*\\(`, "g");
  for (const match of withStrings.matchAll(loaderCall)) push(match.index!, match[1]!, match.index! + match[0].length, false);
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.offset - b.offset)
    .filter((f) => !seen.has(`${f.offset}`) && seen.add(`${f.offset}`))
    .map((f) => ({ line: lineOf(content, f.offset), api: f.api, loreFromPath: f.loreFromPath }));
}

/** A test file's own spawn declarations. */
export interface SpawnDeclarations {
  /** `@spawns <glob>` patterns. */
  readonly spawns: readonly string[];
  /** `@spawns-external <program> <reason>` lines. */
  readonly external: readonly { readonly program: string; readonly reason: string }[];
}

const EXTERNAL_LINE_RE = /^\s*(?:\/\/|\*|\/\*\*?)\s*@spawns-external\b(?:\s+(\S+)(?:\s+(.*\S))?)?/;

/**
 * Parse the spawn declarations in a file's leading comment block. `@spawns` goes through the shared parser
 * (scripts/test-declared-inputs.ts, one grammar for the selector, the recorder and this check); `@spawns-external` is
 * read here because it names a program outside the repository, which the selector must never act on.
 * @throws DeclaredInputsError for a malformed `@spawns` / `@reads` line or an `@spawns-external` without program and reason
 */
export function parseSpawnDeclarations(content: string): SpawnDeclarations {
  const { spawns } = parseDeclaredInputs(content);
  const external: Array<{ program: string; reason: string }> = [];
  for (const line of leadingCommentLines(content)) {
    const match = EXTERNAL_LINE_RE.exec(line);
    if (match === null) continue;
    const [, program, reason] = match;
    if (program === undefined || reason === undefined) {
      throw new DeclaredInputsError("empty-pattern", "`@spawns-external` needs a program and a reason: `@spawns-external <program> <reason>`", { line, pattern: program ?? "" });
    }
    external.push({ program, reason });
  }
  return { spawns, external };
}

const TEST_DIR_RE = /^packages\/[^/]+\/tests\//;
const EXTENSION_RE = /\.tsx?$/;

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const rel = posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, rel, out);
    else if (entry.isFile() && EXTENSION_RE.test(entry.name)) out.push(rel);
  }
}

/** Every non-production module under `root` (packages/<pkg>/tests/** and scripts/**, `.ts` and `.tsx`) keyed by repo-relative path. */
export function collectSpawnFileMap(root: string): FileMap {
  const files: string[] = [];
  const packagesDir = join(root, "packages");
  if (existsSync(packagesDir)) {
    for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
      const testsDir = posix.join("packages", pkg.name, "tests");
      if (pkg.isDirectory() && existsSync(join(root, testsDir))) walk(root, testsDir, files);
    }
  }
  if (existsSync(join(root, "scripts"))) walk(root, "scripts", files);
  return new Map(files.map((f) => [f, readFileSync(join(root, f), "utf8")]));
}

interface Analysis {
  readonly forward: ReadonlyMap<string, readonly string[]>;
  readonly sites: ReadonlyMap<string, readonly SpawnSite[]>;
}

function analyse(fileMap: FileMap): Analysis {
  const forward = new Map<string, string[]>();
  const sites = new Map<string, SpawnSite[]>();
  for (const [file, content] of fileMap) {
    const targets = new Set<string>();
    for (const specifier of extractImportSpecifiers(content)) {
      // alias map is empty on purpose: every alias target is production source, which is excluded from this graph
      const resolved = resolveImportSpecifier(specifier, file, fileMap, {});
      if (resolved !== undefined && resolved !== file) targets.add(resolved);
    }
    forward.set(file, [...targets]);
    sites.set(file, scanSpawnSites(content));
  }
  return { forward, sites };
}

/** Breadth-first closure from `start`; returns each reached module with the chain that reached it (start first). */
function reach(start: string, forward: ReadonlyMap<string, readonly string[]>): Map<string, string[]> {
  const chains = new Map<string, string[]>([[start, [start]]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    for (const next of forward.get(current) ?? []) {
      if (chains.has(next)) continue;
      chains.set(next, [...chains.get(current)!, next]);
      queue.push(next);
    }
  }
  return chains;
}

/**
 * Test files whose spawn declarations are checked in `:changed` mode: the changed test files plus every test whose import
 * closure contains a changed non-production module.
 * @param changedPaths - repo-relative posix paths changed on the branch (paths outside `fileMap`, such as production source, are ignored)
 */
export function selectChangedTests(fileMap: FileMap, changedPaths: readonly string[]): string[] {
  const { forward } = analyse(fileMap);
  const changed = new Set(changedPaths.filter((p) => fileMap.has(p)));
  return [...fileMap.keys()].filter(isTestFile).filter((test) => {
    if (changed.has(test)) return true;
    for (const module of reach(test, forward).keys()) if (changed.has(module)) return true;
    return false;
  });
}

/**
 * Non-test modules whose own header carries `@spawns-external` and no `@spawns`: they start programs outside the repository
 * and say which. Such a program can never select a test, so naming it once on the helper covers every importer; without
 * this, a helper every test reaches (the test identity helper reads its own start time with `ps`) would force one
 * identical line into hundreds of test files. A helper that starts a repository file declares `@spawns` or nothing, and
 * its importers keep carrying the declaration.
 */
function externalOnlyHelpers(fileMap: FileMap): Set<string> {
  const covered = new Set<string>();
  for (const [file, content] of fileMap) {
    if (isTestFile(file)) continue;
    try {
      const declarations = parseSpawnDeclarations(content);
      if (declarations.external.length > 0 && declarations.spawns.length === 0) covered.add(file);
    } catch (error) {
      if (!(error instanceof DeclaredInputsError)) throw error; // a malformed header covers nothing
    }
  }
  return covered;
}

/**
 * Violations over `testFiles` (default: every test file in `fileMap`).
 * @throws SpawnCheckError("no-test-files") when there is no test file to check: a pass over nothing is not a pass
 */
export function findSpawnViolations(fileMap: FileMap, testFiles: readonly string[] = [...fileMap.keys()].filter(isTestFile)): SpawnViolation[] {
  if (testFiles.length === 0) throw new SpawnCheckError("no-test-files", "check:test-spawns: no test files to check (refusing to report a pass over nothing)");
  const { forward, sites } = analyse(fileMap);
  const covered = externalOnlyHelpers(fileMap);
  const violations: SpawnViolation[] = [];
  for (const test of testFiles) {
    const reached: Array<SpawnSite & { file: string; chain: string[] }> = [];
    for (const [module, chain] of reach(test, forward)) {
      for (const site of sites.get(module) ?? []) {
        // a helper that names its own external programs has declared them for every importer; `lore` from PATH never is
        if (module !== test && covered.has(module) && !site.loreFromPath) continue;
        reached.push({ ...site, file: module, chain });
      }
    }
    if (reached.length === 0) continue;
    const first = reached[0]!;
    let declarations: SpawnDeclarations;
    try {
      declarations = parseSpawnDeclarations(fileMap.get(test) ?? "");
    } catch (error) {
      if (!(error instanceof DeclaredInputsError)) throw error;
      violations.push({ testFile: test, site: first, chain: first.chain, missing: "malformed-declaration", detail: error.message });
      continue;
    }
    if (declarations.spawns.length === 0 && declarations.external.length === 0) {
      violations.push({ testFile: test, site: first, chain: first.chain, missing: "any-declaration" });
      continue;
    }
    const lore = reached.find((site) => site.loreFromPath);
    if (lore !== undefined && !matchesAnyPattern("dist/lore", declarations.spawns)) {
      violations.push({ testFile: test, site: lore, chain: lore.chain, missing: "dist-lore" });
    }
  }
  return violations;
}

/** One violation as the lines the check prints: the file, the call site, the import chain and the declaration to add. */
export function formatViolation(violation: SpawnViolation): string {
  const { testFile, site, chain, missing, detail } = violation;
  const where = `${site.file}:${site.line} (${site.api})`;
  const via = chain.length > 1 ? `\n    via ${chain.join(" -> ")}` : "";
  if (missing === "malformed-declaration") return `${testFile}: malformed spawn declaration: ${detail ?? ""}\n    spawn call site: ${where}${via}`;
  const fix =
    missing === "dist-lore" || site.loreFromPath
      ? "it spawns `lore` from PATH: add `// @spawns dist/lore`"
      : "add `// @spawns <repo path>` or `// @spawns-external <program> <reason>` to its leading comment block";
  return `${testFile}: undeclared spawn at ${where}${via}\n    ${fix}`;
}

/** CLI entry: returns the exit code (0 clean, 1 violations, 2 cannot run). */
export function main(argv: readonly string[], cwd: string): number {
  let changed = false;
  let base: string | undefined;
  let rootArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--changed") {
      changed = true;
      if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) base = argv[++i];
    } else if (arg === "--root") {
      rootArg = argv[++i];
      if (rootArg === undefined) throw new SpawnCheckError("bad-arguments", "--root needs a directory");
    } else {
      throw new SpawnCheckError("bad-arguments", `unknown argument: ${arg}`, { arg });
    }
  }
  const root = rootArg !== undefined ? resolve(cwd, rootArg) : getRepoRoot(cwd);
  const fileMap = collectSpawnFileMap(root);
  let testFiles: string[];
  if (changed) {
    testFiles = selectChangedTests(fileMap, getChangedFiles(root, resolveBaseRef(root, base)));
    if (testFiles.length === 0) {
      console.log("check:test-spawns:changed: no changed test file and no test reaching a changed non-production module; nothing to check");
      return 0;
    }
  } else {
    testFiles = [...fileMap.keys()].filter(isTestFile);
  }
  const violations = findSpawnViolations(fileMap, testFiles);
  if (violations.length > 0) {
    console.error(violations.map(formatViolation).join("\n"));
    console.error(`\ncheck:test-spawns: ${violations.length} of ${testFiles.length} test files spawn a process without a declaration`);
    return 1;
  }
  console.log(`check:test-spawns: ${testFiles.length} test files checked, every spawning test declares it`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2), process.cwd()));
  } catch (error) {
    console.error(`check:test-spawns: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

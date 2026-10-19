/**
 * Export reader — decides which names a source file exports by PARSING it with the TypeScript
 * compiler API (baseline-detect-code-anchor-drift BR-417; task-drift-check-decides-exported-names-
 * by-parsing-the-file-not). It is the implementation of `FsProbe.readExportedNames`, which
 * `@lore/core`'s browser-safe `computeDrift` consumes through `AnchorProbe.exported`.
 *
 * Public surface:
 *   createExportReader(readFile) — `(path, content) => ExportedNames` over a repo-relative reader
 *   EXPORT_READER_EXTENSIONS     — the extensions it can parse (everything else is "not measured")
 *
 * Recognised export forms: `export` on a function / class / interface / type / enum / namespace /
 * variable statement (destructuring patterns included), `export default …`, `export { a, b as c }`,
 * `export type { T }`, `export { x as y } from "m"`, `export * as ns from "m"`, `export * from "m"`
 * (followed through relative modules via `readFile`; a default export is not carried by `*`), and
 * the CommonJS forms `exports.x = …` / `module.exports.x = …`.
 *
 * @invariant Never a guess (BR-417): whenever the answer could be incomplete the result carries
 *   `notMeasured` with the reason — an extension this reader does not parse, a syntax error, a star
 *   re-export of a package or of a module it could not read, `module.exports = …` / `export = …`,
 *   a star chain deeper than {@link MAX_STAR_DEPTH}. Names it did find stay verified.
 * @invariant Star re-exports are followed through relative specifiers only, with a visited set (a
 *   cycle terminates) and `.js`→`.ts` style extension mapping, plus `index` resolution for a directory.
 * @invariant Imports no Node builtin and does no IO of its own: every file read goes through the
 *   injected `readFile`, so the repo-escape guard of the real probe applies to followed modules too.
 *
 * Side-effect class: pure given the injected `readFile` (loads `typescript` lazily on first use).
 */

import type * as TS from "typescript";
import type { ExportedNames } from "@lore/core";

/** Extensions parsed as TypeScript / JavaScript; any other extension is reported not measured. */
export const EXPORT_READER_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

/** Bound on star re-export chain depth (the visited set already prevents cycles). */
export const MAX_STAR_DEPTH = 16;

/** Reads one repo-relative file, or `null` when it cannot be read. */
export type ReadRepoFile = (path: string) => string | null;

/** Typed failure: the `typescript` package could not be loaded, so nothing can be measured. */
export class ExportReaderUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`export reader: typescript unavailable (${reason})`);
    this.name = "ExportReaderUnavailableError";
  }
}

let cachedTs: typeof TS | undefined;

function loadTypeScript(): typeof TS {
  if (cachedTs !== undefined) return cachedTs;
  try {
    // reason: a LITERAL specifier on purpose — `bun build --compile` then embeds the compiler as a lazily
    // evaluated CommonJS module (same mechanism as service/site-census.ts, issue #58), so the compiled
    // binary needs no `typescript` on disk and no other command pays for loading it.
    cachedTs = require("typescript") as typeof TS;
  } catch (cause) {
    throw new ExportReaderUnavailableError(String(cause));
  }
  return cachedTs;
}

/** Mutable accumulator for one file's (and its followed star targets') names. */
interface Collected {
  names: Set<string>;
  notMeasured: string[];
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot);
}

function scriptKindFor(ts: typeof TS, extension: string): TS.ScriptKind {
  switch (extension) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

/** `a/b/../c` → `a/c`; `undefined` when the path climbs above the repository root. */
function normalizeRepoPath(path: string): string | undefined {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

/** Candidate repo-relative files a relative `specifier` written in `fromPath` may denote, in probe order. */
function starTargetCandidates(fromPath: string, specifier: string): string[] {
  const dir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const joined = normalizeRepoPath(`${dir}/${specifier}`);
  if (joined === undefined) return [];
  const candidates: string[] = [];
  const remap: Record<string, readonly string[]> = {
    ".js": [".ts", ".tsx"],
    ".jsx": [".tsx"],
    ".mjs": [".mts"],
    ".cjs": [".cts"],
  };
  const extension = extensionOf(joined);
  if (EXPORT_READER_EXTENSIONS.includes(extension)) {
    candidates.push(joined);
    for (const mapped of remap[extension] ?? []) candidates.push(joined.slice(0, -extension.length) + mapped);
  } else {
    for (const ext of EXPORT_READER_EXTENSIONS) candidates.push(joined + ext);
  }
  for (const ext of EXPORT_READER_EXTENSIONS) candidates.push(`${joined}/index${ext}`);
  return candidates;
}

/** Names bound by a binding name or pattern (`a`, `{ a, b: c }`, `[x, ...rest]`). */
function bindingNames(ts: typeof TS, name: TS.BindingName, into: Set<string>): void {
  if (ts.isIdentifier(name)) {
    into.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) bindingNames(ts, element.name, into);
  }
}

function hasModifier(ts: typeof TS, node: TS.Node, kind: TS.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

/** The property name of `exports.x` / `module.exports.x` when `left` is one of those, else `undefined`. */
function commonJsNamedExport(ts: typeof TS, left: TS.Expression): string | undefined {
  if (!ts.isPropertyAccessExpression(left) || !ts.isIdentifier(left.name)) return undefined;
  const target = left.expression;
  const isExports = ts.isIdentifier(target) && target.text === "exports";
  const isModuleExports =
    ts.isPropertyAccessExpression(target) &&
    ts.isIdentifier(target.expression) &&
    target.expression.text === "module" &&
    target.name.text === "exports";
  return isExports || isModuleExports ? left.name.text : undefined;
}

/** `true` when `left` is exactly `module.exports`. */
function isModuleExportsTarget(ts: typeof TS, left: TS.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(left) &&
    ts.isIdentifier(left.expression) &&
    left.expression.text === "module" &&
    left.name.text === "exports"
  );
}

/**
 * Builds the export reader over a repo-relative file reader.
 *
 * @param readFile - Reads a repo-relative file or returns `null`; used to follow `export * from "./m"`.
 * @returns A function giving the exported names of one file's text, with `notMeasured` set whenever
 *   the list may be incomplete. Never throws for unparseable input.
 * @throws ExportReaderUnavailableError when the `typescript` package cannot be loaded.
 * @example
 * const read = createExportReader((p) => files.get(p) ?? null);
 * read("src/index.ts", "export * from './y.js';"); // => { names: Set(y's exports) }
 */
export function createExportReader(readFile: ReadRepoFile): (path: string, content: string) => ExportedNames {
  return (path, content) => {
    const ts = loadTypeScript();
    const collected: Collected = { names: new Set(), notMeasured: [] };
    collectFile(ts, readFile, path, content, collected, new Set([path]), 0, true);
    return collected.notMeasured.length === 0
      ? { names: collected.names }
      : { names: collected.names, notMeasured: [...new Set(collected.notMeasured)].join("; ") };
  };
}

/**
 * Parses one file and adds its exports to `collected`. `includeDefault` is false for a file reached
 * through `export *`, which does not carry a default export.
 */
function collectFile(
  ts: typeof TS,
  readFile: ReadRepoFile,
  path: string,
  content: string,
  collected: Collected,
  visited: Set<string>,
  depth: number,
  includeDefault: boolean,
): void {
  const extension = extensionOf(path);
  if (!EXPORT_READER_EXTENSIONS.includes(extension)) {
    collected.notMeasured.push(`"${path}" is a ${extension === "" ? "file with no extension" : `"${extension}" file`}, which the export reader cannot parse`);
    return;
  }
  const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, false, scriptKindFor(ts, extension));
  // reason: `parseDiagnostics` is not in the public typings but is the parser's own syntax-error list; a file
  // that did not parse cleanly may yield a partial statement list, so its names cannot be called complete.
  const diagnostics = (sourceFile as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics;
  if (!Array.isArray(diagnostics)) {
    collected.notMeasured.push(`syntax errors in "${path}" could not be checked`);
  } else if (diagnostics.length > 0) {
    collected.notMeasured.push(`"${path}" has syntax errors`);
  }

  const own = new Set<string>();
  for (const statement of sourceFile.statements) {
    collectStatement(ts, readFile, path, statement, own, collected, visited, depth);
  }
  for (const name of own) {
    if (name !== "default" || includeDefault) collected.names.add(name);
  }
}

function collectStatement(
  ts: typeof TS,
  readFile: ReadRepoFile,
  path: string,
  statement: TS.Statement,
  own: Set<string>,
  collected: Collected,
  visited: Set<string>,
  depth: number,
): void {
  if (ts.isExportDeclaration(statement)) {
    const clause = statement.exportClause;
    if (clause === undefined) {
      followStar(ts, readFile, path, statement, collected, visited, depth);
    } else if (ts.isNamespaceExport(clause)) {
      own.add(clause.name.text);
    } else {
      for (const element of clause.elements) own.add(element.name.text);
    }
    return;
  }
  if (ts.isExportAssignment(statement)) {
    if (statement.isExportEquals === true) {
      collected.notMeasured.push(`"${path}" uses \`export =\`, whose members are not named exports`);
    } else {
      own.add("default");
    }
    return;
  }
  if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression)) {
    const { left, operatorToken } = statement.expression;
    if (operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const named = commonJsNamedExport(ts, left);
      if (named !== undefined) own.add(named);
      else if (isModuleExportsTarget(ts, left)) {
        collected.notMeasured.push(`"${path}" assigns \`module.exports\` (CommonJS), whose members are not read`);
      }
    }
    return;
  }
  if (!hasModifier(ts, statement, ts.SyntaxKind.ExportKeyword)) return;
  if (hasModifier(ts, statement, ts.SyntaxKind.DefaultKeyword)) {
    own.add("default");
    return;
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) bindingNames(ts, declaration.name, own);
  } else if (ts.isImportEqualsDeclaration(statement)) {
    own.add(statement.name.text);
  } else if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  ) {
    if (statement.name !== undefined && (ts.isIdentifier(statement.name) || ts.isStringLiteral(statement.name))) {
      own.add(statement.name.text);
    }
  }
}

function followStar(
  ts: typeof TS,
  readFile: ReadRepoFile,
  fromPath: string,
  declaration: TS.ExportDeclaration,
  collected: Collected,
  visited: Set<string>,
  depth: number,
): void {
  const specifierNode = declaration.moduleSpecifier;
  if (specifierNode === undefined || !ts.isStringLiteral(specifierNode)) {
    collected.notMeasured.push(`"${fromPath}" has an \`export *\` with no module specifier`);
    return;
  }
  const specifier = specifierNode.text;
  if (!specifier.startsWith(".")) {
    collected.notMeasured.push(`\`export * from "${specifier}"\` in "${fromPath}" re-exports a package, whose names are not read`);
    return;
  }
  if (depth + 1 > MAX_STAR_DEPTH) {
    collected.notMeasured.push(`\`export * from "${specifier}"\` in "${fromPath}" is deeper than ${MAX_STAR_DEPTH} star re-exports`);
    return;
  }
  for (const candidate of starTargetCandidates(fromPath, specifier)) {
    const text = readFile(candidate);
    if (text === null) continue;
    if (visited.has(candidate)) return; // reason: a star cycle — the names of this file are already being collected
    visited.add(candidate);
    collectFile(ts, readFile, candidate, text, collected, visited, depth + 1, false);
    return;
  }
  collected.notMeasured.push(`\`export * from "${specifier}"\` in "${fromPath}" names a module that could not be read`);
}

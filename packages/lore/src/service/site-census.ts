/**
 * Module: site-census — static completeness census of the refusal / failure sites a command can reach.
 *
 * Purpose: make "a baseline leaf states every refusal its command can produce" machine-checkable
 *   (spec baseline-slice-2 C1). Starting at an entry symbol it follows, with the TypeScript
 *   compiler API, every call the type checker can resolve statically into a function / method
 *   body, and lists each `err({ code })` / `gateFailure({ code })` site it meets.
 * Public surface: {@link listSites}, {@link resolveCommandEntry}, {@link SiteCensusError},
 *   {@link findCensusRoot}, {@link Site}, {@link SiteCensusEntry}, {@link ERR_CALLEES}.
 * Invariants:
 *   - Deterministic: sites are de-duplicated by key and sorted by key (code-unit order).
 *   - A site key is `file#symbol#code` (file relative to rootDir, `/`-separated; symbol is the
 *     enclosing named function, see {@link enclosingSymbolName}).
 *   - A code is only ever READ (string literal, or a `const` / property initialised with one,
 *     through ternaries and `as`); anything else is reported as a dynamic (not_measured) site —
 *     never guessed.
 *   - A call through an element access (`registry[k](..)`) is a dynamic site: the callee is data.
 *   - Only functions whose source file lies under rootDir (and is neither node_modules nor .d.ts)
 *     are followed; recursion is bounded by {@link MAX_CALL_DEPTH} and a visited set.
 *   - A call through an interface / abstract method has no statically-resolvable body (the
 *     implementation is chosen at runtime), so it is a dynamic (not_measured) site keyed
 *     `<declaring file>#<Interface>#<method>`, de-duplicated per interface method; the
 *     implementations behind it are NOT visited.
 *   - A failure site whose enclosing symbol is named in {@link NON_BUSINESS_SYMBOLS} (app
 *     bootstrap) lands in the result's `bootstrap` list, never in the main list. An interface call
 *     made from such a symbol is plumbing too and is not recorded.
 * Side-effect class: IO (reads source files via the compiler host); no writes.
 *
 * `typescript` is a devDependency: it is loaded lazily with a non-literal specifier so the
 * compiled binary does not embed it, and its absence is a loud {@link SiteCensusError}.
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type * as TS from "typescript";
import { NON_BUSINESS_SYMBOLS } from "./site-census-nonbusiness.js";

/** Callee names whose call is a failure site: the Result error constructor and the gate-predicate failure constructor. */
export const ERR_CALLEES: readonly string[] = ["err", "gateFailure"];

/** Bound on call-graph depth from the entry (the visited set already prevents cycles). */
export const MAX_CALL_DEPTH = 12;

const MAX_CODE_RESOLVE_DEPTH = 6;
const MAX_LABEL_LENGTH = 80;

/** One failure site (or one unmeasurable call) reached from an entry. */
export interface Site {
  /** `file#symbol#code`, or `file#symbol#dynamic:<label>` for a dynamic site. */
  readonly key: string;
  /** Source file relative to rootDir, `/`-separated. */
  readonly file: string;
  /** Enclosing named function, e.g. `Service.process` or `default.subCommands.add.run`. */
  readonly symbol: string;
  /** The error code; absent exactly when `dynamic` is true. */
  readonly code?: string;
  /** True when the census could not measure the site (registry call, interface call or non-literal code). */
  readonly dynamic: boolean;
}

/**
 * The main site list, carrying the app-bootstrap sites (symbols in {@link NON_BUSINESS_SYMBOLS})
 * as a `bootstrap` property. The two lists never share a key; a consumer that only spreads or
 * maps the array sees the business sites alone.
 */
export type SiteList = Site[] & { bootstrap: Site[] };

/** Where the walk starts: a file (relative to rootDir) and the {@link enclosingSymbolName}-style symbol in it. */
export interface SiteCensusEntry {
  readonly file: string;
  readonly symbol: string;
}

export type SiteCensusErrorReason =
  | "typescript-unavailable"
  | "entry-file-missing"
  | "entry-symbol-missing"
  | "command-unresolved";

/** Typed failure of the census; `context` carries what the caller must fix. */
export class SiteCensusError extends Error {
  constructor(
    readonly reason: SiteCensusErrorReason,
    readonly context: Readonly<Record<string, string>>,
  ) {
    super(`site census: ${reason} ${JSON.stringify(context)}`);
    this.name = "SiteCensusError";
  }
}

let cachedTs: typeof TS | undefined;

function loadTypeScript(): typeof TS {
  if (cachedTs !== undefined) return cachedTs;
  const specifier = "typescript"; // reason: non-literal so `bun build --compile` does not embed the compiler.
  try {
    cachedTs = createRequire(import.meta.url)(specifier) as typeof TS;
  } catch (cause) {
    throw new SiteCensusError("typescript-unavailable", { cause: String(cause) });
  }
  return cachedTs;
}

type FunctionLike = TS.FunctionDeclaration | TS.MethodDeclaration | TS.FunctionExpression | TS.ArrowFunction;

/**
 * List the failure sites reachable from `entry`.
 *
 * @param input.rootDir - Absolute directory bounding both the entry file and every followed callee.
 * @param input.entry - Entry file (relative to rootDir) and symbol (see {@link enclosingSymbolName}).
 * @returns Sites sorted by key, de-duplicated; `[]` when the entry reaches none. The array's
 *   `bootstrap` property lists the app-bootstrap sites (never in the array itself).
 * @throws SiteCensusError when typescript, the entry file or the entry symbol cannot be found.
 * @example
 * listSites({ rootDir, entry: { file: "command.ts", symbol: "runCommand" } });
 */
export function listSites(input: { rootDir: string; entry: SiteCensusEntry }): SiteList {
  const { sites, bootstrap } = traceCensus(input);
  // reason: non-enumerable so structural equality / spreads of the main list ignore the bootstrap side-channel.
  return Object.defineProperty([...sites], "bootstrap", { value: bootstrap, enumerable: false }) as SiteList;
}

/** {@link listSites} plus the walk's footprint: every `file#symbol` whose body was visited (sorted, unique). */
export interface CensusTrace {
  readonly sites: Site[];
  /** App-bootstrap sites (see {@link NON_BUSINESS_SYMBOLS}); disjoint from `sites`. */
  readonly bootstrap: Site[];
  readonly reached: string[];
}

/**
 * Like {@link listSites} but also reports which functions the walk entered — the oracle for
 * "was this `return err(` hit unreached, or missed?" when auditing the census against a grep.
 */
export function traceCensus(input: { rootDir: string; entry: SiteCensusEntry }): CensusTrace {
  const ts = loadTypeScript();
  const rootDir = path.resolve(input.rootDir);
  const entryPath = path.resolve(rootDir, input.entry.file);
  if (!existsSync(entryPath)) {
    throw new SiteCensusError("entry-file-missing", { file: input.entry.file, rootDir });
  }
  const program = ts.createProgram([entryPath], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [], // reason: ambient bun-types are irrelevant to call resolution and cost seconds.
    jsx: ts.JsxEmit.ReactJSX,
  });
  const checker = program.getTypeChecker();
  const entryFile = program.getSourceFile(entryPath);
  if (entryFile === undefined) {
    throw new SiteCensusError("entry-file-missing", { file: input.entry.file, rootDir });
  }
  const walker = new CensusWalker(ts, program, checker, rootDir);
  const roots = walker.functionsNamed(entryFile, input.entry.symbol);
  if (roots.length === 0) {
    throw new SiteCensusError("entry-symbol-missing", {
      file: input.entry.file,
      symbol: input.entry.symbol,
      available: walker.namedFunctions(entryFile).join(", "),
    });
  }
  for (const root of roots) walker.visit(root, 0);
  return { sites: walker.result(), bootstrap: walker.bootstrapResult(), reached: walker.reachedSymbols() };
}

/**
 * Map a CLI command name to its handler entry — the documented rule for `lore baseline sites`.
 *
 * Rule: the name is whitespace-separated tokens. Token 1 names `commands/<token>.ts` under
 * `packages/lore/src/adapters/cli`; each further token names a nested `subCommands.<token>`;
 * the handler is the `run` of the innermost `defineCommand`. A single hyphenated token that is
 * not itself a command file (`ac-add`) is read as `<file>` + one subcommand (`ac` + `add`);
 * deeper nesting (`baseline glossary add`) needs spaces.
 *
 * @returns the entry; the entry symbol is e.g. `default.subCommands.add.run`.
 * @throws SiteCensusError("command-unresolved") when no command file matches.
 * @example
 * resolveCommandEntry({ rootDir, command: "ac add" })
 * // { file: "packages/lore/src/adapters/cli/commands/ac.ts", symbol: "default.subCommands.add.run" }
 */
export function resolveCommandEntry(input: { rootDir: string; command: string }): SiteCensusEntry {
  const commandsDir = "packages/lore/src/adapters/cli/commands";
  const tokens = input.command.trim().split(/\s+/).filter((t) => t.length > 0);
  const first = tokens[0];
  if (first === undefined) throw new SiteCensusError("command-unresolved", { command: input.command });
  const fileFor = (name: string): string => `${commandsDir}/${name}.ts`;
  const exists = (name: string): boolean => existsSync(path.resolve(input.rootDir, fileFor(name)));
  let name = first;
  let subs = tokens.slice(1);
  if (tokens.length === 1 && !exists(first) && first.includes("-")) {
    const cut = first.indexOf("-");
    name = first.slice(0, cut);
    subs = [first.slice(cut + 1)];
  }
  if (!exists(name)) {
    throw new SiteCensusError("command-unresolved", { command: input.command, tried: fileFor(name) });
  }
  const symbol = ["default", ...subs.map((s) => `subCommands.${s}`), "run"].join(".");
  return { file: fileFor(name), symbol };
}

/**
 * Walk up from `startDir` to the first directory holding the CLI command sources
 * (`packages/lore/src/adapters/cli/commands`) — the rootDir `lore baseline sites|coverage` analyse.
 *
 * @returns the absolute directory, or `undefined` when `startDir` is not inside a lore source
 *   checkout (an installed binary has no sources to analyse; the caller must say so, never guess).
 */
export function findCensusRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(current, "packages/lore/src/adapters/cli/commands"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Whole-walk state: visited set, collected sites, and the per-file symbol index. */
class CensusWalker {
  private readonly visited = new Set<TS.Node>();
  private readonly sites = new Map<string, Site>();
  private readonly bootstrapSites = new Map<string, Site>();
  private readonly index = new Map<TS.SourceFile, Map<string, FunctionLike[]>>();

  constructor(
    private readonly ts: typeof TS,
    private readonly program: TS.Program,
    private readonly checker: TS.TypeChecker,
    private readonly rootDir: string,
  ) {}

  result(): Site[] {
    return CensusWalker.sortedByKey(this.sites);
  }

  bootstrapResult(): Site[] {
    return CensusWalker.sortedByKey(this.bootstrapSites);
  }

  private static sortedByKey(sites: ReadonlyMap<string, Site>): Site[] {
    return [...sites.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  reachedSymbols(): string[] {
    const names = [...this.visited].map((fn) => {
      const rel = path.relative(this.rootDir, fn.getSourceFile().fileName).split(path.sep).join("/");
      return `${rel}#${this.enclosingSymbolName(fn)}`;
    });
    return [...new Set(names)].sort();
  }

  functionsNamed(file: TS.SourceFile, symbol: string): FunctionLike[] {
    return this.indexOf(file).get(symbol) ?? [];
  }

  namedFunctions(file: TS.SourceFile): string[] {
    return [...this.indexOf(file).keys()].sort();
  }

  /** Walk one function body, recording sites and recursing into statically resolvable callees. */
  visit(fn: FunctionLike, depth: number): void {
    if (this.visited.has(fn) || fn.body === undefined) return;
    this.visited.add(fn);
    const scan = (node: TS.Node): void => {
      if (this.ts.isCallExpression(node)) this.handleCall(node, depth);
      this.ts.forEachChild(node, scan);
    };
    scan(fn.body);
  }

  private handleCall(call: TS.CallExpression, depth: number): void {
    const callee = this.unwrap(call.expression);
    if (this.ts.isIdentifier(callee) && ERR_CALLEES.includes(callee.text)) {
      this.recordFailureCall(call, callee.text);
      return;
    }
    if (this.ts.isElementAccessExpression(callee)) {
      this.addSite(call, undefined, `dynamic:${this.label(callee)}`);
      return;
    }
    const dispatch = this.interfaceMethodOf(callee);
    if (dispatch !== undefined) {
      if (!this.isNonBusinessSymbol(this.enclosingSymbolName(call), call.getSourceFile())) this.addInterfaceSite(dispatch);
      return;
    }
    if (depth >= MAX_CALL_DEPTH) return;
    for (const target of this.resolveTargets(callee)) this.visit(target, depth + 1);
  }

  /** True when `symbol` in `file` (bare or `<file>#<symbol>`) is on the shared non-business list. */
  private isNonBusinessSymbol(symbol: string, file: TS.SourceFile): boolean {
    const rel = path.relative(this.rootDir, file.fileName).split(path.sep).join("/");
    return NON_BUSINESS_SYMBOLS.includes(symbol) || NON_BUSINESS_SYMBOLS.includes(`${rel}#${symbol}`);
  }

  /**
   * The interface / abstract method a call dispatches through, when the callee has declarations
   * under rootDir but none with a body (so the runtime implementation is unknown statically).
   */
  private interfaceMethodOf(callee: TS.Expression): { file: string; iface: string; method: string } | undefined {
    if (!this.ts.isPropertyAccessExpression(callee)) return undefined;
    const symbol = this.dealias(this.checker.getSymbolAtLocation(callee.name));
    const decls = symbol?.declarations ?? [];
    if (decls.length === 0) return undefined;
    const ts = this.ts;
    for (const decl of decls) {
      if (!this.isFollowable(decl.getSourceFile())) return undefined;
      if (this.functionOfDeclaration(decl) !== undefined) return undefined;
    }
    const decl = decls[0] as TS.Declaration;
    const isInterfaceMember = ts.isMethodSignature(decl) && (ts.isInterfaceDeclaration(decl.parent) || ts.isTypeLiteralNode(decl.parent));
    const isAbstractMethod = ts.isMethodDeclaration(decl) && decl.body === undefined && (ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Abstract) !== 0;
    if (!isInterfaceMember && !isAbstractMethod) return undefined;
    const owner = decl.parent;
    const iface = ts.isInterfaceDeclaration(owner) || ts.isClassDeclaration(owner) ? owner.name?.text : this.enclosingSymbolName(owner);
    if (iface === undefined || iface.length === 0) return undefined;
    const file = path.relative(this.rootDir, decl.getSourceFile().fileName).split(path.sep).join("/");
    return { file, iface, method: callee.name.text };
  }

  private addInterfaceSite(dispatch: { file: string; iface: string; method: string }): void {
    const key = `${dispatch.file}#${dispatch.iface}#${dispatch.method}`;
    if (this.sites.has(key)) return;
    this.sites.set(key, { key, file: dispatch.file, symbol: dispatch.iface, dynamic: true });
  }

  private recordFailureCall(call: TS.CallExpression, callee: string): void {
    const arg = call.arguments[0];
    const codes = arg !== undefined ? this.codesOfErrArgument(arg) : undefined;
    if (codes === undefined || codes.length === 0) {
      this.addSite(call, undefined, `dynamic:${callee}(${arg === undefined ? "" : this.label(arg)})`);
      return;
    }
    for (const code of codes) this.addSite(call, code, code);
  }

  /** The literal codes of `err({ code: <here> })`, or undefined when not statically readable. */
  private codesOfErrArgument(arg: TS.Expression): string[] | undefined {
    const object = this.unwrap(arg);
    if (!this.ts.isObjectLiteralExpression(object)) return undefined;
    for (const prop of object.properties) {
      if (this.ts.isPropertyAssignment(prop) && this.propertyName(prop.name) === "code") {
        return this.literalsOf(prop.initializer, 0);
      }
      if (this.ts.isShorthandPropertyAssignment(prop) && prop.name.text === "code") {
        const valueSymbol = this.checker.getShorthandAssignmentValueSymbol(prop);
        return this.literalsOfSymbol(valueSymbol, 0);
      }
    }
    return undefined;
  }

  private literalsOf(expr: TS.Expression, depth: number): string[] | undefined {
    if (depth > MAX_CODE_RESOLVE_DEPTH) return undefined;
    const e = this.unwrap(expr);
    if (this.ts.isStringLiteral(e) || this.ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
    if (this.ts.isConditionalExpression(e)) {
      const whenTrue = this.literalsOf(e.whenTrue, depth + 1);
      const whenFalse = this.literalsOf(e.whenFalse, depth + 1);
      return whenTrue === undefined || whenFalse === undefined ? undefined : [...new Set([...whenTrue, ...whenFalse])];
    }
    if (this.ts.isIdentifier(e)) return this.literalsOfSymbol(this.checker.getSymbolAtLocation(e), depth);
    if (this.ts.isPropertyAccessExpression(e)) return this.literalsOfSymbol(this.checker.getSymbolAtLocation(e.name), depth);
    return undefined;
  }

  /** A symbol resolves to literals only when declared `const x = "lit"` or as `{ k: "lit" }` / enum-like member. */
  private literalsOfSymbol(symbol: TS.Symbol | undefined, depth: number): string[] | undefined {
    const resolved = this.dealias(symbol);
    const decl = resolved?.declarations?.[0];
    if (decl === undefined) return undefined;
    if (this.ts.isVariableDeclaration(decl) && decl.initializer !== undefined) {
      const isConst = (decl.parent.flags & this.ts.NodeFlags.Const) !== 0;
      return isConst ? this.literalsOf(decl.initializer, depth + 1) : undefined;
    }
    if (this.ts.isPropertyAssignment(decl)) return this.literalsOf(decl.initializer, depth + 1);
    if (this.ts.isEnumMember(decl) && decl.initializer !== undefined) return this.literalsOf(decl.initializer, depth + 1);
    return undefined;
  }

  private resolveTargets(callee: TS.Expression): FunctionLike[] {
    const location = this.ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    if (!this.ts.isIdentifier(location) && !this.ts.isPrivateIdentifier(location)) return [];
    const symbol = this.dealias(this.checker.getSymbolAtLocation(location));
    const targets: FunctionLike[] = [];
    for (const decl of symbol?.declarations ?? []) {
      const fn = this.functionOfDeclaration(decl);
      if (fn !== undefined && fn.body !== undefined && this.isFollowable(fn.getSourceFile())) targets.push(fn);
    }
    return targets;
  }

  private functionOfDeclaration(decl: TS.Declaration): FunctionLike | undefined {
    const ts = this.ts;
    if (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl)) return decl;
    const init = ts.isVariableDeclaration(decl) || ts.isPropertyAssignment(decl) ? decl.initializer : undefined;
    if (init === undefined) return undefined;
    const inner = this.unwrap(init);
    return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner) ? inner : undefined;
  }

  private isFollowable(file: TS.SourceFile): boolean {
    if (file.isDeclarationFile) return false;
    const rel = path.relative(this.rootDir, file.fileName);
    return !rel.startsWith("..") && !path.isAbsolute(rel) && !rel.split(path.sep).includes("node_modules");
  }

  private dealias(symbol: TS.Symbol | undefined): TS.Symbol | undefined {
    if (symbol === undefined) return undefined;
    return (symbol.flags & this.ts.SymbolFlags.Alias) !== 0 ? this.checker.getAliasedSymbol(symbol) : symbol;
  }

  private addSite(node: TS.Node, code: string | undefined, tail: string): void {
    const file = node.getSourceFile();
    const rel = path.relative(this.rootDir, file.fileName).split(path.sep).join("/");
    const symbol = this.enclosingSymbolName(node);
    const key = `${rel}#${symbol}#${tail}`;
    const sink = this.isNonBusinessSymbol(symbol, file) ? this.bootstrapSites : this.sites;
    if (sink.has(key)) return;
    sink.set(key, code === undefined ? { key, file: rel, symbol, dynamic: true } : { key, file: rel, symbol, code, dynamic: false });
  }

  private label(node: TS.Node): string {
    const text = node.getText().replace(/\s+/g, " ").replace(/#/g, "~");
    return text.length > MAX_LABEL_LENGTH ? `${text.slice(0, MAX_LABEL_LENGTH)}...` : text;
  }

  private unwrap(expr: TS.Expression): TS.Expression {
    let current = expr;
    for (;;) {
      if (
        this.ts.isParenthesizedExpression(current) ||
        this.ts.isNonNullExpression(current) ||
        this.ts.isAsExpression(current) ||
        this.ts.isTypeAssertionExpression(current) ||
        this.ts.isSatisfiesExpression(current)
      ) {
        current = current.expression;
      } else return current;
    }
  }

  private propertyName(name: TS.PropertyName): string | undefined {
    return this.ts.isIdentifier(name) || this.ts.isStringLiteral(name) ? name.text : undefined;
  }

  // ── symbol naming ────────────────────────────────────────────────────────────

  private indexOf(file: TS.SourceFile): Map<string, FunctionLike[]> {
    const cached = this.index.get(file);
    if (cached !== undefined) return cached;
    const built = new Map<string, FunctionLike[]>();
    const scan = (node: TS.Node): void => {
      if (this.isFunctionLike(node)) {
        const name = this.enclosingSymbolName(node);
        built.set(name, [...(built.get(name) ?? []), node]);
      }
      this.ts.forEachChild(node, scan);
    };
    scan(file);
    this.index.set(file, built);
    return built;
  }

  private isFunctionLike(node: TS.Node): node is FunctionLike {
    return (
      this.ts.isFunctionDeclaration(node) ||
      this.ts.isMethodDeclaration(node) ||
      this.ts.isFunctionExpression(node) ||
      this.ts.isArrowFunction(node)
    );
  }

  /**
   * Name of the function that owns `node`: climb ancestors collecting names until a top-level
   * root (top-level function / const / class, or `export default`). Anonymous callbacks add no
   * segment, so a site inside `withX(async () => ...)` belongs to the enclosing named handler.
   * Examples: `Service.process`, `isReady`, `default.subCommands.add.run`.
   */
  private enclosingSymbolName(node: TS.Node): string {
    const ts = this.ts;
    const segments: string[] = [];
    for (let cur: TS.Node | undefined = node; cur !== undefined; cur = cur.parent) {
      if (ts.isExportAssignment(cur)) {
        segments.push("default");
        break;
      }
      const topLevel = ts.isSourceFile(cur.parent) || ts.isModuleBlock(cur.parent);
      if ((ts.isFunctionDeclaration(cur) || ts.isClassDeclaration(cur)) && cur.name !== undefined && topLevel) {
        segments.push(cur.name.text);
        break;
      }
      if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name) && ts.isVariableDeclarationList(cur.parent) && ts.isVariableStatement(cur.parent.parent)) {
        const statementParent = cur.parent.parent.parent;
        if (ts.isSourceFile(statementParent) || ts.isModuleBlock(statementParent)) {
          segments.push(cur.name.text);
          break;
        }
      }
      if ((ts.isMethodDeclaration(cur) || ts.isPropertyAssignment(cur)) && cur.name !== undefined) {
        const segment = this.propertyName(cur.name);
        if (segment !== undefined) segments.push(segment);
      }
    }
    return segments.reverse().join(".");
  }
}

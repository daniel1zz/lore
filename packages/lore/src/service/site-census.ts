/**
 * Module: site-census — static completeness census of the refusal / failure sites a command can reach.
 *
 * Purpose: make "a baseline leaf states every refusal its command can produce" machine-checkable
 *   (spec baseline-slice-2 C1). Starting at an entry symbol it follows, with the TypeScript
 *   compiler API, every call the type checker can resolve statically into a function / method
 *   body, and lists each `err({ code })` / `gateFailure({ code })` site it meets.
 * Public surface: {@link listSites}, {@link listSitesMany}, {@link traceCensusMany}, {@link resolveCommandEntry},
 *   {@link SiteCensusError}, {@link findCensusRoot}, {@link Site}, {@link SiteCensusEntry}, {@link ERR_CALLEES}.
 * Many-entry census (BR-1248 design): {@link traceCensusMany} builds ONE TypeScript program for every entry file and walks
 *   each entry with a walker RESTRICTED to that entry's import closure (the module resolution the workspace host performed).
 *   Every analysis that depends on which files are in the program (the product error type, the injected-binding scans
 *   `objectMembersNamed` / `callSitesOf`, `unresolvedImports`) sees only the closure, so each entry's result is identical to
 *   the per-entry {@link traceCensus} program; without the restriction an injected member bound differently in another
 *   entry's closure would leak extra bindings (`closureScoped: false` exists only as the falsifying probe of that fact).
 * Invariants:
 *   - A command entry symbol `default(.subCommands.<x>)*.run` is resolved by following the declared
 *     structure: a `subCommands.<x>` value may be an inline command or an identifier bound to a
 *     standalone `defineCommand` const (same file or imported), and `run` may be inline or an identifier.
 *     A symbol that is neither a named function nor resolvable this way is entry-symbol-missing.
 *   - Completeness is never faked: an import of an in-root file that the compiler cannot resolve
 *     (excluding node/bun built-ins) is reported in `unresolvedImports` (non-enumerable on the
 *     {@link listSites} array); its callees are unwalked so the site list is then a lower bound,
 *     and a consumer MUST treat the census as incomplete (`computeLeafCoverage` does).
 *   - Deterministic: sites are de-duplicated by key and sorted by key (code-unit order).
 *   - A site key is `file#symbol#code`, plus a 4th segment `#field` when the refusal carries a
 *     `field`: the literal when it is a string literal, else a decimal ordinal (0-based, by source
 *     position) among the same file+symbol+code refusals with a non-literal field. A refusal with
 *     no `field` has no 4th segment. File is relative to rootDir, `/`-separated; symbol is the
 *     enclosing named function, see {@link enclosingSymbolName}.
 *   - A failure site is (a) a call to {@link ERR_CALLEES}, or (b) any object literal whose
 *     CONTEXTUAL type is assignable to the product error type: the parameter type of the `err` /
 *     `gateFailure` declaration found in the analysed program (a generic parameter contributes its
 *     constraint). So a pure core `{ ok: false, error: { code, field } }` and a CLI
 *     `const refusal: LoreError = { code }` are sites though they never call err(). A program that
 *     declares no err/gateFailure has no product error type and only (a) applies.
 *   - Layout independence: workspace packages (root package.json `workspaces`, each package's
 *     `name`) resolve to their in-root source and tsconfig `paths` apply; node_modules symlink
 *     targets of workspace packages are never followed. A followed function body that nevertheless
 *     lies outside rootDir (and outside node_modules) is a loud SiteCensusError, never a drop.
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
 *   - Dependency injection is followed STATICALLY (issue #104, BR-659/BR-660). A call through a function-typed
 *     property / parameter (`this.deps.create(x)`), and an interface call whose receiver is an injected property /
 *     parameter (`this.store.insert(x)`), is resolved from the values BOUND to that property / parameter anywhere in
 *     the analysed program: object-literal members whose contextual type declares the property, and the arguments
 *     of every call / `new` that resolves to the parameter's function. A bound value is followed when it is an
 *     arrow / function expression, a function reference, or `x.m.bind(x)`; an interface receiver is resolved from
 *     the bound value's static type. Exactly one resolvable implementation -> it is followed and no dynamic site is
 *     recorded; several are ALL followed AND one dynamic site is recorded (the runtime choice is not known); none, or
 *     any bound value that is not statically resolvable -> one dynamic site. Never a guess, never a silent drop.
 *   - A failure site whose enclosing symbol is named in {@link NON_BUSINESS_SYMBOLS} (app
 *     bootstrap) lands in the result's `bootstrap` list, never in the main list. An interface call
 *     made from such a symbol is plumbing too and is not recorded.
 * Side-effect class: IO (reads source files via the compiler host); no writes.
 *
 * `typescript` is loaded lazily through a literal `require`: `bun build --compile` embeds it (evaluated only
 * when a census verb first runs, so no other command pays for it), and a load failure is a loud
 * {@link SiteCensusError}.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
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
  /** True when the census could not measure the site (registry call, interface call, non-literal code, a depth cut or an unmodelled binding). */
  readonly dynamic: boolean;
  /** `depth-bound` exactly when the walk stopped at {@link MAX_CALL_DEPTH} inside `symbol`: everything the cut callee reaches is NOT listed. */
  readonly kind?: "depth-bound";
}

/** How a refusal's `field` shows in its key: nothing, the literal, or a per-(file,symbol,code) ordinal. */
type FieldKey = { readonly kind: "none" } | { readonly kind: "literal"; readonly value: string } | { readonly kind: "ordinal" };

/** A coded failure site awaiting key finalisation (ordinals need every site of the walk). */
interface PendingSite {
  readonly rel: string;
  readonly symbol: string;
  readonly code: string;
  readonly field: FieldKey;
  readonly pos: number;
  readonly bootstrap: boolean;
}

/**
 * The main site list, carrying the app-bootstrap sites (symbols in {@link NON_BUSINESS_SYMBOLS})
 * as a `bootstrap` property. The two lists never share a key; a consumer that only spreads or
 * maps the array sees the business sites alone.
 */
export type SiteList = Site[] & { bootstrap: Site[]; unresolvedImports: UnresolvedImport[] };

/** Where the walk starts: a file (relative to rootDir) and the {@link enclosingSymbolName}-style symbol in it. */
export interface SiteCensusEntry {
  readonly file: string;
  readonly symbol: string;
}

export type SiteCensusErrorReason =
  | "typescript-unavailable"
  | "entry-file-missing"
  | "entry-symbol-missing"
  | "command-unresolved"
  | "callee-outside-root"
  | "workspace-import-unresolved"
  | "workspace-pattern-unsupported";

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
  try {
    // reason: a LITERAL specifier on purpose — `bun build --compile` then embeds the compiler as a lazily
    // evaluated CommonJS module (issue #58), so the compiled binary needs no `typescript` on disk.
    cachedTs = require("typescript") as typeof TS;
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
  return asSiteList(traceCensus(input));
}

function asSiteList({ sites, bootstrap, unresolvedImports }: CensusTrace): SiteList {
  // reason: non-enumerable so structural equality / spreads of the main list ignore the side-channels.
  const list = [...sites];
  Object.defineProperty(list, "bootstrap", { value: bootstrap, enumerable: false });
  Object.defineProperty(list, "unresolvedImports", { value: unresolvedImports, enumerable: false });
  return list as SiteList;
}

/** {@link listSites} plus the walk's footprint: every `file#symbol` whose body was visited (sorted, unique). */
export interface CensusTrace {
  readonly sites: Site[];
  /** App-bootstrap sites (see {@link NON_BUSINESS_SYMBOLS}); disjoint from `sites`. */
  readonly bootstrap: Site[];
  readonly reached: string[];
  /**
   * Imports made by in-root source files that the compiler could not resolve (sorted, unique). Their
   * callees were never walked, so any site behind them is MISSING from `sites`: a non-empty list means
   * the census is incomplete, never "a smaller complete list". `[]` when every import resolved.
   */
  readonly unresolvedImports: UnresolvedImport[];
}

/** One import specifier the census could not resolve, with the in-root file (relative, `/`-separated) that imports it. */
export interface UnresolvedImport {
  readonly specifier: string;
  readonly from: string;
}

/**
 * Like {@link listSites} but also reports which functions the walk entered — the oracle for
 * "was this `return err(` hit unreached, or missed?" when auditing the census against a grep.
 */
export function traceCensus(input: { rootDir: string; entry: SiteCensusEntry }): CensusTrace {
  return traceCensusMany({ rootDir: input.rootDir, entries: [input.entry] })[0] as CensusTrace;
}

/**
 * {@link traceCensus} for many entries over ONE shared TypeScript program (see the module header).
 *
 * @param input.entries - Entries to census; the result has one trace per entry, in the same order (duplicates allowed).
 * @param input.closureScoped - Default true: each entry is walked within its own import closure, so its trace equals
 *   `traceCensus` of that entry alone. `false` walks every entry against the whole shared program: a falsifying probe
 *   that leaks bindings across closures, never a mode a caller should use for results.
 * @throws SiteCensusError exactly as {@link traceCensus} (the first failing entry, in order).
 */
export function traceCensusMany(input: { rootDir: string; entries: readonly SiteCensusEntry[]; closureScoped?: boolean }): CensusTrace[] {
  if (input.entries.length === 0) return [];
  const ts = loadTypeScript();
  const rootDir = path.resolve(input.rootDir);
  const entryPaths = input.entries.map((entry) => {
    const entryPath = path.resolve(rootDir, entry.file);
    if (!existsSync(entryPath)) throw new SiteCensusError("entry-file-missing", { file: entry.file, rootDir });
    return entryPath;
  });
  const { program, checker, resolutions } = buildCensusProgram(ts, rootDir, entryPaths);
  const scoped = input.closureScoped !== false;
  return input.entries.map((entry, i): CensusTrace => {
    const entryPath = entryPaths[i] as string;
    const entryFile = program.getSourceFile(entryPath);
    if (entryFile === undefined) throw new SiteCensusError("entry-file-missing", { file: entry.file, rootDir });
    const closure = scoped ? importClosure(entryPath, resolutions.importsByFile) : undefined;
    const walker = new CensusWalker(ts, program, checker, rootDir, closure);
    walker.resolveErrorTypes();
    let roots = walker.functionsNamed(entryFile, entry.symbol);
    if (roots.length === 0) roots = walker.commandRunNamed(entryFile, entry.symbol);
    if (roots.length === 0) {
      throw new SiteCensusError("entry-symbol-missing", {
        file: entry.file,
        symbol: entry.symbol,
        available: walker.namedFunctions(entryFile).join(", "),
      });
    }
    for (const root of roots) walker.visit(root, 0);
    const unresolved = new Map<string, UnresolvedImport>();
    for (const [file, found] of resolutions.unresolvedByFile) {
      if (closure !== undefined && !closure.has(file)) continue;
      for (const [key, value] of found) unresolved.set(key, value);
    }
    const unresolvedImports = [...unresolved.values()].sort((a, b) => (a.specifier === b.specifier ? (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) : a.specifier < b.specifier ? -1 : 1));
    return { sites: walker.result(), bootstrap: walker.bootstrapResult(), reached: walker.reachedSymbols(), unresolvedImports };
  });
}

/** One runnable command of a checkout: the file of its top-level module and the sub-command name path inside it. */
export interface RunnableCommandPath {
  /** Top-level command name as the registry spells it (`ac`, `sync-docs`). */
  readonly top: string;
  /** Command module, relative to rootDir. */
  readonly file: string;
  /** Sub-command names below the module's default command; `[]` = the module's own `run`. */
  readonly subs: readonly string[];
}

/**
 * List every runnable command of the checkout at `rootDir` STATICALLY: read the registry object literal `registryVar` of
 * `registryFile`, follow each entry's lazy import to its command module, and walk the module's `subCommands` structure
 * (inline objects, `defineCommand` calls, identifiers, factory calls, lazy imports). No analysed code is executed, so
 * the compiled binary (which cannot resolve the checkout's bare imports) can run it.
 *
 * @throws SiteCensusError("command-unresolved") when the registry or any command module / sub-command is not statically
 *   resolvable; never returns a shorter list.
 * @example
 * listRunnableCommandPaths({ rootDir, registryFile: "packages/lore/src/adapters/cli/index.ts", registryVar: "COMMAND_LOADERS" });
 */
export function listRunnableCommandPaths(input: { rootDir: string; registryFile: string; registryVar: string }): RunnableCommandPath[] {
  const ts = loadTypeScript();
  const rootDir = path.resolve(input.rootDir);
  const registryPath = path.resolve(rootDir, input.registryFile);
  const unresolved = (context: Record<string, string>): SiteCensusError => new SiteCensusError("command-unresolved", { registry: input.registryFile, ...context });
  if (!existsSync(registryPath)) throw unresolved({ reason: "command registry not found" });
  const { program, checker } = buildCensusProgram(ts, rootDir, [registryPath]);
  const registryFile = program.getSourceFile(registryPath);
  if (registryFile === undefined) throw unresolved({ reason: "command registry not loadable" });
  let literal: TS.ObjectLiteralExpression | undefined;
  for (const st of registryFile.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const decl of st.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === input.registryVar && decl.initializer !== undefined) {
        let init: TS.Expression = decl.initializer;
        while (ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isSatisfiesExpression(init)) init = init.expression;
        if (ts.isObjectLiteralExpression(init)) literal = init;
      }
    }
  }
  if (literal === undefined) throw unresolved({ reason: `module exports no ${input.registryVar} object literal` });
  const walker = new CensusWalker(ts, program, checker, rootDir);
  const out: RunnableCommandPath[] = [];
  for (const prop of literal.properties) {
    if (!ts.isPropertyAssignment(prop) || !(ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) throw unresolved({ reason: `${input.registryVar} entry has no static name` });
    const top = prop.name.text;
    let body: TS.Node = prop.initializer;
    while (ts.isArrowFunction(body) || ts.isParenthesizedExpression(body)) body = ts.isArrowFunction(body) ? body.body : body.expression;
    const importCall = ts.isCallExpression(body) && body.expression.kind === ts.SyntaxKind.ImportKeyword ? body : undefined;
    const specifier = importCall?.arguments[0];
    const moduleSymbol = specifier === undefined ? undefined : checker.getSymbolAtLocation(specifier);
    const moduleFile = moduleSymbol?.declarations?.find(ts.isSourceFile);
    if (moduleFile === undefined) throw unresolved({ reason: "loader does not statically import a command module", command: top });
    const file = path.relative(rootDir, moduleFile.fileName).split(path.sep).join("/");
    for (const subs of walker.runnableSubPaths(moduleFile, file)) out.push({ top, file, subs });
  }
  return out;
}

/** The one TypeScript program every census verb builds: workspace-aware resolution over `rootNames`, nothing emitted. */
function buildCensusProgram(
  ts: typeof TS,
  rootDir: string,
  rootNames: readonly string[],
): { program: TS.Program; checker: TS.TypeChecker; resolutions: HostResolutions } {
  const options: TS.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [], // reason: ambient bun-types are irrelevant to call resolution and cost seconds.
    jsx: ts.JsxEmit.ReactJSX,
    ...tsconfigPathOptions(ts, rootDir),
  };
  const resolutions: HostResolutions = { importsByFile: new Map(), unresolvedByFile: new Map() };
  const host = createWorkspaceHost(ts, options, rootDir, resolutions);
  const program = ts.createProgram({ rootNames: [...new Set(rootNames)], options, host });
  return { program, checker: program.getTypeChecker(), resolutions };
}

/** Files reachable from `entryPath` through the imports the workspace host resolved (the entry included). */
function importClosure(entryPath: string, importsByFile: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const closure = new Set<string>([entryPath]);
  const queue = [entryPath];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    for (const next of importsByFile.get(file) ?? []) {
      if (closure.has(next)) continue;
      closure.add(next);
      queue.push(next);
    }
  }
  return closure;
}

/**
 * {@link listSites} for many CLI commands over one shared program: each distinct command is censused once.
 *
 * @param input.commands - CLI command names as {@link resolveCommandEntry} reads them.
 * @returns command name -> the list {@link listSites} returns for it (same sites, bootstrap, unresolvedImports).
 * @throws SiteCensusError as {@link resolveCommandEntry} / {@link traceCensusMany}.
 * @example
 * listSitesMany({ rootDir, commands: ["claim", "done"] }).get("claim");
 */
export function listSitesMany(input: { rootDir: string; commands: readonly string[]; closureScoped?: boolean }): Map<string, SiteList> {
  const distinct = [...new Set(input.commands)];
  const traces = traceCensusMany({
    rootDir: input.rootDir,
    entries: distinct.map((command) => resolveCommandEntry({ rootDir: input.rootDir, command })),
    ...(input.closureScoped === undefined ? {} : { closureScoped: input.closureScoped }),
  });
  const lists = new Map<string, SiteList>();
  distinct.forEach((command, i) => lists.set(command, asSiteList(traces[i] as CensusTrace)));
  return lists;
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

/** tsconfig `paths` / `baseUrl` of the analysed root (with `extends` resolved); `{}` when it has no tsconfig. */
function tsconfigPathOptions(ts: typeof TS, rootDir: string): TS.CompilerOptions {
  const configPath = path.join(rootDir, "tsconfig.json");
  if (!existsSync(configPath)) return {};
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error !== undefined) {
    throw new SiteCensusError("typescript-unavailable", { cause: ts.flattenDiagnosticMessageText(read.error.messageText, "\n"), file: configPath });
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, rootDir, undefined, configPath);
  const picked: TS.CompilerOptions = {};
  if (parsed.options.paths !== undefined) {
    picked.paths = parsed.options.paths;
    // reason: `paths` without baseUrl resolve against pathsBasePath, which the parser records.
    const base = (parsed.options as Record<string, unknown>)["pathsBasePath"];
    if (typeof base === "string") (picked as Record<string, unknown>)["pathsBasePath"] = base;
  }
  if (parsed.options.baseUrl !== undefined) picked.baseUrl = parsed.options.baseUrl;
  return picked;
}

/** A workspace package of the analysed root: its `name`, in-root directory and `exports` map. */
interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly exportsMap: unknown;
}

/** Directories matched by one `workspaces` pattern: `<dir>/*` (one level) or a literal directory. */
function expandWorkspacePattern(rootDir: string, pattern: string): string[] {
  if (!pattern.includes("*")) return [path.resolve(rootDir, pattern)];
  if (!pattern.endsWith("/*") || pattern.slice(0, -2).includes("*")) {
    throw new SiteCensusError("workspace-pattern-unsupported", { pattern, supported: "literal dir or <dir>/*" });
  }
  const parent = path.resolve(rootDir, pattern.slice(0, -2));
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(parent, e.name));
}

/** Workspace packages declared by rootDir/package.json `workspaces`; `[]` when it declares none. */
function readWorkspacePackages(rootDir: string): WorkspacePackage[] {
  const manifestPath = path.join(rootDir, "package.json");
  if (!existsSync(manifestPath)) return [];
  const root = JSON.parse(readFileSync(manifestPath, "utf8")) as { workspaces?: string[] | { packages?: string[] } };
  const patterns = Array.isArray(root.workspaces) ? root.workspaces : (root.workspaces?.packages ?? []);
  const found: WorkspacePackage[] = [];
  for (const pattern of patterns) {
    for (const dir of expandWorkspacePattern(rootDir, pattern)) {
      const pkgPath = path.join(dir, "package.json");
      if (!existsSync(pkgPath)) continue;
      const manifest = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; exports?: unknown };
      if (typeof manifest.name === "string") found.push({ name: manifest.name, dir, exportsMap: manifest.exports });
    }
  }
  return found;
}

// Explicit allowlist: anything not listed (dotted code names like `./foo.service`, unknown extensions) stays reported.
const ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  ".css", ".scss", ".html", ".htm", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".md", ".txt",
]);

/** First string found in an `exports` target (string, or a conditions object preferring types/import/default). */
function exportTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (target === null || typeof target !== "object") return undefined;
  for (const condition of ["types", "import", "default"]) {
    const nested = exportTarget((target as Record<string, unknown>)[condition]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/**
 * Compiler host whose module resolution maps workspace package names to their in-root source
 * (so a worktree's node_modules links to another checkout can never change what is analysed);
 * every other specifier goes through TypeScript's normal resolution.
 */
/**
 * What the workspace host observed while the program resolved modules: per containing file the files it imports (the
 * import-closure graph) and the unresolved imports it made (in-root, non-runtime, non-asset only).
 */
interface HostResolutions {
  readonly importsByFile: Map<string, Set<string>>;
  readonly unresolvedByFile: Map<string, Map<string, UnresolvedImport>>;
}

function createWorkspaceHost(ts: typeof TS, options: TS.CompilerOptions, rootDir: string, resolutions: HostResolutions): TS.CompilerHost {
  const host = ts.createCompilerHost(options);
  const packages = readWorkspacePackages(rootDir);
  const resolveFile = (specifier: string, containingFile: string): TS.ResolvedModuleFull | undefined =>
    ts.resolveModuleName(specifier, containingFile, options, host).resolvedModule;
  // reason: a workspace target is an absolute `*.ts` path, so TypeScript flags it resolvedUsingTsExtension and then
  // asserts the ORIGINAL specifier (`@lore/core`) ends in `.ts`: a Debug Failure. The flag is false for the bare specifier.
  const asBareResolution = (resolved: TS.ResolvedModuleFull | undefined): TS.ResolvedModuleFull | undefined =>
    resolved === undefined ? undefined : { ...resolved, resolvedUsingTsExtension: false };
  const resolveWorkspace = (pkg: WorkspacePackage, subpath: string, containingFile: string): TS.ResolvedModuleFull | undefined => {
    const key = subpath === "" ? "." : `./${subpath}`;
    const mapped =
      pkg.exportsMap !== null && typeof pkg.exportsMap === "object" && !Array.isArray(pkg.exportsMap)
        ? exportTarget((pkg.exportsMap as Record<string, unknown>)[key])
        : undefined;
    return asBareResolution(resolveFile(path.resolve(pkg.dir, mapped ?? subpath), containingFile));
  };
  // reason: runtime-provided modules (`node:fs`, `bun:sqlite`) have no source to walk and no err() sites: never "missing".
  const runtimeProvided = (specifier: string): boolean => isBuiltin(specifier) || specifier.startsWith("bun:") || specifier === "bun";
  // reason: a relative import of a non-code asset (`./x.html`, `../dist/a.css`) is a build artefact with no err() sites; missing on a fresh checkout is not "not measured".
  const relativeAsset = (specifier: string): boolean =>
    (specifier.startsWith(".") || specifier.startsWith("/")) && ASSET_EXTENSIONS.has(path.extname(specifier).toLowerCase());
  const recordUnresolved = (specifier: string, containingFile: string): void => {
    const rel = path.relative(rootDir, containingFile);
    if (rel.startsWith("..") || path.isAbsolute(rel) || rel.split(path.sep).includes("node_modules") || runtimeProvided(specifier) || relativeAsset(specifier)) return;
    const from = rel.split(path.sep).join("/");
    const forFile = resolutions.unresolvedByFile.get(containingFile) ?? new Map<string, UnresolvedImport>();
    forFile.set(`${specifier}\0${from}`, { specifier, from });
    resolutions.unresolvedByFile.set(containingFile, forFile);
  };
  const recordImport = (containingFile: string, resolved: TS.ResolvedModuleFull | undefined): void => {
    if (resolved === undefined) return;
    const imports = resolutions.importsByFile.get(containingFile) ?? new Set<string>();
    imports.add(resolved.resolvedFileName);
    resolutions.importsByFile.set(containingFile, imports);
  };
  host.resolveModuleNameLiterals = (literals, containingFile) =>
    literals.map((literal): TS.ResolvedModuleWithFailedLookupLocations => {
      const specifier = literal.text;
      const pkg = packages.find((p) => specifier === p.name || specifier.startsWith(`${p.name}/`));
      if (pkg === undefined) {
        const resolvedModule = resolveFile(specifier, containingFile);
        // reason: the compiler appends a synthetic `react/jsx-runtime` import (position -1) to every file under `jsx: ReactJSX`; it is not source.
        if (resolvedModule === undefined && literal.pos >= 0) recordUnresolved(specifier, containingFile);
        recordImport(containingFile, resolvedModule);
        return { resolvedModule };
      }
      const resolved = resolveWorkspace(pkg, specifier.slice(pkg.name.length + 1), containingFile);
      if (resolved === undefined) {
        throw new SiteCensusError("workspace-import-unresolved", {
          specifier,
          containingFile: path.relative(rootDir, containingFile),
          packageDir: path.relative(rootDir, pkg.dir),
        });
      }
      recordImport(containingFile, resolved);
      return { resolvedModule: resolved };
    });
  return host;
}

/** A value bound to an injected property / parameter; `shorthand` when `expr` is the name of `{ name }`. */
interface BoundValue {
  readonly expr: TS.Node;
  readonly shorthand: boolean;
}

/** Functions an injected call may reach; `opaque` when some bound value could not be resolved statically. */
interface BoundFunctions {
  readonly fns: FunctionLike[];
  readonly opaque: boolean;
}

/** Whole-walk state: visited set, collected sites, and the per-file symbol index. */
class CensusWalker {
  /** Every function body walked, with the SHALLOWEST depth it was reached at (a deeper first visit must not hide a shallow one). */
  private readonly visited = new Map<TS.Node, number>();
  /** Calls whose callee the walk did not follow because of {@link MAX_CALL_DEPTH}; a later shallower visit of the same call retracts its cut. */
  private readonly depthCuts = new Map<TS.Node, { site: Site; bootstrap: boolean }>();
  private readonly sites = new Map<string, Site>();
  private readonly bootstrapSites = new Map<string, Site>();
  private readonly index = new Map<TS.SourceFile, Map<string, FunctionLike[]>>();
  /** Coded failure sites keyed by `<file>:<node start>` (a node scanned twice is one site). */
  private readonly pending = new Map<string, PendingSite>();
  /** Object literals already recorded as the argument of an err()/gateFailure() call. */
  private readonly consumedArguments = new Set<TS.Node>();
  /** The product error type(s): parameter types of the program's err/gateFailure declarations. */
  private errorTypes: TS.Type[] = [];

  constructor(
    private readonly ts: typeof TS,
    private readonly program: TS.Program,
    private readonly checker: TS.TypeChecker,
    private readonly rootDir: string,
    /** The entry's import closure (absolute file names); `undefined` = the whole program (single-entry / falsifying probe). */
    private readonly scope: ReadonlySet<string> | undefined = undefined,
  ) {}

  /**
   * Find the product error type: the first-parameter type of every top-level `err` /
   * `gateFailure` function or const-arrow under rootDir (a type-parameter contributes its
   * constraint). Empty when the program declares neither: then only err()/gateFailure() calls
   * can be sites (nothing is typed as a product error).
   */
  resolveErrorTypes(): void {
    const ts = this.ts;
    if (typeof this.checker.isTypeAssignableTo !== "function") {
      throw new SiteCensusError("typescript-unavailable", { cause: "TypeChecker.isTypeAssignableTo missing (typescript >= 5.4 required)" });
    }
    const found: TS.Type[] = [];
    for (const file of this.program.getSourceFiles()) {
      if (!this.isFollowable(file)) continue;
      for (const statement of file.statements) {
        const fns: FunctionLike[] = [];
        if (ts.isFunctionDeclaration(statement) && statement.name !== undefined && ERR_CALLEES.includes(statement.name.text)) fns.push(statement);
        if (ts.isVariableStatement(statement)) {
          for (const decl of statement.declarationList.declarations) {
            if (!ts.isIdentifier(decl.name) || !ERR_CALLEES.includes(decl.name.text) || decl.initializer === undefined) continue;
            const init = this.unwrap(decl.initializer);
            if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) fns.push(init);
          }
        }
        for (const fn of fns) {
          const param = fn.parameters[0];
          if (param === undefined) continue;
          let type = this.checker.getTypeAtLocation(param);
          if ((type.flags & ts.TypeFlags.TypeParameter) !== 0) type = this.checker.getBaseConstraintOfType(type) ?? type;
          if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) === 0) found.push(type);
        }
      }
    }
    this.errorTypes = found;
  }

  result(): Site[] {
    return CensusWalker.sortedByKey(this.withDepthCuts(this.mergedSites(this.sites, false), false));
  }

  bootstrapResult(): Site[] {
    return CensusWalker.sortedByKey(this.withDepthCuts(this.mergedSites(this.bootstrapSites, true), true));
  }

  private withDepthCuts(merged: Map<string, Site>, bootstrap: boolean): Map<string, Site> {
    for (const cut of this.depthCuts.values()) if (cut.bootstrap === bootstrap && !merged.has(cut.site.key)) merged.set(cut.site.key, cut.site);
    return merged;
  }

  /** Ready-keyed sites plus the pending coded sites of one sink, keys finalised (ordinals by source position). */
  private mergedSites(ready: ReadonlyMap<string, Site>, bootstrap: boolean): Map<string, Site> {
    const merged = new Map(ready);
    const ordered = [...this.pending.values()].filter((p) => p.bootstrap === bootstrap).sort((a, b) => (a.rel === b.rel ? a.pos - b.pos : a.rel < b.rel ? -1 : 1));
    const ordinals = new Map<string, number>();
    const bases: string[] = [];
    for (const p of ordered) {
      let tail = p.code;
      if (p.field.kind === "literal") tail = `${p.code}#${p.field.value}`;
      if (p.field.kind === "ordinal") {
        const group = `${p.rel}#${p.symbol}#${p.code}`;
        const next = ordinals.get(group) ?? 0;
        ordinals.set(group, next + 1);
        tail = `${p.code}#${next}`;
      }
      bases.push(`${p.rel}#${p.symbol}#${tail}`);
    }
    // Distinct sites that still share a base key (same code and the same literal field, or both field-less) must not
    // collapse (issue #59: one key covering a dozen refusals): every member of such a group gets `~<n>` by source position.
    const sizes = new Map<string, number>();
    for (const base of bases) sizes.set(base, (sizes.get(base) ?? 0) + 1);
    const seen = new Map<string, number>();
    ordered.forEach((p, i) => {
      const base = bases[i] as string;
      let key = base;
      if ((sizes.get(base) ?? 0) > 1) {
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        key = p.field.kind === "none" ? `${base}#~${n}` : `${base}~${n}`;
      }
      if (!merged.has(key)) merged.set(key, { key, file: p.rel, symbol: p.symbol, code: p.code, dynamic: false });
    });
    return merged;
  }

  private static sortedByKey(sites: ReadonlyMap<string, Site>): Site[] {
    return [...sites.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  reachedSymbols(): string[] {
    const names = [...this.visited.keys()].map((fn) => {
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

  /**
   * Resolve a command-shaped entry symbol `default(.subCommands.<x>)*.run` by FOLLOWING the declared
   * structure: the default export's command object, each `subCommands.<x>` value (an inline object /
   * `defineCommand(...)` call, or an identifier bound to one — a standalone const, possibly imported),
   * then its `run` (inline function, method, or identifier bound to a function). `[]` when the symbol
   * is not command-shaped or any step is absent (the caller then refuses with entry-symbol-missing).
   */
  commandRunNamed(file: TS.SourceFile, symbol: string): FunctionLike[] {
    const ts = this.ts;
    const match = /^default((?:\.subCommands\.[^.]+)*)\.run$/.exec(symbol);
    if (match === null) return [];
    const subs = (match[1] ?? "").split(".subCommands.").filter((t) => t.length > 0);
    const exported = file.statements.find((st): st is TS.ExportAssignment => ts.isExportAssignment(st));
    if (exported === undefined) return [];
    let command = this.commandObject(exported.expression, 0, false);
    for (const sub of subs) {
      if (command === undefined) return [];
      const group = this.propertyValue(command, "subCommands");
      const container = group === undefined ? undefined : this.commandObject(group.expr, 0, group.shorthand);
      const entry = container === undefined ? undefined : this.propertyValue(container, sub);
      command = entry === undefined ? undefined : this.commandObject(entry.expr, 0, entry.shorthand);
    }
    const run = command === undefined ? undefined : this.runFunction(command);
    return run === undefined ? [] : [run];
  }

  /**
   * Every runnable node of the command module `file`: the sub-command name path (`[]` = the module's own command,
   * `["add"]` = `default.subCommands.add`) of each command object that declares a `run`. Reads the declared structure
   * only (no analysed code runs). A module with no default command, a computed / spread sub-command entry, or a
   * sub-command value that does not resolve to a command object is a loud `command-unresolved`, never a shorter list.
   */
  runnableSubPaths(file: TS.SourceFile, rel: string): string[][] {
    const ts = this.ts;
    const exported = file.statements.find((st): st is TS.ExportAssignment => ts.isExportAssignment(st));
    const root = exported === undefined ? undefined : this.lazyCommandObject(exported.expression, 0);
    if (root === undefined) throw new SiteCensusError("command-unresolved", { reason: "no default command object", file: rel });
    const out: string[][] = [];
    this.collectRunnable(root, [], out, rel);
    return out;
  }

  private collectRunnable(command: TS.ObjectLiteralExpression, subs: readonly string[], out: string[][], rel: string): void {
    const ts = this.ts;
    if (this.propertyValue(command, "run") !== undefined) out.push([...subs]);
    const group = this.propertyValue(command, "subCommands");
    if (group === undefined) return;
    const container = this.lazyCommandObject(group.expr, 0, group.shorthand);
    const where = [...subs].join(" ") || "(top)";
    if (container === undefined) throw new SiteCensusError("command-unresolved", { reason: "subCommands is not an object literal", file: rel, at: where });
    for (const prop of container.properties) {
      const name = ts.isSpreadAssignment(prop) || prop.name === undefined ? undefined : this.propertyName(prop.name);
      if (name === undefined) throw new SiteCensusError("command-unresolved", { reason: "subCommands entry has no static name", file: rel, at: where });
      const value = this.propertyValue(container, name);
      const child = value === undefined ? undefined : this.lazyCommandObject(value.expr, 0, value.shorthand);
      if (child === undefined) throw new SiteCensusError("command-unresolved", { reason: "sub-command does not resolve to a command object", file: rel, at: [...subs, name].join(" ") });
      this.collectRunnable(child, [...subs, name], out, rel);
    }
  }

  /**
   * {@link commandObject} plus citty's lazy forms: a thunk returning a command (`() => ({..})`), and a lazily imported
   * module (`() => import("./x.js")`, `import("./x.js").then((m) => m.default)`) whose default export is the command.
   */
  private lazyCommandObject(expr: TS.Node, depth: number, shorthand = false): TS.ObjectLiteralExpression | undefined {
    const ts = this.ts;
    if (depth > MAX_CODE_RESOLVE_DEPTH) return undefined;
    const node = ts.isExpression(expr) ? this.unwrap(expr) : expr;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (!ts.isBlock(node.body)) return this.lazyCommandObject(node.body, depth + 1);
      const returns = node.body.statements.filter(ts.isReturnStatement);
      const only = returns[0];
      return returns.length === 1 && only?.expression !== undefined ? this.lazyCommandObject(only.expression, depth + 1) : undefined;
    }
    if (ts.isCallExpression(node)) {
      const callee = this.unwrap(node.expression);
      if (callee.kind === ts.SyntaxKind.ImportKeyword) return this.importedDefaultCommand(node, depth);
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "then") {
        const receiver = this.unwrap(callee.expression);
        const cb = node.arguments[0];
        const picksDefault = cb !== undefined && ts.isArrowFunction(cb) && !ts.isBlock(cb.body) && ts.isPropertyAccessExpression(cb.body) && cb.body.name.text === "default";
        if (picksDefault && ts.isCallExpression(receiver) && this.unwrap(receiver.expression).kind === ts.SyntaxKind.ImportKeyword) return this.importedDefaultCommand(receiver, depth);
      }
    }
    return this.commandObject(node, depth, shorthand);
  }

  private importedDefaultCommand(call: TS.CallExpression, depth: number): TS.ObjectLiteralExpression | undefined {
    const ts = this.ts;
    const spec = call.arguments[0];
    const moduleSymbol = spec === undefined ? undefined : this.checker.getSymbolAtLocation(spec);
    if (moduleSymbol === undefined) return undefined;
    const def = this.checker.getExportsOfModule(moduleSymbol).find((e) => e.name === "default");
    const decl = def?.declarations?.find(ts.isExportAssignment);
    return decl === undefined ? undefined : this.lazyCommandObject(decl.expression, depth + 1);
  }

  /** Object literal behind `expr`: itself, the first argument of a call (`defineCommand({..})`), or an identifier's initializer. */
  private commandObject(expr: TS.Node, depth: number, shorthand: boolean): TS.ObjectLiteralExpression | undefined {
    const ts = this.ts;
    if (depth > MAX_CODE_RESOLVE_DEPTH) return undefined;
    const node = ts.isExpression(expr) ? this.unwrap(expr) : expr;
    if (ts.isObjectLiteralExpression(node)) return node;
    if (ts.isCallExpression(node)) {
      const arg = node.arguments[0];
      const wrapped = arg === undefined ? undefined : this.commandObject(arg, depth + 1, false);
      return wrapped ?? this.factoryReturnedCommand(node, depth);
    }
    if (ts.isIdentifier(node)) {
      const decl = this.valueDeclarationOf(node, shorthand);
      if (decl === undefined || !ts.isVariableDeclaration(decl) || decl.initializer === undefined) return undefined;
      return this.commandObject(decl.initializer, depth + 1, false);
    }
    return undefined;
  }

  /**
   * A call to a local factory function (`regenerableVerb("add")`): the command object its body returns. The callee
   * must resolve to a declared function with a body and EVERY `return` (outside nested functions) must resolve to
   * the same command object; anything else is `undefined` (the caller then refuses with entry-symbol-missing).
   */
  private factoryReturnedCommand(call: TS.CallExpression, depth: number): TS.ObjectLiteralExpression | undefined {
    const ts = this.ts;
    const callee = this.unwrap(call.expression);
    if (!ts.isIdentifier(callee)) return undefined;
    const decl = this.valueDeclarationOf(callee, false);
    const fn = decl === undefined ? undefined : this.functionOfDeclaration(decl);
    if (fn === undefined || fn.body === undefined) return undefined;
    const returned: TS.Expression[] = [];
    if (ts.isBlock(fn.body)) {
      const collect = (node: TS.Node): void => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node) && node.expression !== undefined) returned.push(node.expression);
        ts.forEachChild(node, collect);
      };
      ts.forEachChild(fn.body, collect);
    } else {
      returned.push(fn.body);
    }
    const found = returned.map((expr) => this.commandObject(expr, depth + 1, false));
    const first = found[0];
    return first !== undefined && found.every((f) => f === first) ? first : undefined;
  }

  private valueDeclarationOf(id: TS.Identifier, shorthand: boolean): TS.Declaration | undefined {
    const symbol = shorthand && this.ts.isShorthandPropertyAssignment(id.parent) ? this.checker.getShorthandAssignmentValueSymbol(id.parent) : this.checker.getSymbolAtLocation(id);
    return this.dealias(symbol)?.valueDeclaration;
  }

  /** The value of property `name` in `obj` (a plain or shorthand assignment, or a method). */
  private propertyValue(obj: TS.ObjectLiteralExpression, name: string): { expr: TS.Node; shorthand: boolean } | undefined {
    const ts = this.ts;
    for (const prop of obj.properties) {
      if (prop.name === undefined || this.propertyName(prop.name) !== name) continue;
      if (ts.isPropertyAssignment(prop)) return { expr: prop.initializer, shorthand: false };
      if (ts.isShorthandPropertyAssignment(prop)) return { expr: prop.name, shorthand: true };
      if (ts.isMethodDeclaration(prop)) return { expr: prop, shorthand: false };
    }
    return undefined;
  }

  private runFunction(command: TS.ObjectLiteralExpression): FunctionLike | undefined {
    const ts = this.ts;
    const run = this.propertyValue(command, "run");
    if (run === undefined) return undefined;
    if (ts.isMethodDeclaration(run.expr)) return run.expr;
    const node = ts.isExpression(run.expr) ? this.unwrap(run.expr) : run.expr;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
    if (ts.isIdentifier(node)) {
      const decl = this.valueDeclarationOf(node, run.shorthand);
      return decl === undefined ? undefined : this.functionOfDeclaration(decl);
    }
    return undefined;
  }

  /** Walk one function body, recording sites and recursing into statically resolvable callees. */
  visit(fn: FunctionLike, depth: number): void {
    const seenAt = this.visited.get(fn);
    if ((seenAt !== undefined && seenAt <= depth) || fn.body === undefined) return;
    // reason: keyed on the shallowest depth - a body first walked at the depth bound had its callees cut, so a later
    // shallower reach must walk it again (idempotent: sites are keyed) or the cut would hide the shallow path's sites.
    this.visited.set(fn, depth);
    const scan = (node: TS.Node): void => {
      if (this.ts.isCallExpression(node)) this.handleCall(node, depth);
      else if (this.ts.isObjectLiteralExpression(node)) this.handleTypedLiteral(node);
      this.ts.forEachChild(node, scan);
    };
    scan(fn.body);
  }

  private handleCall(call: TS.CallExpression, depth: number): void {
    this.depthCuts.delete(call);
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
      if (this.isNonBusinessSymbol(this.enclosingSymbolName(call), call.getSourceFile())) return;
      const injected: BoundFunctions = this.ts.isPropertyAccessExpression(callee) ? this.implementationsBehindReceiver(callee) : { fns: [], opaque: true };
      this.followOrCut(call, injected.fns, depth);
      if (injected.fns.length !== 1 || injected.opaque) this.addInterfaceSite(dispatch);
      return;
    }
    const targets = this.resolveTargets(callee);
    if (targets.length === 0) {
      this.handleInjectedCall(call, callee, depth);
      return;
    }
    this.followOrCut(call, targets, depth);
  }

  /** Follow `fns` one level deeper, or - at {@link MAX_CALL_DEPTH} - record a `depth-bound` not_measured site naming the function where the walk stopped. */
  private followOrCut(call: TS.CallExpression, fns: readonly FunctionLike[], depth: number): void {
    if (fns.length === 0) return;
    if (depth < MAX_CALL_DEPTH) {
      for (const fn of fns) this.visit(fn, depth + 1);
      return;
    }
    // reason: a callee already walked elsewhere (at any depth) is not lost by this cut - only an unvisited body is.
    if (fns.every((fn) => this.visited.has(fn))) return;
    const file = call.getSourceFile();
    const rel = path.relative(this.rootDir, file.fileName).split(path.sep).join("/");
    const symbol = this.enclosingSymbolName(call);
    const key = `${rel}#${symbol}#depth-bound`;
    this.depthCuts.set(call, { site: { key, file: rel, symbol, dynamic: true, kind: "depth-bound" }, bootstrap: this.isNonBusinessSymbol(symbol, file) });
  }

  // ── dependency injection (#104) ──────────────────────────────────────────────

  /** Declarations that hold an injected value: a function-typed member or a parameter (incl. a constructor parameter property). */
  private isInjectionSource(decl: TS.Declaration): decl is TS.PropertySignature | TS.PropertyDeclaration | TS.ParameterDeclaration {
    const ts = this.ts;
    return ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl) || ts.isParameter(decl);
  }

  /** All of `decls` are injection sources declared in followable source. */
  private allInjectionSources(decls: readonly TS.Declaration[]): boolean {
    return decls.length > 0 && decls.every((d) => this.isInjectionSource(d) && this.isFollowable(d.getSourceFile()));
  }

  /**
   * A call whose callee has no statically-resolvable body because it is an injected function-typed property /
   * parameter: follow the bound implementations, and report a dynamic site unless exactly one resolved cleanly.
   */
  private handleInjectedCall(call: TS.CallExpression, callee: TS.Expression, depth: number): void {
    const ts = this.ts;
    const location = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
    if (!ts.isIdentifier(location)) return;
    const decls = this.dealias(this.checker.getSymbolAtLocation(location))?.declarations ?? [];
    if (!this.allInjectionSources(decls)) return;
    const type = this.checker.getTypeAtLocation(location);
    if (type.getCallSignatures().length === 0 && (type.flags & ts.TypeFlags.Any) === 0) return;
    if (this.isNonBusinessSymbol(this.enclosingSymbolName(call), call.getSourceFile())) return;
    const resolved = this.functionsBoundTo(decls, new Set(), 0);
    this.followOrCut(call, resolved.fns, depth);
    if (resolved.fns.length !== 1 || resolved.opaque) this.addSite(call, undefined, `dynamic:${this.label(callee)}`);
  }

  /** Implementations behind `receiver.method(..)` when `receiver` is an injected member / parameter bound to concrete values. */
  private implementationsBehindReceiver(callee: TS.PropertyAccessExpression): BoundFunctions {
    const through = this.injectionSourcesOf(callee.expression);
    return through === undefined ? { fns: [], opaque: true } : this.methodsOfBoundValues(through, callee.name.text, new Set(), 0);
  }

  /** Functions bound to the injection sources `decls` (a function-typed member / parameter that is itself called). */
  private functionsBoundTo(decls: readonly TS.Declaration[], seen: Set<TS.Node>, depth: number): BoundFunctions {
    const fns = new Set<FunctionLike>();
    let opaque = depth > MAX_CODE_RESOLVE_DEPTH;
    if (opaque) return { fns: [], opaque };
    for (const decl of decls) {
      if (!this.isInjectionSource(decl)) {
        opaque = true;
        continue;
      }
      const bound = this.valuesBoundTo(decl, seen);
      if (bound.opaque) opaque = true;
      for (const value of bound.values) {
        const inner = this.functionsOfValue(value, seen, depth + 1);
        if (inner.opaque) opaque = true;
        for (const fn of inner.fns) fns.add(fn);
      }
    }
    return { fns: [...fns], opaque };
  }

  /** Concrete method bodies `method` resolves to across the static types of the values bound to `decls`. */
  private methodsOfBoundValues(decls: readonly TS.Declaration[], method: string, seen: Set<TS.Node>, depth: number): BoundFunctions {
    const ts = this.ts;
    const fns = new Set<FunctionLike>();
    let opaque = depth > MAX_CODE_RESOLVE_DEPTH;
    if (opaque) return { fns: [], opaque };
    for (const decl of decls) {
      if (!this.isInjectionSource(decl)) {
        opaque = true;
        continue;
      }
      const bound = this.valuesBoundTo(decl, seen);
      if (bound.opaque) opaque = true;
      for (const value of bound.values) {
        const type = value.shorthand ? this.shorthandValueType(value.expr) : this.checker.getTypeAtLocation(value.expr);
        if (type === undefined) {
          opaque = true;
          continue;
        }
        for (const constituent of type.isUnion() ? type.types : [type]) {
          if ((constituent.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) !== 0) continue;
          const members = this.checker.getPropertyOfType(constituent, method)?.declarations ?? [];
          const bodies = members.map((m) => this.functionOfDeclaration(m)).filter((f): f is FunctionLike => f !== undefined && f.body !== undefined);
          if (members.length > 0 && bodies.length === members.length && bodies.every((f) => this.isFollowable(f.getSourceFile()))) {
            for (const fn of bodies) fns.add(fn);
            continue;
          }
          // The bound value is itself typed as the interface: look through to what it was bound from, else not resolvable.
          const through = this.injectionSourcesOf(value.expr);
          if (through === undefined) {
            opaque = true;
            continue;
          }
          const inner = this.methodsOfBoundValues(through, method, seen, depth + 1);
          if (inner.opaque) opaque = true;
          for (const fn of inner.fns) fns.add(fn);
        }
      }
    }
    return { fns: [...fns], opaque };
  }

  private shorthandValueType(name: TS.Node): TS.Type | undefined {
    const parent = name.parent;
    if (!this.ts.isShorthandPropertyAssignment(parent)) return undefined;
    const symbol = this.checker.getShorthandAssignmentValueSymbol(parent);
    return symbol === undefined ? undefined : this.checker.getTypeOfSymbolAtLocation(symbol, name);
  }

  /** Injection-source declarations an identifier / property access refers to, or undefined when it refers to none. */
  private injectionSourcesOf(expr: TS.Node): readonly TS.Declaration[] | undefined {
    const ts = this.ts;
    const node = ts.isExpression(expr) ? this.unwrap(expr) : expr;
    const location = ts.isPropertyAccessExpression(node) ? node.name : node;
    if (!ts.isIdentifier(location)) return undefined;
    const decls = this.dealias(this.checker.getSymbolAtLocation(location))?.declarations ?? [];
    return this.allInjectionSources(decls) ? decls : undefined;
  }

  /** Functions an expression evaluates to: arrow / function expression, function reference, `f.bind(x)`, a ternary of those. */
  private functionsOfValue(value: BoundValue, seen: Set<TS.Node>, depth: number): BoundFunctions {
    const ts = this.ts;
    if (depth > MAX_CODE_RESOLVE_DEPTH) return { fns: [], opaque: true };
    if (value.shorthand) {
      const parent = value.expr.parent;
      const symbol = ts.isShorthandPropertyAssignment(parent) ? this.checker.getShorthandAssignmentValueSymbol(parent) : undefined;
      return this.functionsOfSymbol(this.dealias(symbol), seen, depth);
    }
    if (ts.isMethodDeclaration(value.expr)) return { fns: [value.expr], opaque: false };
    if (!ts.isExpression(value.expr)) return { fns: [], opaque: true };
    const node = this.unwrap(value.expr);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return { fns: [node], opaque: false };
    if (ts.isConditionalExpression(node)) {
      const a = this.functionsOfValue({ expr: node.whenTrue, shorthand: false }, seen, depth + 1);
      const b = this.functionsOfValue({ expr: node.whenFalse, shorthand: false }, seen, depth + 1);
      return { fns: [...new Set([...a.fns, ...b.fns])], opaque: a.opaque || b.opaque };
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "bind") {
      return this.functionsOfValue({ expr: node.expression.expression, shorthand: false }, seen, depth + 1);
    }
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const location = ts.isPropertyAccessExpression(node) ? node.name : node;
      return this.functionsOfSymbol(this.dealias(this.checker.getSymbolAtLocation(location)), seen, depth);
    }
    return { fns: [], opaque: true };
  }

  private functionsOfSymbol(symbol: TS.Symbol | undefined, seen: Set<TS.Node>, depth: number): BoundFunctions {
    const decls = symbol?.declarations ?? [];
    if (decls.length === 0) return { fns: [], opaque: true };
    const fns = new Set<FunctionLike>();
    let opaque = false;
    for (const decl of decls) {
      const fn = this.functionOfDeclaration(decl);
      if (fn !== undefined && fn.body !== undefined && this.isFollowable(fn.getSourceFile())) {
        fns.add(fn);
        continue;
      }
      let inner: BoundFunctions | undefined;
      if (this.ts.isVariableDeclaration(decl) && decl.initializer !== undefined && (decl.parent.flags & this.ts.NodeFlags.Const) !== 0) {
        inner = this.functionsOfValue({ expr: decl.initializer, shorthand: false }, seen, depth + 1);
      } else if (this.isInjectionSource(decl) && this.isFollowable(decl.getSourceFile())) {
        inner = this.functionsBoundTo([decl], seen, depth + 1);
      }
      if (inner === undefined) {
        opaque = true;
        continue;
      }
      if (inner.opaque) opaque = true;
      for (const f of inner.fns) fns.add(f);
    }
    return { fns: [...fns], opaque };
  }

  /**
   * Every value bound to an injection source in the analysed program. A property: the members of object literals whose
   * contextual type declares it (plus its own initializer). A parameter: the argument of every call / `new` that resolves
   * to the parameter's function (or the parameter's default). `opaque` when some binding cannot be enumerated.
   */
  private valuesBoundTo(decl: TS.PropertySignature | TS.PropertyDeclaration | TS.ParameterDeclaration, seen: Set<TS.Node>): { values: BoundValue[]; opaque: boolean } {
    const ts = this.ts;
    if (seen.has(decl)) return { values: [], opaque: false };
    seen.add(decl);
    if (ts.isParameter(decl)) {
      const owner = decl.parent;
      if (!(this.isFunctionLike(owner) || ts.isConstructorDeclaration(owner)) || owner.body === undefined) return { values: [], opaque: true };
      const index = owner.parameters.indexOf(decl);
      const values: BoundValue[] = [];
      let opaque = decl.dotDotDotToken !== undefined;
      for (const site of this.callSitesOf(owner)) {
        const args = site.arguments ?? [];
        const arg = args[index];
        if (args.slice(0, index + 1).some((a) => ts.isSpreadElement(a))) opaque = true;
        else if (arg !== undefined) values.push({ expr: arg, shorthand: false });
        else if (decl.initializer !== undefined) values.push({ expr: decl.initializer, shorthand: false });
      }
      return { values, opaque };
    }
    const propertyName = this.propertyName(decl.name);
    if (propertyName === undefined) return { values: [], opaque: true };
    const values: BoundValue[] = [];
    let opaque = false;
    if (ts.isPropertyDeclaration(decl) && decl.initializer !== undefined) values.push({ expr: decl.initializer, shorthand: false });
    for (const prop of this.objectMembersNamed(propertyName)) {
      if (!ts.isObjectLiteralExpression(prop.parent)) continue;
      if (!this.isBoundTo(prop.parent, propertyName, decl)) {
        // reason: an object literal with no contextual type that carries this member name may still be bound to the
        // property later (cast, return through an untyped helper); it is not enumerable, so the binding set is not closed.
        if (this.checker.getContextualType(prop.parent) === undefined) opaque = true;
        continue;
      }
      if (ts.isPropertyAssignment(prop)) values.push({ expr: prop.initializer, shorthand: false });
      else if (ts.isShorthandPropertyAssignment(prop)) values.push({ expr: prop.name, shorthand: true });
      else values.push({ expr: prop, shorthand: false });
    }
    // reason: `deps.fn = other` after construction binds the property too; the value is enumerable, so it is followed.
    for (const assignment of this.assignmentsTo(propertyName)) {
      const target = this.checker.getSymbolAtLocation(assignment.left.name);
      if ((this.dealias(target)?.declarations ?? []).includes(decl)) values.push({ expr: assignment.right, shorthand: false });
    }
    // reason: a spread into a literal typed with this property carries members the census cannot enumerate.
    if (this.spreadLiteralsDeclaring(propertyName, decl).length > 0) opaque = true;
    return { values, opaque };
  }

  private assignmentIndex: Map<string, Array<TS.BinaryExpression & { left: TS.PropertyAccessExpression }>> | undefined;

  /** `<expr>.name = value` assignments across every followable file (syntactic index, built once). */
  private assignmentsTo(name: string): Array<TS.BinaryExpression & { left: TS.PropertyAccessExpression }> {
    if (this.assignmentIndex === undefined) {
      const ts = this.ts;
      const index = new Map<string, Array<TS.BinaryExpression & { left: TS.PropertyAccessExpression }>>();
      for (const file of this.program.getSourceFiles()) {
        if (!this.isFollowable(file)) continue;
        const scan = (node: TS.Node): void => {
          if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left)) {
            const key = node.left.name.text;
            index.set(key, [...(index.get(key) ?? []), node as TS.BinaryExpression & { left: TS.PropertyAccessExpression }]);
          }
          ts.forEachChild(node, scan);
        };
        scan(file);
      }
      this.assignmentIndex = index;
    }
    return this.assignmentIndex.get(name) ?? [];
  }

  private spreadLiterals: TS.ObjectLiteralExpression[] | undefined;

  /** Object literals containing a spread whose contextual type declares `decl` as member `name`. */
  private spreadLiteralsDeclaring(name: string, decl: TS.Declaration): TS.ObjectLiteralExpression[] {
    if (this.spreadLiterals === undefined) {
      const ts = this.ts;
      const found: TS.ObjectLiteralExpression[] = [];
      for (const file of this.program.getSourceFiles()) {
        if (!this.isFollowable(file)) continue;
        const scan = (node: TS.Node): void => {
          if (ts.isObjectLiteralExpression(node) && node.properties.some((p) => ts.isSpreadAssignment(p))) found.push(node);
          ts.forEachChild(node, scan);
        };
        scan(file);
      }
      this.spreadLiterals = found;
    }
    return this.spreadLiterals.filter((literal) => this.isBoundTo(literal, name, decl));
  }

  /** True when the object literal's contextual type declares `name` as the very member `decl`. */
  private isBoundTo(literal: TS.ObjectLiteralExpression, name: string, decl: TS.Declaration): boolean {
    const contextual = this.checker.getContextualType(literal);
    if (contextual === undefined) return false;
    const constituents = contextual.isUnion() ? contextual.types : [contextual];
    return constituents.some((t) => (this.checker.getPropertyOfType(t, name)?.declarations ?? []).includes(decl));
  }

  private memberIndex: Map<string, Array<TS.PropertyAssignment | TS.ShorthandPropertyAssignment | TS.MethodDeclaration>> | undefined;

  /** Object-literal members named `name` across every followable file (syntactic index, built once). */
  private objectMembersNamed(name: string): Array<TS.PropertyAssignment | TS.ShorthandPropertyAssignment | TS.MethodDeclaration> {
    if (this.memberIndex === undefined) {
      const ts = this.ts;
      const index = new Map<string, Array<TS.PropertyAssignment | TS.ShorthandPropertyAssignment | TS.MethodDeclaration>>();
      for (const file of this.program.getSourceFiles()) {
        if (!this.isFollowable(file)) continue;
        const scan = (node: TS.Node): void => {
          if (ts.isObjectLiteralExpression(node)) {
            for (const prop of node.properties) {
              if (!(ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop) || ts.isMethodDeclaration(prop))) continue;
              const key = this.propertyName(prop.name);
              if (key !== undefined) index.set(key, [...(index.get(key) ?? []), prop]);
            }
          }
          ts.forEachChild(node, scan);
        };
        scan(file);
      }
      this.memberIndex = index;
    }
    return this.memberIndex.get(name) ?? [];
  }

  private callIndex: Map<TS.Node, Array<TS.CallExpression | TS.NewExpression>> | undefined;

  /** Every call / `new` in a followable file whose resolved signature is declared by `owner` (built once). */
  private callSitesOf(owner: TS.Node): Array<TS.CallExpression | TS.NewExpression> {
    if (this.callIndex === undefined) {
      const ts = this.ts;
      const index = new Map<TS.Node, Array<TS.CallExpression | TS.NewExpression>>();
      for (const file of this.program.getSourceFiles()) {
        if (!this.isFollowable(file)) continue;
        const scan = (node: TS.Node): void => {
          if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            const declaration = this.checker.getResolvedSignature(node)?.declaration;
            if (declaration !== undefined) index.set(declaration, [...(index.get(declaration) ?? []), node]);
          }
          ts.forEachChild(node, scan);
        };
        scan(file);
      }
      this.callIndex = index;
    }
    return this.callIndex.get(owner) ?? [];
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
    const object = this.unwrap(arg as TS.Expression) as TS.ObjectLiteralExpression;
    this.consumedArguments.add(object);
    const field = this.fieldKeyOf(object);
    for (const code of codes) this.addCodedSite(call, code, field);
  }

  /**
   * An object literal whose contextual type is the product error type is a failure site even
   * when no err() wraps it (pure core refusals, CLI usage refusals). Literals that are the
   * argument of err()/gateFailure() are recorded by the call path and skipped here.
   */
  private handleTypedLiteral(object: TS.ObjectLiteralExpression): void {
    if (this.consumedArguments.has(object) || this.errorTypes.length === 0) return;
    if (!this.isTypedAsProductError(object)) return;
    const codes = this.codesOfErrArgument(object);
    if (codes !== undefined && codes.length > 0) {
      const field = this.fieldKeyOf(object);
      for (const code of codes) this.addCodedSite(object, code, field);
      return;
    }
    const hasCodeKey = object.properties.some((p) => (this.ts.isPropertyAssignment(p) || this.ts.isShorthandPropertyAssignment(p)) && this.propertyName(p.name) === "code");
    const hasSpread = object.properties.some((p) => this.ts.isSpreadAssignment(p));
    // reason: a literal typed as the error but with neither a `code` key nor a spread cannot occur (it would not type-check); with
    // a spread or an unreadable code the refusal exists but cannot be named, so it is reported as dynamic, never dropped.
    if (hasCodeKey || hasSpread) this.addSite(object, undefined, `dynamic:error-literal(${this.label(object)})`);
  }

  private isTypedAsProductError(object: TS.ObjectLiteralExpression): boolean {
    const contextual = this.checker.getContextualType(object);
    if (contextual === undefined) return false;
    const constituents = contextual.isUnion() ? contextual.types : [contextual];
    const nullish = this.ts.TypeFlags.Undefined | this.ts.TypeFlags.Null;
    const unusable = this.ts.TypeFlags.Any | this.ts.TypeFlags.Unknown | this.ts.TypeFlags.Never;
    return constituents.some(
      (t) => (t.flags & (nullish | unusable)) === 0 && this.errorTypes.some((errorType) => this.checker.isTypeAssignableTo(t, errorType)),
    );
  }

  /** The `field` of a refusal literal: absent, a single string literal, or non-literal (ordinal-keyed). */
  private fieldKeyOf(object: TS.Expression): FieldKey {
    if (!this.ts.isObjectLiteralExpression(object)) return { kind: "none" };
    for (const prop of object.properties) {
      if (this.ts.isPropertyAssignment(prop) && this.propertyName(prop.name) === "field") return this.fieldKeyFrom(this.literalsOf(prop.initializer, 0));
      if (this.ts.isShorthandPropertyAssignment(prop) && prop.name.text === "field") {
        return this.fieldKeyFrom(this.literalsOfSymbol(this.checker.getShorthandAssignmentValueSymbol(prop), 0));
      }
    }
    return { kind: "none" };
  }

  private fieldKeyFrom(literals: string[] | undefined): FieldKey {
    return literals !== undefined && literals.length === 1 ? { kind: "literal", value: (literals[0] as string).replace(/#/g, "~") } : { kind: "ordinal" };
  }

  private addCodedSite(node: TS.Node, code: string, field: FieldKey): void {
    const file = node.getSourceFile();
    const rel = path.relative(this.rootDir, file.fileName).split(path.sep).join("/");
    const symbol = this.enclosingSymbolName(node);
    this.pending.set(`${rel}:${node.getStart()}:${code}`, {
      rel,
      symbol,
      code,
      field,
      pos: node.getStart(),
      bootstrap: this.isNonBusinessSymbol(symbol, file),
    });
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
      if (fn === undefined || fn.body === undefined) continue;
      const source = fn.getSourceFile();
      if (this.isFollowable(source)) targets.push(fn);
      else if (this.isOutsideRootSource(source)) {
        // reason: dropping a callee body that lies outside rootDir is the #60 silent omission; fail loud instead.
        throw new SiteCensusError("callee-outside-root", { file: source.fileName, rootDir: this.rootDir });
      }
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
    // reason: in a shared program a file outside this entry's closure is invisible to it (see the module header).
    if (this.scope !== undefined && !this.scope.has(file.fileName)) return false;
    const rel = path.relative(this.rootDir, file.fileName);
    return !rel.startsWith("..") && !path.isAbsolute(rel) && !rel.split(path.sep).includes("node_modules");
  }

  /** A real (non-.d.ts, non-node_modules) source file that lies outside rootDir. */
  private isOutsideRootSource(file: TS.SourceFile): boolean {
    if (file.isDeclarationFile) return false;
    const rel = path.relative(this.rootDir, file.fileName);
    return (rel.startsWith("..") || path.isAbsolute(rel)) && !file.fileName.split(path.sep).includes("node_modules");
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
    // reason: property names only name a symbol once a function sits below them (`subCommands.add.run`); a refusal literal
    // `{ ok: false, error: { code } }` inside `validateX` must be `validateX`, not `validateX.error`.
    let insideFunction = false;
    for (let cur: TS.Node | undefined = node; cur !== undefined; cur = cur.parent) {
      // reason: a node with no named root (e.g. an anonymous type literal at module level) climbs to the SourceFile, whose parent is undefined.
      if (ts.isSourceFile(cur)) break;
      if (this.isFunctionLike(cur)) insideFunction = true;
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
      if (insideFunction && (ts.isMethodDeclaration(cur) || ts.isPropertyAssignment(cur)) && cur.name !== undefined) {
        const segment = this.propertyName(cur.name);
        if (segment !== undefined) segments.push(segment);
      }
    }
    return segments.reverse().join(".");
  }
}

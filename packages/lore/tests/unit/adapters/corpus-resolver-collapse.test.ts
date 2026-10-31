// @spawns-external git builds a throwaway git repository the test runs against
/**
 * @spec_ref spec-corpus-resolution-carries-provenance-and-a-foreign-write AC-CP-2
 *   (plus the two additions from the dispatching task's §5.1/§5.2: the
 *   findLoreDbPathQuiet relocation-vacuity fix, and the `undetermined`
 *   miss-mechanism at both wrappers)
 *
 * Three halves, each pinned to a MECHANISM rather than a name-grep, per the
 * AC's own text:
 *
 *   (a) BEHAVIOUR, driven not read — both `findLoreDbPath`/`findLoreDbPathQuiet`
 *       delegate to the ONE shared resolver and keep their exact terminal
 *       contracts (loud exit(1) vs quiet `undefined`); the loud stderr is
 *       pinned by EXACT EQUALITY against the PRE-CHANGE `utils.ts` literal.
 *   (b) CALLER PRESERVATION via the TypeScript compiler API over a real
 *       `ts.Program` — declared return types, and at each of the six call
 *       sites the checker-resolved type of the call expression plus a
 *       transitive-alias property-access/destructuring scan (a synthetic
 *       fixture proves the scan is a mechanism, not a `.path`-grep).
 *   (c) RELOCATION AND HEADER on that SAME Program — `utils.ts` declares
 *       ZERO FunctionDeclarations named the three relocated functions and
 *       contains ZERO occurrences of the three verbatim pre-change header
 *       needles (assembled by runtime concatenation so this file cannot
 *       match itself); CONTROL: the relocated module DOES declare all three.
 *
 * §5.1 addition: `findLoreDbPathQuiet` never lived in `utils.ts` — it lived
 * in `gate-bypass-audit.ts` — so half (c)'s "utils.ts declares zero
 * FunctionDeclarations named findLoreDbPathQuiet" clause is VACUOUSLY true
 * with zero code changes. The CONTROL clause (corpus-resolution.ts DOES
 * declare it) is what actually carries weight here, and is the assertion
 * this file's dispatching task required a genuine relocation to satisfy.
 *
 * §5.2 addition: `resolveCorpusProvenance`'s `"undetermined"` branch returns
 * `{path: cwd, provenance: "undetermined"}` — `path` there is a DIRECTORY,
 * never a real corpus file. Both wrappers must treat it as a miss and must
 * never surface that `path` value.
 *
 * Runner: vitest (this file touches no `bun:sqlite` directly — the compiler
 * API's `ts.Program` walks source text, and the behavioural fixtures below
 * exercise `corpus-resolution.ts`'s exported functions in-process, spawning
 * only the real `git` binary via the module's own `spawnSync` calls).
 *
 * Fixture discipline: every corpus is a fresh `mkdtemp` directory — this
 * repo's own `.lore/` corpus is never touched (root CLAUDE.md).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { CliExit } from "../../../src/adapters/cli/cli-exit.js";
import {
  findLoreDbPath,
  findLoreDbPathQuiet,
  resolveCorpus,
} from "../../../src/adapters/cli/corpus-resolution.js";
import { liveIo } from "../../live-invocation.js";

// ─── Paths ───────────────────────────────────────────────────────────────

// tests/unit/adapters -> tests/unit -> tests -> packages/lore -> packages -> repo root
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(HERE, "..", "..", "..", "..", "..");
const ROOT_TSCONFIG_PATH = join(REPO_ROOT, "tsconfig.json");

const CLI_ADAPTER_DIR = join(REPO_ROOT, "packages", "lore", "src", "adapters", "cli");
const UTILS_PATH = join(CLI_ADAPTER_DIR, "utils.ts");
const CORPUS_RESOLUTION_PATH = join(CLI_ADAPTER_DIR, "corpus-resolution.ts");
const LOADER_PATH = join(CLI_ADAPTER_DIR, "loader.ts");
const CONTEXT_PATH = join(CLI_ADAPTER_DIR, "commands", "context.ts");
const REPORT_ISSUE_WIRING_PATH = join(CLI_ADAPTER_DIR, "report-issue-wiring.ts");
const CHECK_AC_REF_INTEGRITY_PATH = join(REPO_ROOT, "scripts", "check-ac-ref-integrity.ts");
const EXPORT_SPEC_MIRROR_PATH = join(REPO_ROOT, "scripts", "export-spec-mirror.ts");

/** The six pinned call sites (AC-CP-2(b)) — findLoreDbPath ONLY, never findLoreDbPathQuiet. */
const CALL_SITE_FILES = [
  LOADER_PATH,
  CONTEXT_PATH,
  REPORT_ISSUE_WIRING_PATH,
  CHECK_AC_REF_INTEGRITY_PATH,
  EXPORT_SPEC_MIRROR_PATH,
];

// ─── Pre-change stderr baseline (captured from `git show HEAD:packages/lore/src/adapters/cli/utils.ts`
// BEFORE this task's edits — utils.ts:144-147 pre-change) — pinned as a
// literal so no implementer may pin a different amount of this message. ───
const PRE_CHANGE_NO_DB_STDERR_MESSAGE =
  "Error: No Lore database found in this directory or any parent.\n" +
  "  Run `lore init` to initialise a new Lore project here.\n";

// ─── Three verbatim header needles (D6), assembled by runtime concatenation
// so this test file's own source can never match itself. ───────────────────
const NEEDLE_NO_BUSINESS_LOGIC = ["No business logic here", "; only terminal I/O concerns"].join("");
const NEEDLE_DB_DISCOVERY_IN_LOADER = ["Note: DB discovery and App construction live in ", "`loader.ts`"].join("");
const NEEDLE_SIDE_EFFECT_PURE = ["Side-effect class: pure (no IO, ", "no process.exit)"].join("");
const HEADER_NEEDLES = [NEEDLE_NO_BUSINESS_LOGIC, NEEDLE_DB_DISCOVERY_IN_LOADER, NEEDLE_SIDE_EFFECT_PURE];

/** The three FunctionDeclaration names D6/§5.1 require relocated OUT of utils.ts. */
const RELOCATED_FUNCTION_NAMES = ["findLoreDbPath", "findLoreDbPathQuiet", "findMainCheckoutLoreDb"];

// ─── TypeScript compiler API plumbing (half b/c) ───────────────────────────

/** Real compiler options, read from THIS repo's own root tsconfig.json (covers packages/lore/src AND scripts/). */
function loadCompilerOptions(): ts.CompilerOptions {
  const configFile = ts.readConfigFile(ROOT_TSCONFIG_PATH, ts.sys.readFile);
  if (configFile.error !== undefined) {
    throw new Error(
      `AC-CP-2: failed to read ${ROOT_TSCONFIG_PATH}: ` +
        ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"),
    );
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(ROOT_TSCONFIG_PATH));
  return parsed.options;
}

/** A real Program over utils.ts + corpus-resolution.ts + the six real call sites. */
function createRealProgram(): ts.Program {
  const options = loadCompilerOptions();
  return ts.createProgram({
    rootNames: [UTILS_PATH, CORPUS_RESOLUTION_PATH, ...CALL_SITE_FILES],
    options,
  });
}

/**
 * A Program identical to {@link createRealProgram}'s options, but ALSO
 * containing one virtual, never-written-to-disk source file — the AC-LL-10
 * idiom (`tests/e2e/libsql-lazy-load.test.ts`) already established in this
 * repo for exactly this "prove the check discriminates" need. The virtual
 * file's relative import of `./corpus-resolution.js` resolves to the REAL
 * module, so the checker-resolved return type feeding the violation is
 * genuine, not hand-typed.
 */
function createProgramWithVirtualFile(virtualPath: string, virtualContent: string): ts.Program {
  const options = loadCompilerOptions();
  const host = ts.createCompilerHost(options, true);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);

  host.fileExists = (fileName) => fileName === virtualPath || originalFileExists(fileName);
  host.readFile = (fileName) => (fileName === virtualPath ? virtualContent : originalReadFile(fileName));
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    if (fileName === virtualPath) {
      const languageVersion =
        typeof languageVersionOrOptions === "object"
          ? languageVersionOrOptions.languageVersion
          : languageVersionOrOptions;
      return ts.createSourceFile(fileName, virtualContent, languageVersion, true, ts.ScriptKind.TS);
    }
    return originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
  };

  return ts.createProgram({ rootNames: [virtualPath, CORPUS_RESOLUTION_PATH], options, host });
}

function getFunctionDeclaration(program: ts.Program, filePath: string, name: string): ts.FunctionDeclaration {
  const sourceFile = program.getSourceFile(filePath);
  if (sourceFile === undefined) {
    throw new Error(`AC-CP-2: Program is missing source file ${filePath}`);
  }
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      return statement;
    }
  }
  throw new Error(`AC-CP-2: no FunctionDeclaration named ${name} found in ${filePath}`);
}

function declaredReturnTypeString(program: ts.Program, decl: ts.FunctionDeclaration): string {
  const checker = program.getTypeChecker();
  const signature = checker.getSignatureFromDeclaration(decl);
  if (signature === undefined) {
    throw new Error(`AC-CP-2: could not resolve a signature for ${decl.name?.text ?? "<anonymous>"}`);
  }
  return checker.typeToString(checker.getReturnTypeOfSignature(signature));
}

/** Recursive AST walk collecting every FunctionDeclaration name anywhere in `sourceFile` (any nesting depth). */
function collectFunctionDeclarationNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** Follows an alias chain (import binding -> re-export -> ... -> origin declaration) to its root symbol. */
function resolveToRootSymbol(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  let current = symbol;
  for (let hop = 0; hop < 8 && (current.flags & ts.SymbolFlags.Alias) !== 0; hop++) {
    const next = checker.getAliasedSymbol(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

/** `true` iff `identifier`'s checker-resolved root symbol is the named FunctionDeclaration in `declFile`. */
function resolvesToDeclaration(
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
  declFile: string,
  name: string,
): boolean {
  const symbol = checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) return false;
  const root = resolveToRootSymbol(checker, symbol);
  const decl = root.declarations?.[0];
  return (
    decl !== undefined &&
    ts.isFunctionDeclaration(decl) &&
    decl.name?.text === name &&
    decl.getSourceFile().fileName === declFile
  );
}

/** Every `findLoreDbPath(...)` CallExpression in `sourceFile` whose callee checker-resolves to corpus-resolution.ts's export. */
function collectFindLoreDbPathCallSites(
  program: ts.Program,
  sourceFile: ts.SourceFile,
  declFile: string,
): ts.CallExpression[] {
  const checker = program.getTypeChecker();
  const sites: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "findLoreDbPath" &&
      resolvesToDeclaration(checker, node.expression, declFile, "findLoreDbPath")
    ) {
      sites.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

/** Strips parens/as/satisfies/non-null wrappers — mirrors AC-LL-10's `unwrapExpression`. */
function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

/**
 * Climbs UP from `node` through any chain of Parenthesized/As/Satisfies/
 * NonNull wrapper parents whose own `.expression` is exactly the node below
 * it — the inverse of {@link unwrapExpression}, needed because a wrapped
 * inline chain like `(findLoreDbPath() as X).path` puts an AsExpression
 * between the call and the PropertyAccessExpression that actually reads it.
 */
function climbThroughWrappers(node: ts.Node): ts.Node {
  let current = node;
  for (;;) {
    const parent = current.parent as ts.Node | undefined;
    if (parent === undefined) return current;
    const isWrapper =
      (ts.isParenthesizedExpression(parent) && parent.expression === current) ||
      (ts.isAsExpression(parent) && parent.expression === current) ||
      (ts.isSatisfiesExpression(parent) && parent.expression === current) ||
      (ts.isNonNullExpression(parent) && parent.expression === current);
    if (!isWrapper) return current;
    current = parent;
  }
}

interface CallSiteCheck {
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * AC-CP-2(b)'s mechanism check for ONE call expression: checker-resolved
 * type must be exactly `string`, the call's direct parent must not be a
 * PropertyAccessExpression, a destructuring binding is a violation, and no
 * identifier that TRANSITIVELY holds the call's result (through any number
 * of `const y = x;` / `y = x;` alias hops in the same file) may ever be the
 * subject of a PropertyAccessExpression or a destructuring binding. Every
 * step is symbol-identity based (checker.getSymbolAtLocation), never a text
 * match — an intermediate binding on a separate line cannot defeat it.
 */
function checkCallSitePreservation(
  program: ts.Program,
  sourceFile: ts.SourceFile,
  callExpr: ts.CallExpression,
): CallSiteCheck {
  const checker = program.getTypeChecker();
  const typeStr = checker.typeToString(checker.getTypeAtLocation(callExpr));
  if (typeStr !== "string") {
    return { ok: false, detail: `call-expression type is "${typeStr}", expected exactly "string"` };
  }

  // Climb through any type-cast/parenthesis wrappers directly around the call
  // (`(findLoreDbPath() as X).path` puts an AsExpression between the call and
  // the read) before looking at what actually consumes the result.
  const outer = climbThroughWrappers(callExpr);
  const outerParent = outer.parent as ts.Node | undefined;

  if (
    outerParent !== undefined &&
    ts.isPropertyAccessExpression(outerParent) &&
    outerParent.expression === outer
  ) {
    return {
      ok: false,
      detail: `direct property access .${outerParent.name.text} on the call result${outer === callExpr ? "" : " (through a type-cast wrapper)"}`,
    };
  }

  const boundSymbols = new Set<ts.Symbol>();
  if (
    outerParent !== undefined &&
    ts.isVariableDeclaration(outerParent) &&
    outerParent.initializer !== undefined &&
    unwrapExpression(outerParent.initializer) === outer
  ) {
    if (!ts.isIdentifier(outerParent.name)) {
      return { ok: false, detail: "destructuring BindingPattern used directly as the call's binding" };
    }
    const sym = checker.getSymbolAtLocation(outerParent.name);
    if (sym !== undefined) boundSymbols.add(sym);
  }

  // Transitive alias hops within the same file (`const y = x;` / `y = x;`).
  for (let round = 0; round < 8; round++) {
    const before = boundSymbols.size;
    const visitAlias = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
        const source = unwrapExpression(node.initializer);
        if (ts.isIdentifier(source)) {
          const sourceSym = checker.getSymbolAtLocation(source);
          if (sourceSym !== undefined && boundSymbols.has(sourceSym) && ts.isIdentifier(node.name)) {
            const targetSym = checker.getSymbolAtLocation(node.name);
            if (targetSym !== undefined) boundSymbols.add(targetSym);
          }
        }
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        const source = unwrapExpression(node.right);
        if (ts.isIdentifier(source)) {
          const sourceSym = checker.getSymbolAtLocation(source);
          if (sourceSym !== undefined && boundSymbols.has(sourceSym)) {
            const targetSym = checker.getSymbolAtLocation(node.left);
            if (targetSym !== undefined) boundSymbols.add(targetSym);
          }
        }
      }
      ts.forEachChild(node, visitAlias);
    };
    visitAlias(sourceFile);
    if (boundSymbols.size === before) break;
  }

  let violation: string | undefined;
  const visitUsage = (node: ts.Node): void => {
    if (violation !== undefined) return;
    if (ts.isPropertyAccessExpression(node)) {
      const unwrapped = unwrapExpression(node.expression);
      if (ts.isIdentifier(unwrapped)) {
        const sym = checker.getSymbolAtLocation(unwrapped);
        if (sym !== undefined && boundSymbols.has(sym)) {
          violation = `property access .${node.name.text} on an aliased binding of the call result`;
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const source = unwrapExpression(node.initializer);
      if (ts.isIdentifier(source)) {
        const sourceSym = checker.getSymbolAtLocation(source);
        if (sourceSym !== undefined && boundSymbols.has(sourceSym) && !ts.isIdentifier(node.name)) {
          violation = "destructuring BindingPattern used on an aliased binding of the call result";
        }
      }
    }
    ts.forEachChild(node, visitUsage);
  };
  visitUsage(sourceFile);

  if (violation !== undefined) {
    return { ok: false, detail: violation };
  }
  return { ok: true, detail: "clean: string type, no property access, no destructuring, no aliased leak" };
}

// ─── Behavioural fixture helpers (half a) ──────────────────────────────────

/** The code of the `CliExit` that `fn` throws: a command helper ends a run with `exitCli(code)`, nothing calls `process.exit`. */
function exitCodeOf(fn: () => unknown): number {
  try {
    fn();
  } catch (error) {
    if (error instanceof CliExit) return error.code;
    throw error;
  }
  throw new Error("expected the call to end the run with exitCli, but it returned");
}

const scratchDirs: string[] = [];

/** Fresh mkdtemp dir, realpath-resolved (macOS TMPDIR is itself a symlink — see worktree-corpus-resolution.bun.test.ts's identical rationale). */
function mkScratchDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  scratchDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function initGitRepo(dir: string): void {
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "corpus-resolver-collapse-test@example.invalid"]);
  git(dir, ["config", "user.name", "corpus-resolver-collapse test"]);
  writeFileSync(join(dir, "README.md"), "AC-CP-2 fixture\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
}

function makeCorpus(dir: string): string {
  const loreDir = join(dir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const dbPath = join(loreDir, "lore.db");
  writeFileSync(dbPath, "");
  return dbPath;
}

// ─── (a) BEHAVIOUR, driven not read ─────────────────────────────────────────

describe("AC-CP-2(a) BEHAVIOUR — both wrappers delegate to ONE shared resolver", () => {
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    while (scratchDirs.length > 0) {
      const dir = scratchDirs.pop();
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("HAPPY: findLoreDbPathQuiet and findLoreDbPath agree on the SAME real path when a corpus exists", () => {
    const repo = mkScratchDir("ac-cp-2-own-");
    initGitRepo(repo);
    const dbPath = makeCorpus(repo);
    process.chdir(repo);

    expect(findLoreDbPathQuiet(liveIo(), { cwd: process.cwd(), env: process.env })).toBe(dbPath);
    expect(findLoreDbPath(liveIo(), { cwd: process.cwd(), env: process.env })).toBe(dbPath);
  });

  it("NEGATIVE: the loud wrapper exits EXACTLY 1 with the pre-change stderr message, byte-identical, when no corpus exists anywhere", () => {
    const repo = mkScratchDir("ac-cp-2-miss-loud-");
    initGitRepo(repo); // a real git repo, never `lore init`-ed
    process.chdir(repo);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(exitCodeOf(() => findLoreDbPath(liveIo(), { cwd: process.cwd(), env: process.env }))).toBe(1);
    expect(stderrSpy.mock.calls.map((c) => String(c[0])).join("")).toBe(PRE_CHANGE_NO_DB_STDERR_MESSAGE);
  });

  it("NEGATIVE: the quiet wrapper returns undefined (never throws) for the SAME miss fixture", () => {
    const repo = mkScratchDir("ac-cp-2-miss-quiet-");
    initGitRepo(repo);
    process.chdir(repo);

    expect(findLoreDbPathQuiet(liveIo(), { cwd: process.cwd(), env: process.env })).toBeUndefined();
  });

  it("MECHANISM: findLoreDbPath's and findLoreDbPathQuiet's function bodies call a SHARED symbol (checker identity, not text)", () => {
    const program = createRealProgram();
    const checker = program.getTypeChecker();
    const loudDecl = getFunctionDeclaration(program, CORPUS_RESOLUTION_PATH, "findLoreDbPath");
    const quietDecl = getFunctionDeclaration(program, CORPUS_RESOLUTION_PATH, "findLoreDbPathQuiet");

    const collectCallees = (decl: ts.FunctionDeclaration): Set<ts.Symbol> => {
      const callees = new Set<ts.Symbol>();
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const sym = checker.getSymbolAtLocation(node.expression);
          if (sym !== undefined) callees.add(resolveToRootSymbol(checker, sym));
        }
        ts.forEachChild(node, visit);
      };
      if (decl.body !== undefined) visit(decl.body);
      return callees;
    };

    const loudCallees = collectCallees(loudDecl);
    const quietCallees = collectCallees(quietDecl);
    const shared = [...loudCallees].filter((s) => quietCallees.has(s));
    expect(
      shared.length,
      "expected findLoreDbPath and findLoreDbPathQuiet to share at least one callee symbol " +
        "(the shared resolver helper) -- zero overlap means they independently reimplement the walk",
    ).toBeGreaterThan(0);
  });
});

// ─── §5.2 — undetermined provenance is a miss at BOTH wrappers ─────────────

describe("§5.2 — provenance: undetermined never surfaces its own cwd path", () => {
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    while (scratchDirs.length > 0) {
      const dir = scratchDirs.pop();
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a plain (non-git) directory resolves to provenance:undetermined via resolveCorpus() directly", () => {
    const dir = mkScratchDir("ac-cp-2-undetermined-resolve-");
    // Deliberately NOT a git repo at all -- gatherCorpusGitFacts's rev-parse probes
    // both fail, and there is no `.lore/lore.db` anywhere in dir's ancestor chain.
    const resolved = resolveCorpus(liveIo(), dir, process.env);
    expect(resolved).toEqual({ path: dir, provenance: "undetermined" });
  });

  it("findLoreDbPathQuiet returns undefined for that SAME fixture, never the directory path", () => {
    const dir = mkScratchDir("ac-cp-2-undetermined-quiet-");
    process.chdir(dir);
    const result = findLoreDbPathQuiet(liveIo(), { cwd: process.cwd(), env: process.env });
    expect(result).toBeUndefined();
    expect(result).not.toBe(dir);
  });

  it("findLoreDbPath exits 1 with the pre-change message for that SAME fixture, never returning the directory path", () => {
    const dir = mkScratchDir("ac-cp-2-undetermined-loud-");
    process.chdir(dir);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(exitCodeOf(() => findLoreDbPath(liveIo(), { cwd: process.cwd(), env: process.env }))).toBe(1);
    expect(stderrSpy.mock.calls.map((c) => String(c[0])).join("")).toBe(PRE_CHANGE_NO_DB_STDERR_MESSAGE);
  });
});

// ─── (b) CALLER PRESERVATION ─────────────────────────────────────────────

describe("AC-CP-2(b) CALLER PRESERVATION — declared return types", () => {
  it("findLoreDbPath's declared return type is EXACTLY string", () => {
    const program = createRealProgram();
    const decl = getFunctionDeclaration(program, CORPUS_RESOLUTION_PATH, "findLoreDbPath");
    expect(declaredReturnTypeString(program, decl)).toBe("string");
  });

  it("findLoreDbPathQuiet's declared return type is EXACTLY string | undefined", () => {
    const program = createRealProgram();
    const decl = getFunctionDeclaration(program, CORPUS_RESOLUTION_PATH, "findLoreDbPathQuiet");
    expect(declaredReturnTypeString(program, decl)).toBe("string | undefined");
  });
});

describe("AC-CP-2(b) CALLER PRESERVATION — the six real call sites", () => {
  const cases: Array<{ label: string; file: string }> = [
    { label: "loader.ts (two call sites in this one file)", file: LOADER_PATH },
    { label: "commands/context.ts", file: CONTEXT_PATH },
    { label: "report-issue-wiring.ts", file: REPORT_ISSUE_WIRING_PATH },
    { label: "scripts/check-ac-ref-integrity.ts", file: CHECK_AC_REF_INTEGRITY_PATH },
    { label: "scripts/export-spec-mirror.ts", file: EXPORT_SPEC_MIRROR_PATH },
  ];

  it.each(cases)("$label: every findLoreDbPath() call resolves to string with no property access / destructuring", ({ file }) => {
    const program = createRealProgram();
    const sourceFile = program.getSourceFile(file);
    expect(sourceFile, `Program is missing ${file}`).toBeDefined();
    const sites = collectFindLoreDbPathCallSites(program, sourceFile!, CORPUS_RESOLUTION_PATH);
    expect(sites.length, `expected at least one findLoreDbPath() call site in ${file}`).toBeGreaterThan(0);

    for (const site of sites) {
      const result = checkCallSitePreservation(program, sourceFile!, site);
      expect(result.ok, `${file}: ${result.detail}`).toBe(true);
    }
  });

  it("loader.ts has exactly its two known call sites (both preserved)", () => {
    const program = createRealProgram();
    const sourceFile = program.getSourceFile(LOADER_PATH);
    expect(sourceFile).toBeDefined();
    const sites = collectFindLoreDbPathCallSites(program, sourceFile!, CORPUS_RESOLUTION_PATH);
    expect(sites.length).toBe(2);
  });
});

describe("AC-CP-2(b) MECHANISM CONTROL — the scan is checker/AST-driven, not a `.path`-text grep", () => {
  const VIRTUAL_PATH = join(CLI_ADAPTER_DIR, "__ac_cp_2_virtual_fixture__.ts");

  it("a direct .path chain on the call result is flagged", () => {
    const content = [
      'import { findLoreDbPath } from "./corpus-resolution.js";',
      "",
      "export function offendingDirectChain(): string {",
      "  return findLoreDbPath().toUpperCase().padStart(1).concat((findLoreDbPath() as unknown as { path: string }).path);",
      "}",
      "",
    ].join("\n");
    const program = createProgramWithVirtualFile(VIRTUAL_PATH, content);
    const sourceFile = program.getSourceFile(VIRTUAL_PATH);
    expect(sourceFile).toBeDefined();
    const sites = collectFindLoreDbPathCallSites(program, sourceFile!, CORPUS_RESOLUTION_PATH);
    expect(sites.length).toBe(2);
    const results = sites.map((s) => checkCallSitePreservation(program, sourceFile!, s));
    expect(results.some((r) => !r.ok)).toBe(true);
  });

  it("a `.path` access through an intermediate binding on a SEPARATE line (the exact evasion a text-grep misses) is flagged", () => {
    const content = [
      'import { findLoreDbPath } from "./corpus-resolution.js";',
      "",
      "export function offendingAliasedAccess(): string {",
      "  const dbPath = findLoreDbPath();",
      "  const alias = dbPath;",
      "  // Two lines removed from the call itself -- a `.path` grep on the call",
      "  // expression's own line would never see this.",
      "  return (alias as unknown as { path: string }).path;",
      "}",
      "",
    ].join("\n");
    const program = createProgramWithVirtualFile(VIRTUAL_PATH, content);
    const sourceFile = program.getSourceFile(VIRTUAL_PATH);
    expect(sourceFile).toBeDefined();
    const sites = collectFindLoreDbPathCallSites(program, sourceFile!, CORPUS_RESOLUTION_PATH);
    expect(sites.length).toBe(1);
    const result = checkCallSitePreservation(program, sourceFile!, sites[0]!);
    expect(result.ok, "expected the aliased .path access to be flagged").toBe(false);
    expect(result.detail).toContain("property access");
  });

  it("a destructuring BindingPattern used on an aliased binding is flagged", () => {
    const content = [
      'import { findLoreDbPath } from "./corpus-resolution.js";',
      "",
      "export function offendingDestructure(): number {",
      "  const dbPath = findLoreDbPath();",
      "  const alias = dbPath;",
      "  const { length } = alias;",
      "  return length;",
      "}",
      "",
    ].join("\n");
    const program = createProgramWithVirtualFile(VIRTUAL_PATH, content);
    const sourceFile = program.getSourceFile(VIRTUAL_PATH);
    expect(sourceFile).toBeDefined();
    const sites = collectFindLoreDbPathCallSites(program, sourceFile!, CORPUS_RESOLUTION_PATH);
    expect(sites.length).toBe(1);
    const result = checkCallSitePreservation(program, sourceFile!, sites[0]!);
    expect(result.ok, "expected the aliased destructure to be flagged").toBe(false);
    expect(result.detail).toContain("destructuring");
  });

  it("CLEAN CONTROL: a plain `const dbPath = findLoreDbPath();` with no further access is NOT flagged (mirrors the real call sites)", () => {
    const content = [
      'import { findLoreDbPath } from "./corpus-resolution.js";',
      "",
      "export function compliantCaller(): string {",
      "  const dbPath = findLoreDbPath();",
      "  return dbPath;",
      "}",
      "",
    ].join("\n");
    const program = createProgramWithVirtualFile(VIRTUAL_PATH, content);
    const sourceFile = program.getSourceFile(VIRTUAL_PATH);
    expect(sourceFile).toBeDefined();
    const sites = collectFindLoreDbPathCallSites(program, sourceFile!, CORPUS_RESOLUTION_PATH);
    expect(sites.length).toBe(1);
    const result = checkCallSitePreservation(program, sourceFile!, sites[0]!);
    expect(result.ok, result.detail).toBe(true);
  });
});

// ─── (c) RELOCATION AND HEADER ───────────────────────────────────────────

describe("AC-CP-2(c) RELOCATION — utils.ts declares ZERO of the three relocated functions", () => {
  it.each(RELOCATED_FUNCTION_NAMES)("utils.ts has no FunctionDeclaration named %s", (name) => {
    const program = createRealProgram();
    const sourceFile = program.getSourceFile(UTILS_PATH);
    expect(sourceFile).toBeDefined();
    const names = collectFunctionDeclarationNames(sourceFile!);
    expect(names.has(name)).toBe(false);
  });

  it("the scan visited a POSITIVE number of files (utils.ts + corpus-resolution.ts)", () => {
    const program = createRealProgram();
    const visited = [UTILS_PATH, CORPUS_RESOLUTION_PATH].filter((p) => program.getSourceFile(p) !== undefined);
    expect(visited.length).toBeGreaterThan(0);
    expect(visited.length).toBe(2);
  });
});

describe("AC-CP-2(c) HEADER — utils.ts contains ZERO occurrences of the three pre-change needles", () => {
  it.each([
    ["No business logic here; only terminal I/O concerns", NEEDLE_NO_BUSINESS_LOGIC],
    ["Note: DB discovery and App construction live in `loader.ts`", NEEDLE_DB_DISCOVERY_IN_LOADER],
    ["Side-effect class: pure (no IO, no process.exit)", NEEDLE_SIDE_EFFECT_PURE],
  ])("needle absent: %s", (_label, needle) => {
    const program = createRealProgram();
    const sourceFile = program.getSourceFile(UTILS_PATH);
    expect(sourceFile).toBeDefined();
    expect(sourceFile!.getFullText().includes(needle)).toBe(false);
  });

  it("SELF-CHECK: the needle-matching mechanism actually fires on a string containing it (so an always-false comparator can't hide behind never being exercised)", () => {
    const decoy = `prose that happens to contain ${NEEDLE_SIDE_EFFECT_PURE} verbatim`;
    expect(decoy.includes(NEEDLE_SIDE_EFFECT_PURE)).toBe(true);
  });
});

describe("AC-CP-2(c) CONTROL — corpus-resolution.ts DOES declare all three, on the SAME Program/run", () => {
  it.each(RELOCATED_FUNCTION_NAMES)("corpus-resolution.ts declares %s", (name) => {
    const program = createRealProgram();
    const sourceFile = program.getSourceFile(CORPUS_RESOLUTION_PATH);
    expect(sourceFile).toBeDefined();
    const names = collectFunctionDeclarationNames(sourceFile!);
    expect(names.has(name)).toBe(true);
  });

  it("§5.1 VACUITY CONTROL: pointing the SAME census at the wrong tree (utils.ts) for findLoreDbPathQuiet goes RED", () => {
    // Demonstrates the CONTROL clause actually discriminates: findLoreDbPathQuiet
    // was NEVER declared in utils.ts even before this task (it lived in
    // gate-bypass-audit.ts), so a census pointed at the wrong file reports it
    // absent -- exactly the vacuity §5.1 warns about. The real assertion is the
    // one above (corpus-resolution.ts declares it); this one documents why a
    // wrong-tree scan would have passed for the WRONG reason.
    const program = createRealProgram();
    const utilsSourceFile = program.getSourceFile(UTILS_PATH);
    expect(utilsSourceFile).toBeDefined();
    const utilsNames = collectFunctionDeclarationNames(utilsSourceFile!);
    expect(utilsNames.has("findLoreDbPathQuiet")).toBe(false);

    const corpusResolutionSourceFile = program.getSourceFile(CORPUS_RESOLUTION_PATH);
    expect(corpusResolutionSourceFile).toBeDefined();
    const corpusResolutionNames = collectFunctionDeclarationNames(corpusResolutionSourceFile!);
    expect(corpusResolutionNames.has("findLoreDbPathQuiet")).toBe(true);
  });
});

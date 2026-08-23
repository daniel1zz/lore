/**
 * Compile-failure fixture harness for SPEC-143 C1/C2's two-axis stamp type
 * family — the machinery `stamp-types.test.ts` drives to turn a TYPE-LEVEL
 * claim into an exit-code measurement.
 *
 * ## Why this file exists at all, and why it is typecheck-CLEAN
 *
 * `packages/lore/tsconfig.tests.json` is `include: ["src/**​/*", "tests/**​/*"]`
 * with NO `exclude`, so every file under `tests/` is compiled by
 * `bun run typecheck:lore-tests`. A fixture that CONTAINED a deliberate type
 * error would therefore redden `bun run typecheck` on `main` for everyone,
 * and would also redden every CONCURRENT typecheck in this checkout for the
 * duration. So this file contains no broken code: it BUILDS broken projects
 * as TEXT and compiles them in an isolated `mkdtemp` directory, outside every
 * typechecked glob.
 *
 * ## Why the isolated project imports the REAL production module
 *
 * The prior art for this shape, `packages/lore/tests/unit/core/
 * mirror-human-id-brand.bun.test.ts`, re-declares the type under test FROM
 * SCRATCH inside its temp project (its own header states why: "a temp project
 * can't resolve workspace packages") and openly records the resulting hole —
 * those cases "would stay green even if `packages/core/src/ordinal.ts`'s OWN
 * `MirrorHumanId` were ever weakened to a plain `string` alias".
 *
 * That hole is closed here. Measured 2026-08-23 in this worktree: a temp
 * project whose `src/*.ts` imports a repo source file by RELATIVE PATH does
 * resolve it, and every bare specifier that file reaches (`@lore/core`, then
 * `zod` and friends) resolves by Node's ordinary parent-directory walk from
 * the REPO file's own location — nothing needs to be vendored. The only piece
 * that does not resolve that way is ambient `@types`, which `typeRoots` +
 * `types` pin explicitly (without them the probe failed with `TS2580: Cannot
 * find name 'process'` inside `packages/core/src/config.ts`).
 *
 * Consequence: every compile assertion in `stamp-types.test.ts` is made
 * against the SHIPPED declarations in `packages/lore/src/service/
 * gate-predicates.ts` and `packages/core/src/task-workflow.ts`, never against
 * a hand-written look-alike. Weakening the real type reddens the oracle.
 *
 * ## Why `never`-exhaustiveness needs the WHOLE-FILE copy
 *
 * Scenario 2 ("a sixth `StampClass` member must break the build at
 * `readStampVerdict`'s `never` check") cannot be expressed by importing the
 * real union — a union is closed and a consumer cannot widen it. So
 * {@link buildWidenedGatePredicates} copies the ENTIRE real
 * `gate-predicates.ts` into the temp project verbatim, rewrites only its
 * `@lore/core` specifier to a resolvable relative path, and applies ONE
 * surgical edit: ` | "future_sixth_class"` appended to `StampClass`'s union.
 * The insertion adds no newline, so line numbers are preserved and the
 * resulting diagnostic can be located INSIDE `readStampVerdict`'s own line
 * range ({@link locateFunctionRange}) — that range check is what makes the
 * assertion "the build fails AT the never check" rather than the far weaker
 * "the build fails somewhere".
 *
 * Every extraction here FAILS LOUD (throws {@link StampFixtureError}) rather
 * than returning a default, because a silent extraction miss would turn this
 * oracle into a vacuous pass — which is precisely the failure class SPEC-143
 * exists to close.
 *
 * ## Exit codes are measured, never assumed
 *
 * `EXIT_CHECKED` is 2, taken from the same measurement the prior-art header
 * records: under `--noEmit`, BOTH a genuine type error AND a config fatal
 * (`TS18003`, empty `include`) exit 2, so an exit code alone cannot tell
 * "the compiler checked my fixture" from "the compiler never ran". The
 * discriminators are therefore the ERROR CODE, the SYMBOL NAME, and (for
 * scenario 2) the DIAGNOSTIC LINE — asserted in the test, never here.
 *
 * Side-effect class: IO. `makeScratchDir`/`writeIsolatedProject` create files
 * under the OS temp directory ONLY (never inside the repo, and never inside
 * `.lore/`); `runTsc` spawns a process; `cleanupScratchDirs` deletes what this
 * module created and nothing else. All extraction/text functions are pure.
 *
 * @spec_ref SPEC-143 C1, C2 (R9), AC-CT-9(c);
 *   task-skill-test-two-axis-type-foundation-red-test-scenarios
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Failure type ──────────────────────────────────────────────────────────

/**
 * Thrown when this harness cannot do its job — a declaration it must locate is
 * absent, a brace scan runs off the end of the file, or the checkout layout it
 * needs is not there.
 *
 * Never caught inside this module and never softened into a default: during the
 * RED phase of SPEC-143's type foundation this is the EXPECTED failure (the
 * declarations do not exist yet), and after the GREEN phase it means the
 * declaration was renamed out from under the oracle. Both must be loud.
 */
export class StampFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StampFixtureError";
  }
}

// ─── Measured constants ────────────────────────────────────────────────────

/** A clean `tsc --noEmit` run. */
export const EXIT_CLEAN = 0;

/**
 * `tsc --noEmit` exit code for "diagnostics were emitted". Measured against
 * this repo's own pinned compiler: a genuine `TS2322` AND a config-fatal
 * `TS18003` BOTH land here, which is exactly why no assertion in
 * `stamp-types.test.ts` relies on the exit code alone. ⛔ Never relax an
 * assertion from `EXIT_CHECKED` to "nonzero" — that erases the distinction.
 */
export const EXIT_CHECKED = 2;

/** "Type X is not assignable to type Y" — the real-violation diagnostic. */
export const TS2322 = "TS2322";

/** "No inputs were found in config file" — the config-fatal diagnostic that also exits 2. */
export const TS18003 = "TS18003";

/**
 * The hypothetical sixth `StampClass` member scenario 2 injects. Deliberately
 * a name that appears NOWHERE in the repo, so finding it in a diagnostic
 * proves the diagnostic was caused by this injection and not by pre-existing
 * debt.
 */
export const SIXTH_STAMP_CLASS_MEMBER = "future_sixth_class";

/** Repo-relative path of the module that owns the two-axis types (SPEC-143 C2). */
export const GATE_PREDICATES_RELATIVE = "packages/lore/src/service/gate-predicates.ts";

/** Repo-relative path of the browser-safe barrel that must re-export `StateStamp`/`ARMING_REV` (C1). */
export const CORE_BARREL_RELATIVE = "packages/core/src/index.ts";

/** Repo-relative path of the module that owns `StateStamp` and `ARMING_REV` (SPEC-143 C1 Scope table). */
export const TASK_WORKFLOW_RELATIVE = "packages/core/src/task-workflow.ts";

// ─── Checkout layout resolution ────────────────────────────────────────────

/** Where the sources under test live, and where the compiler that checks them lives. */
export interface RepoPaths {
  /** The checkout THIS TEST FILE belongs to — a git worktree has its own `packages/`. */
  readonly repoRoot: string;
  /**
   * The nearest `node_modules` holding `.bin/tsc`. ⛔ NOT necessarily under
   * `repoRoot`: a git worktree created under `<main>/.claude/worktrees/` has no
   * `node_modules` of its own and resolves upward into the main checkout's.
   * Computing this as `join(repoRoot, "node_modules")` — as the prior-art
   * fixture does — makes `spawnSync` return `status: null` in every worktree,
   * i.e. a failure that reads like a broken assertion instead of a missing
   * install.
   */
  readonly nodeModules: string;
  /** The pinned compiler binary. Never `bunx tsc`, which may fetch a DIFFERENT TypeScript. */
  readonly tscBin: string;
}

function findAncestorContaining(startDir: string, marker: string): string | undefined {
  let current = startDir;
  for (;;) {
    if (existsSync(join(current, marker))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Locates the checkout under test and the pinned compiler, by walking upward
 * from THIS file — never from `process.cwd()`, so the harness is
 * cwd-independent (a vitest worker's cwd is not contractually the repo root).
 *
 * @throws StampFixtureError when either marker is absent — a missing
 *   `node_modules/.bin/tsc` must say "run bun install", not silently produce a
 *   `status: null` spawn that reads as an assertion failure.
 */
export function resolveRepoPaths(): RepoPaths {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findAncestorContaining(here, CORE_BARREL_RELATIVE);
  if (repoRoot === undefined) {
    throw new StampFixtureError(
      `cannot locate the checkout root: no ancestor of ${here} contains ${CORE_BARREL_RELATIVE}`,
    );
  }
  const nodeModulesHost = findAncestorContaining(repoRoot, join("node_modules", ".bin", "tsc"));
  if (nodeModulesHost === undefined) {
    throw new StampFixtureError(
      `cannot locate node_modules/.bin/tsc at or above ${repoRoot} — run \`bun install\` in the main checkout ` +
        `(a git worktree under <main>/.claude/worktrees/ has no node_modules of its own and resolves upward)`,
    );
  }
  return {
    repoRoot,
    nodeModules: join(nodeModulesHost, "node_modules"),
    tscBin: join(nodeModulesHost, "node_modules", ".bin", "tsc"),
  };
}

/** Absolute path of a repo-relative source file, verified to exist. */
export function repoFile(paths: RepoPaths, repoRelative: string): string {
  const absolute = join(paths.repoRoot, repoRelative);
  if (!existsSync(absolute)) {
    throw new StampFixtureError(`expected repo file is missing: ${absolute}`);
  }
  return absolute;
}

/** Contents of a repo-relative source file in THIS checkout. */
export function readRepoFile(paths: RepoPaths, repoRelative: string): string {
  return readFileSync(repoFile(paths, repoRelative), "utf8");
}

// ─── Scratch projects ──────────────────────────────────────────────────────

const scratchDirs: string[] = [];

/** A fresh temp directory owned by this module; released by {@link cleanupScratchDirs}. */
export function makeScratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "stamp-types-"));
  scratchDirs.push(dir);
  return dir;
}

/** Removes every directory {@link makeScratchDir} created. Call from `afterEach`. */
export function cleanupScratchDirs(): void {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The `compilerOptions` an isolated project uses — deliberately the same shape
 * `tsconfig.base.json` applies to the real packages (`strict`,
 * `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `isolatedModules`,
 * `moduleResolution: "bundler"`), so a fixture cannot pass here under looser
 * rules than the code it is asserting about compiles under.
 *
 * `typeRoots`/`types` are absolute paths into the resolved `node_modules`:
 * ambient `@types` resolution is the ONE thing that does not follow the
 * importing file's own directory walk (measured — without this, the probe died
 * on `TS2580: Cannot find name 'process'` inside `packages/core/src/config.ts`).
 */
function baseCompilerOptions(paths: RepoPaths): Record<string, unknown> {
  return {
    target: "ESNext",
    module: "ESNext",
    moduleResolution: "bundler",
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitOverride: true,
    esModuleInterop: true,
    isolatedModules: true,
    resolveJsonModule: true,
    allowImportingTsExtensions: false,
    noEmit: true,
    skipLibCheck: true,
    lib: ["ESNext"],
    typeRoots: [join(paths.nodeModules, "@types"), paths.nodeModules],
    types: ["bun-types"],
  };
}

/**
 * Writes a self-contained TypeScript project into `root`.
 *
 * @param files - project-relative path -> full file contents (e.g.
 *   `{"src/index.ts": "..."}`). Parent directories are created.
 * @param includeGlob - `tsconfig.json`'s `include`. The default matches
 *   `src/`; the reverse-control case passes a glob matching NOTHING to force
 *   `TS18003`, and deliberately not a literal `[]` (some tsc versions treat
 *   that differently).
 */
export function writeIsolatedProject(
  paths: RepoPaths,
  root: string,
  files: Readonly<Record<string, string>>,
  includeGlob: readonly string[] = ["src/**/*.ts"],
): void {
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolute = join(root, relativePath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, "utf8");
  }
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify(
      { compilerOptions: baseCompilerOptions(paths), include: [...includeGlob] },
      null,
      2,
    ),
    "utf8",
  );
}

/** One `tsc` invocation's observable result. */
export interface TscRun {
  /** `null` only when the process could not be spawned at all — never conflated with 0. */
  readonly status: number | null;
  /** `stdout` followed by `stderr`; `tsc` prints diagnostics to stdout. */
  readonly output: string;
}

/**
 * Runs the PINNED compiler over an isolated project.
 *
 * ⛔ `spawnSync` is measured directly, not through a shell pipeline: a pipe
 * reports the LAST command's status, which is how an exit-code oracle silently
 * stops measuring anything.
 */
export function runTsc(paths: RepoPaths, projectRoot: string): TscRun {
  const result = spawnSync(paths.tscBin, ["-p", join(projectRoot, "tsconfig.json")], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

// ─── Diagnostic parsing ────────────────────────────────────────────────────

/** One parsed `tsc` diagnostic line: `path(line,col): error TSxxxx: message`. */
export interface TscDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
}

const DIAGNOSTIC_PATTERN = /^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm;

/**
 * Parses every `path(line,col): error TSxxxx: message` line out of a `tsc` run.
 *
 * Diagnostics with no file position (`error TS18003: ...` is printed WITHOUT a
 * position) do not match and are intentionally absent from the result — the
 * caller asserts those by code substring, which is why `TS18003` is exported
 * as a plain string constant.
 */
export function parseDiagnostics(output: string): readonly TscDiagnostic[] {
  const diagnostics: TscDiagnostic[] = [];
  for (const match of output.matchAll(DIAGNOSTIC_PATTERN)) {
    diagnostics.push({
      file: match[1] ?? "",
      line: Number(match[2]),
      column: Number(match[3]),
      code: match[4] ?? "",
      message: match[5] ?? "",
    });
  }
  return diagnostics;
}

// ─── Source-text surgery (pure) ────────────────────────────────────────────

/**
 * Blanks comments and string/template literals with spaces, preserving every
 * byte offset and newline, so a brace/semicolon scan cannot be fooled by a
 * `{` inside a doc comment or a message string. Returns a string of identical
 * length to the input.
 *
 * Regex literals are NOT masked (distinguishing `/` division from a regex
 * needs a real parser). That is sound for the declarations this harness
 * locates — a type alias and a `switch`-based projection contain none — and if
 * it ever stops being sound the effect is a thrown {@link StampFixtureError}
 * or a failed control compile, never a silent pass.
 */
export function maskCommentsAndStrings(source: string): string {
  const out = source.split("");
  let index = 0;
  const blank = (at: number): void => {
    if (source[at] !== "\n") out[at] = " ";
  };
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") blank(index++);
      continue;
    }
    if (char === "/" && next === "*") {
      blank(index++);
      blank(index++);
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        blank(index++);
      }
      if (index < source.length) {
        blank(index++);
        blank(index++);
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      blank(index++);
      while (index < source.length) {
        if (source[index] === "\\") {
          blank(index++);
          if (index < source.length) blank(index++);
          continue;
        }
        if (source[index] === quote) {
          blank(index++);
          break;
        }
        blank(index++);
      }
      continue;
    }
    index += 1;
  }
  return out.join("");
}

/** 1-based line number of a byte offset. */
function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

/** An inclusive 1-based line span in a source file. */
export interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Locates `export function <name>(...) { ... }` and returns its inclusive
 * 1-based line span, by matching parentheses to find the body's opening brace
 * and then balancing braces to its close.
 *
 * This span is what lets scenario 2 assert the sixth-member diagnostic lands
 * INSIDE `readStampVerdict` — the difference between "the build broke at the
 * exhaustiveness check" and "the build broke somewhere".
 *
 * @throws StampFixtureError when the declaration is absent (the RED-phase
 *   state: `readStampVerdict` does not exist yet) or its braces do not close.
 */
export function locateFunctionRange(source: string, name: string): LineRange {
  const masked = maskCommentsAndStrings(source);
  const header = new RegExp(String.raw`(^|\n)[ \t]*export\s+function\s+${name}\s*\(`);
  const headerMatch = header.exec(masked);
  if (headerMatch === null) {
    throw new StampFixtureError(
      `MISSING IMPLEMENTATION — no \`export function ${name}(\` declaration found. ` +
        `SPEC-143 C2 requires it in ${GATE_PREDICATES_RELATIVE}.`,
    );
  }
  const headerStart = headerMatch.index + (headerMatch[1] === "\n" ? 1 : 0);
  let cursor = masked.indexOf("(", headerStart);
  let parenDepth = 0;
  let bodyStart = -1;
  for (; cursor < masked.length; cursor += 1) {
    const char = masked[cursor];
    if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;
    else if (char === "{" && parenDepth === 0) {
      bodyStart = cursor;
      break;
    }
  }
  if (bodyStart === -1) {
    throw new StampFixtureError(`cannot find the body of \`${name}\` — no \`{\` at paren depth 0`);
  }
  let braceDepth = 0;
  for (let i = bodyStart; i < masked.length; i += 1) {
    if (masked[i] === "{") braceDepth += 1;
    else if (masked[i] === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) {
        return { startLine: lineOf(source, headerStart), endLine: lineOf(source, i) };
      }
    }
  }
  throw new StampFixtureError(`unbalanced braces while scanning the body of \`${name}\``);
}

/**
 * Appends `| "<member>"` to `export type StampClass = ...;`, returning the new
 * source. The insertion is made immediately before the declaration's
 * terminating `;` and contains NO newline, so every subsequent line keeps its
 * original number — which is what makes {@link locateFunctionRange}'s span
 * comparable against the widened file's diagnostics.
 *
 * @throws StampFixtureError when `StampClass` is not declared (RED phase) or
 *   its declaration is not `;`-terminated.
 */
export function widenStampClassUnion(source: string, member: string): string {
  const masked = maskCommentsAndStrings(source);
  const header = /(^|\n)[ \t]*export\s+type\s+StampClass\s*=/.exec(masked);
  if (header === null) {
    throw new StampFixtureError(
      `MISSING IMPLEMENTATION — no \`export type StampClass =\` declaration found. ` +
        `SPEC-143 C2 requires it in ${GATE_PREDICATES_RELATIVE}.`,
    );
  }
  let depth = 0;
  for (let i = header.index + header[0].length; i < masked.length; i += 1) {
    const char = masked[i];
    if (char === "{" || char === "(" || char === "[") depth += 1;
    else if (char === "}" || char === ")" || char === "]") depth -= 1;
    else if (char === ";" && depth === 0) {
      return `${source.slice(0, i)} | "${member}"${source.slice(i)}`;
    }
  }
  throw new StampFixtureError("`export type StampClass` declaration is not `;`-terminated");
}

/**
 * The verbatim initializer text of a top-level `export const <name> = <init>;`
 * (an optional `: Type` annotation is tolerated and excluded from the result).
 *
 * Reads the SOURCE rather than the runtime value on purpose. SPEC-143 C1 says
 * of `ARMING_REV`: "It is data, not a computation — nothing re-derives it".
 * A runtime `typeof x === "number"` check cannot tell a literal from
 * `deriveArmingRev()`; the initializer text can.
 *
 * @throws StampFixtureError when no such declaration exists, or it is not
 *   `;`-terminated.
 */
export function exportedConstInitializer(source: string, name: string): string {
  const masked = maskCommentsAndStrings(source);
  const header = new RegExp(
    String.raw`(^|\n)[ \t]*export\s+const\s+${name}\s*(?::[^=;]*)?=`,
  ).exec(masked);
  if (header === null) {
    throw new StampFixtureError(
      `MISSING IMPLEMENTATION — no top-level \`export const ${name} = \` declaration found.`,
    );
  }
  const start = header.index + header[0].length;
  let depth = 0;
  for (let i = start; i < masked.length; i += 1) {
    const char = masked[i];
    if (char === "{" || char === "(" || char === "[") depth += 1;
    else if (char === "}" || char === ")" || char === "]") depth -= 1;
    else if (char === ";" && depth === 0) return source.slice(start, i).trim();
  }
  throw new StampFixtureError(`\`export const ${name}\` declaration is not \`;\`-terminated`);
}

/**
 * A module specifier that resolves `absoluteTarget` from a file living in
 * `fromDir`, always explicitly relative (`./` or `../`) so it is never mistaken
 * for a bare package name.
 */
export function relativeSpecifier(fromDir: string, absoluteTarget: string): string {
  const raw = relative(fromDir, absoluteTarget).split("\\").join("/");
  return raw.startsWith(".") ? raw : `./${raw}`;
}

/**
 * The intra-package `.js` specifier for a repo `.ts` source file — this
 * package's own import convention (relative `.js` paths that map 1:1 onto
 * `.ts` sources), which `moduleResolution: "bundler"` resolves.
 */
export function moduleSpecifierFor(fromDir: string, absoluteTsFile: string): string {
  return relativeSpecifier(fromDir, absoluteTsFile.replace(/\.ts$/, ".js"));
}

// ─── The two project builders ──────────────────────────────────────────────

/** A project ready to compile: its root plus the specifiers its sources use. */
export interface IsolatedProject {
  readonly root: string;
  readonly srcDir: string;
}

/**
 * Copies the REAL `gate-predicates.ts` into a temp project, optionally widening
 * `StampClass` by one member.
 *
 * The only edit to the copy other than the widening is its `@lore/core`
 * specifier: a bare package name cannot resolve from a temp directory, so it is
 * rewritten to a relative path at `packages/core/src/index.js`, from which
 * every downstream bare specifier (`zod`, ...) resolves by the ordinary
 * parent-directory walk out of the repo's own tree.
 *
 * @returns the project plus the copied source text (so the caller can locate
 *   `readStampVerdict`'s line range in exactly the bytes tsc compiled).
 */
export function buildGatePredicatesProject(
  paths: RepoPaths,
  options: { readonly widenWith?: string } = {},
): IsolatedProject & { readonly copiedSource: string; readonly copiedFileName: string } {
  const root = makeScratchDir();
  const srcDir = join(root, "src");
  const realSource = readFileSync(repoFile(paths, GATE_PREDICATES_RELATIVE), "utf8");
  const coreSpecifier = moduleSpecifierFor(srcDir, repoFile(paths, CORE_BARREL_RELATIVE));
  const rewritten = realSource.split('from "@lore/core"').join(`from "${coreSpecifier}"`);
  if (rewritten === realSource) {
    throw new StampFixtureError(
      `${GATE_PREDICATES_RELATIVE} no longer imports from "@lore/core" — the specifier rewrite ` +
        `this harness depends on did nothing, so the copy would not compile for an unrelated reason`,
    );
  }
  const copiedSource =
    options.widenWith === undefined
      ? rewritten
      : widenStampClassUnion(rewritten, options.widenWith);
  const copiedFileName = "gate-predicates.ts";
  writeIsolatedProject(paths, root, { [`src/${copiedFileName}`]: copiedSource });
  return { root, srcDir, copiedSource, copiedFileName };
}

/**
 * A temp project whose single source file imports the REAL two-axis types (and,
 * when needed, the REAL `@lore/core` barrel) by relative specifier.
 *
 * `body` is appended after the import block, so a case only has to write the
 * assignment it wants checked. This is the mechanism behind every scenario-3
 * assertion and behind the green compile-consumer control.
 */
export function buildRealTypeConsumerProject(
  paths: RepoPaths,
  body: string,
): IsolatedProject {
  const root = makeScratchDir();
  const srcDir = join(root, "src");
  const gateSpecifier = moduleSpecifierFor(srcDir, repoFile(paths, GATE_PREDICATES_RELATIVE));
  const coreSpecifier = moduleSpecifierFor(srcDir, repoFile(paths, CORE_BARREL_RELATIVE));
  const source =
    `import type { StampClass, RadiusMeasurement, StampCurrency, StampVerdict } from "${gateSpecifier}";\n` +
    `import { readStampVerdict } from "${gateSpecifier}";\n` +
    `import type { StateStamp } from "${coreSpecifier}";\n` +
    `import { ARMING_REV } from "${coreSpecifier}";\n` +
    `\n${body}\n`;
  writeIsolatedProject(paths, root, { "src/index.ts": source });
  return { root, srcDir };
}

// ─── Import-graph walk (scenario 4) ────────────────────────────────────────

/**
 * Node builtin module names, checked WITHOUT the `node:` prefix. A specifier
 * counts as a builtin when it is one of these or starts with `node:`.
 *
 * Kept as an explicit list rather than `node:module`'s `builtinModules` so the
 * assertion cannot change meaning with the Node version running the suite —
 * `packages/core/src/index.ts`'s own invariant names `fs`, `path`, `os`,
 * `child_process` as the ones that blank the dashboard SPA.
 */
const NODE_BUILTIN_NAMES: ReadonlySet<string> = new Set([
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "worker_threads",
  "zlib",
]);

/** True when `specifier` names a Node builtin, with or without the `node:` prefix. */
export function isNodeBuiltinSpecifier(specifier: string): boolean {
  if (specifier.startsWith("node:")) return true;
  return NODE_BUILTIN_NAMES.has(specifier);
}

/** True for `bun:*` specifiers (`bun:sqlite`, ...) — equally unreachable from a browser bundle. */
export function isBunRuntimeSpecifier(specifier: string): boolean {
  return specifier.startsWith("bun:");
}

/** Matches `from "specifier"` in `import` / `export ... from` statements, and `import("specifier")`. */
const SPECIFIER_PATTERN = /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** The transitive closure of relative imports from an entry module. */
export interface ImportClosure {
  /** Absolute paths of every reachable source file, including the entry. */
  readonly files: ReadonlySet<string>;
  /** Every non-relative specifier seen anywhere in that closure. */
  readonly bareSpecifiers: ReadonlySet<string>;
}

/**
 * Walks the transitive closure of RELATIVE imports out of `entryFile`,
 * following this package's `.js`-specifier-to-`.ts`-source convention, and
 * collects every bare specifier encountered.
 *
 * An unresolvable relative specifier throws instead of being skipped: a scan
 * that silently drops an edge reports a smaller, cleaner-looking graph than
 * the real one, which is the same class of vacuous pass this whole spec exists
 * to refuse.
 *
 * @throws StampFixtureError on an unresolvable relative import.
 */
export function collectImportClosure(entryFile: string): ImportClosure {
  const files = new Set<string>();
  const bareSpecifiers = new Set<string>();
  const stack: string[] = [entryFile];
  while (stack.length > 0) {
    const file = stack.pop();
    if (file === undefined || files.has(file)) continue;
    if (!existsSync(file)) {
      throw new StampFixtureError(`import-closure scan cannot resolve "${file}"`);
    }
    files.add(file);
    const contents = readFileSync(file, "utf8");
    for (const match of maskComments(contents).matchAll(SPECIFIER_PATTERN)) {
      const specifier = match[1] ?? match[2];
      if (specifier === undefined) continue;
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        stack.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      } else {
        bareSpecifiers.add(specifier);
      }
    }
  }
  return { files, bareSpecifiers };
}

/**
 * Comment-only masking for the closure walk. Distinct from
 * {@link maskCommentsAndStrings} on purpose: the specifier scan NEEDS string
 * literals intact (the specifier IS a string literal); it only has to stop
 * example code inside a doc comment from being counted as a real edge.
 */
export function maskComments(source: string): string {
  const out = source.split("");
  let index = 0;
  const blank = (at: number): void => {
    if (source[at] !== "\n") out[at] = " ";
  };
  while (index < source.length) {
    if (source[index] === "/" && source[index + 1] === "/") {
      while (index < source.length && source[index] !== "\n") blank(index++);
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      blank(index++);
      blank(index++);
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        blank(index++);
      }
      if (index < source.length) {
        blank(index++);
        blank(index++);
      }
      continue;
    }
    index += 1;
  }
  return out.join("");
}

/**
 * Files in `closure` that declare `name` at top level as an exported `const`,
 * `type`, or `interface`. Used to assert WHERE a symbol lives, not merely that
 * it is importable — SPEC-143 C1 pins `ARMING_REV`'s owner to
 * `packages/core/src/task-workflow.ts` ("a single exported constant ... stored
 * in packages/core/src/task-workflow.ts. It is data, not a computation").
 */
export function filesDeclaring(closure: ImportClosure, name: string): readonly string[] {
  const declaration = new RegExp(
    String.raw`(^|\n)[ \t]*export\s+(?:declare\s+)?(?:const|type|interface|function|class|enum)\s+${name}\b`,
  );
  return [...closure.files].filter((file) => declaration.test(maskComments(readFileSync(file, "utf8")))).sort();
}

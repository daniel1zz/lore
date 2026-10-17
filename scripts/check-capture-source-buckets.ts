#!/usr/bin/env bun
/**
 * Bucketing-predicate site scan (`bun scripts/check-capture-source-buckets.ts`) —
 * SPEC-143 AC-CT-10 (R13): THE SINGLE BUCKETING PREDICATE IS RATCHETED, NOT ESTABLISHED ONCE.
 *
 * ## What this exists for
 *
 * An evidence row is bucketed along TWO axes — `capture_source` (runner / self-report /
 * runner-unattested) and the stamp verdict (bound / stale / radius_unmeasured / unbound /
 * legacy_unbound). Each axis has ONE exported classifier: `classifyCaptureSource`
 * (`packages/core/src/task-workflow.ts`) and `readStampVerdict`
 * (`packages/lore/src/service/gate-predicates.ts`). `lore assess` and `lore status` both route
 * through them. This scan refuses the NEXT private re-derivation: the day somebody adds a third
 * surface and writes `if (e.capture_source === "runner") r++ else s++` there, the two
 * distributions can disagree with no test red.
 *
 * ## STRUCTURAL DISCRIMINATOR (R13) — path is never the discriminator
 *
 * A BUCKETING DECISION is a raw `capture_source` read (or a raw stamp-field read: `.stamp`,
 * `.state_stamp`), or a literal comparison against a `CAPTURE_SOURCES` / `StampVerdict` value, in
 * a function writing TWO OR MORE distinct accumulation targets (counters or arrays), outside the
 * classifier's file. Each site is given exactly one disposition:
 *
 *   - `classifier-file`      — the site lives in its axis's classifier file (the one derivation).
 *   - `classifier-input`     — the raw field is passed straight into a classifier call
 *                              (`classifyCaptureSource(entry.capture_source)`): that FEEDS the
 *                              classifier, it decides nothing.
 *   - `sanctioned-consumer`  — a `switch` / comparison over a classifier's RETURN value (the call
 *                              itself, or a local `const x = classifier(...)`). Two accumulators
 *                              are fine here: this is how the distributions are SUPPOSED to work.
 *   - `exempt-by-shape`      — a raw read in a function with FEWER THAN TWO accumulation targets.
 *                              This is the TAIL-GUARD (`isRunnerCaptured`: returns the comparison,
 *                              writes nothing). It stays exempt wherever it moves — a path
 *                              allowlist would silently rot when the guard is relocated.
 *   - `allowlisted`          — a whole-file waiver in {@link ALLOWLIST}, WITH a written reason.
 *   - `violation`            — everything else. Exit 1.
 *
 * "Accumulation target" = the root of an expression that is compound-assigned (`+=`, …),
 * incremented, `.push`/`.unshift`/`.add`/`.set`-called, or element-assigned (`counts[k] = v`),
 * written directly in the function body — NOT in a nested function, which is its own function.
 * The nearest enclosing function is "the function"; an arrow callback is not folded into its
 * parent.
 *
 * Known blind spot, stated rather than hidden: a decision made with ZERO writes in the function
 * (e.g. `rows.filter(r => r.capture_source === "runner").length`) is exempt-by-shape by this
 * spec-mandated discriminator. The classifier-input rule keeps the two shipped surfaces honest;
 * the next defence for that shape is review.
 *
 * ## Exit codes (the `check-ac-state-renderers.ts` / AC-CT-7 numbering)
 *
 *   0 — no violation. Output states how many files and sites were scanned.
 *   1 — one or more violations, each printed `file:line [axis] function — kind`.
 *   2 — the scan could not measure what it claims to: missing scan roots, ZERO files, ZERO sites
 *       (AS-17: an empty scan is never "clean"), a classifier file or classifier function or the
 *       vocabulary declaration absent from its file, an empty `LORE_CAPTURE_SOURCE_BUCKETS_REPO_ROOT`.
 *
 * Public surface: {@link scanTree}, {@link main}, {@link ALLOWLIST}, {@link BucketScanError}.
 * Side-effect class: {@link scanTree} reads the file tree; {@link main} also writes stdout/stderr.
 *
 * Source: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-10 (R13);
 * design: knowledge-ac-ct-3-10-re-measured-on-main-cb55711d-verdicts-nine §3 C5, §4 T6.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_NAME = "check-capture-source-buckets";

/** Overrides the scanned repo root (fixture trees). ⛔ Never set by production callers. */
export const REPO_ROOT_ENV = "LORE_CAPTURE_SOURCE_BUCKETS_REPO_ROOT";

/** The two evidence-row axes whose bucketing is ratcheted. */
export type BucketAxis = "capture_source" | "stamp_verdict";

/** What kind of syntax the site is. */
export type SiteKind = "raw-field-read" | "literal-comparison" | "case-literal";

/** The one verdict every scanned site receives (see the module header). */
export type SiteDisposition =
  | "classifier-file"
  | "classifier-input"
  | "sanctioned-consumer"
  | "exempt-by-shape"
  | "allowlisted"
  | "violation";

/** One scanned site. */
export interface BucketSite {
  readonly file: string;
  readonly line: number;
  readonly axis: BucketAxis;
  readonly kind: SiteKind;
  /** Enclosing function; an anonymous callback is named `outer>(anonymous)`. */
  readonly fn: string;
  readonly accumulationTargets: number;
  readonly disposition: SiteDisposition;
}

/** What {@link scanTree} measured. */
export interface BucketScanReport {
  readonly filesScanned: number;
  readonly sites: readonly BucketSite[];
  readonly violations: readonly BucketSite[];
}

/** A whole-file waiver for one axis. Never add one to silence a real second derivation. */
export interface AllowlistEntry {
  readonly axis: BucketAxis;
  readonly file: string;
  readonly reason: string;
}

/**
 * Why the scan broke. `code` is the machine-readable half so a test can assert WHICH undecidable
 * condition fired rather than just "exit 2".
 */
export class BucketScanError extends Error {
  public constructor(
    public readonly code:
      | "scan-root-missing"
      | "zero-files-scanned"
      | "zero-sites-scanned"
      | "classifier-file-missing"
      | "classifier-missing"
      | "vocabulary-missing"
      | "unreadable-file",
    message: string,
  ) {
    super(message);
    this.name = "BucketScanError";
  }
}

interface AxisSpec {
  readonly axis: BucketAxis;
  /** The one file allowed to derive the bucket. */
  readonly classifierFile: string;
  /** The classifier declared IN {@link classifierFile}; the scan exits 2 if it is absent there. */
  readonly declaredClassifier: string;
  /** Functions whose RETURN value is a bucket (includes {@link declaredClassifier}). */
  readonly classifierNames: readonly string[];
  /** Property names whose raw read is a bucketing input. */
  readonly rawFields: readonly string[];
  /** Identifiers that stand for a vocabulary value (compared like a literal). */
  readonly valueIdentifiers: readonly string[];
  /** The other operand of a literal comparison must look like this axis, else the literal is unrelated. */
  readonly relevance: RegExp;
  /** Where the vocabulary is declared, and how to read it from the AST. */
  readonly vocabulary: { readonly file: string; readonly kind: "const-array" | "type-union"; readonly name: string };
}

const AXES: readonly AxisSpec[] = [
  {
    axis: "capture_source",
    classifierFile: "packages/core/src/task-workflow.ts",
    declaredClassifier: "classifyCaptureSource",
    classifierNames: ["classifyCaptureSource"],
    rawFields: ["capture_source"],
    valueIdentifiers: ["RUNNER_UNATTESTED_CAPTURE_SOURCE"],
    relevance: /capture|source|bucket/i,
    vocabulary: { file: "packages/core/src/task-workflow.ts", kind: "const-array", name: "CAPTURE_SOURCES" },
  },
  {
    axis: "stamp_verdict",
    classifierFile: "packages/lore/src/service/gate-predicates.ts",
    declaredClassifier: "readStampVerdict",
    // reason: `readStampedRadius` (packages/core/src/stamp-binding.ts) is the shared radius -> verdict
    // step `readStampVerdict` itself delegates to; its return is a StampVerdict member too.
    classifierNames: ["readStampVerdict", "readStampedRadius"],
    rawFields: ["stamp", "state_stamp"],
    valueIdentifiers: [],
    relevance: /stamp|verdict|radius|bucket/i,
    vocabulary: { file: "packages/lore/src/service/gate-predicates.ts", kind: "type-union", name: "StampVerdict" },
  },
];

/**
 * Whole-file waivers, each with a written reason. The tail-guard (`isRunnerCaptured` in
 * `task-workflow-service.ts`) needs NONE: it is exempt by shape and stays exempt if it moves.
 */
export const ALLOWLIST: readonly AllowlistEntry[] = [
  {
    axis: "stamp_verdict",
    file: "packages/core/src/stamp-binding.ts",
    reason:
      "lives in @lore/core, which cannot import `readStampVerdict` (packages/lore). Its `tallyStampReadings` " +
      "`switch (reading.stamp)` is the per-stamp-class tally the evidence panel feeds on; it derives the radius " +
      "sub-verdict through `readStampedRadius` (a classifier named in this scan) and the stamp class from the " +
      "already-classified `classifyStampAxis` reading, never from a raw row field.",
  },
  {
    axis: "stamp_verdict",
    file: "packages/lore/src/service/state-binding-service.ts",
    reason:
      "`reportImpact` PREDICTS, before the `state-binding-armed` row exists, how many rows arming would turn " +
      "unbound (`attestation.state_stamp === undefined`). `readStampVerdict` needs that arming row, so it cannot " +
      "be called here; this is a what-if count, not a reading of any row's stored verdict.",
  },
];

/** Roots under the repo, enumerated as `packages/*` + `/src`. */
const PACKAGES_DIR = "packages";

const TEST_FILE = /\.(?:bun\.)?test\.[cm]?tsx?$|\.d\.[cm]?ts$/;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const SKIPPED_DIRS = new Set(["node_modules", "dist", "tests", "__tests__", ".git"]);

/** Collects every non-test source file under `absDir`, as repo-relative posix paths. */
function walkSourceFiles(treeRoot: string, absDir: string, out: string[]): void {
  for (const name of readdirSync(absDir).sort()) {
    const abs = join(absDir, name);
    const stats = statSync(abs);
    if (stats.isDirectory()) {
      if (!SKIPPED_DIRS.has(name)) walkSourceFiles(treeRoot, abs, out);
      continue;
    }
    if (SOURCE_FILE.test(name) && !TEST_FILE.test(name)) {
      out.push(relative(treeRoot, abs).split(sep).join("/"));
    }
  }
}

/** Every `packages/<pkg>/src` directory that exists under `treeRoot`. */
function listScanRoots(treeRoot: string): string[] {
  const packagesAbs = join(treeRoot, PACKAGES_DIR);
  let packageNames: string[];
  try {
    packageNames = readdirSync(packagesAbs);
  } catch (error) {
    throw new BucketScanError(
      "scan-root-missing",
      `cannot read ${PACKAGES_DIR}/ under ${treeRoot}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const roots: string[] = [];
  for (const packageName of packageNames.sort()) {
    const srcAbs = join(packagesAbs, packageName, "src");
    try {
      if (statSync(srcAbs).isDirectory()) roots.push(srcAbs);
    } catch {
      // reason: a package without `src/` (docs-only, assets-only) is simply not a scan root; the
      // zero-files check below is what refuses a tree where NO package has one.
    }
  }
  return roots;
}

function readSource(treeRoot: string, relPath: string): ts.SourceFile {
  let text: string;
  try {
    text = readFileSync(join(treeRoot, relPath), "utf8");
  } catch (error) {
    throw new BucketScanError(
      "unreadable-file",
      `cannot read ${relPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true);
}

/** String members of `const NAME = [...] as const` or `type NAME = "a" | "b"` in `source`. */
function readVocabulary(source: ts.SourceFile, spec: AxisSpec): string[] {
  const { kind, name } = spec.vocabulary;
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (kind === "const-array" && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      let init = node.initializer;
      while (init !== undefined && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init))) init = init.expression;
      if (init !== undefined && ts.isArrayLiteralExpression(init)) {
        for (const element of init.elements) if (ts.isStringLiteralLike(element)) values.push(element.text);
      }
    }
    if (kind === "type-union" && ts.isTypeAliasDeclaration(node) && node.name.text === name) {
      const collect = (type: ts.TypeNode): void => {
        if (ts.isUnionTypeNode(type)) type.types.forEach(collect);
        else if (ts.isLiteralTypeNode(type) && ts.isStringLiteralLike(type.literal)) values.push(type.literal.text);
      };
      collect(node.type);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return values;
}

function declaresFunction(source: ts.SourceFile, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = true;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

interface AxisRuntime {
  readonly spec: AxisSpec;
  readonly literals: ReadonlySet<string>;
}

/** Resolves each axis's vocabulary and proves its classifier exists, or throws exit-2 errors. */
function resolveAxes(treeRoot: string): AxisRuntime[] {
  return AXES.map((spec) => {
    let classifierSource: ts.SourceFile;
    try {
      classifierSource = readSource(treeRoot, spec.classifierFile);
    } catch (error) {
      throw new BucketScanError(
        "classifier-file-missing",
        `${spec.axis}: classifier file ${spec.classifierFile} is absent — the scan has nothing to ratchet against (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    if (!declaresFunction(classifierSource, spec.declaredClassifier)) {
      throw new BucketScanError(
        "classifier-missing",
        `${spec.axis}: ${spec.classifierFile} declares no ${spec.declaredClassifier}`,
      );
    }
    const vocabularySource =
      spec.vocabulary.file === spec.classifierFile ? classifierSource : readSource(treeRoot, spec.vocabulary.file);
    const literals = readVocabulary(vocabularySource, spec);
    if (literals.length === 0) {
      throw new BucketScanError(
        "vocabulary-missing",
        `${spec.axis}: found no string members of ${spec.vocabulary.name} in ${spec.vocabulary.file}`,
      );
    }
    return { spec, literals: new Set(literals) };
  });
}

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** Visits `root`'s descendants without crossing into nested function-likes. */
function walkOwn(root: ts.Node, visit: (node: ts.Node) => void): void {
  const step = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, (child) => {
      if (!isFunctionLike(child)) step(child);
    });
  };
  ts.forEachChild(root, (child) => {
    if (!isFunctionLike(child)) step(child);
  });
}

const COMPOUND_ASSIGNMENT = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);
const ACCUMULATING_METHODS = new Set(["push", "unshift", "add", "set", "splice"]);

/** The root identity of a write target: `reasons[x]` -> `reasons`, `this.n.count` -> `this.n`. */
function accumulationKey(expression: ts.Expression): string {
  let current: ts.Expression = expression;
  for (;;) {
    if (ts.isElementAccessExpression(current)) current = current.expression;
    else if (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
    else if (ts.isPropertyAccessExpression(current) && current.expression.kind !== ts.SyntaxKind.ThisKeyword) current = current.expression;
    else break;
  }
  if (ts.isPropertyAccessExpression(current)) return `this.${current.name.text}`;
  return current.getText();
}

/** The distinct accumulation targets written directly in `fn`'s body. */
function collectAccumulationTargets(fn: ts.Node): Set<string> {
  const targets = new Set<string>();
  walkOwn(fn, (node) => {
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (COMPOUND_ASSIGNMENT.has(op)) targets.add(accumulationKey(node.left));
      else if (op === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(node.left)) {
        targets.add(accumulationKey(node.left));
      }
    } else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      if (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) {
        targets.add(accumulationKey(node.operand));
      }
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (ACCUMULATING_METHODS.has(node.expression.name.text)) targets.add(accumulationKey(node.expression.expression));
    }
  });
  return targets;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) || ts.isAwaitExpression(current)) {
    current = current.expression;
  }
  return current;
}

function isClassifierCall(expression: ts.Expression, classifierNames: readonly string[]): boolean {
  const call = unwrap(expression);
  return ts.isCallExpression(call) && ts.isIdentifier(call.expression) && classifierNames.includes(call.expression.text);
}

/** Names bound by `const x = classifier(...)` directly in `fn`. */
function collectClassifierDerived(fn: ts.Node, classifierNames: readonly string[]): Set<string> {
  const derived = new Set<string>();
  walkOwn(fn, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      isClassifierCall(node.initializer, classifierNames)
    ) {
      derived.add(node.name.text);
    }
  });
  return derived;
}

function isClassifierReturn(expression: ts.Expression, derived: ReadonlySet<string>, classifierNames: readonly string[]): boolean {
  const inner = unwrap(expression);
  if (isClassifierCall(inner, classifierNames)) return true;
  return ts.isIdentifier(inner) && derived.has(inner.text);
}

function rawFieldName(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function isAssignmentTarget(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

const COMPARISON_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

function isVocabularyValue(expression: ts.Expression, axis: AxisRuntime): boolean {
  const inner = unwrap(expression);
  if (ts.isStringLiteralLike(inner)) return axis.literals.has(inner.text);
  return ts.isIdentifier(inner) && axis.spec.valueIdentifiers.includes(inner.text);
}

function isAxisRawRead(expression: ts.Expression, axis: AxisRuntime): boolean {
  const inner = unwrap(expression);
  const field = rawFieldName(inner);
  return field !== undefined && axis.spec.rawFields.includes(field);
}

function functionName(node: FunctionLike | ts.SourceFile, outerName: string): string {
  if (ts.isSourceFile(node)) return "<module>";
  let own: string | undefined;
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node)) && node.name !== undefined) {
    own = node.name.getText();
  } else if (ts.isConstructorDeclaration(node)) own = "constructor";
  else if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) own = node.name.getText();
  else if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) own = node.parent.name.text;
  if (own !== undefined) return own;
  return outerName === "<module>" ? "(anonymous)" : `${outerName}>(anonymous)`;
}

interface FunctionContext {
  readonly name: string;
  readonly targets: number;
  readonly derivedByAxis: ReadonlyMap<BucketAxis, ReadonlySet<string>>;
}

function allowlisted(allowlist: readonly AllowlistEntry[], axis: BucketAxis, file: string): boolean {
  return allowlist.some((entry) => entry.axis === axis && entry.file === file);
}

function scanFile(
  file: string,
  source: ts.SourceFile,
  axes: readonly AxisRuntime[],
  allowlist: readonly AllowlistEntry[],
): BucketSite[] {
  const sites: BucketSite[] = [];

  const record = (
    node: ts.Node,
    ctx: FunctionContext,
    axis: AxisRuntime,
    kind: SiteKind,
    sanction: "classifier-input" | "sanctioned-consumer" | undefined,
  ): void => {
    let disposition: SiteDisposition;
    if (file === axis.spec.classifierFile) disposition = "classifier-file";
    else if (sanction !== undefined) disposition = sanction;
    else if (ctx.targets < 2) disposition = "exempt-by-shape";
    else if (allowlisted(allowlist, axis.spec.axis, file)) disposition = "allowlisted";
    else disposition = "violation";
    sites.push({
      file,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      axis: axis.spec.axis,
      kind,
      fn: ctx.name,
      accumulationTargets: ctx.targets,
      disposition,
    });
  };

  const buildContext = (node: FunctionLike | ts.SourceFile, outerName: string): FunctionContext => ({
    name: functionName(node, outerName),
    targets: collectAccumulationTargets(node).size,
    derivedByAxis: new Map(axes.map((axis) => [axis.spec.axis, collectClassifierDerived(node, axis.spec.classifierNames)])),
  });

  const visit = (node: ts.Node, ctx: FunctionContext): void => {
    const nextCtx = isFunctionLike(node) ? buildContext(node, ctx.name) : ctx;

    for (const axis of axes) {
      const derived = nextCtx.derivedByAxis.get(axis.spec.axis) ?? new Set<string>();

      const field = rawFieldName(node);
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        field !== undefined &&
        axis.spec.rawFields.includes(field) &&
        !isAssignmentTarget(node)
      ) {
        const parent = node.parent;
        const fedToClassifier =
          ts.isCallExpression(parent) &&
          parent.arguments.some((argument) => argument === node) &&
          isClassifierCall(parent, axis.spec.classifierNames);
        record(node, nextCtx, axis, "raw-field-read", fedToClassifier ? "classifier-input" : undefined);
      }

      if (ts.isBindingElement(node)) {
        const bound = (node.propertyName ?? node.name).getText();
        if (axis.spec.rawFields.includes(bound)) record(node, nextCtx, axis, "raw-field-read", undefined);
      }

      if (ts.isBinaryExpression(node) && COMPARISON_OPERATORS.has(node.operatorToken.kind)) {
        const [valueSide, otherSide] = isVocabularyValue(node.right, axis)
          ? [node.right, node.left]
          : isVocabularyValue(node.left, axis)
            ? [node.left, node.right]
            : [undefined, undefined];
        if (valueSide !== undefined && otherSide !== undefined && !isAxisRawRead(otherSide, axis)) {
          if (isClassifierReturn(otherSide, derived, axis.spec.classifierNames)) {
            record(node, nextCtx, axis, "literal-comparison", "sanctioned-consumer");
          } else if (axis.spec.relevance.test(otherSide.getText())) {
            record(node, nextCtx, axis, "literal-comparison", undefined);
          }
        }
      }

      if (ts.isCaseClause(node) && isVocabularyValue(node.expression, axis)) {
        const switchStatement = node.parent.parent;
        if (ts.isSwitchStatement(switchStatement) && !isAxisRawRead(switchStatement.expression, axis)) {
          if (isClassifierReturn(switchStatement.expression, derived, axis.spec.classifierNames)) {
            record(node, nextCtx, axis, "case-literal", "sanctioned-consumer");
          } else if (axis.spec.relevance.test(switchStatement.expression.getText())) {
            record(node, nextCtx, axis, "case-literal", undefined);
          }
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, nextCtx));
  };

  visit(source, buildContext(source, "<module>"));
  return sites;
}

/**
 * Scans every non-test `packages/*\/src` file under `treeRoot`.
 *
 * @param treeRoot - repo root (a fixture tree in tests)
 * @param allowlist - whole-file waivers; defaults to {@link ALLOWLIST}
 * @returns the files scanned, every site with its disposition, and the violations
 * @throws {BucketScanError} the scan could not measure — NEVER returns a clean report over nothing
 * @example
 * scanTree(process.cwd()).violations.length; // => 0 on a clean tree
 */
export function scanTree(treeRoot: string, allowlist: readonly AllowlistEntry[] = ALLOWLIST): BucketScanReport {
  const axes = resolveAxes(treeRoot);
  const files: string[] = [];
  for (const root of listScanRoots(treeRoot)) walkSourceFiles(treeRoot, root, files);
  if (files.length === 0) {
    throw new BucketScanError("zero-files-scanned", `walked ${treeRoot}/${PACKAGES_DIR}/*/src and found zero source files`);
  }

  const sites: BucketSite[] = [];
  for (const file of files) sites.push(...scanFile(file, readSource(treeRoot, file), axes, allowlist));
  if (sites.length === 0) {
    throw new BucketScanError(
      "zero-sites-scanned",
      `scanned ${files.length} file(s) and found zero bucketing sites — not even the classifiers' own. ` +
        "The site detector drifted from the code; an empty scan is never a clean verdict (AS-17)",
    );
  }
  return { filesScanned: files.length, sites, violations: sites.filter((site) => site.disposition === "violation") };
}

/** Counts per disposition, in a fixed order, for the one-line summary. */
function summariseDispositions(sites: readonly BucketSite[]): string {
  const order: SiteDisposition[] = [
    "classifier-file",
    "classifier-input",
    "sanctioned-consumer",
    "exempt-by-shape",
    "allowlisted",
    "violation",
  ];
  return order.map((disposition) => `${disposition}=${sites.filter((site) => site.disposition === disposition).length}`).join(", ");
}

/**
 * CLI entrypoint.
 *
 * @param repoRoot - the tree to scan; defaults to this script's repo
 * @returns 0 clean / 1 violation(s) / 2 the scan could not measure
 */
export function main(repoRoot: string = REPO_ROOT): number {
  let report: BucketScanReport;
  try {
    report = scanTree(repoRoot);
  } catch (error) {
    if (error instanceof BucketScanError) {
      process.stderr.write(`${SCRIPT_NAME}: could not scan [${error.code}] — ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  if (report.violations.length > 0) {
    process.stderr.write(
      `\n${SCRIPT_NAME} FAILED — ${report.violations.length} bucketing decision(s) outside the classifier file:\n\n` +
        report.violations
          .map(
            (site) =>
              `  ${site.file}:${site.line} [${site.axis}] ${site.fn} — ${site.kind} in a function writing ` +
              `${site.accumulationTargets} accumulation targets`,
          )
          .join("\n") +
        "\n\nRoute the bucket through `classifyCaptureSource` (capture_source) or `readStampVerdict` " +
        "(stamp verdict) and `switch` over its return value. A second derivation lets the two distributions " +
        "disagree. A site that is genuinely not a bucketing decision belongs in ALLOWLIST with a written reason.\n",
    );
    return 1;
  }

  console.log(
    `${SCRIPT_NAME}: scanned ${report.filesScanned} file(s), ${report.sites.length} site(s) ` +
      `(${summariseDispositions(report.sites)}); 0 bucketing decision(s) outside the classifier files.`,
  );
  return 0;
}

if (import.meta.main) {
  const rawRoot = process.env[REPO_ROOT_ENV];
  if (rawRoot !== undefined && rawRoot.trim() === "") {
    process.stderr.write(`${SCRIPT_NAME}: ${REPO_ROOT_ENV} is set but empty — unset it, or point it at a real directory.\n`);
    process.exit(2);
  }
  process.exit(main(rawRoot === undefined ? REPO_ROOT : resolve(rawRoot)));
}

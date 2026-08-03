#!/usr/bin/env bun
/**
 * Plan-membership site-enumeration oracle (`bun run check:plan-member-sites`) —
 * `task-plan-membership-has-ten-known-sites-and-no-enumeration`.
 *
 * ## What this exists for
 *
 * Plan membership is this corpus's deepest recurring defect family: TEN sites
 * were found ONE AT A TIME. Plan membership IS `extra.plan_id` — the DECLARED
 * property, mandatory for every non-adhoc task; `parent_id` is only a PROXY,
 * and `lore create task --plan-id P --parent Q` with `P !== Q` is a SUPPORTED
 * shape (SPEC-065 D4), so a plan-scoped query keyed on `parent_id` silently
 * drops a diverged member from its own plan. The shared predicate lives in
 * `packages/lore/src/service/plan-membership.ts`; read its header first — it
 * states the residual THIS script closes.
 *
 * Before this script, two mechanisms guarded the family and both were partial:
 *
 * 1. `packages/lore/tests/unit/service/isplanmember-single-definition.test.ts`
 *    keys on the literal string `"function isPlanMember"`, so an arrow-const
 *    (`const isPlanMember = (t, p) => t.extra["plan_id"] === p`) or a class
 *    member satisfies its count while violating the property. It also scans
 *    `packages/lore/src` only — `packages/core/src` was unscanned.
 * 2. The shared module's JSDoc names a companion grep
 *    (`grep -rn 'extra\["plan_id"\] ===' packages/lore/src/`) that existed only
 *    as a sentence in a comment — never run by anything.
 *
 * This script is the mechanism those two were standing in for. It is modelled
 * on `scripts/check-ordinal-write-sites.mjs`: a conservative, ALLOWLIST-BY-FILE
 * TEXTUAL check, not a semantic analyzer. Extend an allowlist (with a written
 * reason) rather than widening a pattern — a widened pattern that starts
 * matching legitimate code forces a WHOLE-FILE allowlist entry, which blinds
 * the rule to every real violation in that file. That failure mode is not
 * hypothetical here; see `RULE_PLAN_SCOPE_ON_PARENT_ID_PROXY`'s note.
 *
 * ## Three rules
 *
 * - **R1 `second-predicate-definition`** — a second definition of the predicate
 *   in ANY form (`function`, `const`/`let`/`var` binding, class/object member).
 * - **R2 `raw-membership-comparison`** — a raw `extra.plan_id` /
 *   `extra["plan_id"]` strict comparison outside the shared module.
 * - **R3 `plan-scope-on-parent-id-proxy`** — a plan-scoped resolution keyed on
 *   the `parent_id` proxy (`parent_id === plan.id` / `=== planId`, and `!==`).
 *
 * ## Comments are STRIPPED before matching (deliberate, and a residual)
 *
 * `check-ordinal-write-sites.mjs` deliberately matches inside comments: prose
 * discussing `MAX(ordinal)+1` in a new file is a drift signal. THIS family is
 * the opposite. The shared module's own header, and the JSDoc of all nine call
 * sites, quote `extra.plan_id === planId` and `t.parent_id === plan.id`
 * VERBATIM as the documented rationale for the fix. Matching comments would
 * report those explanations as violations and force whole-file allowlist
 * entries for `ac-service.ts`, `corpus-service.ts`, `archive-candidates.ts` and
 * `task-workflow-service.ts` — the exact files whose CODE most needs the rule.
 * So comments and string literals are blanked (line structure preserved, so
 * reported line numbers stay exact) and every rule matches CODE only.
 *
 * Accepted residual: a commented-out copy of the predicate is invisible to R1.
 * That is the cheaper failure — a commented-out copy cannot change a query
 * result, and the loud-zero check below still proves each rule is live.
 *
 * ## Scope: exit 0 means "no COMPARISON-shaped site", never "the family is closed"
 * (task-plan-member-sites-twelve-and-thirteen-both-structurally)
 *
 * All three rules above match a syntactic COMPARISON (`===`/`!==`) or a
 * DEFINITION. Three shapes carry the exact same defect — a plan-scoped query
 * that answers from `parent_id` instead of `extra.plan_id` — while being
 * structurally invisible to every rule here, and each was measured and
 * deliberately NOT mechanized rather than silently left uncovered:
 *
 *   - **Map/Set lookup** (`slugById.get(task.parent_id)`,
 *     `activePlanIds.has(d.parent_id)`) — no `===`/`!==` token exists to match.
 *     Widening R3 to catch the `.has()` shape was measured and REJECTED: it
 *     flags legitimate `knowledge`/handoff groupings whose plan link genuinely
 *     IS `parent_id` (see R3's own JSDoc below), and because allowlisting here
 *     is BY FILE, admitting them would blind R3 to a real violation
 *     reintroduced in the same file.
 *   - **Store filter key** (`filters["parent_id"] = <a resolved plan id>`) —
 *     `lore list --plan-id`'s pre-fix shape (site 13). A key ASSIGNMENT, not a
 *     comparison; no rule here parses object literals or property writes.
 *   - **Store lookup by parent** (`store.find(task.parent_id)`) — site 10's
 *     shape. Measured at ~4% precision (11 tree-wide hits, 10 legitimate
 *     non-task parent resolutions: phase→plan, plan→spec, spec→prd, tree
 *     walks) — a rule at that precision would generate more allowlist entries
 *     than real findings.
 *
 * A reader who sees this script exit 0 and concludes "plan membership is
 * fully guarded" is trusting a scope this script never claimed. It closes the
 * residual `plan-membership.ts`'s own JSDoc names ("a second predicate
 * definition in disguise, or a raw comparison outside the shared module") —
 * nothing more.
 *
 * ## Loud-zero
 *
 * A path typo, a renamed field, or an over-aggressive comment strip must never
 * read as "clean". Exit 4 (never 0) when: a scan root is missing, zero files
 * are walked, or a RULE matches NOTHING anywhere in the tree — including inside
 * the files its own allowlist exempts. `plan-membership.ts` alone guarantees a
 * tree-wide match for R1 (`export function isPlanMember`) and R2
 * (`task.extra["plan_id"] === planId`); R3's tree-wide match is
 * `task-workflow-service.ts`'s divergence detector.
 *
 * Public surface: {@link RULES} (+ its `allowlist` arrays — the extension
 * point), {@link stripCommentsPreservingLines}, {@link isScannableSourceFile},
 * {@link collectViolationsInFile}, {@link scanRepo}, {@link main},
 * {@link PlanMembershipScanError}.
 *
 * Side-effect class: {@link stripCommentsPreservingLines} /
 * {@link collectViolationsInFile} are pure; {@link scanRepo} reads the file
 * tree; {@link main} reads the tree and writes to stdout/stderr.
 *
 * Exit codes (identical numbering to `check-ordinal-write-sites.mjs` — no new
 * scheme):
 *   0 — no violations outside the allowlists.
 *   3 — one or more violations, each printed as `file:line: <rule> — <text>`.
 *   4 — the scan itself could not measure what it claims to (missing root, zero
 *       files walked, a rule that matches nothing tree-wide). NEVER silent.
 *
 * ⛔ `main` RETURNS its exit code and calls `process.exit` only under
 * `import.meta.main` — unlike `check-no-nul-bytes.ts`, precondition failures
 * are caught INSIDE `main` and returned as 4 rather than thrown, because this
 * oracle's contract requires the loud-zero exit VALUE to be assertable from a
 * test (`expect(main(emptyDir)).toBe(4)`). {@link scanRepo} still throws
 * {@link PlanMembershipScanError} for callers that want the typed failure.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The single definition site of the shared predicate — POSIX-style, repo-root-relative. */
export const SHARED_PREDICATE_MODULE = "packages/lore/src/service/plan-membership.ts";

/**
 * Source roots scanned, repo-root-relative. `packages/core/src` is here
 * deliberately: `isplanmember-single-definition.test.ts` scans
 * `packages/lore/src` only, and `packages/core/src/archive-candidates.ts`
 * already reasons about plan membership in prose.
 */
export const SCAN_ROOTS = ["packages/lore/src", "packages/core/src"] as const;

/**
 * A file exempted from ONE rule, with the adjudication that exempts it.
 * ⛔ `file` exempts that file from the rule ENTIRELY — never add an entry to
 * silence prose or a formatting artifact; strip/reword the source instead.
 */
export interface PlanMembershipAllowlistEntry {
  /** Repo-root-relative POSIX path. */
  readonly file: string;
  /** Why this file is permitted to contain the pattern. Required, prose. */
  readonly reason: string;
}

/** One syntactic form a rule recognises. `pattern` is per-LINE and non-global (no `lastIndex` state). */
export interface PlanMembershipPattern {
  /** Grep-friendly name of the form, e.g. `arrow-or-value-binding`. */
  readonly form: string;
  readonly pattern: RegExp;
}

/** One rule: a set of syntactic forms plus the files adjudicated to be allowed to contain them. */
export interface PlanMembershipRule {
  /** Printed verbatim in every violation line. */
  readonly name: string;
  /** One-sentence statement of the property the rule protects. */
  readonly what: string;
  readonly patterns: readonly PlanMembershipPattern[];
  readonly allowlist: readonly PlanMembershipAllowlistEntry[];
}

/** One reported occurrence. `text` is the ORIGINAL (un-stripped) source line, trimmed. */
export interface PlanMembershipViolation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly form: string;
  readonly text: string;
}

/**
 * Loud precondition failure — a state in which this oracle CANNOT measure what
 * it claims to, so "no violations found" would be a lie. Surfaces as exit 4.
 */
export class PlanMembershipScanError extends Error {
  /** Machine-readable cause: which loud-zero condition tripped. */
  readonly reason: "missing-root" | "no-files-walked" | "rule-matches-nothing" | "unreadable-file";

  constructor(
    reason: "missing-root" | "no-files-walked" | "rule-matches-nothing" | "unreadable-file",
    message: string,
  ) {
    super(message);
    this.name = "PlanMembershipScanError";
    this.reason = reason;
  }
}

// ─── R1 ─────────────────────────────────────────────────────────────────────

/**
 * A second definition of the predicate, in any form. The existing single-
 * definition test only sees form (a); (b) is the arrow-const the task doc names
 * as gap 1, and (c)/(d) are the class/object-member forms.
 */
const RULE_SECOND_PREDICATE_DEFINITION: PlanMembershipRule = {
  name: "second-predicate-definition",
  what: "isPlanMember has exactly ONE definition site, in the shared module",
  patterns: [
    // (a) `function isPlanMember` / `export function isPlanMember` / `async function …`
    { form: "function-declaration", pattern: /\bfunction\s+isPlanMember\b/ },
    // (b) `const isPlanMember = …` / `let` / `var`, incl. an annotated binding
    //     (`const isPlanMember: (t, p) => boolean = …`).
    { form: "arrow-or-value-binding", pattern: /\b(?:const|let|var)\s+isPlanMember\s*[=:]/ },
    // (c) class/object method shorthand — anchored at line start (after
    //     modifiers) so an ordinary CALL wrapped onto its own line by the
    //     formatter (`  isPlanMember(t, plan.id),`) is the only false-positive
    //     shape, and it is loud + trivially adjudicated rather than silent.
    {
      form: "member-method-shorthand",
      pattern: /^[ \t]*(?:(?:private|public|protected|static|readonly|async|get|set)[ \t]+)*isPlanMember[ \t]*\(/,
    },
    // (d) object-literal property or interface member: `isPlanMember: (t, p) => …`
    { form: "member-property", pattern: /(?<![\w$])isPlanMember[ \t]*:/ },
  ],
  allowlist: [
    {
      file: SHARED_PREDICATE_MODULE,
      reason:
        "THE definition site. `export function isPlanMember(task, planId)` — the codebase's only " +
        "definition, consolidated from three byte-identical copies at 3577660 and pinned by " +
        "packages/lore/tests/unit/service/isplanmember-single-definition.test.ts.",
    },
  ],
};

// ─── R2 ─────────────────────────────────────────────────────────────────────

/**
 * A raw `extra.plan_id` strict comparison outside the shared module — the
 * companion grep the shared module's JSDoc names but nothing ran.
 */
const RULE_RAW_MEMBERSHIP_COMPARISON: PlanMembershipRule = {
  name: "raw-membership-comparison",
  what: "membership is tested through isPlanMember, never by comparing extra.plan_id inline",
  patterns: [
    // Field on the LEFT: `t.extra["plan_id"] === planId`, `doc.extra.plan_id !== x`,
    // including optional chaining (`extra?.["plan_id"]`, `extra?.plan_id`).
    // reason: the two access spellings are separate alternatives because `?.`
    // IS the dot — an earlier `(?:\?\.)?\s*\.\s*plan_id` shape required BOTH and
    // was therefore inert for `extra?.plan_id ===` (caught by this rule's
    // canonical-example table, which is why every form has one).
    {
      form: "field-left",
      pattern: /\bextra\s*(?:(?:\?\.|\.)\s*plan_id|(?:\?\.)?\s*\[\s*["']plan_id["']\s*\])\s*(?:===|!==)/,
    },
    // Field on the RIGHT: `planId === t.extra["plan_id"]` — the same defect
    // written the other way round, which a left-only pattern would miss.
    {
      form: "field-right",
      pattern:
        /(?:===|!==)\s*(?:[A-Za-z_$][\w$]*\s*\??\.\s*)*extra\s*(?:(?:\?\.|\.)\s*plan_id|(?:\?\.)?\s*\[\s*["']plan_id["']\s*\])/,
    },
  ],
  allowlist: [
    {
      file: SHARED_PREDICATE_MODULE,
      reason:
        "THE comparison. `return task.extra[\"plan_id\"] === planId;` is the predicate's body — " +
        "the one place the raw comparison is supposed to live.",
    },
    {
      file: "packages/lore/src/service/export-docs-service.ts",
      reason:
        "STRING NARROWING, not a membership test: `typeof doc.extra[\"plan_id\"] === \"string\"` " +
        "narrows a task's declared plan id so it can be used as an `index.mappings` KEY. It has " +
        "no planId to compare against; routing it through isPlanMember would be a type error, " +
        "not a de-duplication. Adjudicated in plan-membership.ts's own JSDoc (Proxy section).",
    },
  ],
};

// ─── R3 ─────────────────────────────────────────────────────────────────────

/**
 * A plan-scoped resolution keyed on the `parent_id` PROXY. This is the shape of
 * the eight-site sweep, the ninth site, and (measured 2026-08-03, since fixed
 * by task-the-eleventh-plan-member-site-found-by-enumeration) the eleventh
 * site in `session-service.ts`'s `bootstrap`.
 *
 * ## Why the right-hand side is anchored at an identifier STARTING with `plan`
 *
 * The obvious generalisation — flag `parent_id === <anything containing "plan">`
 * — was measured against this tree and REJECTED. It matches
 * `session-service.ts`'s `doc.parent_id !== scopePlan.id` (line 630) and
 * `planIds.has(pair.doc.parent_id)` (lines 352/379), which are all LEGITIMATE:
 * those docs are `knowledge`/handoff docs, and a handoff has no
 * `extra.plan_id` — its `parent_id` IS its plan link (stated in
 * `packages/core/src/archive-candidates.ts`'s header). Since allowlisting is
 * BY FILE, admitting those three would have required exempting
 * `session-service.ts` WHOLESALE, which at measurement time would have blinded
 * this rule to the one REAL violation then present in that same file
 * (`bootstrap`'s `d.parent_id === plan.id`, since fixed by
 * task-the-eleventh-plan-member-site-found-by-enumeration). The risk is not
 * merely historical: a by-file allowlist blinds this rule to ANY
 * comparison-shaped violation reintroduced in that same file for as long as
 * the exemption stands, which is why a narrower rule that reports the true
 * site still beats a wider rule whose allowlist hides it.
 *
 * Accepted residual (documented, not silent): a task-membership comparison
 * against a plan variable NOT named `plan…` (e.g. `owningPlan.id`, `p.id`) is
 * invisible to this rule. Closing it needs the doc TYPE, which no grep can see.
 * The same limit is why the tenth site
 * (`task-the-tenth-plan-member-site-is-a-write-path-create-time`:
 * create-time `extra.phase` validation resolving the plan via
 * `store.find(<x>.parent_id)`) is NOT reachable by any rule here — measured: a
 * `store.find(…parent_id)` rule flags 11 sites of which 10 are legitimate
 * non-task parent resolutions (phase→plan, plan→spec, spec→prd, tree walks),
 * ~4% precision.
 */
const RULE_PLAN_SCOPE_ON_PARENT_ID_PROXY: PlanMembershipRule = {
  name: "plan-scope-on-parent-id-proxy",
  what: "a plan-scoped task query keys on extra.plan_id (isPlanMember), never on the parent_id proxy",
  patterns: [
    // `t.parent_id === plan.id`, `d.parent_id !== planId`, `x.parent_id === this.plan.id`,
    // `parent_id === planDoc.id`, `parent_id === plan_id`. `\bplan` refuses
    // `scopePlan.id` by design (see this rule's JSDoc).
    {
      form: "proxy-comparison-left",
      pattern: /\bparent_id\s*(?:===|!==)\s*(?:[A-Za-z_$][\w$]*\s*\??\.\s*)*\bplan[\w$]*(?:\s*\??\.\s*id)?\b/i,
    },
    // The reversed spelling of the same comparison: `plan.id === t.parent_id`.
    {
      form: "proxy-comparison-right",
      pattern: /\bplan[\w$]*(?:\s*\??\.\s*id)?\s*(?:===|!==)\s*(?:[A-Za-z_$][\w$]*\s*\??\.\s*)*parent_id\b/i,
    },
  ],
  allowlist: [
    {
      file: "packages/lore/src/service/task-workflow-service.ts",
      reason:
        "THE DIVERGENCE DETECTOR: `(t) => t.parent_id === plan.id && !isPlanMember(t, plan.id)` " +
        "deliberately compares BOTH keys — finding tasks parented under a plan they are not " +
        "members of is its entire purpose, and it already routes membership through the shared " +
        "predicate. It is the one legitimate use of the proxy comparison and must stay.",
    },
  ],
};

/** Every rule, in report order. Loud-zero applies to each independently. */
export const RULES: readonly PlanMembershipRule[] = [
  RULE_SECOND_PREDICATE_DEFINITION,
  RULE_RAW_MEMBERSHIP_COMPARISON,
  RULE_PLAN_SCOPE_ON_PARENT_ID_PROXY,
];

// ─── Comment stripping ──────────────────────────────────────────────────────

/**
 * Blanks every COMMENT, replacing its characters with spaces so byte offsets
 * and line numbers are preserved exactly.
 *
 * A deliberately small state machine, not a JS tokenizer: it tracks line
 * comments, block comments, and the three quote forms (handling `\` escapes),
 * and self-heals a mis-detected single/double-quoted string at the newline
 * (an unescaped JS string cannot span lines). Regex literals are NOT tracked —
 * a `/` followed by `/` or `*` inside a regex would need to be escaped or
 * inside a character class to reach here, and the loud-zero check catches a
 * catastrophic over-strip (a rule that suddenly matches nothing tree-wide).
 * Accepted residual: a lone `"` or `'` inside a regex character class (e.g.
 * `/["']/`) opens a phantom quote state, so a trailing `//` comment on THAT
 * line is not stripped. Bounded to the one line (quote state resets at the
 * newline) and it can only ever cause a LOUD, adjudicable false positive from
 * comment prose — never a missed violation. Measured zero occurrences in the
 * scanned tree at authoring time.
 *
 * ⛔ String literals are TRACKED but NOT blanked, and that asymmetry is
 * load-bearing: quote state is needed so a `//` inside a string (`"https://…"`)
 * is not read as a comment start, but the CONTENT must survive because R2's
 * primary form IS a string — `task.extra["plan_id"] === planId`. Blanking
 * strings silently disarms that rule (its tree-wide match count drops to zero,
 * which the loud-zero check then reports as exit 4).
 *
 * @param source - one file's full text
 * @returns the same text, same length and line count, comments blanked
 * @throws PlanMembershipScanError when a block comment never terminates —
 *   that means the strip consumed the rest of the file, so any "clean" verdict
 *   for it would be unmeasured
 * @example
 * stripCommentsPreservingLines('a // extra.plan_id === x\n') // => 'a                       \n'
 */
export function stripCommentsPreservingLines(source: string): string {
  const out = source.split("");
  const blank = (index: number): void => {
    if (out[index] !== "\n") out[index] = " ";
  };

  type ScanState = "code" | "line-comment" | "block-comment" | "single" | "double" | "template";
  let state: ScanState = "code";
  let blockCommentStartLine = 0;
  let line = 1;

  for (let index = 0; index < source.length; index++) {
    const char = source[index] as string;
    const next = index + 1 < source.length ? (source[index + 1] as string) : "";

    if (char === "\n") {
      line++;
      // A line comment ends at the newline; a mis-detected single/double-quoted
      // string self-heals here (a real one cannot span a raw newline).
      if (state === "line-comment" || state === "single" || state === "double") state = "code";
      continue;
    }

    switch (state) {
      case "code":
        if (char === "/" && next === "/") {
          state = "line-comment";
          blank(index);
        } else if (char === "/" && next === "*") {
          state = "block-comment";
          blockCommentStartLine = line;
          blank(index);
        } else if (char === "'") {
          state = "single";
        } else if (char === '"') {
          state = "double";
        } else if (char === "`") {
          state = "template";
        }
        break;

      case "line-comment":
        blank(index);
        break;

      case "block-comment":
        blank(index);
        if (char === "*" && next === "/") {
          blank(index + 1);
          index++;
          state = "code";
        }
        break;

      case "single":
      case "double":
      case "template": {
        // reason: string content is deliberately NOT blanked — see this
        // function's JSDoc. Only the quote STATE matters here.
        if (char === "\\") {
          // Escape: consume the escaped character too, so `\'` never closes.
          if (index + 1 < source.length) {
            if (source[index + 1] === "\n") line++;
            index++;
          }
          break;
        }
        const closer = state === "single" ? "'" : state === "double" ? '"' : "`";
        if (char === closer) state = "code";
        break;
      }
    }
  }

  if (state === "block-comment") {
    throw new PlanMembershipScanError(
      "unreadable-file",
      `unterminated block comment starting at line ${blockCommentStartLine} — the comment strip ` +
        "consumed the rest of the file, so no verdict for it is measurable",
    );
  }

  return out.join("");
}

// ─── Tree walk ──────────────────────────────────────────────────────────────

/**
 * True for a source file this oracle scans. Excludes both test conventions
 * (`*.test.ts` vitest, `*.bun.test.ts` bun), declaration files, and the
 * `tests`/`generated`/`node_modules` directories.
 *
 * @param relPath - repo-root-relative POSIX path
 * @example isScannableSourceFile("packages/core/src/schemas.ts") // => true
 */
export function isScannableSourceFile(relPath: string): boolean {
  if (!relPath.endsWith(".ts") && !relPath.endsWith(".mts") && !relPath.endsWith(".cts")) return false;
  if (relPath.endsWith(".test.ts") || relPath.endsWith(".bun.test.ts") || relPath.endsWith(".d.ts")) return false;
  const segments = relPath.split("/");
  return !segments.includes("tests") && !segments.includes("generated") && !segments.includes("node_modules");
}

/**
 * Reads one directory's entries.
 *
 * reason: the return type is INFERRED, never annotated — `readdirSync` is
 * overloaded on its options and an explicit `ReturnType<typeof readdirSync>`
 * resolves to the Buffer-name overload (`Dirent<NonSharedBuffer>`), which makes
 * `entry.name` a Buffer and every string comparison below a type error.
 *
 * @throws PlanMembershipScanError when the directory cannot be read — never
 *   degrades to "found nothing here"
 */
function readDirectoryEntries(absDir: string) {
  try {
    return readdirSync(absDir, { withFileTypes: true });
  } catch (error) {
    throw new PlanMembershipScanError(
      "unreadable-file",
      `cannot read directory ${absDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Recursively walks `absDir`, returning repo-root-relative POSIX paths of scannable files. */
function walkSourceFiles(repoRoot: string, absDir: string): string[] {
  const out: string[] = [];
  for (const entry of readDirectoryEntries(absDir)) {
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      out.push(...walkSourceFiles(repoRoot, abs));
    } else if (entry.isFile()) {
      const rel = relative(repoRoot, abs).split(sep).join("/");
      if (isScannableSourceFile(rel)) out.push(rel);
    }
  }
  return out;
}

// ─── Matching ───────────────────────────────────────────────────────────────

/**
 * Finds every rule occurrence in ONE file's source, ignoring allowlists (the
 * caller decides what to do with them — {@link scanRepo} needs the unfiltered
 * set for its loud-zero check).
 *
 * At most one violation per (line, rule): the FIRST matching form wins, so a
 * line matching two spellings of the same rule is reported once.
 *
 * @param relPath - repo-root-relative POSIX path, echoed into each violation
 * @param source - the file's full, UN-stripped text
 * @param rules - defaults to {@link RULES}; injectable for fixture-driven tests
 * @returns violations in ascending line order, rules in {@link RULES} order
 * @throws PlanMembershipScanError from the comment strip on an unterminated block comment
 * @example
 * collectViolationsInFile("a.ts", 'const isPlanMember = (t, p) => t.extra["plan_id"] === p;\n')
 * // => two violations: second-predicate-definition + raw-membership-comparison
 */
export function collectViolationsInFile(
  relPath: string,
  source: string,
  rules: readonly PlanMembershipRule[] = RULES,
): PlanMembershipViolation[] {
  const originalLines = source.split("\n");
  const codeLines = stripCommentsPreservingLines(source).split("\n");

  const violations: PlanMembershipViolation[] = [];
  for (const rule of rules) {
    for (let index = 0; index < codeLines.length; index++) {
      const codeLine = codeLines[index] as string;
      const matched = rule.patterns.find((candidate) => candidate.pattern.test(codeLine));
      if (matched === undefined) continue;
      violations.push({
        file: relPath,
        line: index + 1,
        rule: rule.name,
        form: matched.form,
        // reason: the ORIGINAL line, not the stripped one — a reader needs the
        // real source, and the stripped line can be mostly blanks.
        text: (originalLines[index] ?? "").trim().slice(0, 160),
      });
    }
  }
  return violations;
}

/** What {@link scanRepo} measured — the numbers {@link main} reports and tests assert on. */
export interface PlanMembershipScanReport {
  /** Every scanned file, repo-root-relative POSIX, in walk order. */
  readonly files: readonly string[];
  /** Violations OUTSIDE the per-rule allowlists. */
  readonly violations: readonly PlanMembershipViolation[];
  /** Per-rule tree-wide match count INCLUDING allowlisted files — the loud-zero evidence. */
  readonly treeWideMatchCounts: Readonly<Record<string, number>>;
}

/**
 * Walks {@link SCAN_ROOTS} under `repoRoot`, matches every rule, and separates
 * allowlisted occurrences from violations.
 *
 * @param repoRoot - absolute path to scan; defaults to this script's repo root
 * @param rules - defaults to {@link RULES}; injectable for fixture-driven tests
 * @returns the scan report
 * @throws PlanMembershipScanError on every loud-zero condition: a missing scan
 *   root, zero files walked, an unreadable file, or a rule with zero tree-wide
 *   matches (a path typo or renamed field must never read as "clean")
 */
export function scanRepo(
  repoRoot: string = REPO_ROOT,
  rules: readonly PlanMembershipRule[] = RULES,
): PlanMembershipScanReport {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const absRoot = join(repoRoot, root);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(absRoot).isDirectory();
    } catch {
      // reason: NOT a swallowed error — every failure to stat the root (missing,
      // permission, not a directory) funnels into the loud throw immediately
      // below. There is no path from here to a "clean" verdict.
      isDirectory = false;
    }
    if (!isDirectory) {
      throw new PlanMembershipScanError(
        "missing-root",
        `scan root '${root}' does not exist under ${repoRoot} — a grep over a missing path returns ` +
          "zero matches, which is indistinguishable from a clean tree",
      );
    }
    files.push(...walkSourceFiles(repoRoot, absRoot));
  }

  if (files.length === 0) {
    throw new PlanMembershipScanError(
      "no-files-walked",
      `walked ${SCAN_ROOTS.length} scan root(s) under ${repoRoot} and found zero scannable source ` +
        "files — refusing to report a tree nobody read as clean",
    );
  }

  const treeWideMatchCounts: Record<string, number> = Object.fromEntries(rules.map((rule) => [rule.name, 0]));
  const violations: PlanMembershipViolation[] = [];

  for (const relPath of files) {
    const abs = join(repoRoot, relPath);
    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch (error) {
      throw new PlanMembershipScanError(
        "unreadable-file",
        `cannot read ${relPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    for (const occurrence of collectViolationsInFile(relPath, content, rules)) {
      treeWideMatchCounts[occurrence.rule] = (treeWideMatchCounts[occurrence.rule] ?? 0) + 1;
      const rule = rules.find((candidate) => candidate.name === occurrence.rule);
      // reason: both defaults here fail SAFE, not silent — an occurrence whose
      // rule cannot be resolved counts as NOT allowlisted, so it is reported
      // rather than dropped. (`rules` is the same array the occurrence came
      // from, so neither default is reachable today.)
      const allowlisted = rule?.allowlist.some((entry) => entry.file === occurrence.file) ?? false;
      if (!allowlisted) violations.push(occurrence);
    }
  }

  const inertRules = rules.filter((rule) => (treeWideMatchCounts[rule.name] ?? 0) === 0);
  if (inertRules.length > 0) {
    throw new PlanMembershipScanError(
      "rule-matches-nothing",
      `${inertRules.length} rule(s) matched NOTHING anywhere in ${files.length} scanned file(s): ` +
        `${inertRules.map((rule) => rule.name).join(", ")}. Every rule must have at least one ` +
        "tree-wide match (allowlisted files count) — plan-membership.ts alone guarantees one for " +
        "second-predicate-definition and raw-membership-comparison. Zero means the pattern, the " +
        "field name, or the comment strip drifted, so a clean verdict would be unmeasured",
    );
  }

  return { files, violations, treeWideMatchCounts };
}

/**
 * CLI entrypoint — scans, prints, and reports the exit code.
 *
 * @param repoRoot - defaults to this script's own repo root; overridable so
 *   tests can point it at a throwaway fixture tree
 * @returns 0 clean / 3 violations found / 4 the scan could not measure
 * @example
 * if (main() !== 0) process.exitCode = 1;
 */
export function main(repoRoot: string = REPO_ROOT): number {
  let report: PlanMembershipScanReport;
  try {
    report = scanRepo(repoRoot);
  } catch (error) {
    process.stderr.write(
      `check:plan-member-sites could not run — ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 4;
  }

  if (report.violations.length > 0) {
    process.stderr.write(
      `\ncheck:plan-member-sites FAILED — ${report.violations.length} plan-membership site(s) outside ` +
        `the adjudicated allowlists:\n\n` +
        report.violations.map((v) => `  ${v.file}:${v.line}: ${v.rule} — ${v.text}`).join("\n") +
        "\n\nPlan membership IS `extra.plan_id` (SPEC-065 D4: `--plan-id P --parent Q` with P !== Q " +
        "is supported), so a `parent_id`-keyed plan query silently drops a diverged member. Route " +
        `membership through \`isPlanMember\` from ${SHARED_PREDICATE_MODULE} — do not re-implement ` +
        "the comparison. If a site is genuinely NOT a membership test, add it to that rule's " +
        "`allowlist` in scripts/check-plan-membership-sites.ts WITH a written reason (⛔ an entry " +
        "exempts the whole file from the rule — never add one to silence prose).\n",
    );
    return 3;
  }

  console.log(
    `check:plan-member-sites passed — ${report.files.length} source file(s) scanned across ` +
      `${SCAN_ROOTS.join(", ")}; ${RULES.length} rule(s) live (tree-wide matches: ` +
      `${RULES.map((rule) => `${rule.name}=${report.treeWideMatchCounts[rule.name] ?? 0}`).join(", ")}); ` +
      "zero sites outside the allowlists.",
  );
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}

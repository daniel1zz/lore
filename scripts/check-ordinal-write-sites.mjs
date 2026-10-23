#!/usr/bin/env node
/**
 * Ordinal-write-site grep oracle (SPEC-084 plan Invariant 2 restatement).
 *
 * SPEC-084's shipped store contract has exactly THREE sanctioned
 * ordinal-write sites (not the plan doc's originally-stated "exactly TWO"):
 *
 *   1. `StoreInterface.insertWithAllocatedOrdinal`  — INSERT-scoped MAX+1
 *      allocation (new numbered-type doc creation).
 *   2. `StoreInterface.allocateOrdinalForExisting`   — UPDATE-scoped MAX+1
 *      allocation (exempt→numbered kind-flip transition).
 *   3. `StoreInterface.assignOrdinalForRepair`       — SPEC-084 D7's
 *      targeted-assignment repair path (`lore migrate ordinals --apply`),
 *      never a MAX+1 allocation, but still a direct write to the `ordinal`
 *      column and therefore equally sanctioned/scoped.
 *
 * Both allocation sites (1, 2) delegate their retry mechanics to the SAME
 * shared seam, `allocateWithBoundedRetry` in `store-shared.ts` — see that
 * file's "SPEC-084 ordinal allocation" section. The DB partial unique index
 * `idx_docs_type_ordinal ON docs(type, ordinal) WHERE ordinal IS NOT NULL`
 * remains the sole uniqueness AUTHORITY; this oracle only guards where
 * allocation/assignment ARITHMETIC AND raw SQL WRITES to the column are
 * allowed to live in source, so a future contributor can't reintroduce a
 * second, un-reviewed MAX+1 (or blind UPDATE) call site elsewhere in the
 * tree without this script naming it.
 *
 * This oracle is a conservative ALLOWLIST-BY-FILE check, not a semantic
 * analyzer: it flags two textual patterns (allocation arithmetic and direct
 * SQL writes to the `ordinal` column) appearing ANYWHERE outside a fixed
 * list of sanctioned files — including inside comments, deliberately: a
 * comment in a new file discussing "MAX(ordinal)+1" is a signal that logic
 * is drifting away from the shared seam and is worth a human look.
 *
 * SANCTIONED_ORDINAL_WRITE_FILES is deliberately a plain exported array so
 * a future change (e.g. a landing `insertWithAllocatedOrdinalAndProvenance`
 * composite, or a new StoreInterface impl) can extend it with one line —
 * see the inline note below.
 *
 * ## Rule (c) — the MirrorHumanId cast-escape (SPEC-mirror-identifier-ssot D4)
 *
 * A THIRD, independent textual rule guards an unrelated field: the corpus→file
 * mirror's export-index `human_id`, branded `MirrorHumanId` in
 * `packages/core/src/ordinal.ts`. That brand has exactly ONE sanctioned escape
 * — the textual `as MirrorHumanId` cast (including the laundering
 * `as unknown as MirrorHumanId` double-cast) at the JSON parse boundary in
 * `packages/core/src/schemas.ts`. Every other producer of a `MirrorHumanId`
 * value narrows via the exported `assertIsMirrorHumanId` assertion function
 * instead of casting, so this rule's allowlist (`SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES`,
 * deliberately SEPARATE from `SANCTIONED_ORDINAL_WRITE_FILES` — the two rules
 * guard unrelated fields for unrelated reasons, and folding them into one set
 * would exempt `schemas.ts` from the ordinal-column rules for a reason that
 * has nothing to do with those rules) has exactly one member. Each rule now
 * carries its OWN `allowedFiles` set (see `ALL_RULES` below) rather than a
 * single file-level skip in `main()` — a single skip would have blinded rule
 * (c) on every file already on the ordinal-column allowlist (e.g.
 * `ordinal-migration-service.ts`), which is sanctioned for THAT rule but not
 * for this one.
 *
 * ## Public surface / why `main` returns instead of exiting
 *
 * `isScannableSourceFile` and `collectViolationsInFile` are pure (path/text in,
 * decision/violations out). `main(repoRoot)` is the IO shell: it walks the tree
 * under `repoRoot`, prints a report, and RETURNS the process exit code — it
 * never calls `process.exit` itself, and nothing at module scope has a side
 * effect, so importing this file scans nothing. The `import.meta.main` block at
 * the bottom is the only place that exits.
 *
 * That shape is what makes the guard ARMABLE (`task-three-of-five-static-
 * checkers-are-inert-no-exported-main`). Until it landed, `main()` was neither
 * exported nor return-based AND ran at module scope, so no test could import
 * this file at all — combined with no CI and a `hooks/pre-push` that runs only
 * `lore` checks, the guard had never once executed against this checkout.
 * `scripts/tests/check-ordinal-write-sites.test.ts` now calls `main()` with no
 * injected root on every `bun run test`; `repoRoot` is injectable so the same
 * tests can prove the scan actually FAILS on a fixture tree that violates the
 * rules (a guard proven only by its green is not proven at all).
 *
 * Usage:
 *   node scripts/check-ordinal-write-sites.mjs        # scan, exit 0/3
 *   bun run check:ordinal-sites                        # npm script wrapper
 *
 * Exit codes (unchanged by the arming refactor — callers read these):
 *   0 — no violations found outside the allowlist.
 *   3 — one or more violations found; each printed as `file:line: <rule> — <text>`.
 *   4 — the scan itself failed (unreadable path etc.) — never silent. `main`
 *       THROWS in this case; the entry block below is what maps it to 4.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(__filename, "..", "..");

/**
 * The ONLY files permitted to contain ordinal-allocation arithmetic
 * (`MAX(ordinal)` / `ordinal + 1`) or a direct SQL write to the `ordinal`
 * column (`SET ordinal = …`). Paths are POSIX-style, relative to repo root.
 *
 * Extend this array (never widen the regexes below) when a new sanctioned
 * write site lands — e.g. a landing `insertWithAllocatedOrdinalAndProvenance`
 * composite (a 4th possible sanctioned site tracked as separate in-flight
 * work at authoring time of this oracle) should either land inside one of
 * the store impl files already listed here, or add its own file to this
 * list with a one-line comment explaining why it's sanctioned.
 */
export const SANCTIONED_ORDINAL_WRITE_FILES = [
  // The 3 StoreInterface impls — insertWithAllocatedOrdinal,
  // allocateOrdinalForExisting, assignOrdinalForRepair, and their raw SQL.
  "packages/lore/src/store/sqlite-store.ts",
  "packages/lore/src/store/turso-store.ts",
  "packages/lore/src/store/in-memory-store.ts",
  // The shared bounded-retry seam BOTH allocation methods delegate to
  // (allocateWithBoundedRetry) — computes `base + 1 + attempt` candidates.
  "packages/lore/src/store/store-shared.ts",
  // StoreInterface's own method contracts — JSDoc documents the MAX(ordinal)
  // and repair-assignment semantics verbatim.
  "packages/lore/src/store/store-interface.ts",
  // Schema migration adding the `ordinal` column + partial unique index
  // (DDL only — `ALTER TABLE`/`CREATE UNIQUE INDEX`, never a value write).
  "packages/lore/src/store/migrations/migration-010.ts",
  // docs-table rebuild admitting type 'baseline' — copies `ordinal` verbatim row-for-row (no allocation).
  "packages/lore/src/store/migrations/migration-013.ts",
  // SPEC-084 D7's one-shot repair migration service — the sole caller of
  // `assignOrdinalForRepair`; its doc comments discuss the MAX+1 sites by
  // name to explain why THIS path deliberately avoids them.
  "packages/lore/src/service/ordinal-migration-service.ts",
];

const SANCTIONED_SET = new Set(SANCTIONED_ORDINAL_WRITE_FILES);

/**
 * The ONE file permitted to contain a textual `as MirrorHumanId` cast (or the
 * laundering `as unknown as MirrorHumanId`) — the `.lore/export-index.json`
 * JSON-parse boundary in `exportIndexMappingSchema` (SPEC-mirror-identifier-ssot
 * D4). Deliberately a SEPARATE array from {@link SANCTIONED_ORDINAL_WRITE_FILES}
 * (see the module header's "Rule (c)" section) even though it is used the same
 * way (as a per-rule `allowedFiles` set) — the two allowlists guard unrelated
 * fields and must be able to diverge independently.
 */
export const SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES = ["packages/core/src/schemas.ts"];

const MIRROR_HUMAN_ID_CAST_ALLOWED_SET = new Set(SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES);

/** Rule (a): MAX(ordinal)-style allocation arithmetic. Sanctioned only in the ordinal-column allowlist. */
const RULE_MAX_ORDINAL = {
  name: "ordinal-allocation-arithmetic",
  pattern: /MAX\s*\(\s*ordinal\s*\)/gi,
  allowedFiles: SANCTIONED_SET,
};

/** Rule (a): `ordinal + 1`-style increment arithmetic (parenthesis-free form). Sanctioned only in the ordinal-column allowlist. */
const RULE_ORDINAL_PLUS_ONE = {
  name: "ordinal-allocation-arithmetic",
  pattern: /\bordinal\s*\+\s*1\b/gi,
  allowedFiles: SANCTIONED_SET,
};

/** Rule (b): a raw SQL `SET ordinal = …` write. Sanctioned only in the ordinal-column allowlist. */
const RULE_SQL_SET_ORDINAL = {
  name: "ordinal-direct-sql-write",
  pattern: /\bSET\s+ordinal\s*=/gi,
  allowedFiles: SANCTIONED_SET,
};

/**
 * Rule (b): a raw SQL `INSERT INTO docs (...)` statement whose column list
 * mentions `ordinal`. Matched over the WHOLE file content (not line-by-line)
 * because `INSERT INTO docs` statements in this codebase are always
 * multi-line template literals — a per-line scan would miss the column list
 * entirely. The window is bounded (600 chars) so an unrelated later mention
 * of "ordinal" much further down the file is never misattributed to an
 * INSERT statement above it. Sanctioned only in the ordinal-column allowlist.
 */
const RULE_SQL_INSERT_ORDINAL = {
  name: "ordinal-direct-sql-write",
  pattern: /INSERT\s+INTO\s+docs[\s\S]{0,600}?\bordinal\b/gi,
  allowedFiles: SANCTIONED_SET,
};

/**
 * Rule (c): an `as MirrorHumanId` cast, including the laundering
 * `as unknown as MirrorHumanId` double-cast (the `unknown as ` portion is
 * OPTIONAL in the pattern so both forms are caught by one rule). Case-sensitive
 * — `MirrorHumanId` is a specific TypeScript identifier, not a prose phrase — and
 * sanctioned ONLY in `SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES` (D4), a narrower and
 * INDEPENDENT allowlist from the ordinal-column rules above.
 */
const RULE_MIRROR_HUMAN_ID_CAST = {
  name: "mirror-human-id-unsanctioned-cast",
  pattern: /\bas\s+(?:unknown\s+as\s+)?MirrorHumanId\b/g,
  allowedFiles: MIRROR_HUMAN_ID_CAST_ALLOWED_SET,
};

const ALL_RULES = [
  RULE_MAX_ORDINAL,
  RULE_ORDINAL_PLUS_ONE,
  RULE_SQL_SET_ORDINAL,
  RULE_SQL_INSERT_ORDINAL,
  RULE_MIRROR_HUMAN_ID_CAST,
];

/**
 * True for source `.ts`/`.mts`/`.cts` files we want to scan — excludes tests,
 * declaration files, generated code and vendored dependencies. Pure.
 *
 * @param {string} relPath - repo-root-relative POSIX path
 * @returns {boolean}
 */
export function isScannableSourceFile(relPath) {
  if (!relPath.endsWith(".ts") && !relPath.endsWith(".mts") && !relPath.endsWith(".cts")) {
    return false;
  }
  if (relPath.endsWith(".test.ts") || relPath.endsWith(".bun.test.ts") || relPath.endsWith(".d.ts")) {
    return false;
  }
  const segments = relPath.split(sep);
  if (segments.includes("tests") || segments.includes("generated") || segments.includes("node_modules")) {
    return false;
  }
  return true;
}

/**
 * Recursively walks `dir`, returning `repoRoot`-relative POSIX paths of scannable
 * files. `repoRoot` is threaded explicitly (rather than read from the module-level
 * constant) so an injected fixture tree's paths are relativised against ITS root —
 * the allowlist compares repo-root-relative keys, so a walker hard-wired to the
 * real repo root would emit paths that could never match.
 *
 * @param {string} dir - absolute directory to walk
 * @param {string} repoRoot - absolute root the returned paths are relative to
 * @returns {string[]}
 */
function walkSourceFiles(dir, repoRoot) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    throw new Error(`cannot read directory ${dir}: ${e instanceof Error ? e.message : String(e)}`);
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      out.push(...walkSourceFiles(abs, repoRoot));
    } else if (entry.isFile()) {
      const rel = relative(repoRoot, abs).split(sep).join("/");
      if (isScannableSourceFile(rel)) out.push(rel);
    }
  }
  return out;
}

/**
 * Every `packages/*\/src` root that currently exists under `repoRoot`.
 *
 * @param {string} repoRoot - absolute repo (or fixture) root
 * @returns {string[]} absolute `src` directory paths
 */
function findPackageSrcRoots(repoRoot) {
  const packagesDir = join(repoRoot, "packages");
  const roots = [];
  let packageEntries;
  try {
    packageEntries = readdirSync(packagesDir, { withFileTypes: true });
  } catch (e) {
    // Loud, with the path: an unreadable/absent packages dir means this oracle
    // scanned NOTHING, which must never be reported as a clean tree.
    throw new Error(
      `cannot read packages directory ${packagesDir}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  for (const entry of packageEntries) {
    if (!entry.isDirectory()) continue;
    const srcDir = join(packagesDir, entry.name, "src");
    try {
      if (statSync(srcDir).isDirectory()) roots.push(srcDir);
    } catch {
      // no src/ dir for this package — skip, not an error.
    }
  }
  return roots;
}

/** Computes the 1-based line number of a character offset within `content`. */
function lineNumberAt(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/**
 * Every rule violation in one file's text, in rule order. Pure — no IO, and no
 * regex `lastIndex` leaks between calls (each rule's index is reset on entry),
 * so the same input always yields the same result.
 *
 * Each rule carries its OWN `allowedFiles` set (see `ALL_RULES` above) — a rule
 * is skipped ENTIRELY for `relPath` when that path is in the rule's own
 * allowlist, never a single global file-level skip. That is what lets rule (c)
 * (the MirrorHumanId cast-escape) keep scanning a file that is sanctioned for
 * the UNRELATED ordinal-column rules (a)/(b), and vice versa.
 *
 * @param {string} relPath - repo-root-relative POSIX path, echoed into each violation
 * @param {string} content - the file's full text
 * @returns {{file: string, line: number, rule: "ordinal-allocation-arithmetic" | "ordinal-direct-sql-write" | "mirror-human-id-unsanctioned-cast", snippet: string}[]}
 *   — the typed surface TypeScript callers see is `check-ordinal-write-sites.d.mts`;
 *   keep the two in sync.
 */
export function collectViolationsInFile(relPath, content) {
  const violations = [];
  for (const rule of ALL_RULES) {
    if (rule.allowedFiles?.has(relPath)) continue; // sanctioned site for THIS rule specifically
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(content)) !== null) {
      const line = lineNumberAt(content, match.index);
      const snippet = match[0].replace(/\s+/g, " ").trim().slice(0, 120);
      violations.push({ file: relPath, line, rule: rule.name, snippet });
      if (match.index === rule.pattern.lastIndex) rule.pattern.lastIndex++; // avoid zero-width infinite loop
    }
  }
  return violations;
}

/**
 * Scans every `packages/*\/src` tree under `repoRoot`, prints a report, and
 * RETURNS the process exit code (0 clean / 3 violations found). Never calls
 * `process.exit` — the `import.meta.main` block below is the only place that
 * does — so this stays directly callable from a test (mirrors
 * `check-no-nul-bytes.ts::main`).
 *
 * @param {string} [repoRoot] - root to scan; defaults to this checkout's own root
 * @returns {number} 0 (clean) or 3 (violations found)
 * @throws {Error} when the scan itself cannot run (unreadable directory) — the
 *   caller maps this to exit 4; it is never reported as a clean tree
 */
export function main(repoRoot = REPO_ROOT) {
  const srcRoots = findPackageSrcRoots(repoRoot);
  const files = srcRoots.flatMap((root) => walkSourceFiles(root, repoRoot));

  // No file-level short-circuit here (deliberately, see the module header's "Rule (c)"
  // section) — every file is handed to collectViolationsInFile, and EACH rule decides for
  // itself (via its own `allowedFiles`) whether relPath is exempt from THAT rule. A single
  // global skip would blind rule (c) on files sanctioned only for rules (a)/(b), and vice versa.
  const violations = [];
  for (const relPath of files) {
    const abs = join(repoRoot, relPath);
    const content = readFileSync(abs, "utf8");
    violations.push(...collectViolationsInFile(relPath, content));
  }

  if (violations.length > 0) {
    console.error(
      `check-ordinal-write-sites: found ${violations.length} violation(s) outside their rule's sanctioned allowlist:\n`,
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}: [${v.rule}] ${v.snippet}`);
    }
    console.error(
      `\nOrdinal-allocation arithmetic / direct SQL writes to the 'ordinal' column may only appear in:\n` +
        SANCTIONED_ORDINAL_WRITE_FILES.map((f) => `  - ${f}`).join("\n") +
        `\n\nAn 'as MirrorHumanId' (or laundering 'as unknown as MirrorHumanId') cast may only appear in:\n` +
        SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES.map((f) => `  - ${f}`).join("\n") +
        `\n\nEither move the offending logic into one of the sanctioned files for its rule, or — if this is a` +
        ` genuinely new sanctioned site — extend the matching allowlist in scripts/check-ordinal-write-sites.mjs.`,
    );
    return 3;
  }

  console.log(
    `check-ordinal-write-sites: OK — ordinal-allocation arithmetic and direct SQL writes to 'ordinal' are` +
      ` confined to ${SANCTIONED_ORDINAL_WRITE_FILES.length} sanctioned file(s), and every 'as MirrorHumanId'` +
      ` cast is confined to ${SANCTIONED_MIRROR_HUMAN_ID_CAST_FILES.length} sanctioned file(s). Scanned ${files.length} source file(s).`,
  );
  return 0;
}

/**
 * `import.meta.main` is Node >= 24.2 (and every Bun release). Guarding on it
 * ALONE would leave this CLI silently INERT under an older Node — no output,
 * exit 0, indistinguishable from a clean scan, which is the precise failure this
 * script's own arming task exists to eliminate. The portable `process.argv[1]`
 * comparison is therefore the fallback whenever the property is absent
 * (`undefined`), never when it is a real `false` (an import).
 */
const isDirectRun = import.meta.main ?? resolve(process.argv[1] ?? "") === __filename;

if (isDirectRun) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(`check-ordinal-write-sites: scan failed — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(4);
  }
}

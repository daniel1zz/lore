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
 * Usage:
 *   node scripts/check-ordinal-write-sites.mjs        # scan, exit 0/3
 *   bun run check:ordinal-sites                        # npm script wrapper
 *
 * Exit codes:
 *   0 — no violations found outside the allowlist.
 *   3 — one or more violations found; each printed as `file:line: <rule> — <text>`.
 *   4 — the scan itself failed (unreadable path etc.) — never silent.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
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
  // SPEC-084 D7's one-shot repair migration service — the sole caller of
  // `assignOrdinalForRepair`; its doc comments discuss the MAX+1 sites by
  // name to explain why THIS path deliberately avoids them.
  "packages/lore/src/service/ordinal-migration-service.ts",
];

const SANCTIONED_SET = new Set(SANCTIONED_ORDINAL_WRITE_FILES);

/** Rule (a): MAX(ordinal)-style allocation arithmetic. */
const RULE_MAX_ORDINAL = {
  name: "ordinal-allocation-arithmetic",
  pattern: /MAX\s*\(\s*ordinal\s*\)/gi,
};

/** Rule (a): `ordinal + 1`-style increment arithmetic (parenthesis-free form). */
const RULE_ORDINAL_PLUS_ONE = {
  name: "ordinal-allocation-arithmetic",
  pattern: /\bordinal\s*\+\s*1\b/gi,
};

/** Rule (b): a raw SQL `SET ordinal = …` write. */
const RULE_SQL_SET_ORDINAL = {
  name: "ordinal-direct-sql-write",
  pattern: /\bSET\s+ordinal\s*=/gi,
};

/**
 * Rule (b): a raw SQL `INSERT INTO docs (...)` statement whose column list
 * mentions `ordinal`. Matched over the WHOLE file content (not line-by-line)
 * because `INSERT INTO docs` statements in this codebase are always
 * multi-line template literals — a per-line scan would miss the column list
 * entirely. The window is bounded (600 chars) so an unrelated later mention
 * of "ordinal" much further down the file is never misattributed to an
 * INSERT statement above it.
 */
const RULE_SQL_INSERT_ORDINAL = {
  name: "ordinal-direct-sql-write",
  pattern: /INSERT\s+INTO\s+docs[\s\S]{0,600}?\bordinal\b/gi,
};

const ALL_RULES = [
  RULE_MAX_ORDINAL,
  RULE_ORDINAL_PLUS_ONE,
  RULE_SQL_SET_ORDINAL,
  RULE_SQL_INSERT_ORDINAL,
];

/** True for source `.ts` files we want to scan — excludes tests and generated code. */
function isScannableSourceFile(relPath) {
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

/** Recursively walks `dir`, returning repo-root-relative POSIX paths of scannable files. */
function walkSourceFiles(dir) {
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
      out.push(...walkSourceFiles(abs));
    } else if (entry.isFile()) {
      const rel = relative(REPO_ROOT, abs).split(sep).join("/");
      if (isScannableSourceFile(rel)) out.push(rel);
    }
  }
  return out;
}

/** Every `packages/*\/src` root that currently exists in this repo. */
function findPackageSrcRoots() {
  const packagesDir = join(REPO_ROOT, "packages");
  const roots = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
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

function collectViolationsInFile(relPath, content) {
  const violations = [];
  for (const rule of ALL_RULES) {
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

function main() {
  const srcRoots = findPackageSrcRoots();
  const files = srcRoots.flatMap((root) => walkSourceFiles(root));

  const violations = [];
  for (const relPath of files) {
    if (SANCTIONED_SET.has(relPath)) continue;
    const abs = join(REPO_ROOT, relPath);
    const content = readFileSync(abs, "utf8");
    violations.push(...collectViolationsInFile(relPath, content));
  }

  if (violations.length > 0) {
    console.error(
      `check-ordinal-write-sites: found ${violations.length} ordinal-write reference(s) outside the sanctioned allowlist:\n`,
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}: [${v.rule}] ${v.snippet}`);
    }
    console.error(
      `\nOnly these files may contain ordinal-allocation arithmetic or direct SQL writes to the 'ordinal' column:\n` +
        SANCTIONED_ORDINAL_WRITE_FILES.map((f) => `  - ${f}`).join("\n") +
        `\n\nEither move the logic into one of the sanctioned files above, or — if this is a genuinely new` +
        ` sanctioned write site — add it to SANCTIONED_ORDINAL_WRITE_FILES in scripts/check-ordinal-write-sites.mjs.`,
    );
    process.exit(3);
  }

  console.log(
    `check-ordinal-write-sites: OK — ordinal-allocation arithmetic and direct SQL writes to 'ordinal' are` +
      ` confined to the ${SANCTIONED_ORDINAL_WRITE_FILES.length} sanctioned file(s). Scanned ${files.length} source file(s).`,
  );
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error(`check-ordinal-write-sites: scan failed — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(4);
}

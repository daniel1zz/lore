#!/usr/bin/env bun
/**
 * Purity oracle for AC-PURE-1 (`bun scripts/check-claude-md-purity.ts`) —
 * `spec-claude-md-governance-content-dimension-checks-wire-the`.
 *
 * PURPOSE (one sentence): assert that `packages/lore/src/service/claude-md-budget.ts`
 * and `packages/lore/src/service/claude-md-admission.ts` — the two split
 * halves of the memory-file admission mechanism — import neither `node:fs`,
 * `node:path`, nor any module under `packages/lore/src/store/`, so every IO
 * capability they need enters as an injected predicate (`fileExists`,
 * `docExists`), never a direct capability grab.
 *
 * ## Why this matters
 *
 * The spec's Module Boundary requires both split modules to stay pure and
 * store-free — `docExists` is owned by the CLI/flow layer, which already
 * holds the corpus handle; the service layer must never reach for it (or the
 * filesystem) on its own. A direct `node:fs`/store import would reintroduce
 * exactly the untestable, uninjectable IO coupling the two-zone design
 * (spec-context-verb-family-two-zone-claude-md-anatomy-lore) exists to keep
 * out.
 *
 * ## RED today, on purpose
 *
 * Neither `claude-md-budget.ts` nor `claude-md-admission.ts` exists yet in
 * this worktree (confirmed empirically before writing this script — the
 * three-way split of `claude-md-check.ts` is the paired implementation
 * task's job, running concurrently). A missing declared target is NOT the
 * same as a clean one — reporting exit 0 on missing files would be a false
 * "verified pure" for a mechanism that was never actually measured, so a
 * missing file is a distinct, louder failure than a detected violation.
 *
 * Exit codes:
 *   0 — both target files exist and import neither a banned Node builtin nor
 *       a store module.
 *   1 — >=1 banned import found (the violation this oracle exists for).
 *   2 — a precondition failed loudly (a declared target file does not
 *       exist). NEVER reported as "clean".
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The two split modules that must stay pure (spec Module Boundary). */
export const TARGET_FILES: readonly string[] = [
  "packages/lore/src/service/claude-md-budget.ts",
  "packages/lore/src/service/claude-md-admission.ts",
];

/** Bare AND `node:`-prefixed forms — both leak the same capability. */
export const BANNED_BUILTIN_SPECIFIERS: readonly string[] = ["node:fs", "node:path", "fs", "path"];

const STORE_DIR = join(REPO_ROOT, "packages", "lore", "src", "store");

/** Loud precondition failure — a state in which this oracle cannot measure what it claims to. */
export class PurityCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurityCheckError";
  }
}

export type PurityViolationReason = "banned-node-builtin" | "store-module";

export interface PurityViolation {
  readonly path: string;
  readonly specifier: string;
  readonly reason: PurityViolationReason;
}

/** Matches `from "specifier"` / `from 'specifier'` — covers `import`, `import type`, and `export * from`. */
const FROM_CLAUSE_PATTERN = /\bfrom\s+["']([^"']+)["']/g;
/** Matches a bare side-effect import with no `from` clause, e.g. `import "node:fs";`. */
const BARE_IMPORT_PATTERN = /\bimport\s+["']([^"']+)["']/g;

/** True when a RELATIVE import specifier, resolved against the importing file's own directory, lands inside `packages/lore/src/store/`. */
function resolvesIntoStore(fileAbsolutePath: string, specifier: string): boolean {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return false;
  const resolved = resolve(dirname(fileAbsolutePath), specifier);
  return resolved === STORE_DIR || resolved.startsWith(STORE_DIR + "/") || resolved.startsWith(STORE_DIR + ".");
}

/**
 * Scans one file's source text for banned import specifiers. Word/clause
 * based, not a full parser — matches the SAME "scan the whole source
 * including comments" posture as `check-no-timer-retry.ts` (a commented-out
 * or "documented" `node:fs` import is exactly how the capability leak comes
 * back).
 *
 * @example
 * scanPurity("a.ts", "/abs/a.ts", 'import { existsSync } from "node:fs";')
 * // => [{ path: "a.ts", specifier: "node:fs", reason: "banned-node-builtin" }]
 */
export function scanPurity(relativePath: string, fileAbsolutePath: string, source: string): PurityViolation[] {
  const specifiers = new Set<string>();
  for (const match of source.matchAll(FROM_CLAUSE_PATTERN)) specifiers.add(match[1] as string);
  for (const match of source.matchAll(BARE_IMPORT_PATTERN)) specifiers.add(match[1] as string);

  const violations: PurityViolation[] = [];
  for (const specifier of specifiers) {
    if (BANNED_BUILTIN_SPECIFIERS.includes(specifier)) {
      violations.push({ path: relativePath, specifier, reason: "banned-node-builtin" });
      continue;
    }
    if (resolvesIntoStore(fileAbsolutePath, specifier)) {
      violations.push({ path: relativePath, specifier, reason: "store-module" });
    }
  }
  return violations;
}

export function main(): number {
  const missing = TARGET_FILES.filter((path) => !existsSync(join(REPO_ROOT, path)));
  if (missing.length > 0) {
    throw new PurityCheckError(
      `declared purity target(s) do not exist: ${missing.join(", ")} — the three-way split of ` +
        "claude-md-check.ts has not landed yet, so purity cannot be measured (a missing file is NOT " +
        "the same as a file that was checked and found clean)",
    );
  }

  const violations: PurityViolation[] = [];
  for (const path of TARGET_FILES) {
    const absolute = join(REPO_ROOT, path);
    const source = readFileSync(absolute, "utf8");
    const fileViolations = scanPurity(path, absolute, source);
    violations.push(...fileViolations);
    console.log(`  ${fileViolations.length === 0 ? "ok" : "FAIL"}  ${path} (${fileViolations.length} violation(s))`);
  }

  if (violations.length > 0) {
    process.stderr.write(
      "\ncheck-claude-md-purity FAILED — claude-md-budget.ts and claude-md-admission.ts must stay pure: " +
        "every IO capability enters as an injected predicate (fileExists, docExists), never a direct " +
        "node:fs / node:path / store import:\n" +
        violations.map((v) => `  ${v.path}  imports '${v.specifier}' (${v.reason})`).join("\n") +
        "\n",
    );
    return 1;
  }

  console.log(
    `AC-PURE-1 CHECK: ${TARGET_FILES.length} file(s) checked (${TARGET_FILES.join(", ")}) — ` +
      "zero node:fs / node:path / store imports.",
  );
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (error) {
    process.stderr.write(
      `check-claude-md-purity could not run: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
}

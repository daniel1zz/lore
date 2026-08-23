#!/usr/bin/env bun
/**
 * Composition oracle for AC-COMPOSE-1 (`bun scripts/check-claude-md-composition.ts`) —
 * `spec-claude-md-governance-content-dimension-checks-wire-the`.
 *
 * PURPOSE (one sentence): assert that BOTH production call sites of the
 * memory-file admission mechanism — `packages/lore/src/adapters/cli/commands/status.ts`
 * and `packages/lore/src/flows/context-flow.ts` — reference the sole
 * composition entry `runMemoryFileChecks`, and that NEITHER names an
 * individual metric function directly.
 *
 * ## Why this matters (root cause this spec repairs)
 *
 * The current mechanism has two independent call sites, each free to compose
 * its own subset of checks. That is exactly how `checkReferenceExistence` and
 * `detectNarrativeSmells` shipped fully unit-tested and permanently dead:
 * nothing forced either call site to route through one shared seam, so
 * neither one ever did. `runMemoryFileChecks` closes that hole by being the
 * ONLY entry either file is allowed to call — this script is the structural
 * enforcement of that rule (never by review).
 *
 * ## RED today, on purpose
 *
 * Neither target file references `runMemoryFileChecks` yet (it does not
 * exist until the paired three-way-split task lands) and BOTH still
 * reference `lintMemoryFiles` directly — confirmed empirically against this
 * worktree before writing this script. So this check currently fails on BOTH
 * conditions simultaneously (missing required entry AND a banned direct
 * reference), which is the correct RED state: the drift this spec repairs.
 *
 * Exit codes:
 *   0 — both target files reference `runMemoryFileChecks` and reference no
 *       individual metric function.
 *   1 — at least one target file is missing the required entry reference,
 *       or references a banned metric function directly (the violation this
 *       oracle exists for).
 *   2 — a precondition failed loudly (a declared target file does not
 *       exist). NEVER reported as "clean" — a missing file is not the same
 *       as a file that was checked and found composition-clean.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The two production call sites this spec's drift was measured on. */
export const TARGET_FILES: ReadonlyArray<{ readonly path: string; readonly label: string }> = [
  { path: "packages/lore/src/adapters/cli/commands/status.ts", label: "status.ts" },
  { path: "packages/lore/src/flows/context-flow.ts", label: "context-flow.ts" },
];

/** The sole composition entry every call site must route through. */
export const REQUIRED_ENTRY = "runMemoryFileChecks";

/**
 * Individual metric functions no production call site may reference
 * directly — verbatim from AC-COMPOSE-1's statement. `computeHeadroom`/
 * `computeHeadroomWarnings` joined this list under N15: Phase 1 shipped
 * them as direct calls from `status.ts` OUTSIDE `runMemoryFileChecks` while
 * the spec's Module Boundary declared that entry sole — this list omitting
 * exactly those two names is what let a false "sole entry" claim stand.
 */
export const BANNED_METRIC_FUNCTIONS: readonly string[] = [
  "lintMemoryFiles",
  "checkReferenceExistence",
  "detectNarrativeSmells",
  "checkSlugPointers",
  "measureEmphasis",
  "computeHeadroom",
  "computeHeadroomWarnings",
];

/** Loud precondition failure — a state in which this oracle cannot measure what it claims to. */
export class CompositionCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositionCheckError";
  }
}

export interface FileCompositionResult {
  readonly path: string;
  readonly label: string;
  readonly referencesEntry: boolean;
  readonly bannedReferences: string[];
}

function identifierPresent(source: string, identifier: string): boolean {
  return new RegExp(`\\b${identifier}\\b`).test(source);
}

/**
 * Checks one file's source text for the required composition-entry
 * reference and any banned direct metric-function reference. Word-bounded,
 * scans the WHOLE source including comments (deliberately — a commented-out
 * or "documented" direct reference is exactly how a second entry point comes
 * back, mirroring this repo's `check-no-timer-retry.ts` convention).
 *
 * @example
 * checkFileComposition("status.ts", "status.ts", "runMemoryFileChecks(files, budgets, deps)")
 * // => { path: "status.ts", label: "status.ts", referencesEntry: true, bannedReferences: [] }
 */
export function checkFileComposition(path: string, label: string, source: string): FileCompositionResult {
  return {
    path,
    label,
    referencesEntry: identifierPresent(source, REQUIRED_ENTRY),
    bannedReferences: BANNED_METRIC_FUNCTIONS.filter((fn) => identifierPresent(source, fn)),
  };
}

export function main(): number {
  const missing = TARGET_FILES.filter((t) => !existsSync(join(REPO_ROOT, t.path)));
  if (missing.length > 0) {
    throw new CompositionCheckError(
      `declared composition target(s) do not exist: ${missing.map((t) => t.path).join(", ")} — ` +
        "cannot check composition of a file that isn't there",
    );
  }

  const results = TARGET_FILES.map((target) =>
    checkFileComposition(target.path, target.label, readFileSync(join(REPO_ROOT, target.path), "utf8")),
  );

  let ok = true;
  for (const result of results) {
    const problems: string[] = [];
    if (!result.referencesEntry) {
      ok = false;
      problems.push(`missing reference to '${REQUIRED_ENTRY}'`);
    }
    if (result.bannedReferences.length > 0) {
      ok = false;
      problems.push(`references individual metric function(s) directly: ${result.bannedReferences.join(", ")}`);
    }
    console.log(`  ${problems.length === 0 ? "ok" : "FAIL"}  ${result.path}${problems.length > 0 ? ` — ${problems.join("; ")}` : ""}`);
  }

  if (!ok) {
    process.stderr.write(
      "\ncheck-claude-md-composition FAILED — status.ts and context-flow.ts must consume ONLY " +
        `'${REQUIRED_ENTRY}' (the sole composition entry); two independent call sites composing their ` +
        "own subset of checks is the exact drift spec-claude-md-governance-content-dimension-checks-wire-the exists to close.\n",
    );
    return 1;
  }

  console.log(
    `AC-COMPOSE-1 CHECK: status.ts and context-flow.ts each reference '${REQUIRED_ENTRY}' only, ` +
      `zero direct metric-function references (checked: ${BANNED_METRIC_FUNCTIONS.join(", ")}).`,
  );
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (error) {
    process.stderr.write(
      `check-claude-md-composition could not run: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
}

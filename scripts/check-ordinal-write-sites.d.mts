/**
 * Type declarations for check-ordinal-write-sites.mjs — hand-written companion
 * (TypeScript resolves this automatically for `.mjs` imports without `allowJs`;
 * the same pattern as scripts/embed-assets-manifest.d.mts and
 * scripts/dashboard-assets-freshness.d.mts). Required by
 * `scripts/tests/check-ordinal-write-sites.test.ts`, which imports the checker
 * to arm it against the real tree — without this file that import is an
 * implicit-`any` error under the root tsconfig's `strict`.
 *
 * Keep in sync with the JSDoc in the .mjs file; this file has no runtime
 * behavior of its own.
 *
 * @spec_ref task-three-of-five-static-checkers-are-inert-no-exported-main
 */

/** The two textual rules this oracle enforces, as reported on each violation. */
export type OrdinalWriteRule = "ordinal-allocation-arithmetic" | "ordinal-direct-sql-write";

/** One rule occurrence in one scanned file. */
export interface OrdinalWriteViolation {
  /** Repo-root-relative POSIX path of the offending file. */
  readonly file: string;
  /** 1-based line number of the match. */
  readonly line: number;
  readonly rule: OrdinalWriteRule;
  /** Whitespace-collapsed matched text, capped at 120 chars. */
  readonly snippet: string;
}

/**
 * The ONLY files permitted to contain ordinal-allocation arithmetic or a direct
 * SQL write to the `ordinal` column. POSIX paths, relative to repo root.
 */
export const SANCTIONED_ORDINAL_WRITE_FILES: readonly string[];

/** True for source `.ts`/`.mts`/`.cts` files in scan scope (excludes tests, `.d.ts`, generated, node_modules). Pure. */
export function isScannableSourceFile(relPath: string): boolean;

/** Every rule violation in one file's text, in rule order. Pure. */
export function collectViolationsInFile(relPath: string, content: string): OrdinalWriteViolation[];

/**
 * Scans every `packages/*​/src` tree under `repoRoot` (default: this checkout's
 * own root), prints a report, and returns the process exit code — 0 clean,
 * 3 violations found. Throws when the scan itself cannot run (the CLI entry
 * block maps that to exit 4). Never calls `process.exit`.
 */
export function main(repoRoot?: string): number;

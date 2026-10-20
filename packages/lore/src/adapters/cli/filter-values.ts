/**
 * Shared validator for CLI filter option values (spec AC-DCL-2, defect cluster D2).
 *
 * Purpose: every command that filters by an enumerated value (--type, --status,
 * --doc-type) or a date (--since), and every flag-dependency rule (--fix needs
 * --check-tree, a doc argument excludes --pending), is checked HERE and nowhere
 * else, so an unknown value is refused (VALIDATION_ERROR, exit 4) instead of
 * silently producing an empty result.
 *
 * Public surface: parseDocTypeFilter, parseDocStatusFilter, parseSinceFilter,
 * requireCheckTreeForFix, refuseDocWithPending, refuseFilterValue.
 * Invariants: accepted enum values are read from the @lore/core schemas (never
 * hard-coded); `--since` accepts exactly ISO 8601 (`YYYY-MM-DD` or a full
 * date-time), the format every command documents; a valid value is returned
 * unchanged so downstream behaviour is identical to before.
 * Side-effect class: pure (refuseFilterValue writes one line to the given stderr).
 */

import { docStatusSchema, docTypeSchema, err, ok } from "@lore/core";
import type { DocStatus, DocType, Invocation, LoreError, Result } from "@lore/core";

import { exitCode, formatErrorFor } from "./utils.js";

/** ISO 8601 calendar date, optionally followed by a time with optional fraction and zone. */
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Human-readable statement of the accepted `--since` format, named in every refusal. */
export const SINCE_ACCEPTED_FORMAT = "ISO 8601 (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)";

function refuse(field: string, value: string, message: string): Result<never, LoreError> {
  return err({ code: "VALIDATION_ERROR", field, message, value, rule: "BR-1289" });
}

function parseEnumFilter<T extends string>(
  flag: string,
  value: string,
  accepted: readonly T[],
): Result<T, LoreError> {
  const match = accepted.find((candidate) => candidate === value);
  if (match !== undefined) return ok(match);
  return refuse(
    flag,
    value,
    `${flag} "${value}" is not a known value. Accepted values: ${accepted.join(", ")}.`,
  );
}

/**
 * Validate a document-type filter value (`--type`, `--doc-type`).
 *
 * @param flag - option name as the user typed it, e.g. `--type`
 * @param value - raw option value
 * @returns the value as a DocType, or VALIDATION_ERROR naming the accepted types
 */
export function parseDocTypeFilter(flag: string, value: string): Result<DocType, LoreError> {
  return parseEnumFilter<DocType>(flag, value, docTypeSchema.options);
}

/**
 * Validate a document-status filter value (`--status`).
 *
 * @param flag - option name as the user typed it
 * @param value - raw option value
 * @returns the value as a DocStatus, or VALIDATION_ERROR naming the accepted statuses
 */
export function parseDocStatusFilter(flag: string, value: string): Result<DocStatus, LoreError> {
  return parseEnumFilter<DocStatus>(flag, value, docStatusSchema.options);
}

/**
 * Validate a `--since` date. The string is returned UNCHANGED (stores compare it
 * against ISO timestamps lexically), so only unreadable input changes behaviour.
 *
 * @param flag - option name as the user typed it
 * @param value - raw option value
 * @returns the original string, or VALIDATION_ERROR naming {@link SINCE_ACCEPTED_FORMAT}
 */
export function parseSinceFilter(flag: string, value: string): Result<string, LoreError> {
  if (ISO_8601_PATTERN.test(value) && !Number.isNaN(Date.parse(value.replace(" ", "T")))) {
    return ok(value);
  }
  return refuse(flag, value, `${flag} "${value}" is not a readable date. Accepted format: ${SINCE_ACCEPTED_FORMAT}.`);
}

/**
 * `lore status --fix` only has meaning under `--check-tree`; alone it was silently ignored.
 *
 * @param fix - whether --fix was passed
 * @param checkTree - whether --check-tree was passed
 * @returns ok, or VALIDATION_ERROR naming `--check-tree`
 */
export function requireCheckTreeForFix(fix: boolean, checkTree: boolean): Result<void, LoreError> {
  if (fix && !checkTree) {
    return refuse("--fix", "true", "--fix requires --check-tree (it applies the tree-check fixes); pass --check-tree --fix.");
  }
  return ok(undefined);
}

/**
 * `lore review <doc> --pending` names two disjoint targets (one doc vs the whole queue);
 * `--pending` used to win silently and ignore the doc.
 *
 * @param doc - the positional document argument, if any
 * @param pending - whether --pending was passed
 * @returns ok, or VALIDATION_ERROR naming both `<doc>` and `--pending`
 */
export function refuseDocWithPending(doc: string | undefined, pending: boolean): Result<void, LoreError> {
  if (pending && doc !== undefined && doc !== "") {
    return refuse(
      "--pending",
      doc,
      `<doc> "${doc}" and --pending are mutually exclusive: review one document, or pass --pending alone for the whole queue.`,
    );
  }
  return ok(undefined);
}

/**
 * Report a refusal from this module on stderr and return the CLI exit code (4).
 *
 * @param inv - the command's invocation (stderr + retry hint)
 * @param error - the VALIDATION_ERROR produced by a parse function
 * @returns the exit code the command should return
 */
export function refuseFilterValue(inv: Invocation, error: LoreError): number {
  inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
  return exitCode(error);
}

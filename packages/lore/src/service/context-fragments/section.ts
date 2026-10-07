/**
 * Lore-owned rules-file shape for static `main` fragments (D15): the ONLY owner of the
 * `lore-<id>.md` file name, its fingerprint first line, and the intact/diverged test.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D15, D4, D8).
 *
 * Public surface: `RULES_FILE_PREFIX`, `RULES_FILE_SUFFIX`, `rulesFileName`, `renderRulesFile`,
 * `parseRulesFile`, `isLoreRulesFileName`, `RulesFileRender`, `ParsedRulesFile`.
 * Invariants:
 *   - File = `<!-- lore:managed fragment=<id> hash=<8hex> -->\n` + rest; `rest` is the fragment
 *     body with exactly one trailing "\n"; `hash` = first 8 hex of sha256(rest).
 *   - A file is INTACT iff its first line parses AND sha256(rest)[0..8] equals the recorded hash;
 *     anything else (hand edit, no fingerprint) is diverged and must never be overwritten.
 *   - Fragment ids that are not safe file-name stems are refused (`renderRulesFile` returns err).
 *   - No managed-zone / CLAUDE.md involvement: a rules file never touches CLAUDE.md.
 * Side-effect class: pure.
 */
import { createHash } from "node:crypto";
import { err, ok, type Fragment, type LoreError, type Result } from "@lore/core";

/** Every lore-owned rules file name starts with this (reserved in both rules dirs). */
export const RULES_FILE_PREFIX = "lore-";
export const RULES_FILE_SUFFIX = ".md";

/** Ids usable as a file-name stem and inside the fingerprint comment. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const FINGERPRINT_LINE = /^<!-- lore:managed fragment=(\S+) hash=([0-9a-f]{8}) -->$/;

/** The only error `renderRulesFile` returns; narrowed so callers can read `message` (still a member of `LoreError`). */
export type RulesFileIdError = Extract<LoreError, { code: "VALIDATION_ERROR" }>;

/** One rendered rules file. */
export interface RulesFileRender {
  readonly id: string;
  readonly fileName: string;
  /** Complete file bytes (fingerprint line + rest). */
  readonly content: string;
}

/** A parsed rules file: the fingerprint's claims plus whether they hold for the bytes present. */
export interface ParsedRulesFile {
  readonly id: string;
  readonly recordedHash: string;
  /** True iff sha256(rest)[0..8] equals `recordedHash`. */
  readonly intact: boolean;
}

function hashRest(rest: string): string {
  return createHash("sha256").update(rest, "utf8").digest("hex").slice(0, 8);
}

/** `lore-<id>.md`. */
export function rulesFileName(id: string): string {
  return `${RULES_FILE_PREFIX}${id}${RULES_FILE_SUFFIX}`;
}

/** True for any name in the lore-reserved namespace (`lore-*.md`). */
export function isLoreRulesFileName(name: string): boolean {
  return name.startsWith(RULES_FILE_PREFIX) && name.endsWith(RULES_FILE_SUFFIX);
}

/**
 * Render one static main fragment as a lore rules file.
 *
 * @returns ok(file) or VALIDATION_ERROR when the fragment id cannot be a file-name stem.
 */
export function renderRulesFile(fragment: Fragment): Result<RulesFileRender, RulesFileIdError> {
  const id = fragment.frontmatter.id;
  if (!SAFE_ID.test(id)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "fragment.id",
      message: `fragment id "${id}" (${fragment.path}) cannot be written as a rules file name; use letters, digits, "-" and "_" only.`,
      value: id,
    });
  }
  const rest = fragment.body.endsWith("\n") ? fragment.body : `${fragment.body}\n`;
  const content = `<!-- lore:managed fragment=${id} hash=${hashRest(rest)} -->\n${rest}`;
  return ok({ id, fileName: rulesFileName(id), content });
}

/**
 * Parse a rules file's fingerprint.
 *
 * @returns the parsed claims, or `null` when the first line is not a lore fingerprint.
 */
export function parseRulesFile(content: string): ParsedRulesFile | null {
  const newline = content.indexOf("\n");
  if (newline < 0) return null;
  const match = FINGERPRINT_LINE.exec(content.slice(0, newline));
  if (match === null) return null;
  const id = match[1] as string;
  const recordedHash = match[2] as string;
  return { id, recordedHash, intact: hashRest(content.slice(newline + 1)) === recordedHash };
}

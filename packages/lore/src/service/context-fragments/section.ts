/**
 * Lore-owned rules-file shape for static `main` fragments (D15): the ONLY owner of the
 * `lore-<id>.md` file name, its fingerprint first line, and the intact/diverged test.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D15, D4, D8).
 *
 * Public surface: `RULES_FILE_PREFIX`, `RULES_FILE_SUFFIX`, `rulesFileName`, `renderRulesFile`,
 * `parseRulesFile`, `isLoreRulesFileName`, `RulesFileRender`, `ParsedRulesFile`; skill files (BR-1064):
 * `renderSkillFile`, `parseSkillFile`, `isLoreSkillFileBytes`, `isLoreSkillDir`, `skillDirName`, `SKILL_DIR_PREFIX`,
 * `SKILL_FILE_NAME`, `SkillFileRender`, `ParsedSkillFile`.
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
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { err, ok, type Fragment, type LoreError, type Result } from "@lore/core";

/** Every lore-owned rules file name starts with this (reserved in both rules dirs). */
export const RULES_FILE_PREFIX = "lore-";
export const RULES_FILE_SUFFIX = ".md";

/** Ids usable as a file-name stem and inside the fingerprint comment. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

// reason: strict on purpose (BR-1176, spec-process-state-end-state D3) — ownership is the intact fingerprint alone.
// A header with any extra token (the interim build wrote `source=`) does not parse, so such a file is never
// treated as lore-owned and is kept, never overwritten or pruned.
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

// ---------------------------------------------------------------------------
// Skill files (BR-1064): `lore-<id>/SKILL.md` for `delivery: skill` fragments.
// File = YAML frontmatter (`name: lore-<id>`, `description`) + fingerprint line + body.
// The fingerprint hash covers the frontmatter block AND the body, so a hand-edited
// description counts as divergence (a rules file has no frontmatter to protect).
// Side-effect class of this section: pure, except `isLoreSkillDir` (one read-only file read).
// ---------------------------------------------------------------------------

/** Every lore-owned skill directory name starts with this (same namespace as rules files). */
export const SKILL_DIR_PREFIX = "lore-";
export const SKILL_FILE_NAME = "SKILL.md";

const FRONTMATTER_OPEN = "---\n";
const FRONTMATTER_CLOSE = "\n---\n";

const SkillFrontmatterSchema = z.object({ name: z.string().min(1), description: z.string().min(1) }).strict();

/** One rendered skill directory's SKILL.md. */
export interface SkillFileRender {
  readonly id: string;
  /** `lore-<id>`; also the frontmatter `name`. */
  readonly dirName: string;
  /** Complete SKILL.md bytes (frontmatter + fingerprint line + body). */
  readonly content: string;
}

/** A parsed SKILL.md: frontmatter fields, the fingerprint's claims, and whether they hold. */
export interface ParsedSkillFile {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly recordedHash: string;
  /** True iff sha256(frontmatter block + body)[0..8] equals `recordedHash`. */
  readonly intact: boolean;
}

/** `lore-<id>` (skill directory name and frontmatter `name`). */
export function skillDirName(id: string): string {
  return `${SKILL_DIR_PREFIX}${id}`;
}

/**
 * Render one `delivery: skill` fragment as a lore SKILL.md.
 *
 * @returns ok(file) or VALIDATION_ERROR when the id is not a safe stem or the description is missing.
 */
export function renderSkillFile(fragment: Fragment): Result<SkillFileRender, RulesFileIdError> {
  const id = fragment.frontmatter.id;
  if (!SAFE_ID.test(id)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "fragment.id",
      message: `fragment id "${id}" (${fragment.path}) cannot be written as a skill directory name; use letters, digits, "-" and "_" only.`,
      value: id,
    });
  }
  const description = fragment.frontmatter.description;
  if (description === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "fragment.description",
      message: `fragment "${id}" (${fragment.path}) has no description; a skill file cannot be rendered without one.`,
      value: id,
    });
  }
  const dirName = skillDirName(id);
  const frontmatterBlock = `${FRONTMATTER_OPEN}${stringifyYaml({ name: dirName, description }, { lineWidth: 0 })}---\n`;
  const rest = fragment.body.endsWith("\n") ? fragment.body : `${fragment.body}\n`;
  const hash = hashRest(frontmatterBlock + rest);
  return ok({ id, dirName, content: `${frontmatterBlock}<!-- lore:managed fragment=${id} hash=${hash} -->\n${rest}` });
}

/**
 * Parse a SKILL.md: frontmatter, then the fingerprint line directly after it.
 *
 * @returns the parsed claims, or `null` when the frontmatter is malformed or the line after it is not a lore fingerprint.
 */
export function parseSkillFile(content: string): ParsedSkillFile | null {
  if (!content.startsWith(FRONTMATTER_OPEN)) return null;
  const close = content.indexOf(FRONTMATTER_CLOSE, FRONTMATTER_OPEN.length - 1);
  if (close < 0) return null;
  const frontmatterBlock = content.slice(0, close + FRONTMATTER_CLOSE.length);
  const afterFrontmatter = content.slice(frontmatterBlock.length);
  const newline = afterFrontmatter.indexOf("\n");
  if (newline < 0) return null;
  const match = FINGERPRINT_LINE.exec(afterFrontmatter.slice(0, newline));
  if (match === null) return null;
  let raw: unknown;
  try {
    raw = parseYaml(content.slice(FRONTMATTER_OPEN.length, close + 1));
  } catch {
    return null; // reason: malformed YAML means "not a lore skill file", never an exception for the caller
  }
  const frontmatter = SkillFrontmatterSchema.safeParse(raw);
  if (!frontmatter.success) return null;
  const id = match[1] as string;
  const recordedHash = match[2] as string;
  const rest = afterFrontmatter.slice(newline + 1);
  return {
    id,
    name: frontmatter.data.name,
    description: frontmatter.data.description,
    recordedHash,
    intact: hashRest(frontmatterBlock + rest) === recordedHash,
  };
}

/**
 * The ONE ownership predicate for a skill directory: true iff `bytes` parse as a lore SKILL.md, the
 * fingerprint is intact, and the frontmatter name and fingerprint id both agree with `dirName`.
 * Pure; shared by `isLoreSkillDir` (disk) and the refresh flow (bytes read through its fs port).
 *
 * @param dirName The skill directory's base name (`lore-<id>`).
 * @param bytes Complete SKILL.md contents.
 */
export function isLoreSkillFileBytes(dirName: string, bytes: string): boolean {
  const parsed = parseSkillFile(bytes);
  if (parsed === null || !parsed.intact) return false;
  return parsed.name === dirName && skillDirName(parsed.id) === dirName;
}

/**
 * True iff `dirPath/SKILL.md` exists and {@link isLoreSkillFileBytes} holds for it under `basename(dirPath)`.
 * A diverged or foreign skill directory is false and must never be overwritten or deleted by lore.
 *
 * @param dirPath Absolute path of a candidate `lore-<id>` skill directory.
 * @throws any fs error other than "file/dir does not exist" (loud, never swallowed as false).
 */
export function isLoreSkillDir(dirPath: string): boolean {
  let content: string;
  try {
    content = readFileSync(join(dirPath, SKILL_FILE_NAME), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
  return isLoreSkillFileBytes(basename(dirPath), content);
}

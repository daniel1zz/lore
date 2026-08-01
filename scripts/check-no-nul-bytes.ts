#!/usr/bin/env bun
/**
 * Structural no-raw-NUL-byte oracle (`bun run check:no-nul-bytes`) — the
 * mechanism-root fix for
 * `task-literal-nul-bytes-in-two-scripts-source-files-one-is`.
 *
 * Purpose: a literal NUL byte typed into a template-literal separator (or
 * anywhere else) inside a tracked TEXT source file is invisible in an
 * editor and passes every semantic oracle (tsc, vitest, this repo's own
 * `check-test-budgets.ts`) unchanged — but git's binary-file heuristic
 * sniffs only the FIRST 8000 BYTES of a file and, on finding a NUL there,
 * renders the WHOLE file as `Bin 0 -> N bytes`: no diff, unreviewable, in a
 * repo whose entire review discipline is diff-based. A file whose NUL
 * happens to sit PAST that window escapes detection today but is a latent
 * bomb — any future edit that shortens the file above the NUL, or moves
 * that code earlier, silently flips it to unreviewable too. This script
 * scans every git-tracked TEXT source file for raw NUL bytes and fails
 * loud, naming each offender WITH byte offsets, independent of file size or
 * where in the file the byte falls.
 *
 * ## Why a vitest test, not `hooks/pre-push` (the task's other named option)
 *
 * `hooks/pre-push` is documented, single-purpose "corpus conformance" (its
 * own header: "lore-doctor recurrence prevention") and fails OPEN —
 * `command -v lore` / `.lore` absent -> exit 0 unconditionally — because
 * every check it runs is meaningless without a lore corpus to check
 * against. A raw-NUL-byte scan has nothing to do with the lore corpus;
 * gating it there would make it silently inert on any clone/fork without
 * `lore` installed — a strictly WEAKER guarantee than this repo's existing
 * convention for structural source-tree oracles (`check-test-budgets.ts`,
 * `check-no-timer-retry.ts`, `check-ac-ref-integrity.ts`): a
 * `scripts/check-*.ts` module with a companion `scripts/tests/*.test.ts`
 * that calls `main()` directly against the REAL repo tree and asserts exit
 * 0 — picked up unconditionally by `bun run test` / `test:vitest` (both
 * already-required, universally-run oracles, via the `scripts/tests/**`
 * vitest include glob in `vitest.config.ts`), with no dependency on the
 * lore binary being present at all. This script follows that convention.
 *
 * ## Complementary defense-in-depth: `.gitattributes`
 *
 * This script is PREVENTIVE — it fails the test suite when a raw NUL lands
 * in a tracked text file, so a well-behaved commit path never produces one.
 * It cannot retroactively fix a blob ALREADY merged with a raw NUL (a
 * `--no-verify` commit, or content that predates this guard): git's binary
 * check runs independently on each side of a diff, so a historically
 * NUL-poisoned parent blob keeps rendering `Bin N -> M bytes` even after a
 * later commit cleans the content. The repo root's `.gitattributes` sets
 * the `diff` attribute (bare/boolean) on this same extension allowlist,
 * which per gitattributes(5) forces git to always diff these paths as
 * text "even when they contain byte values that normally never appear in
 * text files, such as NUL" — the two mechanisms are independent and both
 * needed; keep their file lists in sync.
 *
 * Public surface: `findNulByteOffsets` (pure — a `Buffer` in, every raw
 * 0-based BYTE offset of a NUL out), `hasShebang` / `hasTextSourceExtension`
 * / `hasNoExtension` (pure classification predicates), `scanTrackedFilesForNulBytes`
 * (IO — reads each candidate file from disk), `main` (IO — additionally
 * shells out to `git ls-files -z` and writes to stdout/stderr).
 * `NulByteCheckError` is the typed failure for every precondition this
 * oracle cannot measure through (not a git repo, `git ls-files` failed, a
 * tracked path unreadable) — thrown, never swallowed into a false green.
 *
 * Side-effect class: `findNulByteOffsets`/`hasShebang`/`hasTextSourceExtension`/
 * `hasNoExtension` are pure. `scanTrackedFilesForNulBytes` reads files from
 * disk. `main` additionally spawns `git` and writes to stdout/stderr.
 *
 * Exit codes:
 *   0 — zero git-tracked text-source files contain a raw NUL byte.
 *   1 — >=1 file contains at least one raw NUL byte (the violation this
 *       oracle exists for) — each is named with its exact byte offset(s).
 *   2 — a precondition failed loudly (`git ls-files` did not exit 0, e.g.
 *       run outside a git working tree, or a tracked path could not be
 *       read). NEVER reported as "clean".
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Extensions this repo hand-authors as text source (surveyed from
 * `git ls-files` at authoring time — see
 * `task-literal-nul-bytes-in-two-scripts-source-files-one-is` for the
 * survey). Deliberately an ALLOWLIST, not a denylist: a new binary asset
 * type landing later (a favicon, a snapshot image) needs no change here —
 * it simply isn't matched, so it can never become a false positive.
 */
export const TEXT_SOURCE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".md",
  ".mdx",
  ".yaml",
  ".yml",
  ".sh",
  ".css",
  ".html",
  ".txt",
  ".toml",
  ".sql",
  ".py",
  ".template",
  ".example",
  ".lock",
];

/** Dotfiles with no conventional extension (`path.split(".").pop()` gives the whole name) that are still unambiguously text. */
export const TEXT_SOURCE_DOTFILES: readonly string[] = [".gitignore"];

/** Thrown when this oracle cannot enumerate or read the tracked tree — never reported as "clean". */
export class NulByteCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NulByteCheckError";
  }
}

/** One git-tracked file whose content contains >=1 raw NUL byte. */
export interface NulByteViolation {
  readonly path: string;
  readonly offsets: readonly number[];
}

/**
 * Every 0-based BYTE offset in `content` holding a raw `0x00`.
 *
 * Operates on raw bytes, never a decoded string: a UTF-8 multi-byte
 * character would shift STRING-index offsets away from the BYTE offsets
 * git's own binary-sniff heuristic (and `git show --stat`'s error) actually
 * measures against — this must stay byte-for-byte comparable to that.
 *
 * @param content - a file's full raw bytes
 * @returns every offset holding a NUL, in ascending order
 * @example
 *   findNulByteOffsets(Buffer.from("a\0b")) // [1]
 */
export function findNulByteOffsets(content: Buffer): number[] {
  const offsets: number[] = [];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === 0) offsets.push(index);
  }
  return offsets;
}

/**
 * Whether `content`'s first two bytes are a shebang (`#!`) — the signal
 * used to classify an extensionless tracked file (e.g. `hooks/pre-push`)
 * as text source, since it has no extension to match against
 * {@link TEXT_SOURCE_EXTENSIONS}.
 *
 * @param content - a file's full raw bytes
 * @example
 *   hasShebang(Buffer.from("#!/bin/sh\n")) // true
 */
export function hasShebang(content: Buffer): boolean {
  return content.length >= 2 && content[0] === 0x23 && content[1] === 0x21;
}

/**
 * Whether `repoRelativePath` matches a known text-source extension or
 * dotfile name — an extension/dotfile allowlist match only; does NOT
 * consult file content (see {@link hasShebang} for the extensionless case).
 *
 * @param repoRelativePath - path as reported by `git ls-files`
 * @example
 *   hasTextSourceExtension("scripts/check-no-nul-bytes.ts") // true
 *   hasTextSourceExtension("packages/dashboard/public/favicon.ico") // false
 */
export function hasTextSourceExtension(repoRelativePath: string): boolean {
  const basename = repoRelativePath.split("/").pop() ?? repoRelativePath;
  if (TEXT_SOURCE_DOTFILES.includes(basename)) return true;
  return TEXT_SOURCE_EXTENSIONS.some((ext) => repoRelativePath.endsWith(ext));
}

/**
 * Whether `repoRelativePath`'s basename has no `.`-extension at all — the
 * signal that a shebang check (not an extension match) is needed to decide
 * if the file is text source.
 *
 * @param repoRelativePath - path as reported by `git ls-files`
 * @example
 *   hasNoExtension("hooks/pre-push") // true
 *   hasNoExtension("scripts/build.ts") // false
 */
export function hasNoExtension(repoRelativePath: string): boolean {
  const basename = repoRelativePath.split("/").pop() ?? repoRelativePath;
  return !basename.includes(".");
}

/**
 * Scans every candidate among `trackedPaths` (extension/dotfile allowlist
 * match, OR an extensionless file whose content starts with a shebang) for
 * raw NUL bytes.
 *
 * @param repoRoot - absolute repo root `trackedPaths` are relative to
 * @param trackedPaths - repo-relative paths, as reported by `git ls-files`
 * @returns one entry per file containing >=1 raw NUL byte, in `trackedPaths` order
 * @throws NulByteCheckError when a candidate file cannot be read
 */
export function scanTrackedFilesForNulBytes(repoRoot: string, trackedPaths: readonly string[]): NulByteViolation[] {
  const violations: NulByteViolation[] = [];
  for (const path of trackedPaths) {
    const extensionMatch = hasTextSourceExtension(path);
    if (!extensionMatch && !hasNoExtension(path)) continue; // known non-allowlisted extension (e.g. an image/font) — skip

    let content: Buffer;
    try {
      content = readFileSync(resolve(repoRoot, path));
    } catch (error) {
      throw new NulByteCheckError(`could not read tracked file '${path}': ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!extensionMatch && !hasShebang(content)) continue; // extensionless AND not a shebang script — skip

    const offsets = findNulByteOffsets(content);
    if (offsets.length > 0) violations.push({ path, offsets });
  }
  return violations;
}

/**
 * Lists every git-tracked path in `repoRoot`, NUL-terminated (`git ls-files -z`)
 * so a filename itself containing unusual characters is still parsed
 * unambiguously.
 *
 * @throws NulByteCheckError when `git ls-files` does not exit 0 (e.g. not a
 *   git working tree) — this oracle must never silently report zero
 *   tracked files as "clean"
 */
function listTrackedFiles(repoRoot: string): string[] {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new NulByteCheckError(`'git ls-files -z' failed (exit ${result.status ?? "null"}) in ${repoRoot}: ${result.stderr || "(no stderr)"}`);
  }
  return result.stdout.split("\0").filter((entry) => entry.length > 0);
}

/**
 * CLI entrypoint — lists the tracked tree, scans every text-source
 * candidate for raw NUL bytes, and reports.
 *
 * @param repoRoot - defaults to this script's own repo root; overridable so
 *   tests can point it at a throwaway fixture tree
 * @returns the process exit code (0 clean / 1 violations found)
 */
export function main(repoRoot: string = REPO_ROOT): number {
  const tracked = listTrackedFiles(repoRoot);
  const violations = scanTrackedFilesForNulBytes(repoRoot, tracked);

  if (violations.length > 0) {
    process.stderr.write(
      `\ncheck:no-nul-bytes FAILED — ${violations.length} git-tracked text-source file(s) contain a raw NUL byte:\n` +
        violations.map((v) => `  ${v.path}  offset(s): ${v.offsets.join(", ")}`).join("\n") +
        "\n\nReplace each raw NUL with an escape sequence (`\\0`), ideally behind a named " +
        "constant documenting why a NUL separator is safe at that site — see " +
        "scripts/check-test-budgets.ts's `KEY_SEP` for the pattern. A raw NUL inside git's " +
        "first-8000-byte binary-sniff window makes the WHOLE FILE unreviewable " +
        "(`git show --stat` reports `Bin 0 -> N bytes`, no diff at all).\n",
    );
    return 1;
  }

  console.log(`check:no-nul-bytes passed — ${tracked.length} tracked file(s) considered, zero raw NUL bytes in any text-source file.`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main());
  } catch (error) {
    process.stderr.write(`check:no-nul-bytes could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

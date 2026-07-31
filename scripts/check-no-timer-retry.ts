#!/usr/bin/env bun
/**
 * Structural no-timer-retry oracle (`bun run check:no-timer-retry`) — AC-IC-3 of
 * `spec-report-issue-has-no-specified-concurrency-contract-ac-072`.
 *
 * The spec's mechanism for concurrent `lore report-issue` writes is a DECLARED
 * BOUNDED WAIT at the store edge (SQLite's `busy_timeout`, declared via
 * `feedback.upstream.write_wait_ms`). D3 bans the alternative — a timer-driven
 * retry in the enforcement path — and requires the ban to be "enforced
 * structurally, not by review". This script is that structure: it greps the
 * enforcement paths for the banned tokens and fails loud on any occurrence.
 *
 * ## Both lists are READ FROM THE SPEC, never restated here (AC-IC-3)
 *
 * The spec's D3 bullet is the SSOT for BOTH the file list and the banned-token
 * list, so the target cannot be narrowed after the fact to whatever file happens
 * to be clean, and a token added to D3 starts being enforced with no change
 * here. The spec is read from the lore corpus itself (`docs.content` for the
 * spec's slug) — the corpus IS the spec, so there is no second copy to drift.
 *
 * ## Every declared path MUST exist (D3, explicitly)
 *
 * D3's list originally shipped a path that did not exist
 * (`adapters/cli/report-issue.ts`; the real surface is
 * `adapters/cli/commands/report-issue.ts`). A grep over a missing path returns
 * ZERO matches, which is indistinguishable from a clean file — so this check
 * would have PASSED while measuring nothing. Path existence is therefore
 * asserted before any grep, and a missing path is a hard failure.
 *
 * Public surface: `extractD3Targets` (pure — spec text in, `{paths, tokens}`
 * out), `scanSource` (pure — one file's text in, violations out), `main` (IO).
 * `NoTimerRetryCheckError` is the typed failure for every loud precondition
 * (spec unreadable, D3 unparseable, declared path missing) — thrown, never
 * swallowed into a false green.
 *
 * Side-effect class: `extractD3Targets`/`scanSource` are pure; `main` reads the
 * corpus + source files and writes to stdout/stderr.
 *
 * Exit codes:
 *   0 — every declared path exists and contains zero banned tokens.
 *   1 — >=1 banned-token occurrence (the violation this oracle exists for).
 *   2 — a precondition failed loudly (no corpus, spec/D3 not found, a declared
 *       path missing, an unreadable file). NEVER reported as "clean".
 */

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The governing spec's slug — the corpus row this check reads its target lists from. */
export const SPEC_SLUG = "spec-report-issue-has-no-specified-concurrency-contract-ac-072";

/**
 * Minimum counts a successful D3 parse must yield. A parse that silently
 * narrowed (regex drift, a reworded bullet) would otherwise measure fewer files
 * or fewer tokens and still exit 0 — the exact false-green shape this oracle
 * exists to prevent. D3 declares three paths and three tokens today; a spec that
 * ADDS either is enforced automatically, a spec that appears to have fewer is a
 * parse failure until a human confirms otherwise.
 */
export const MIN_DECLARED_PATHS = 3;
export const MIN_DECLARED_TOKENS = 3;

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Loud precondition failure — a state in which this oracle CANNOT measure what it claims to. */
export class NoTimerRetryCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoTimerRetryCheckError";
  }
}

/** One banned-token occurrence. */
export interface TimerRetryViolation {
  readonly path: string;
  readonly line: number;
  readonly token: string;
  readonly text: string;
}

/** D3's two declared lists, as parsed out of the spec's own text. */
export interface D3Targets {
  /** Repo-relative source paths that must together contain zero banned tokens. */
  readonly paths: string[];
  /** The banned identifiers/words (e.g. `setTimeout`, `sleep`, `backoff`). */
  readonly tokens: string[];
}

/** Backticked token shaped like a repo source path (`packages/...` ending in `.ts`). */
const BACKTICKED_TOKEN_PATTERN = /`([^`\n]+)`/g;
const SOURCE_PATH_SHAPE = /^packages\/[A-Za-z0-9._/-]+\.ts$/;
/** Backticked token shaped like a bare identifier/word — D3's banned-token form. */
const BANNED_TOKEN_SHAPE = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Extracts D3's declared file list and banned-token list from the spec's raw
 * markdown. Scans from the D3 bullet up to (excluding) the next bullet or
 * section heading, so tokens quoted elsewhere in the spec — including the
 * Contract Details section's discussion of OTHER files (`app.ts`,
 * `sqlite-store.ts`) and of the nonexistent path D3 used to name — can never
 * widen or narrow the target.
 *
 * @param specMarkdown - the spec document's `content` field, verbatim
 * @returns the two declared lists, de-duplicated, in document order
 * @throws NoTimerRetryCheckError when the D3 bullet is absent, or either list
 *   parses below its documented minimum (a silent narrowing is a failure, never
 *   a smaller-but-fine target)
 * @example
 *   extractD3Targets("- **D3 — …** `packages/core/src/a.ts` … zero `sleep` occurrences")
 */
export function extractD3Targets(specMarkdown: string): D3Targets {
  const lines = specMarkdown.split("\n");
  const startIndex = lines.findIndex((line) => /^\s*[-*]\s+\*\*D3\b/.test(line));
  if (startIndex === -1) {
    throw new NoTimerRetryCheckError(
      `could not find D3's bullet in ${SPEC_SLUG} — the spec text this check reads its ` +
        "target list from has changed shape; fix the parser (or the spec) rather than " +
        "letting the check measure nothing",
    );
  }

  const bulletLines: string[] = [lines[startIndex] as string];
  for (let index = startIndex + 1; index < lines.length; index++) {
    const line = lines[index] as string;
    if (/^\s*[-*]\s+\*\*/.test(line) || /^#{1,6}\s/.test(line)) break;
    bulletLines.push(line);
  }
  const bulletText = bulletLines.join("\n");

  const paths: string[] = [];
  const tokens: string[] = [];
  for (const match of bulletText.matchAll(BACKTICKED_TOKEN_PATTERN)) {
    const value = (match[1] as string).trim();
    if (SOURCE_PATH_SHAPE.test(value)) {
      if (!paths.includes(value)) paths.push(value);
    } else if (BANNED_TOKEN_SHAPE.test(value)) {
      if (!tokens.includes(value)) tokens.push(value);
    }
  }

  if (paths.length < MIN_DECLARED_PATHS) {
    throw new NoTimerRetryCheckError(
      `parsed only ${paths.length} declared path(s) from D3 (expected at least ${MIN_DECLARED_PATHS}): ` +
        `${paths.join(", ") || "(none)"} — refusing to run a narrowed check`,
    );
  }
  if (tokens.length < MIN_DECLARED_TOKENS) {
    throw new NoTimerRetryCheckError(
      `parsed only ${tokens.length} banned token(s) from D3 (expected at least ${MIN_DECLARED_TOKENS}): ` +
        `${tokens.join(", ") || "(none)"} — refusing to run a narrowed check`,
    );
  }
  return { paths, tokens };
}

/**
 * Finds every banned-token occurrence in one file's source.
 *
 * Case-INSENSITIVE and word-bounded: `Bun.sleep`, `await sleep(`,
 * `retry-with-backoff` in a comment and `setTimeout` all count. Comments count
 * DELIBERATELY — D3 bans the mechanism, and a commented-out or "documented"
 * timer retry is exactly how one comes back.
 *
 * @param path - repo-relative path (echoed into each violation)
 * @param source - the file's full text
 * @param tokens - D3's declared banned tokens
 * @returns one violation per occurrence, in file order
 * @example
 *   scanSource("a.ts", "await Bun.sleep(5);", ["sleep"]) // [{path:"a.ts", line:1, token:"sleep", …}]
 */
export function scanSource(path: string, source: string, tokens: readonly string[]): TimerRetryViolation[] {
  const violations: TimerRetryViolation[] = [];
  const lines = source.split("\n");
  for (const token of tokens) {
    const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    lines.forEach((text, index) => {
      if (pattern.test(text)) {
        violations.push({ path, line: index + 1, token, text: text.trim() });
      }
    });
  }
  return violations.sort((a, b) => a.line - b.line || a.token.localeCompare(b.token));
}

/**
 * Resolves the lore corpus database this repo's own spec lives in. Mirrors
 * `adapters/cli/utils.ts`'s two-step resolution: the repo root's own
 * `.lore/lore.db`, else — when this checkout is a LINKED git worktree, where
 * `.lore/` is never materialised — the MAIN checkout's.
 *
 * @returns absolute path to `lore.db`
 * @throws NoTimerRetryCheckError when neither location has one (this oracle
 *   cannot read its target list, so it must never report "clean")
 */
function resolveCorpusDbPath(): string {
  const local = join(REPO_ROOT, ".lore", "lore.db");
  if (existsSync(local)) return local;

  const commonDir = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 5000,
  });
  const candidate =
    commonDir.status === 0 && commonDir.stdout.trim().length > 0
      ? join(dirname(resolve(REPO_ROOT, commonDir.stdout.trim())), ".lore", "lore.db")
      : undefined;
  if (candidate !== undefined && existsSync(candidate)) return candidate;

  throw new NoTimerRetryCheckError(
    `no lore corpus found at '${local}'${candidate !== undefined ? ` or '${candidate}'` : ""} — ` +
      `this check reads its target list from ${SPEC_SLUG} in the corpus and cannot run without it`,
  );
}

/**
 * Reads the governing spec's markdown out of the corpus.
 *
 * `bun:sqlite` is imported LAZILY, deliberately: `scripts/tests/**` is inside
 * this repo's vitest include globs, and vitest cannot resolve `bun:sqlite` — a
 * top-level import would make this module unimportable from the unit tests that
 * cover its pure parsers (same lazy-import move `adapters/mcp/tools.ts` makes,
 * see this repo's CLI module CLAUDE.md).
 *
 * @param dbPath - the resolved `lore.db`
 * @returns the spec's `content` field
 * @throws NoTimerRetryCheckError when the spec row is absent or has no content
 */
async function readSpecMarkdown(dbPath: string): Promise<string> {
  const { Database } = await import("bun:sqlite");
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query("SELECT content FROM docs WHERE slug = ? AND deleted_at IS NULL").get(SPEC_SLUG) as
      | { content?: unknown }
      | null;
    const content = row?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new NoTimerRetryCheckError(
        `spec '${SPEC_SLUG}' has no readable content in ${dbPath} — cannot read D3's target list`,
      );
    }
    return content;
  } finally {
    db.close();
  }
}

/**
 * CLI entrypoint — resolves the corpus, parses D3, asserts every declared path
 * exists, greps them, and reports.
 *
 * @returns the process exit code (0 clean / 1 violations); precondition
 *   failures reject with {@link NoTimerRetryCheckError} and are reported as
 *   exit 2 by the caller below
 */
export async function main(): Promise<number> {
  const targets = extractD3Targets(await readSpecMarkdown(resolveCorpusDbPath()));

  console.log(`check:no-timer-retry — banned tokens (from ${SPEC_SLUG} D3): ${targets.tokens.join(", ")}`);

  const missing = targets.paths.filter((path) => !existsSync(join(REPO_ROOT, path)));
  if (missing.length > 0) {
    throw new NoTimerRetryCheckError(
      `D3 declares ${missing.length} path(s) that do not exist: ${missing.join(", ")} — ` +
        "a grep over a missing path returns zero matches, which is indistinguishable from a " +
        "clean file, so this is a hard failure (D3: 'the checker MUST assert that every path " +
        "in this list exists and fail loud when one is missing')",
    );
  }

  const violations: TimerRetryViolation[] = [];
  for (const path of targets.paths) {
    const absolute = join(REPO_ROOT, path);
    let source: string;
    try {
      source = readFileSync(absolute, "utf8");
    } catch (error) {
      throw new NoTimerRetryCheckError(
        `could not read declared path '${path}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const fileViolations = scanSource(path, source, targets.tokens);
    violations.push(...fileViolations);
    console.log(`  ${fileViolations.length === 0 ? "ok" : "FAIL"}  ${path} (${fileViolations.length} match(es))`);
  }

  if (violations.length > 0) {
    process.stderr.write(
      `\ncheck:no-timer-retry FAILED — ${violations.length} banned-token occurrence(s) in the ` +
        "enforcement path. D3 bans timer-driven retry there; the mechanism is the DECLARED " +
        "bounded wait (feedback.upstream.write_wait_ms → PRAGMA busy_timeout):\n" +
        violations.map((v) => `  ${v.path}:${v.line}  [${v.token}]  ${v.text}`).join("\n") +
        "\n",
    );
    return 1;
  }

  console.log(`check:no-timer-retry passed — ${targets.paths.length} declared path(s), zero banned tokens.`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (error) {
    process.stderr.write(
      `check:no-timer-retry could not run: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
}

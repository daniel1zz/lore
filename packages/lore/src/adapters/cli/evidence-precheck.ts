/**
 * Pure command-string analysis for the `lore evidence` self-reported-pass
 * oracle-file precheck (defect: task-lore-evidence-self-reported-pass-lacks-
 * oracle-file, AC-080-3 incident — a self-reported `--oracle test --result
 * pass` recorded cleanly even though the referenced test file did not exist
 * on disk; only `lore verify`'s SPEC-061 zero-match guard caught it, two
 * verify rounds later).
 *
 * Public surface:
 *   - extractTestFileTokens(command) — pull test-file-like path tokens out of
 *     a shell command string
 *   - extractCdPrefixTarget(command) — detect a leading `cd <path> && ...`
 *     (or `cd <path>; ...`) prefix, if present
 *   - findMissingOracleFiles(command, opts) — compose both extractors with an
 *     injected existence port to report which extracted tokens resolve to no
 *     file anywhere plausible
 *
 * Design: token EXTRACTION and existence-port CHECKING both live here so the
 * whole precheck is unit-testable with a fake `fileExists` — no real
 * filesystem needed (mirrors `service/drift-check-service.ts`'s injected
 * `FsProbe` port / `adapters/real-fs-probe.ts`'s real implementation split).
 * Resolving the ACTUAL filesystem (which path is cwd, which is corpus root)
 * is deliberately left to the CLI command (`commands/evidence.ts`) — that
 * layer is the one that knows `process.cwd()` and the discovered `.lore/`
 * root; this module only needs `existsSync` handed to it as a function.
 *
 * Side-effect class: pure (no IO, no fs, no process access) — vitest-safe.
 *
 * Source: task-lore-evidence-self-reported-pass-lacks-oracle-file
 */

/**
 * Matches a path-like token ending in a recognized test-file suffix
 * (`.bun.test.ts`, `.test.tsx`, `.test.ts`, `.spec.ts`). The character class
 * excludes whitespace and quote characters, so a quoted token (`"foo.test.ts"`)
 * is captured WITHOUT its surrounding quotes automatically — no separate
 * quote-stripping step is needed for this pattern. `\b` at the end prevents a
 * false match on `foo.test.tsx-something` (an unlikely but not impossible
 * shell token).
 */
const TEST_FILE_TOKEN_PATTERN =
  /[^\s"'`]+\.(?:bun\.test\.ts|test\.tsx|test\.ts|spec\.ts)\b/g;

/**
 * Extracts every test-file-like path token from a raw shell command string.
 *
 * Deliberately naive tokenization — no shell-grammar parsing. A flag value
 * that happens to not end in a recognized test-file suffix (e.g. `-t "AC-1
 * happy path"`) never matches, since the pattern requires the suffix. A
 * command referencing no recognizable test file returns `[]` — this is a
 * deliberate fail-open (see `commands/evidence.ts`'s module header): a
 * command with no extractable token cannot be checked for existence, so the
 * precheck does not block it.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
 * @returns de-duplicated, order-preserving list of path-like test-file tokens
 * @example
 *   extractTestFileTokens("bunx vitest run packages/lore/tests/foo.test.ts")
 *   // => ["packages/lore/tests/foo.test.ts"]
 *   extractTestFileTokens("bunx vitest run -t \"AC-1\" packages/x.test.ts")
 *   // => ["packages/x.test.ts"]
 *   extractTestFileTokens("bun run typecheck")
 *   // => []
 */
export function extractTestFileTokens(command: string): string[] {
  const matches = command.match(TEST_FILE_TOKEN_PATTERN) ?? [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of matches) {
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

/** Strips a single layer of matching wrapping quote characters, if present. */
function stripWrappingQuotes(token: string): string {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' || first === "'" || first === "`") && first === last) {
      return token.slice(1, -1);
    }
  }
  return token;
}

/**
 * Detects a leading `cd <path> && ...` (or `cd <path>; ...`) prefix at the
 * START of a command string and returns the cd target, quotes stripped. Only
 * recognizes a SINGLE leading `cd` — `foo && cd bar && baz` does not count
 * (the `cd` is not first): this is a narrow "cd-prefix" recognizer for the
 * common `cd <dir> && <oracle command>` shape recorded by evidence commands,
 * not a general shell-command interpreter.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
 * @returns the cd target (quotes stripped), or `null` when the command has no
 *   leading cd-prefix
 * @example
 *   extractCdPrefixTarget("cd packages/lore && bun test tests/foo.bun.test.ts")
 *   // => "packages/lore"
 *   extractCdPrefixTarget("bunx vitest run foo.test.ts")
 *   // => null
 */
export function extractCdPrefixTarget(command: string): string | null {
  const match = /^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)/.exec(command);
  if (!match || match[1] === undefined) return null;
  const target = stripWrappingQuotes(match[1]);
  return target.length > 0 ? target : null;
}

/** Injectable filesystem-existence check — see this module's header. */
export type FileExistsPort = (absolutePath: string) => boolean;

/**
 * Minimal path-joining helper (POSIX-style, no `node:path` dependency — this
 * module stays free of Node builtins so it is importable from vitest). Treats
 * `base` as already absolute; `segment` may itself be absolute (returned
 * unchanged, matching `path.resolve`'s override behavior) or relative
 * (joined onto `base`). Does not normalize `..`/`.` segments — callers pass
 * already-clean roots (`process.cwd()`, a discovered corpus root) and
 * relatively well-formed command tokens; a `fileExists` port backed by real
 * `fs.existsSync` resolves any leftover `..`/`.` segments transparently at
 * the OS level.
 */
function joinPath(base: string, segment: string): string {
  if (segment.startsWith("/")) return segment;
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}/${segment}`;
}

/**
 * Reports which test-file tokens extracted from `command` resolve to no
 * existing file under ANY plausible root: the cd-prefix target (if the
 * command starts with `cd <dir> &&`/`cd <dir>; `), `opts.cwd`, and
 * `opts.corpusRoot` (when distinct from `cwd`). A token already absolute is
 * checked as-is (no root candidates). A token counts as "missing" only when
 * it fails EVERY applicable root — the check is deliberately permissive
 * about WHERE the file lives, strict about WHETHER it exists anywhere
 * plausible.
 *
 * @param command - the exact command string recorded via `lore evidence --command`
 * @param opts.cwd - absolute current working directory
 * @param opts.corpusRoot - absolute discovered `.lore/` corpus root; omitted
 *   or equal to `cwd` means only `cwd` is tried
 * @param opts.fileExists - injected existence check (real caller: `fs.existsSync`)
 * @returns the subset of extracted tokens (original, un-resolved strings)
 *   that do not exist under any candidate root; `[]` when `command`
 *   references no test-file token at all (nothing to check) or every
 *   extracted token resolves somewhere
 * @example
 *   findMissingOracleFiles("bunx vitest run x.test.ts", {
 *     cwd: "/repo",
 *     fileExists: (p) => p === "/repo/x.test.ts",
 *   })
 *   // => []
 */
export function findMissingOracleFiles(
  command: string,
  opts: { cwd: string; corpusRoot?: string; fileExists: FileExistsPort },
): string[] {
  const tokens = extractTestFileTokens(command);
  if (tokens.length === 0) return [];

  const cdTarget = extractCdPrefixTarget(command);
  const roots = [
    ...(cdTarget !== null ? [joinPath(opts.cwd, cdTarget)] : []),
    opts.cwd,
    ...(opts.corpusRoot !== undefined && opts.corpusRoot !== opts.cwd
      ? [opts.corpusRoot]
      : []),
  ];

  const missing: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("/")) {
      if (!opts.fileExists(token)) missing.push(token);
      continue;
    }
    const existsSomewhere = roots.some((root) =>
      opts.fileExists(joinPath(root, token)),
    );
    if (!existsSomewhere) missing.push(token);
  }
  return missing;
}

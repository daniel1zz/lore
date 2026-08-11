/**
 * Pure decision logic for the repo-corpus pollution guard (SPEC-OX D3, AC-OX-2).
 *
 * Purpose: decide, from `git status --short` porcelain text alone, whether the
 * checkout's tracked-but-mostly-ignored corpus surfaces (`.lore/` and
 * `docs/requirements/**`) have been dirtied by a test run — and, if so, WHICH paths
 * are dirty. The guard this replaces asserted only a boolean ("output is empty"),
 * which reproduces the attribution cost this spec exists to remove: a red with no
 * named cause.
 *
 * Public surface: `checkRepoPollution(gitStatusShortOutput)` → `RepoPollutionVerdict`.
 *
 * Invariants:
 *   - Never calls `git` and never touches the filesystem. Callers (the e2e wiring in
 *     `packages/lore/tests/integration/spec-loop-e2e.bun.test.ts`) run
 *     `git status --short .lore docs/requirements` and feed this module the raw
 *     stdout text. That split is what lets both the "accepts" and "rejects"
 *     directions be driven from a unit test without ever dirtying a real tree (D3).
 *   - Handles the `git status --short` rename/copy line shape (`R  old -> new`),
 *     which names TWO paths on one line — both are reported, never just one, and
 *     never swapped.
 *   - The corpus scope — `.lore/` and `docs/requirements/**` — is encoded HERE, not
 *     delegated to the caller's `git status` pathspec. A line naming a path outside
 *     that scope (e.g. an unrelated source-tree edit picked up by an unscoped `git
 *     status`) is NOT reported: this predicate answers "is the CORPUS dirty", not
 *     "is the working tree dirty". Blank input verdicts clean.
 *
 * Side-effect class: pure (no IO, no mutation, no randomness). Printing the verdict
 * is the WIRING's job (the e2e guard), not this module's — keeping this predicate
 * pure is what makes it unit-testable without a real git tree.
 */

/**
 * Verdict returned by {@link checkRepoPollution}.
 *
 * `clean` is a derived convenience (`offendingPaths.length === 0`). Callers that need
 * to report WHY a run failed MUST read `offendingPaths` — checking `clean` alone
 * silently drops the attribution this predicate exists to provide.
 */
export interface RepoPollutionVerdict {
  readonly clean: boolean;
  readonly offendingPaths: readonly string[];
}

/**
 * Parse one `git status --short` porcelain line into the path(s) it names.
 *
 * Porcelain v1 short format is two status characters, then a separating space, then
 * either a bare path or — for a rename/copy — `old -> new`. A rename names TWO paths
 * on one line; both are returned, in `old, new` order, so a caller cannot silently
 * drop the source or destination side (a naive parser that only reads up to the first
 * space, or only after the arrow, reports the wrong one).
 *
 * @param line one line of `git status --short` output, its trailing newline already
 *   stripped (e.g. `" M path"`, `"?? path"`, `"R  old -> new"`).
 * @returns the path(s) named by the line; an empty array if the line is too short to
 *   contain a status-code-plus-path pair (malformed input is dropped, never thrown).
 */
function parseStatusLine(line: string): readonly string[] {
  // "XY" (2 status chars) + 1 separator space + at least 1 path char = 4 minimum.
  if (line.length < 4) return [];
  const pathSpec = line.slice(3);
  const arrowIndex = pathSpec.indexOf(" -> ");
  if (arrowIndex === -1) return [pathSpec];
  return [pathSpec.slice(0, arrowIndex), pathSpec.slice(arrowIndex + 4)];
}

/**
 * Whether `path` falls under one of the two corpus surfaces this guard protects.
 *
 * This is the widened scope (SPEC-OX D3): the guard it replaces ran
 * `execSync("git status --short .lore")` and so could only ever SEE `.lore/` —
 * mirror-content dirt under `docs/requirements/**` was invisible to it entirely
 * (measured: a peer's mirror fingerprint moved across one `bun run test`, undetected
 * by that narrower guard). Encoding both prefixes here, rather than trusting the
 * caller's `git status` pathspec alone, means this predicate stays correct even if a
 * future caller runs an unscoped `git status`.
 *
 * @param path a path as it appears in `git status --short` output (repo-root-relative,
 *   no leading `./`).
 * @returns `true` for `.lore` (or anything under it) or `docs/requirements` (or
 *   anything under it); `false` for every other path.
 */
function isInCorpusScope(path: string): boolean {
  return (
    path === ".lore" ||
    path.startsWith(".lore/") ||
    path === "docs/requirements" ||
    path.startsWith("docs/requirements/")
  );
}

/**
 * Decide whether `git status --short` output shows the repo corpus dirty, and name
 * every offending path.
 *
 * @param gitStatusShortOutput raw stdout of `git status --short .lore
 *   docs/requirements` (or any equivalently-scoped invocation) — one entry per line,
 *   trailing newline optional.
 * @returns `{ clean: true, offendingPaths: [] }` for blank input; otherwise
 *   `{ clean: false, offendingPaths }` naming every path the output mentions,
 *   including both sides of a rename.
 * @example
 * checkRepoPollution("") // => { clean: true, offendingPaths: [] }
 * checkRepoPollution(" M docs/requirements/spec/spec-001-foo.md")
 *   // => { clean: false, offendingPaths: ["docs/requirements/spec/spec-001-foo.md"] }
 */
export function checkRepoPollution(gitStatusShortOutput: string): RepoPollutionVerdict {
  const offendingPaths = gitStatusShortOutput
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim().length > 0)
    .flatMap(parseStatusLine)
    .filter((path) => path.length > 0 && isInCorpusScope(path));

  return { clean: offendingPaths.length === 0, offendingPaths };
}

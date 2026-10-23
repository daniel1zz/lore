// @spawns packages/lore/src/index.ts
// @reads packages/core/src/**
// @reads packages/lore/src/**
// @reads scripts/**
/**
 * SUGGESTED-COMMAND INTEGRITY (AC-FR-9, spec-falsifiability-reachability-a-feedable-
 * checkpoint-an) — task-make-lore-ac-set-accept-the-falsifier-flags-its-own-error.
 *
 * Every pasteable `lore <cmd> ...` command a lore ERROR/REFUSAL message emits must
 * actually resolve on the real CLI: each named subcommand must exist, and each named
 * flag must be accepted by THAT subcommand. Measured 2026-08-10: `verify-runner-
 * service.ts:1470` told users to run `lore ac add/set <spec> <id> --falsifier-path ...`
 * while `ac set` did not accept ANY `--falsifier-*` flag — G4's exact shape (a message
 * promising more than the implementation delivers) recurring within hours of G4
 * closing. This suite is the scanner that stops that class of defect from recurring,
 * armed against the WHOLE back-catalogue, not just the one measured offender.
 *
 * ## Scope — what counts as an "error/refusal message" here
 *
 * Scanned anchors (after comment-stripping, so JSDoc usage examples are NEVER
 * scanned — they are documentation, not something the CLI actually emits at
 * runtime): `message:` object-literal fields (the `LoreError.message` shape),
 * `process.stderr.write(...)`, `console.error(...)`, `throw new Error(...)`.
 * Scan roots: `packages/lore/src`, `packages/core/src`, `scripts` (excluding
 * `.test.ts`/`.bun.test.ts`/`.d.ts` and any `tests/` directory).
 *
 * ⛔ Explicitly OUT OF SCOPE (named, not hidden — the task's own mandate):
 *   - `packages/dashboard/**` — a separate frontend package (JSX/TSX, different
 *     quoting conventions this scanner is not built for); several components
 *     (e.g. `SessionsPanel.tsx`, `AnchorConflictsPanel.tsx`) DO print `lore ...`
 *     hints to users, which is a legitimate future extension, not a defect this
 *     task closes.
 *   - `description:` fields on citty `args` declarations (shown only by `--help`,
 *     never printed as an error/refusal) — e.g. `commands/verify.ts:387`'s
 *     `--falsify` flag description says "see `lore ac add --falsifier-*`" (true
 *     but now incomplete now that `set` also accepts it); this is HELP TEXT, not
 *     a refusal message, and `verify.ts` sits outside this task's file anchors.
 *   - A "lore <cmd> ..." mention that ends in an ordinary English sentence before
 *     any flag is reached (see MENTION_ANCHOR / the token-walk below) — e.g.
 *     `verify-runner-service.ts:1221`'s "the no-PLAN-positional lore verify path
 *     is reachable ONLY for a SPEC-069 --adhoc task" names `--adhoc`, but that
 *     flag belongs to `lore create task`, not `lore verify` — the SENTENCE merely
 *     mentions it while describing the task's own property. A scanner that kept
 *     collecting flags across arbitrary prose would flag this as broken when it
 *     is not (nothing here suggests running `lore verify --adhoc`). Same for
 *     `verify-runner-service.ts:766/911/947`'s "lore verify aborted/never
 *     attests..." narrative sentences — real flags mentioned deep in prose after
 *     an intervening plain-English word are a documented, deliberate MISS, never
 *     a false RED. Conservative-miss over false-positive is the trade this
 *     scanner makes throughout — see the token-walk's own comment below.
 *   - A comma-separated flag ENUMERATION in prose with no invocation shape (e.g.
 *     `ac-service.ts`'s own "lore ac set requires at least one field to change:
 *     --statement, --oracle, ..." — an English sentence, not `lore ac set
 *     --statement --oracle ...`) is likewise never reached by the token-walk once
 *     it hits "requires". These enumerations are hand-verified in this same task
 *     (`ac-service.ts`/`commands/ac.ts`'s own zero-flag messages) — not silently
 *     unactionable, just outside a scanner built for INVOCATION-shaped strings.
 *
 * ## Mechanism
 *
 * 1. `stripComments` blanks `//` and `/* *\/` comments (preserving length/line
 *    count exactly) while leaving string/template literal CONTENT untouched.
 *    Residual (documented, not claimed fixed): this is not a full JS/TS lexer —
 *    a bare regex literal (`/foo\//`) immediately after one of the four anchors
 *    could mis-lex; none of this corpus's anchors are followed by one (measured
 *    by inspection). A nested template literal inside a `${...}` interpolation
 *    (backtick-within-backtick) would also desync state — none observed.
 * 2. Each of the four anchor patterns' matched call/field is expanded to its
 *    FULL expression text via `extractExpression` (balanced-paren/bracket/brace
 *    tracking, string-literal-aware) — this is what lets a multi-line, `+`
 *    -concatenated message (exactly `verify-runner-service.ts:1470`'s shape)
 *    be read as ONE logical string, not three unrelated line fragments.
 * 3. `MENTION_ANCHOR` finds every `` `lore <word>``, `'lore <word>`, `"lore
 *    <word>` `` occurrence inside that expression text — the preceding quote/
 *    backtick character is REQUIRED so plain prose ("the lore corpus itself")
 *    is never mistaken for a command suggestion (measured false-positive:
 *    `check-no-timer-retry.ts:213`'s "no lore corpus found..." — "lore" there is
 *    preceded by a space, never matched).
 * 4. For each mention, a TOKEN-WALK collects flags: `--flag`-shaped tokens are
 *    ALWAYS collected (until stopped); the FIRST bare lowercase word right after
 *    the top-level command is allowed through as a candidate subcommand (`rm`,
 *    `add/set`, ...) WITHOUT stopping the walk; any SECOND (or later) bare word
 *    STOPS collection outright — this is the single rule that tells
 *    `lore ac rm --force <spec> <id>` (a real invocation: one bare word, then
 *    flags/placeholders) apart from `lore verify path is reachable ONLY for a
 *    SPEC-069 --adhoc task` (prose: "path", then "is" — a second bare word — STOPS
 *    before ever reaching `--adhoc`). Placeholder tokens (`<spec>`, `${x.y}`)
 *    are invisible to the token regex (no character class hit), so they never
 *    count as "a bare word" either way.
 * 5. Each mention is checked against the REAL CLI, driven live via `--help`
 *    (spawned against THIS worktree's own `packages/lore/src/index.ts`, never
 *    the global `lore` symlink, which may point at stale `dist/` — repo
 *    standing lesson). The root's `USAGE` line is the subcommand-existence SSOT
 *    (a `|`-joined run after the command path — absent for a leaf command, e.g.
 *    `verify [OPTIONS] [PLAN]` has none, so `lore verify --help`'s own bare-word
 *    mentions are structurally never checked as subcommands). Leaf commands'
 *    `OPTIONS` section is the flag-existence SSOT — `--help` itself is always
 *    exempt (framework-provided, never listed in a command's own declared args).
 *
 * Coverage (six dimensions):
 *   HAPPY — the real tree scans clean (0 violations) after this task's `ac set`
 *     wiring; the real tree yields a non-trivial mention count (loud-zero: the
 *     scanner is not vacuously matching nothing); a fixture pointing at a REAL
 *     flag passes (RED (b) — proves the scanner is not just always-failing).
 *   NEGATIVE — unquoted "lore <word>" prose is never matched; a flag mentioned
 *     only AFTER an intervening prose word is never checked; `--help` is never
 *     flagged as unknown.
 *   BOUNDARY — multiple command mentions in ONE message don't bleed flags across
 *     each other; a slash-joined subcommand alternative (`add/set`) checks BOTH
 *     candidates; a multi-alias OPTIONS row (`--yes, --allow-new-commands`)
 *     parses both names; a defaulted flag row (``--type="relates-to"``) parses to
 *     the bare flag name; a JSDoc-commented example is never scanned.
 *   ERROR (RED, both required per AC-FR-9) — (a) a real subcommand pointed at a
 *     flag it does not accept fails naming the message's file:line; an unknown
 *     subcommand and an unknown top-level command are likewise violations.
 *   STATE — scanning is read-only and idempotent; two runs over the same fixture
 *     tree produce identical results and touch nothing on disk.
 *   REGRESSION — the EXACT measured offender (`verify-runner-service.ts`'s
 *     `verify.falsifier` guard message) is pinned clean now that `ac set` accepts
 *     the flags it names; `stripComments` preserves length/newline-count exactly.
 *
 * @spec_ref spec-falsifiability-reachability-a-feedable-checkpoint-an AC-FR-9
 * @spec_ref task-make-lore-ac-set-accept-the-falsifier-flags-its-own-error
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, type Dirent } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

/**
 * Production scan roots for the real-tree assertions — `packages/dashboard` is
 * deliberately excluded (see this file's own module header, "OUT OF SCOPE").
 */
const SCAN_ROOTS: readonly string[] = ["packages/lore/src", "packages/core/src", "scripts"];

// ─── Comment stripping (preserves length + newline count exactly) ───────────

type StripState = "code" | "line" | "block" | "sq" | "dq" | "tmpl";

/**
 * Blanks `//` and `/* *\/` comments to spaces while preserving every OTHER
 * character's position — output length and newline count are IDENTICAL to the
 * input, so line numbers computed against the stripped text stay valid against
 * the original file. String/template literal content is never touched. NOT a
 * full JS/TS lexer — see this file's module header "Mechanism" step 1 for the
 * documented residual (bare regex literals, nested template interpolation).
 */
export function stripComments(source: string): string {
  const out: string[] = new Array(source.length);
  let state: StripState = "code";
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    const next = i + 1 < source.length ? source[i + 1] : undefined;
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        out[i] = " ";
        i += 1;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (ch === '"') {
        state = "dq";
        out[i] = ch;
        i += 1;
        continue;
      }
      if (ch === "'") {
        state = "sq";
        out[i] = ch;
        i += 1;
        continue;
      }
      if (ch === "`") {
        state = "tmpl";
        out[i] = ch;
        i += 1;
        continue;
      }
      out[i] = ch;
      i += 1;
      continue;
    }
    if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out[i] = "\n";
        i += 1;
        continue;
      }
      out[i] = " ";
      i += 1;
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
        continue;
      }
      out[i] = ch === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (state === "dq" || state === "sq") {
      const quote = state === "dq" ? '"' : "'";
      if (ch === "\\" && next !== undefined) {
        out[i] = ch;
        out[i + 1] = next;
        i += 2;
        continue;
      }
      if (ch === quote) {
        state = "code";
        out[i] = ch;
        i += 1;
        continue;
      }
      out[i] = ch;
      i += 1;
      continue;
    }
    // state === "tmpl"
    if (ch === "\\" && next !== undefined) {
      out[i] = ch;
      out[i + 1] = next;
      i += 2;
      continue;
    }
    if (ch === "`") {
      state = "code";
      out[i] = ch;
      i += 1;
      continue;
    }
    out[i] = ch;
    i += 1;
    continue;
  }
  return out.join("");
}

// ─── Expression extraction (balanced paren/bracket/brace, string-aware) ─────

interface ExtractedExpr {
  readonly text: string;
  readonly endIndex: number;
}

type ExprState = "code" | "sq" | "dq" | "tmpl";

/**
 * Reads a full logical expression starting at `startIndex` — used to turn a
 * `message:` field's value, or a `process.stderr.write(...)`/`console.error(...)`/
 * `throw new Error(...)` call's argument, into ONE string even when it is built
 * from several `+`-concatenated string/template literals across multiple lines
 * (`verify-runner-service.ts:1470`'s exact shape). Stops at the FIRST character
 * in `stopChars` encountered at bracket-depth 0 (never inside a nested
 * `(`/`[`/`{` or a string/template literal).
 */
export function extractExpression(
  source: string,
  startIndex: number,
  stopChars: ReadonlySet<string>,
): ExtractedExpr {
  let state: ExprState = "code";
  let depth = 0;
  let i = startIndex;
  let out = "";
  while (i < source.length) {
    const ch = source[i] as string;
    if (state === "code") {
      if (ch === '"') {
        state = "dq";
        out += ch;
        i += 1;
        continue;
      }
      if (ch === "'") {
        state = "sq";
        out += ch;
        i += 1;
        continue;
      }
      if (ch === "`") {
        state = "tmpl";
        out += ch;
        i += 1;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") {
        depth += 1;
        out += ch;
        i += 1;
        continue;
      }
      if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0 && stopChars.has(ch)) return { text: out, endIndex: i };
        depth = Math.max(0, depth - 1);
        out += ch;
        i += 1;
        continue;
      }
      if (depth === 0 && stopChars.has(ch)) return { text: out, endIndex: i };
      out += ch;
      i += 1;
      continue;
    }
    if (state === "dq" || state === "sq") {
      const quote = state === "dq" ? '"' : "'";
      if (ch === "\\" && i + 1 < source.length) {
        out += ch + (source[i + 1] as string);
        i += 2;
        continue;
      }
      if (ch === quote) {
        state = "code";
        out += ch;
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    // state === "tmpl"
    if (ch === "\\" && i + 1 < source.length) {
      out += ch + (source[i + 1] as string);
      i += 2;
      continue;
    }
    if (ch === "`") {
      state = "code";
      out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
    continue;
  }
  return { text: out, endIndex: source.length };
}

// ─── Anchors — the only four constructs treated as "error/refusal messages" ─

interface Anchor {
  readonly regex: RegExp;
  readonly stopChars: ReadonlySet<string>;
}

const FIELD_STOP: ReadonlySet<string> = new Set([",", "}"]);
const CALL_STOP: ReadonlySet<string> = new Set([")"]);

const ANCHORS: readonly Anchor[] = [
  { regex: /\bmessage:\s*/g, stopChars: FIELD_STOP },
  { regex: /\bprocess\.stderr\.write\(/g, stopChars: CALL_STOP },
  { regex: /\bconsole\.error\(/g, stopChars: CALL_STOP },
  { regex: /\bthrow new Error\(/g, stopChars: CALL_STOP },
];

// ─── Mention detection ───────────────────────────────────────────────────────

/** A quote/backtick char immediately before "lore <word>" — see module header step 3. */
const MENTION_ANCHOR = /[`'"]lore\s+([a-z][a-z0-9_-]*)/g;
/**
 * Either a `--flag`-shaped token, a `<placeholder>`/`${placeholder}` token (matched
 * WHOLESALE so its inner letters are never re-examined as a bare word — `<spec>`
 * must be transparent, not a disqualifying "second bare word"), or a bare
 * (optionally slash-joined) lowercase word. Order matters: placeholders are tried
 * BEFORE the bare-word branch so `<spec>`'s "spec" is consumed as part of the
 * placeholder match, never left for the bare-word alternative to also match.
 */
const TOKEN_PATTERN = /--[a-z][a-z0-9-]*|<[^>]*>|\$\{[^}]*\}|[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*/g;

export interface CommandMention {
  readonly topLevel: string;
  /** The first bare word after `topLevel`, if any — a CANDIDATE subcommand, unresolved. */
  readonly subCandidateRaw: string | undefined;
  readonly flags: readonly string[];
  /** Absolute index (into the CALLER's stripped source) of the mention's anchor character. */
  readonly absoluteIndex: number;
}

function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

/**
 * Finds every `lore <word>` mention inside `exprText` and, for each, walks the
 * following tokens per the rule this file's module header "Mechanism" step 4
 * documents: flags are always collected; the FIRST bare word is an allowed
 * subcommand candidate; any SECOND bare word stops collection. A mention's own
 * token-walk also stops at the START of the NEXT mention (belt-and-suspenders —
 * in practice the bare-word rule alone already stops before every observed
 * multi-mention message in this corpus, e.g. `commands/ac.ts`'s three-example
 * `--mode` refusal).
 *
 * @param exprAbsoluteStart - offset of `exprText`'s index 0 within the caller's
 *   stripped source — added to each mention's local match index so {@link
 *   CommandMention.absoluteIndex} is directly usable for line-number lookup.
 */
export function findMentions(exprText: string, exprAbsoluteStart: number): CommandMention[] {
  const anchorMatches = [...exprText.matchAll(MENTION_ANCHOR)];
  const mentions: CommandMention[] = [];
  for (let m = 0; m < anchorMatches.length; m++) {
    const match = anchorMatches[m] as RegExpMatchArray;
    const topLevel = match[1] as string;
    const matchIndex = match.index as number;
    const regionStart = matchIndex + match[0].length;
    const regionEnd = m + 1 < anchorMatches.length ? (anchorMatches[m + 1] as RegExpMatchArray).index as number : exprText.length;
    const regionText = exprText.slice(regionStart, regionEnd);

    const tokens = [...regionText.matchAll(TOKEN_PATTERN)].map((t) => t[0]);
    let subCandidateRaw: string | undefined;
    const flags: string[] = [];
    let bareWordsSeen = 0;
    for (const token of tokens) {
      if (token.startsWith("--")) {
        flags.push(token);
        continue;
      }
      if (token.startsWith("<") || token.startsWith("$")) {
        continue; // placeholder — transparent, never counts as a bare word
      }
      bareWordsSeen += 1;
      if (bareWordsSeen === 1) {
        subCandidateRaw = token;
        continue;
      }
      break; // second+ bare word — stop collecting for THIS mention
    }

    mentions.push({
      topLevel,
      subCandidateRaw,
      flags: dedupe(flags),
      absoluteIndex: exprAbsoluteStart + matchIndex,
    });
  }
  return mentions;
}

function lineNumberAt(source: string, index: number): number {
  let line = 1;
  const bound = Math.min(index, source.length);
  for (let i = 0; i < bound; i++) {
    if (source[i] === "\n") line += 1;
  }
  return line;
}

// ─── Real CLI driver (memoized) ──────────────────────────────────────────────

/**
 * Spawns `bun run <THIS WORKTREE's index.ts> <cmdPath...> --help` — deliberately
 * the SOURCE entry, never the global `lore` symlink (which points at the MAIN
 * checkout's `dist/` and may be stale relative to this worktree's changes).
 */
function runHelp(cmdPath: readonly string[]): string {
  const result = spawnSync("bun", ["run", LORE_ENTRY, ...cmdPath, "--help"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 5 * 1024 * 1024,
    // reason: BR-1371 fits help to 100 columns off a TTY, which wraps the USAGE pipe list and cuts it at a word
    // boundary ("...|r\n  eject"); the parser below needs the list on one line, so ask for a width nothing exceeds.
    env: { ...process.env, CLAUDECODE: "1", COLUMNS: "1000" },
  });
  if (result.status !== 0 || typeof result.stdout !== "string") {
    throw new Error(
      `error-message-commands-executable: 'lore ${cmdPath.join(" ")} --help' exited ` +
        `${String(result.status)} (expected 0) — cannot validate suggested commands against a ` +
        `CLI surface this probe cannot even query. stderr: ${result.stderr ?? "(none)"}`,
    );
  }
  return result.stdout;
}

const USAGE_LINE_PATTERN = /USAGE\s+`([^`]+)`/;
const PIPE_LIST_PATTERN = /[a-z][a-z0-9_-]*(?:\|[a-z][a-z0-9_-]*)+/;

/** Extracts the SSOT subcommand set from a `--help` USAGE line, or `null` for a leaf command. */
export function parseUsageSubcommands(stdout: string): Set<string> | null {
  const usageMatch = USAGE_LINE_PATTERN.exec(stdout);
  if (usageMatch === null) {
    throw new Error(`error-message-commands-executable: no USAGE line found in --help output:\n${stdout}`);
  }
  const pipeMatch = PIPE_LIST_PATTERN.exec(usageMatch[1] as string);
  return pipeMatch === null ? null : new Set(pipeMatch[0].split("|"));
}

/** Extracts every `--flag` name declared under the OPTIONS section, plus the always-exempt `--help`. */
export function parseOptionFlags(stdout: string): Set<string> {
  const flags = new Set<string>(["--help"]);
  const optionsIndex = stdout.indexOf("OPTIONS\n");
  if (optionsIndex === -1) return flags;
  const region = stdout.slice(optionsIndex);
  for (const rowMatch of region.matchAll(/`([^`]+)`/g)) {
    const raw = rowMatch[1] as string;
    for (const piece of raw.split(",")) {
      const flagMatch = /^\s*(--[a-z][a-z0-9-]*)/.exec(piece);
      if (flagMatch !== null) flags.add(flagMatch[1] as string);
    }
  }
  return flags;
}

interface CommandSurface {
  readonly hasSubcommands: boolean;
  readonly subcommands: ReadonlySet<string>;
  readonly flags: ReadonlySet<string>;
}

const surfaceCache = new Map<string, CommandSurface>();

/** Memoized real-CLI surface for one command path (e.g. `[]`, `["ac"]`, `["ac", "set"]`). */
function commandSurface(cmdPath: readonly string[]): CommandSurface {
  const key = cmdPath.join(" ");
  const cached = surfaceCache.get(key);
  if (cached !== undefined) return cached;
  const stdout = runHelp(cmdPath);
  const subcommands = parseUsageSubcommands(stdout);
  const surface: CommandSurface =
    subcommands !== null
      ? { hasSubcommands: true, subcommands, flags: new Set() }
      : { hasSubcommands: false, subcommands: new Set(), flags: parseOptionFlags(stdout) };
  surfaceCache.set(key, surface);
  return surface;
}

function topLevelCommands(): ReadonlySet<string> {
  const surface = commandSurface([]);
  if (!surface.hasSubcommands) {
    throw new Error("error-message-commands-executable: root 'lore --help' unexpectedly has no subcommand list");
  }
  return surface.subcommands;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

/** Validates ONE mention against the real CLI — see module header "Mechanism" step 5. */
export function validateMention(mention: CommandMention, file: string, line: number): Violation[] {
  const violations: Violation[] = [];
  if (!topLevelCommands().has(mention.topLevel)) {
    violations.push({ file, line, reason: `unknown top-level command "lore ${mention.topLevel}"` });
    return violations;
  }

  const topSurface = commandSurface([mention.topLevel]);

  if (topSurface.hasSubcommands) {
    if (mention.subCandidateRaw === undefined) return violations; // documented scope limit — see header
    const candidates = mention.subCandidateRaw.split("/");
    const validCandidates: string[] = [];
    for (const candidate of candidates) {
      if (!topSurface.subcommands.has(candidate)) {
        violations.push({
          file,
          line,
          reason:
            `unknown subcommand "lore ${mention.topLevel} ${candidate}" (declared: ` +
            `${[...topSurface.subcommands].join(", ")})`,
        });
      } else {
        validCandidates.push(candidate);
      }
    }
    for (const candidate of validCandidates) {
      const subSurface = commandSurface([mention.topLevel, candidate]);
      for (const flag of mention.flags) {
        if (!subSurface.flags.has(flag)) {
          violations.push({
            file,
            line,
            reason: `flag "${flag}" is not accepted by "lore ${mention.topLevel} ${candidate}"`,
          });
        }
      }
    }
    return violations;
  }

  // Leaf command — subCandidateRaw is a positional VALUE (doc type, checkpoint name,
  // topic, ...), never validated as a subcommand.
  for (const flag of mention.flags) {
    if (!topSurface.flags.has(flag)) {
      violations.push({ file, line, reason: `flag "${flag}" is not accepted by "lore ${mention.topLevel}"` });
    }
  }
  return violations;
}

// ─── Source-tree scanning ────────────────────────────────────────────────────

export function isScannableSourceFile(relPath: string): boolean {
  if (!relPath.endsWith(".ts")) return false;
  if (relPath.endsWith(".d.ts")) return false;
  if (relPath.endsWith(".test.ts") || relPath.endsWith(".bun.test.ts")) return false;
  if (relPath.includes("/tests/") || relPath.startsWith("tests/")) return false;
  if (relPath.includes("/generated/") || relPath.includes("/node_modules/") || relPath.includes("/dist/")) return false;
  return true;
}

const SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", "generated"]);

function walk(absDir: string, relDir: string, out: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    const absPath = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(absPath, relPath, out);
    } else if (entry.isFile() && isScannableSourceFile(relPath)) {
      out.push(relPath);
    }
  }
}

export interface ScanResult {
  readonly violations: Violation[];
  readonly mentionCount: number;
  readonly filesScanned: number;
}

/** Scans `root`'s `relRoots` for command mentions and validates each against the real CLI. */
export function scanTree(root: string, relRoots: readonly string[]): ScanResult {
  const files: string[] = [];
  for (const relRoot of relRoots) {
    // reason: "." (used by fixture tests to scan a scratch root directly) collapses
    // to the empty base so reported paths read as "foo.ts", not "./foo.ts" —
    // matches every real relRoot (e.g. "packages/lore/src"), which never starts "./".
    walk(join(root, relRoot), relRoot === "." ? "" : relRoot, files);
  }

  let mentionCount = 0;
  const violations: Violation[] = [];
  for (const relPath of files) {
    const raw = readFileSync(join(root, relPath), "utf8");
    const stripped = stripComments(raw);
    for (const anchor of ANCHORS) {
      for (const anchorMatch of stripped.matchAll(anchor.regex)) {
        const startIndex = (anchorMatch.index as number) + anchorMatch[0].length;
        const { text } = extractExpression(stripped, startIndex, anchor.stopChars);
        const mentions = findMentions(text, startIndex);
        mentionCount += mentions.length;
        for (const mention of mentions) {
          const line = lineNumberAt(stripped, mention.absoluteIndex);
          violations.push(...validateMention(mention, relPath, line));
        }
      }
    }
  }
  return { violations, mentionCount, filesScanned: files.length };
}

// ─── Fixture helpers ─────────────────────────────────────────────────────────

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function makeScratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "error-message-commands-"));
  scratchDirs.push(dir);
  return dir;
}

function writeFixture(root: string, relPath: string, content: string): void {
  const abs = join(root, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

// ─── Tests ────────────────────────────────────────────────────────────────────
// Named "suggested-commands-resolve" so `-t suggested-commands-resolve` (this
// AC's declared oracle command) selects every test in this file.

describe("suggested-commands-resolve — AC-FR-9 suggested-command integrity", () => {
  // ─── HAPPY ──────────────────────────────────────────────────────────────

  describe("HAPPY", () => {
    it("the real corpus tree resolves cleanly — 0 violations after the ac-set falsifier wiring", () => {
      const result = scanTree(REPO_ROOT, SCAN_ROOTS);
      expect(result.violations).toEqual([]);
    });

    it("loud-zero: the real tree yields a non-trivial mention count (the scanner is not vacuous)", () => {
      const result = scanTree(REPO_ROOT, SCAN_ROOTS);
      expect(result.mentionCount).toBeGreaterThan(15);
      expect(result.filesScanned).toBeGreaterThan(50);
    });

    it("RED (b): a message naming a flag that DOES exist passes — proves the scanner is not always-failing", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "good.ts",
        'function build() {\n  return { code: "VALIDATION_ERROR", message: "run `lore ac set --statement <text> <spec> <id>` to fix" };\n}\n',
      );
      const result = scanTree(root, ["."]);
      expect(result.violations).toEqual([]);
      expect(result.mentionCount).toBe(1);
    });
  });

  // ─── NEGATIVE ───────────────────────────────────────────────────────────

  describe("NEGATIVE", () => {
    it("unquoted prose mentioning 'lore <word>' is never matched", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "prose.ts",
        'function build() {\n  return { code: "STORE_ERROR", message: "no lore corpus found here" };\n}\n',
      );
      const result = scanTree(root, ["."]);
      expect(result.mentionCount).toBe(0);
      expect(result.violations).toEqual([]);
    });

    it("a flag mentioned only AFTER an intervening prose word is never checked (documented conservative miss)", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "prose-flag.ts",
        "function build() {\n" +
          '  return {\n' +
          '    code: "VALIDATION_ERROR",\n' +
          '    message:\n' +
          '      "the no-PLAN-positional lore verify path is reachable ONLY for a SPEC-069 " +\n' +
          '      "--adhoc task. Pass the PLAN positional instead.",\n' +
          "  };\n}\n",
      );
      const result = scanTree(root, ["."]);
      // "verify" is a real leaf command; "path" is the one allowed bare word, "is" is
      // the second bare word that stops the walk — "--adhoc" (which is not even a
      // real `verify` flag) must never be reached or reported.
      expect(result.violations).toEqual([]);
    });

    it("--help is never flagged as an unknown flag", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "help-flag.ts",
        'function build() {\n  return { code: "VALIDATION_ERROR", message: "see \'lore verify --help\'." };\n}\n',
      );
      const result = scanTree(root, ["."]);
      expect(result.violations).toEqual([]);
    });
  });

  // ─── BOUNDARY ───────────────────────────────────────────────────────────

  describe("BOUNDARY", () => {
    it("three command mentions in ONE message don't bleed flags across each other", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "multi-mention.ts",
        "function build() {\n" +
          "  process.stderr.write(\n" +
          '    "Error: --mode cannot be changed via `lore ac set` — use `lore ac rm --force <spec> <id>` " +\n' +
          '      "then `lore ac add <spec> <id> --mode <new-mode> ...` instead.\\n",\n' +
          "  );\n}\n",
      );
      const result = scanTree(root, ["."]);
      expect(result.mentionCount).toBe(3);
      expect(result.violations).toEqual([]);
    });

    it("a bad flag on the THIRD of three mentions is attributed to that mention alone", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "multi-mention-bad.ts",
        "function build() {\n" +
          "  process.stderr.write(\n" +
          '    "Error: via `lore ac set` — use `lore ac rm --force <spec> <id>` " +\n' +
          '      "then `lore ac add <spec> <id> --bogus-flag <x>` instead.\\n",\n' +
          "  );\n}\n",
      );
      const result = scanTree(root, ["."]);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.reason).toContain("--bogus-flag");
      expect(result.violations[0]?.reason).toContain("lore ac add");
    });

    it("a slash-joined subcommand alternative (add/set) checks BOTH candidates", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "slash.ts",
        "function build() {\n" +
          "  return {\n" +
          '    code: "VALIDATION_ERROR",\n' +
          "    message:\n" +
          "      `AC declares no falsifier — declare one first ('lore ac add/set ` +\n" +
          '      "<spec> <id> --falsifier-path <p> --falsifier-find <f> --falsifier-replace " +\n' +
          '      "<r> --falsifier-exit-code <n>\')",\n' +
          "  };\n}\n",
      );
      const result = scanTree(root, ["."]);
      expect(result.violations).toEqual([]);
      expect(result.mentionCount).toBe(1);
    });

    it("a slash-joined alternative naming ONE real and ONE fake subcommand flags only the fake one", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "slash-bad.ts",
        "function build() {\n" +
          "  return {\n" +
          '    code: "VALIDATION_ERROR",\n' +
          "    message: \"declare one first ('lore ac set/bogus --statement <s> <spec> <id>')\",\n" +
          "  };\n}\n",
      );
      const result = scanTree(root, ["."]);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.reason).toContain('unknown subcommand "lore ac bogus"');
    });

    it("a multi-alias OPTIONS row (--yes, --allow-new-commands) parses BOTH names — real CLI probe", () => {
      const flags = parseOptionFlags(runHelp(["verify"]));
      expect(flags.has("--yes")).toBe(true);
      expect(flags.has("--allow-new-commands")).toBe(true);
    });

    it("a defaulted flag row (--type=\"relates-to\") parses to the bare flag name — real CLI probe", () => {
      const flags = parseOptionFlags(runHelp(["link"]));
      expect(flags.has("--type")).toBe(true);
      expect([...flags].some((f) => f.includes("="))).toBe(false);
    });

    it("a JSDoc-commented example naming a bad flag is never scanned (comment-stripping)", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "jsdoc.ts",
        "/**\n * Usage: `lore ac set <spec> <id> --totally-bogus-flag <x>`\n */\n" +
          "function build() {\n  return 1;\n}\n",
      );
      const result = scanTree(root, ["."]);
      expect(result.mentionCount).toBe(0);
      expect(result.violations).toEqual([]);
    });
  });

  // ─── ERROR (RED, both required per AC-FR-9) ────────────────────────────

  describe("ERROR — RED-first (both directions required)", () => {
    it("RED (a): a REAL subcommand pointed at a flag it does NOT accept fails naming file:line", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "bad-flag.ts",
        "function build() {\n" +
          "  return {\n" +
          '    code: "VALIDATION_ERROR",\n' +
          "    message:\n" +
          "      \"declare one first ('lore ac set <spec> <id> --totally-bogus-flag <p>')\",\n" +
          "  };\n}\n",
      );
      const result = scanTree(root, ["."]);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.file).toBe("bad-flag.ts");
      expect(result.violations[0]?.line).toBe(5);
      expect(result.violations[0]?.reason).toContain("--totally-bogus-flag");
    });

    it("an unknown subcommand is a violation naming the bogus subcommand", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "bad-sub.ts",
        'function build() {\n  return { code: "VALIDATION_ERROR", message: "run `lore ac bogus <spec> <id>`" };\n}\n',
      );
      const result = scanTree(root, ["."]);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.reason).toContain('unknown subcommand "lore ac bogus"');
    });

    it("an unknown top-level command is a violation naming the bogus command", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "bad-top.ts",
        'function build() {\n  return { code: "VALIDATION_ERROR", message: "run `lore bogus-command --flag`" };\n}\n',
      );
      const result = scanTree(root, ["."]);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.reason).toBe('unknown top-level command "lore bogus-command"');
    });

    it("the ORIGINAL measured offender shape (falsifier flags on ac set) is RED before this task's fix", () => {
      // reason: reconstructs the EXACT pre-fix message content (from verify-runner-
      // service.ts's own history) and asserts the flags it names are checked against
      // "ac set" specifically — this is what would have failed loudly had `ac set`
      // still not accepted the falsifier flags. Guards against the scanner itself
      // silently degrading (e.g. if `ac set`'s surface probe were ever pointed at
      // the wrong subcommand).
      const mentions = findMentions(
        "AC declares no falsifier — declare one first ('lore ac add/set <spec> <id> " +
          "--falsifier-path <p> --falsifier-find <f> --falsifier-replace <r> " +
          "--falsifier-exit-code <n>') before running the attested-red path",
        0,
      );
      expect(mentions).toHaveLength(1);
      expect(mentions[0]?.subCandidateRaw).toBe("add/set");
      expect(mentions[0]?.flags).toEqual([
        "--falsifier-path",
        "--falsifier-find",
        "--falsifier-replace",
        "--falsifier-exit-code",
      ]);
      const setSurface = commandSurface(["ac", "set"]);
      for (const flag of mentions[0]?.flags ?? []) expect(setSurface.flags.has(flag)).toBe(true);
    });
  });

  // ─── STATE ──────────────────────────────────────────────────────────────

  describe("STATE", () => {
    it("scanning is read-only and idempotent — two runs over the same fixture tree agree and touch nothing", () => {
      const root = makeScratchDir();
      writeFixture(
        root,
        "stable.ts",
        'function build() {\n  return { code: "VALIDATION_ERROR", message: "run `lore ac set --statement <s> <spec> <id>`" };\n}\n',
      );
      const before = readdirSync(root).sort();
      const first = scanTree(root, ["."]);
      const second = scanTree(root, ["."]);
      expect(second).toEqual(first);
      expect(readdirSync(root).sort()).toEqual(before);
    });
  });

  // ─── REGRESSION ─────────────────────────────────────────────────────────

  describe("REGRESSION", () => {
    it("stripComments preserves length and newline count exactly", () => {
      const source = 'a(); // comment\n/* block\n   comment */\nconst s = "// not a comment";\nb();\n';
      const stripped = stripComments(source);
      expect(stripped.length).toBe(source.length);
      expect(stripped.split("\n")).toHaveLength(source.split("\n").length);
      expect(stripped).toContain('"// not a comment"');
    });

    it("the exact measured offender file (verify-runner-service.ts) scans clean on its own", () => {
      const relPath = "packages/lore/src/service/verify-runner-service.ts";
      const raw = readFileSync(join(REPO_ROOT, relPath), "utf8");
      expect(raw).toContain("lore ac add/set");
      const stripped = stripComments(raw);
      const violations: Violation[] = [];
      for (const anchor of ANCHORS) {
        for (const anchorMatch of stripped.matchAll(anchor.regex)) {
          const startIndex = (anchorMatch.index as number) + anchorMatch[0].length;
          const { text } = extractExpression(stripped, startIndex, anchor.stopChars);
          for (const mention of findMentions(text, startIndex)) {
            violations.push(...validateMention(mention, relPath, lineNumberAt(stripped, mention.absoluteIndex)));
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });
});

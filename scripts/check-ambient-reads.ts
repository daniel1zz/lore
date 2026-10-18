#!/usr/bin/env bun
/**
 * Ambient-read oracle (`bun run check:ambient-reads`) — AC-IV-6 / AC-IV-7 of
 * `spec-ambient-state-is-read-once-at-the-entry-owned-only-prune`, rule AS-26.
 *
 * Only the program entry may read process-wide ambient state (env, cwd, home,
 * temp dir, user, host, argv, executable path). This script makes that boundary
 * enforced instead of remembered: it scans `packages/core/src` and
 * `packages/lore/src` (non-test `.ts`) for the D5 banned tokens.
 *
 * ## Banned tokens + allowlist are READ FROM THE SPEC (same source as
 * check-no-timer-retry: the lore corpus row, no second copy to drift)
 * The spec's D5 bullet is the SSOT. Parsing is guarded by minimum counts so a
 * reworded bullet fails loud (exit 2) instead of silently narrowing the check.
 * Two structural patterns are added here because a token list cannot express
 * them: destructuring from the global (`const { env } = process`, `} = Bun`).
 * `import { homedir } from "node:os"` is caught by the `homedir(` call token.
 *
 * ## Allowlist semantics
 * Allowlisted files are EXEMPT from counting (the entry may read). A
 * not-yet-created allowlisted file (invocation-node.ts today) is TOLERATED:
 * the allowlist is an exemption, not a scan target, and a missing exempt file
 * cannot hide a read. A missing SCAN ROOT is different — it would measure
 * nothing — so it is a hard failure (exit 2).
 *
 * ## Ledger (ratchet, INV-3) — `scripts/ambient-read-ledger.json`
 * `{ "<file>": <count> }` of tolerated pre-migration sites. Count above ledger
 * fails; below ledger also fails (lower the ledger); a non-allowlisted file with
 * hits and no entry fails. `--ledger-empty` exits 1 while the ledger has any
 * entry (AC-IV-7), 0 when empty.
 *
 * ## Comment / string handling (documented edge cases)
 * Comments (line, block) and the CONTENT of string/template literals are
 * blanked before matching, preserving line numbers; `${...}` expressions inside
 * templates stay code. Regex literals are not tokenised: a regex literal that
 * contains an unbalanced quote or `//` can confuse the blanker (accepted;
 * the ledger ratchet shows any count shift).
 *
 * Exit codes: 0 pass / 1 violations (or ledger non-empty with --ledger-empty) /
 * 2 precondition failure (no corpus, D5 unparseable, scan root missing,
 * bad ledger) — never reported as clean.
 *
 * Flags (test seams): `--root <dir>`, `--ledger <file>`, `--ledger-empty`.
 * Side effects: `main` reads corpus + files, writes stdout/stderr.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SPEC_SLUG = "spec-ambient-state-is-read-once-at-the-entry-owned-only-prune";
export const RULE_TAG = "[AS-26]";
export const SCAN_ROOTS = ["packages/core/src", "packages/lore/src"] as const;
/** D5 lists 13 tokens and 5 allowlisted paths; fewer parsed means a narrowed parse. */
export const MIN_DECLARED_TOKENS = 13;
export const MIN_ALLOWLIST_PATHS = 5;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_LEDGER = join(SCRIPT_DIR, "ambient-read-ledger.json");

/** Destructuring from the global cannot be a token; matched structurally. */
const DESTRUCTURE_PATTERNS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: "} = process", pattern: /\}\s*=\s*process(?![A-Za-z0-9_$])/g },
  { label: "} = Bun", pattern: /\}\s*=\s*Bun(?![A-Za-z0-9_$])/g },
];

export class AmbientReadCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbientReadCheckError";
  }
}

export interface AmbientSite {
  readonly path: string;
  readonly line: number;
  readonly token: string;
}

export interface D5Targets {
  readonly tokens: string[];
  readonly allowlist: string[];
}

/**
 * Parses D5's banned tokens and allowlist out of the spec markdown.
 * @throws AmbientReadCheckError when D5 is absent or either list is narrower than documented
 */
export function extractD5Targets(specMarkdown: string): D5Targets {
  const lines = specMarkdown.split("\n");
  const start = lines.findIndex((line) => /^\s*(?:[-*]\s+)?\*\*D5\b/.test(line));
  if (start === -1) {
    throw new AmbientReadCheckError(`could not find D5 in ${SPEC_SLUG} — fix the parser or the spec`);
  }
  const block: string[] = [lines[start] as string];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (/^\s*(?:[-*]\s+)?\*\*D\d/.test(line) || /^#{1,6}\s/.test(line)) break;
    block.push(line);
  }
  const text = block.join("\n");
  const bannedFrom = text.indexOf("Banned tokens:");
  const notBannedFrom = text.indexOf("Not banned");
  const allowFrom = text.indexOf("Allowlist");
  if (bannedFrom === -1 || notBannedFrom === -1 || allowFrom === -1 || !(bannedFrom < notBannedFrom && notBannedFrom < allowFrom)) {
    throw new AmbientReadCheckError("D5 no longer has the 'Banned tokens: … Not banned … Allowlist' shape — fix the parser or the spec");
  }
  const ticks = (segment: string): string[] =>
    [...segment.matchAll(/`([^`\n]+)`/g)].map((m) => (m[1] as string).trim());
  const tokens = [...new Set(ticks(text.slice(bannedFrom, notBannedFrom)))];
  const allowEnd = text.indexOf("any other ambient read", allowFrom);
  const allowlist = [
    ...new Set(
      ticks(text.slice(allowFrom, allowEnd === -1 ? undefined : allowEnd)).filter((v) => /^packages\/[A-Za-z0-9._/-]+\.ts$/.test(v)),
    ),
  ];
  if (tokens.length < MIN_DECLARED_TOKENS) {
    throw new AmbientReadCheckError(`parsed only ${tokens.length} banned token(s) from D5 (expected >= ${MIN_DECLARED_TOKENS}) — refusing a narrowed check`);
  }
  if (allowlist.length < MIN_ALLOWLIST_PATHS) {
    throw new AmbientReadCheckError(`parsed only ${allowlist.length} allowlist path(s) from D5 (expected >= ${MIN_ALLOWLIST_PATHS}) — refusing a narrowed check`);
  }
  return { tokens, allowlist };
}

/**
 * Blanks comments and string/template-literal contents, preserving every
 * newline and column so line numbers survive. `${…}` in templates stays code.
 */
export function stripCommentsAndStrings(source: string): string {
  const out: string[] = [];
  // Stack of template contexts: each entry is the brace depth at which `${` was opened.
  const templateStack: number[] = [];
  let braceDepth = 0;
  let i = 0;
  const blank = (ch: string): string => (ch === "\n" ? "\n" : " ");
  const readQuoted = (quote: string): void => {
    out.push(quote);
    i++;
    while (i < source.length) {
      const ch = source[i] as string;
      if (ch === "\\") {
        out.push(" ", blank(source[i + 1] ?? " "));
        i += 2;
        continue;
      }
      if (ch === quote) {
        out.push(quote);
        i++;
        return;
      }
      if (ch === "\n") return; // unterminated on this line: bail out rather than swallow the file
      out.push(" ");
      i++;
    }
  };
  const readTemplateChunk = (): void => {
    // Positioned just after a backtick or after the closing `}` of a `${…}`.
    while (i < source.length) {
      const ch = source[i] as string;
      if (ch === "\\") {
        out.push(" ", blank(source[i + 1] ?? " "));
        i += 2;
      } else if (ch === "`") {
        out.push("`");
        i++;
        return;
      } else if (ch === "$" && source[i + 1] === "{") {
        out.push("${");
        i += 2;
        templateStack.push(braceDepth);
        braceDepth++;
        return;
      } else {
        out.push(blank(ch));
        i++;
      }
    }
  };
  while (i < source.length) {
    const ch = source[i] as string;
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out.push(" ");
        i++;
      }
    } else if (ch === "/" && next === "*") {
      out.push(" ", " ");
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out.push(blank(source[i] as string));
        i++;
      }
      if (i < source.length) {
        out.push(" ", " ");
        i += 2;
      }
    } else if (ch === '"' || ch === "'") {
      readQuoted(ch);
    } else if (ch === "`") {
      out.push("`");
      i++;
      readTemplateChunk();
    } else if (ch === "{") {
      braceDepth++;
      out.push(ch);
      i++;
    } else if (ch === "}") {
      braceDepth--;
      out.push(ch);
      i++;
      if (templateStack.length > 0 && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop();
        readTemplateChunk();
      }
    } else {
      out.push(ch);
      i++;
    }
  }
  return out.join("");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Finds every banned-token site in one file's source (comments/strings ignored). */
export function scanSource(path: string, source: string, tokens: readonly string[]): AmbientSite[] {
  const code = stripCommentsAndStrings(source);
  const lineStarts: number[] = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] as number) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const sites: AmbientSite[] = [];
  for (const token of tokens) {
    const tail = /[A-Za-z0-9_$]$/.test(token) ? "(?![A-Za-z0-9_$])" : "";
    const pattern = new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(token)}${tail}`, "g");
    for (const m of code.matchAll(pattern)) sites.push({ path, line: lineOf(m.index as number), token });
  }
  for (const { label, pattern } of DESTRUCTURE_PATTERNS) {
    for (const m of code.matchAll(pattern)) sites.push({ path, line: lineOf(m.index as number), token: label });
  }
  return sites.sort((a, b) => a.line - b.line || a.token.localeCompare(b.token));
}

const TEST_FILE = /\.(?:bun\.)?test\.ts$|\.d\.ts$/;

function listSourceFiles(absDir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const full = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      found.push(...listSourceFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !TEST_FILE.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

export interface CheckOutcome {
  readonly exitCode: 0 | 1;
  readonly lines: string[];
  readonly totalSites: number;
  readonly filesOverLedger: number;
}

/** Pure decision: sites per file + allowlist + ledger → outcome. */
export function evaluate(
  siteCounts: ReadonlyMap<string, readonly AmbientSite[]>,
  allowlist: readonly string[],
  ledger: Readonly<Record<string, number>>,
): CheckOutcome {
  const lines: string[] = [];
  let totalSites = 0;
  const bad = new Set<string>();
  const files = new Set<string>([...siteCounts.keys(), ...Object.keys(ledger)]);
  for (const file of [...files].sort()) {
    const exempt = allowlist.includes(file);
    const sites = exempt ? [] : (siteCounts.get(file) ?? []);
    const expected = ledger[file];
    if (exempt && expected !== undefined) {
      lines.push(`${file}: allowlisted entry file must not be in the ledger ${RULE_TAG}`);
      bad.add(file);
      continue;
    }
    totalSites += sites.length;
    if (sites.length > (expected ?? 0)) {
      for (const s of sites) lines.push(`${s.path}:${s.line} ${s.token} ${RULE_TAG}`);
      lines.push(`${file}: ${sites.length} site(s) exceed ledger ${expected ?? "(absent)"} ${RULE_TAG}`);
      bad.add(file);
    } else if (expected !== undefined && sites.length < expected) {
      lines.push(`${file}: ${sites.length} site(s) below ledger ${expected} — lower scripts/ambient-read-ledger.json (ratchet) ${RULE_TAG}`);
      bad.add(file);
    }
  }
  lines.push(`check:ambient-reads: ${totalSites} sites, ${bad.size} files over ledger`);
  if (bad.size === 0) lines.push("PASS");
  return { exitCode: bad.size === 0 ? 0 : 1, lines, totalSites, filesOverLedger: bad.size };
}

function resolveCorpusDbPath(root: string): string {
  const local = join(root, ".lore", "lore.db");
  if (existsSync(local)) return local;
  const repoLocal = join(DEFAULT_ROOT, ".lore", "lore.db");
  if (existsSync(repoLocal)) return repoLocal;
  const common = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: DEFAULT_ROOT, encoding: "utf8", timeout: 5000 });
  const candidate =
    common.status === 0 && common.stdout.trim().length > 0
      ? join(dirname(resolve(DEFAULT_ROOT, common.stdout.trim())), ".lore", "lore.db")
      : undefined;
  if (candidate !== undefined && existsSync(candidate)) return candidate;
  throw new AmbientReadCheckError(`no lore corpus found (looked at '${local}'${candidate ? ` and '${candidate}'` : ""}) — D5 is read from ${SPEC_SLUG}`);
}

async function readSpecMarkdown(dbPath: string): Promise<string> {
  const { Database } = await import("bun:sqlite");
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query("SELECT content FROM docs WHERE slug = ? AND deleted_at IS NULL").get(SPEC_SLUG) as { content?: unknown } | null;
    if (typeof row?.content !== "string" || row.content.trim().length === 0) {
      throw new AmbientReadCheckError(`spec '${SPEC_SLUG}' has no readable content in ${dbPath}`);
    }
    return row.content;
  } finally {
    db.close();
  }
}

function readLedger(path: string): Record<string, number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new AmbientReadCheckError(`cannot read ledger '${path}': ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AmbientReadCheckError(`ledger '${path}' must be a JSON object of file -> count`);
  }
  for (const [file, count] of Object.entries(parsed)) {
    if (!Number.isInteger(count) || (count as number) < 1) {
      throw new AmbientReadCheckError(`ledger entry '${file}' must be a positive integer (remove the entry at zero)`);
    }
  }
  return parsed as Record<string, number>;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined) throw new AmbientReadCheckError(`${flag} needs a value`);
  return value;
}

/** CLI entrypoint; returns the exit code (0/1). Precondition failures throw. */
export async function main(argv: readonly string[]): Promise<number> {
  const root = resolve(flagValue(argv, "--root") ?? DEFAULT_ROOT);
  const ledger = readLedger(resolve(flagValue(argv, "--ledger") ?? DEFAULT_LEDGER));

  if (argv.includes("--ledger-empty")) {
    const entries = Object.keys(ledger);
    if (entries.length > 0) {
      console.error(`check:ambient-reads --ledger-empty: ${entries.length} ledger entr${entries.length === 1 ? "y" : "ies"} remain ${RULE_TAG}`);
      for (const file of entries) console.error(`  ${file}: ${ledger[file]}`);
      return 1;
    }
    console.log("check:ambient-reads --ledger-empty: PASS (ledger empty)");
    return 0;
  }

  const { tokens, allowlist } = extractD5Targets(await readSpecMarkdown(resolveCorpusDbPath(root)));
  const siteMap = new Map<string, AmbientSite[]>();
  for (const scanRoot of SCAN_ROOTS) {
    const abs = join(root, scanRoot);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      throw new AmbientReadCheckError(`scan root '${scanRoot}' is missing under ${root} — a missing root would measure nothing`);
    }
    for (const file of listSourceFiles(abs)) {
      const rel = relative(root, file).split("\\").join("/");
      const sites = scanSource(rel, readFileSync(file, "utf8"), tokens);
      if (sites.length > 0) siteMap.set(rel, sites);
    }
  }
  const outcome = evaluate(siteMap, allowlist, ledger);
  const stream = outcome.exitCode === 0 ? console.log : console.error;
  for (const line of outcome.lines) stream(line);
  return outcome.exitCode;
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`check:ambient-reads could not run: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

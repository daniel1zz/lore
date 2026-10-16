#!/usr/bin/env bun
/**
 * Prose-pin oracle (`bun scripts/check-prose-pins.ts`) —
 * `spec-test-governance-guards-that-refuse-bad-tests-declared` AC-TG-4
 * (cites AS-15: shipped surfaces).
 *
 * Purpose: a test that asserts a whole sentence of SHIPPED or GOVERNING prose
 * (an `assets/**` template, a CLAUDE.md, a SKILL.md, a `.claude/rules` file, a
 * `docs/**` page) turns every wording edit of that prose into a red test: the
 * test pins the author's phrasing instead of a behavior. This script scans test
 * SOURCE (never runs anything) and fails loud when a test file that reads such
 * prose asserts, positively, a string or regex literal of {@link MIN_WORDS} or
 * more words that also occurs in the prose corpus.
 *
 * Public surface: `scanFile` (pure — one test file's source + the prose text →
 * pins), `checkLedger` (pure — pins vs exemption ledger; a stale entry fails),
 * `parseLedgerFile` (pure — Zod-validates ledger JSON), `buildProseIndex` (IO —
 * reads the prose corpus once into one normalised string), `main` (IO).
 * Exit codes: 0 clean, 1 unledgered pin or stale ledger entry (file:line
 * printed), 2 the scan itself could not complete.
 *
 * Decisions:
 *  - `docs/requirements/**` is the generated corpus mirror (thousands of files
 *    that quote specs, which in turn quote test strings). It is NOT counted as
 *    governing prose: counting it would flag every test that pins an error
 *    sentence a spec merely mentions. Every other `docs/**` page counts.
 *  - Only test files whose source mentions a prose location (see
 *    `READS_PROSE`) are scanned; a runtime-error-string test that never reads
 *    prose is out of scope even if the sentence also appears in a doc.
 *  - A literal starting with `#` is a heading used to locate a section, not a pin.
 *  - `.not.` assertions and identifier arguments (imported constants) are not
 *    pins.
 *
 * Side-effect class: `scanFile`/`checkLedger`/`parseLedgerFile` pure; the rest IO.
 *
 * @spec_ref spec-test-governance-guards-that-refuse-bad-tests-declared
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";

export const MIN_WORDS = 5;
export const LEDGER_RELATIVE_PATH = "scripts/prose-pin-ledger.json";

/** A test file is in scope only when its source names a prose location. */
const READS_PROSE =
  /assets\/|docs\/|CLAUDE\.md|SKILL\.md|\.claude\/rules|"assets"|"docs"/;

const ASSERTION = /\.(toContain|toMatch|includes)\(\s*/g;

export type ProsePin = {
  readonly path: string;
  readonly line: number;
  readonly literal: string;
};

const LedgerEntrySchema = z.object({
  file: z.string().min(1),
  literal_fingerprint: z.string().min(1),
  consumer: z.string().min(1),
  reason: z.string().min(1),
});
const LedgerSchema = z.object({ entries: z.array(LedgerEntrySchema) });
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export class ProsePinLedgerError extends Error {
  constructor(readonly reason: string, readonly cause_?: unknown) {
    super(`prose-pin ledger: ${reason}`);
    this.name = "ProsePinLedgerError";
  }
}

/** Lower-cases nothing; collapses all whitespace so wrapped prose still matches. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  return text.split(" ").filter((w) => /[A-Za-z]/.test(w)).length;
}

/** Reads one quoted literal starting at `start`; returns [kind, body, end] or null. */
function readLiteral(
  src: string,
  start: number,
): { kind: "string" | "regex"; body: string; end: number } | null {
  const q = src[start];
  if (q === '"' || q === "'" || q === "`") {
    let i = start + 1;
    let body = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\" && i + 1 < src.length) {
        const n = src[i + 1] as string;
        body += n === "n" || n === "t" ? " " : n;
        i += 2;
        continue;
      }
      if (q === "`" && src[i] === "$" && src[i + 1] === "{") return null; // interpolated: not a pure literal
      body += src[i];
      i++;
    }
    // A literal followed by `+` is a concatenation fragment, still a literal; keep it.
    return { kind: "string", body, end: i + 1 };
  }
  if (q === "/") {
    let i = start + 1;
    let inClass = false;
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") i += 2;
      else {
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        else if (c === "\n") return null;
        i++;
      }
    }
    return { kind: "regex", body: src.slice(start + 1, i), end: i + 1 };
  }
  return null;
}

/** Longest literal-text segment of a regex body (escapes undone, `\s` → space). */
function regexLiteralText(body: string): string {
  const text = body
    .replace(/\\s[+*]?/g, " ")
    .replace(/\\([^A-Za-z0-9])/g, "$1")
    .replace(/[()[\]{}|*+?^$]/g, "\u0000");
  const segments = text.split("\u0000").map(normalizeText);
  return segments.reduce((a, b) => (b.length > a.length ? b : a), "");
}

/**
 * Finds the positive prose pins of one test file.
 * @param path repo-relative path (reported verbatim)
 * @param source the file's text
 * @param proseText the normalised prose corpus (see {@link buildProseIndex})
 */
export function scanFile(
  path: string,
  source: string,
  proseText: string,
): ProsePin[] {
  if (!READS_PROSE.test(source)) return [];
  const pins: ProsePin[] = [];
  for (const m of source.matchAll(ASSERTION)) {
    const before = source.slice(Math.max(0, m.index - 12), m.index);
    if (/\.not$/.test(before)) continue;
    const lit = readLiteral(source, m.index + m[0].length);
    if (lit === null) continue;
    const text =
      lit.kind === "regex" ? regexLiteralText(lit.body) : normalizeText(lit.body);
    if (text.startsWith("#")) continue; // a markdown heading locates a section; it is not a phrasing pin
    if (wordCount(text) < MIN_WORDS || !proseText.includes(text)) continue;
    const line = source.slice(0, m.index).split("\n").length;
    pins.push({ path, line, literal: text });
  }
  return pins;
}

export type LedgerCheck = {
  readonly unledgered: readonly ProsePin[];
  readonly stale: readonly LedgerEntry[];
};

/** A ledger entry covers a pin iff file and literal fingerprint both match. */
export function checkLedger(
  pins: readonly ProsePin[],
  ledger: readonly LedgerEntry[],
): LedgerCheck {
  const covers = (e: LedgerEntry, p: ProsePin) =>
    e.file === p.path && e.literal_fingerprint === p.literal;
  return {
    unledgered: pins.filter((p) => !ledger.some((e) => covers(e, p))),
    stale: ledger.filter((e) => !pins.some((p) => covers(e, p))),
  };
}

export function parseLedgerFile(raw: string): LedgerEntry[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new ProsePinLedgerError("not valid JSON", err);
  }
  const parsed = LedgerSchema.safeParse(json);
  if (!parsed.success) throw new ProsePinLedgerError(parsed.error.message);
  return parsed.data.entries;
}

function walk(dir: string, keep: (p: string) => boolean, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
}

/** Reads the governing prose corpus once into a single normalised string. */
export function buildProseIndex(root: string): string {
  const files: string[] = [];
  const isMd = (p: string) => p.endsWith(".md");
  walk(join(root, "assets"), isMd, files);
  walk(
    join(root, "docs"),
    (p) => isMd(p) && !relative(root, p).startsWith("docs/requirements/"),
    files,
  );
  walk(join(root, ".claude", "rules"), isMd, files);
  walk(
    join(root, "packages"),
    (p) => p.endsWith("/CLAUDE.md") || p.endsWith("/SKILL.md"),
    files,
  );
  walk(root, (p) => p === join(root, "CLAUDE.md"), files);
  return files.map((f) => normalizeText(readFileSync(f, "utf8"))).join("\n");
}

/** Collects every in-scope test file under packages/**\/tests and scripts/tests. */
export function listTestFiles(root: string): string[] {
  const out: string[] = [];
  const isTest = (p: string) => /\.test\.ts$/.test(p);
  walk(join(root, "scripts", "tests"), isTest, out);
  walk(
    join(root, "packages"),
    (p) => isTest(p) && /\/tests\//.test(p),
    out,
  );
  return out.sort();
}

export function main(root: string = process.cwd()): number {
  try {
    const prose = buildProseIndex(root);
    const pins = listTestFiles(root).flatMap((f) =>
      scanFile(relative(root, f), readFileSync(f, "utf8"), prose),
    );
    const ledger = parseLedgerFile(
      readFileSync(join(root, LEDGER_RELATIVE_PATH), "utf8"),
    );
    const { unledgered, stale } = checkLedger(pins, ledger);
    for (const p of unledgered) {
      console.error(
        `${p.path}:${p.line}: prose pin — asserts shipped/governing prose "${p.literal.slice(0, 80)}"; assert a heading or key token, or ledger it in ${LEDGER_RELATIVE_PATH} with consumer + reason`,
      );
    }
    for (const e of stale) {
      console.error(
        `${LEDGER_RELATIVE_PATH}: stale entry for ${e.file} "${e.literal_fingerprint.slice(0, 80)}" — no such pin exists any more; delete the row`,
      );
    }
    if (unledgered.length + stale.length > 0) return 1;
    console.log(`check-prose-pins: ${pins.length} ledgered pin(s), 0 violations`);
    return 0;
  } catch (err) {
    console.error(`check-prose-pins: scan could not complete: ${String(err)}`);
    return 2;
  }
}

if (import.meta.main) process.exit(main());

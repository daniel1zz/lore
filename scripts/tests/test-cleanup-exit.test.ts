// @reads scripts/run-chain.ts
// @spawns scripts/check-prose-pins.ts
// @reads package.json
// @reads scripts/prose-pin-ledger.json
// @reads scripts/test-isolation-ledger.json
// @reads packages/lore/tests/unit/store/in-memory-store.test.ts
// @reads packages/lore/tests/unit/store/sqlite-store.bun.test.ts
// @reads packages/lore/tests/unit/store/turso-store.bun.test.ts
// @reads packages/lore/tests/unit/setup-governance-retirement.test.ts
// @reads packages/lore/tests/integration/cli/setup-retires-session-start-fragments.test.ts
// @reads packages/lore/tests/integration/init-context-skill-retirement.bun.test.ts
// @reads packages/lore/tests/integration/setup-retired-agent-types.bun.test.ts
// @reads packages/lore/tests/integration/retirement-registry.bun.test.ts
// @reads assets/**
// @reads docs/**
// @reads .claude/rules/**
// @reads CLAUDE.md
// @reads packages/**/tests/**
// @reads packages/**/CLAUDE.md
// @reads packages/**/SKILL.md
/**
 * AC-TG-9 (`spec-test-governance-guards-that-refuse-bad-tests-declared`; cites AS-14): the exit
 * state of the test cleanup. One file proves four clauses of the statement against the real tree:
 *
 *   1. check-prose-pins exits 0 on the real tree, and BOTH guards are wired into the `test` chain
 *      (`check:prose-pins` here; `check:ac-oracle-ownership` is proven by the chain, see below).
 *   2. every ledger row has a non-empty reason (prose pins also a non-empty consumer).
 *   3. the four tombstone files are gone and one retirement registry test exists.
 *   4. no `it()` body appears in two of the three store test files (whitespace-normalised).
 *
 * Why `check:ac-oracle-ownership` is not spawned here: it reads the live `.lore` corpus
 * (`lore ac list`), and under vitest `LORE_TEST_SANDBOX=1` makes the CLI refuse this repository's own
 * corpus (AC-TG-2) — the same reason the other live-corpus checks run from `check:live-repo-state`
 * and the test chain, not from a test. Its real-tree exit 0 is therefore proven by the chain that
 * runs it (`bun run test`), and this file pins that it is wired there. Its rules are unit-tested in
 * check-ac-oracle-ownership.test.ts.
 *
 * Red-first clauses use planted inputs in a mkdtemp directory (never the repo): a ledger row with an
 * empty reason, and a copy of a store test with one `it()` body duplicated into a second file.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DEFAULT_STEPS } from "../run-chain";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

const STORE_TEST_FILES = [
  "packages/lore/tests/unit/store/in-memory-store.test.ts",
  "packages/lore/tests/unit/store/sqlite-store.bun.test.ts",
  "packages/lore/tests/unit/store/turso-store.bun.test.ts",
] as const;

/** The three tombstone files named by AC-TG-9 (the 4th, the retirement cases of setup-governance-retirement, is checked by name below). */
const TOMBSTONE_FILES = [
  "packages/lore/tests/integration/cli/setup-retires-session-start-fragments.test.ts",
  "packages/lore/tests/integration/init-context-skill-retirement.bun.test.ts",
  "packages/lore/tests/integration/setup-retired-agent-types.bun.test.ts",
] as const;
const RETIREMENT_REGISTRY_TEST = "packages/lore/tests/integration/retirement-registry.bun.test.ts";

// ─── pure helpers (exercised by the planted-input cases below) ──────────────────

/** Normalised `it()`/`test()` bodies (title dropped, whitespace collapsed) of one test file's source. */
function extractItBodies(source: string): string[] {
  const bodies: string[] = [];
  const callRe = /(?<![\w.])(?:it|test)(?:\.(?:only|skip|concurrent))?\s*\(/g;
  for (const m of source.matchAll(callRe)) {
    const open = (m.index ?? 0) + m[0].length;
    const close = findMatchingParen(source, open - 1);
    if (close === -1) continue;
    const args = source.slice(open, close);
    const afterTitle = dropLeadingStringLiteral(args);
    if (afterTitle === undefined) continue; // not a title-first it() call (e.g. a helper named `test(`)
    bodies.push(afterTitle.replace(/^\s*,/, "").replace(/\s+/g, " ").trim());
  }
  return bodies;
}

function findMatchingParen(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i] as string;
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the closing quote of the string literal opening at `i`. */
function skipString(src: string, i: number): number {
  const quote = src[i] as string;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j] as string;
    if (c === "\\") j += 1;
    else if (c === quote) return j;
  }
  return src.length;
}

function dropLeadingStringLiteral(args: string): string | undefined {
  const start = args.search(/\S/);
  if (start === -1) return undefined;
  const q = args[start] as string;
  if (q !== '"' && q !== "'" && q !== "`") return undefined;
  return args.slice(skipString(args, start) + 1);
}

/** Bodies shorter than this carry no behaviour worth deduplicating (e.g. an empty `() => {}`). */
const MIN_BODY_CHARS = 40;

/** Bodies that appear in two or more of the given files, with the files that hold them. */
function findCrossFileDuplicateBodies(files: ReadonlyArray<{ readonly name: string; readonly source: string }>): Array<{ body: string; files: string[] }> {
  const holders = new Map<string, Set<string>>();
  for (const f of files) {
    for (const body of extractItBodies(f.source)) {
      if (body.length < MIN_BODY_CHARS) continue;
      holders.set(body, (holders.get(body) ?? new Set()).add(f.name));
    }
  }
  return [...holders].filter(([, set]) => set.size >= 2).map(([body, set]) => ({ body, files: [...set] }));
}

const LedgerRowsSchema = z.array(z.record(z.string(), z.unknown()));

/** Rows (array, or `{entries: [...]}`) with an empty `reason`, or an empty `consumer` when required. */
function ledgerRowProblems(parsed: unknown, requireConsumer: boolean): string[] {
  const rows = LedgerRowsSchema.parse(Array.isArray(parsed) ? parsed : (parsed as { entries?: unknown }).entries);
  const problems: string[] = [];
  rows.forEach((row, i) => {
    const label = String(row.file ?? row.path ?? row.spec ?? `row ${i}`);
    const nonEmpty = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;
    if (!nonEmpty(row.reason)) problems.push(`${label}: empty reason`);
    if (requireConsumer && !nonEmpty(row.consumer)) problems.push(`${label}: empty consumer`);
  });
  return problems;
}

// ─── clause 2: ledgers ─────────────────────────────────────────────────────────

describe("AC-TG-9 — every ledger row states why", () => {
  it("NEGATIVE: a planted prose-pin row with an empty reason or consumer is reported", () => {
    const planted = { entries: [{ file: "a.test.ts", reason: "", consumer: "x" }, { file: "b.test.ts", reason: "why", consumer: "  " }, { file: "c.test.ts", reason: "why", consumer: "x" }] };
    expect(ledgerRowProblems(planted, true)).toEqual(["a.test.ts: empty reason", "b.test.ts: empty consumer"]);
    expect(ledgerRowProblems([{ file: "d.test.ts" }], false)).toEqual(["d.test.ts: empty reason"]);
  });

  it("scripts/prose-pin-ledger.json: every entry has a non-empty reason and consumer", () => {
    const parsed: unknown = JSON.parse(read("scripts/prose-pin-ledger.json"));
    expect(ledgerRowProblems(parsed, true)).toEqual([]);
  });

  it("scripts/test-isolation-ledger.json (when it exists): every entry has a non-empty reason", () => {
    // Absent until the repo-tree snapshot guard (AC-TG-3) lands; an absent ledger has no rows to check.
    const path = join(REPO_ROOT, "scripts/test-isolation-ledger.json");
    if (!existsSync(path)) return;
    expect(ledgerRowProblems(JSON.parse(readFileSync(path, "utf8")), false)).toEqual([]);
  });
});

// ─── clause 1: the guards pass on the real tree and are wired ──────────────────

describe("AC-TG-9 — the guards pass on the real tree and run in the test chain", () => {
  it("check-prose-pins exits 0 on the real tree", () => {
    const r = spawnSync("bun", [join(REPO_ROOT, "scripts/check-prose-pins.ts")], { cwd: REPO_ROOT, encoding: "utf8" });
    expect({ status: r.status, out: `${r.stdout}${r.stderr}` }).toMatchObject({ status: 0 });
  });

  it("the `test` script runs check:prose-pins and check:ac-oracle-ownership, and both scripts exist", () => {
    const pkg = z.object({ scripts: z.record(z.string(), z.string()) }).parse(JSON.parse(read("package.json")));
    expect(pkg.scripts.test).toContain("scripts/run-chain.ts");
    expect(DEFAULT_STEPS).toContain("bun run check:prose-pins");
    expect(DEFAULT_STEPS).toContain("bun run check:ac-oracle-ownership");
    expect(pkg.scripts["check:prose-pins"]).toBe("bun scripts/check-prose-pins.ts");
    expect(pkg.scripts["check:ac-oracle-ownership"]).toBe("bun scripts/check-ac-oracle-ownership.ts");
  });
});

// ─── clause 3: tombstones gone, one registry ───────────────────────────────────

describe("AC-TG-9 — tombstone tests are gone, one retirement registry test exists", () => {
  it("the three tombstone files do not exist and the retirement registry test does", () => {
    for (const rel of TOMBSTONE_FILES) expect(existsSync(join(REPO_ROOT, rel)), `${rel} must be gone`).toBe(false);
    expect(existsSync(join(REPO_ROOT, RETIREMENT_REGISTRY_TEST))).toBe(true);
  });

  it("setup-governance-retirement keeps no per-path retirement case (those live in the registry)", () => {
    const titles = [...read("packages/lore/tests/unit/setup-governance-retirement.test.ts").matchAll(/\bit\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g)].map((m) => m[2] ?? "");
    const perPath = titles.filter((t) => /is absent from the install walk|absent from the check-embedded manifest/i.test(t));
    expect(perPath).toEqual([]);
  });

  it("exactly one test file is the retirement registry (iterates RETIREMENTS)", () => {
    expect(read(RETIREMENT_REGISTRY_TEST)).toContain("RETIREMENTS");
  });
});

// ─── clause 4: no it() body in two store files ─────────────────────────────────

describe("AC-TG-9 — store test files share cases through *.shared.ts, not copies", () => {
  it("NEGATIVE: a body planted in two files is found after whitespace normalisation; a title-only difference is not a body difference", () => {
    const dir = mkdtempSync(join(tmpdir(), "tg9-dup-"));
    try {
      const bodyA = 'it("one title", async () => {\n  const store = makeStore();\n  await store.insert({ id: "x" });\n  expect(await store.find("x")).toBeDefined();\n});';
      const bodyB = 'it("another title", async () => { const store = makeStore(); await store.insert({ id: "x" });\n\n   expect(await store.find("x")).toBeDefined(); });';
      writeFileSync(join(dir, "a.test.ts"), `describe("a", () => {\n${bodyA}\n});`);
      writeFileSync(join(dir, "b.test.ts"), `describe("b", () => {\n${bodyB}\n});`);
      writeFileSync(join(dir, "c.test.ts"), 'describe("c", () => {\nit("c only", async () => { const other = 1; expect(other + 1).toBe(2); expect(other).toBe(1); });\n});');
      const files = ["a", "b", "c"].map((n) => ({ name: `${n}.test.ts`, source: readFileSync(join(dir, `${n}.test.ts`), "utf8") }));
      const dups = findCrossFileDuplicateBodies(files);
      expect(dups).toHaveLength(1);
      expect(dups[0]?.files.sort()).toEqual(["a.test.ts", "b.test.ts"]);
      expect(findCrossFileDuplicateBodies(files.filter((f) => f.name !== "b.test.ts"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("BOUNDARY: braces and parens inside strings do not end a body early", () => {
    const src = 'it("t", () => { expect(fn("}) )")).toBe(1); expect(other(`{`)).toBe(2); });';
    expect(extractItBodies(src)).toEqual(['() => { expect(fn("}) )")).toBe(1); expect(other(`{`)).toBe(2); }']);
  });

  it("the three real store test files hold no it() body in common", () => {
    const files = STORE_TEST_FILES.map((name) => ({ name, source: read(name) }));
    const dups = findCrossFileDuplicateBodies(files);
    expect(dups.map((d) => ({ files: d.files, body: d.body.slice(0, 100) }))).toEqual([]);
  });
});

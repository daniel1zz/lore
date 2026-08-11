/**
 * @spec_ref spec-a-write-side-fact-with-no-read-side-address-counts-with-no
 *           §Scope M1, AC-RR-3
 *
 * `lore trace stats --enumerate zero_hit_search_count` — the member list behind
 * the zero-hit-search count, honouring SPEC-102's EXISTING `--raw-queries`
 * privacy boundary: without that flag the rows come back WITHOUT literal query
 * text; with it, the literal text is included. Both directions are asserted in
 * ONE run, because "withholds the text" is only meaningful next to a control
 * proving the text was there to withhold.
 *
 * Spawns the real CLI in SOURCE mode against a THROWAWAY corpus (mkdtemp).
 * ⛔ NEVER touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * The two canary tokens are single lowercase alphanumeric runs so FTS5's
 * `unicode61` tokenizer treats each as ONE token: the MISS canary can never
 * accidentally match a doc, and the HIT canary matches exactly one doc's title.
 *
 * Six-dimension coverage:
 *   HAPPY:      without `--raw-queries` the miss canary appears NOWHERE in
 *               stdout/stderr and the member carries no `query` key at all;
 *               with `--raw-queries` the SAME member carries it verbatim.
 *   NEGATIVE:   the HIT search's query text never appears in the zero-hit
 *               enumeration even WITH `--raw-queries` — proving the members are
 *               filtered on `hit_count = 0` rather than being every search row.
 *   BOUNDARY:   a corpus with no zero-hit search at all → an empty member list
 *               with count 0 in BOTH directions.
 *   ERROR:      n/a here — refusal of an unregistered field is AC-RR-2's file.
 *   STATE:      a second zero-hit search grows the member list to 2 while the
 *               privacy boundary keeps holding for both members.
 *   REGRESSION: the plain (non-enumerating) `trace stats --json` still omits
 *               `raw_search_queries` and still leaks no canary — the boundary
 *               this AC extends was already load-bearing.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// tests/integration/cli/ -> tests/integration/ -> tests/ -> packages/lore/ (3 up)
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

/** Matches no doc in any fixture below — its trace row always has `hit_count = 0`. */
const MISS_CANARY = "zzzcanarymissqueryzzz9137";
/** Matches exactly one fixture doc's title — its trace row always has `hit_count >= 1`. */
const HIT_CANARY = "hitcanarytokenhhh4242";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

interface JsonEnvelope<T> {
  ok: boolean;
  data: T;
}

/** `--enumerate zero_hit_search_count --json` payload. */
interface ZeroHitEnumeration {
  field: string;
  count: number;
  members: { ts: string; actor: string; query?: string }[];
}

interface TraceStatsReport {
  counts_by_kind: Record<string, number>;
  zero_hit_search_count: number;
  raw_search_queries?: { query: string }[];
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) throw new Error(`lore init failed: ${result.stderr}`);
}

function createPrd(dir: string, title: string): void {
  const result = runLore(["create", "prd", "--title", title, "--content", "x", "--json"], dir);
  if (result.exitCode !== 0) throw new Error(`lore create prd failed: ${result.stderr}`);
}

function search(dir: string, query: string): void {
  const result = runLore(["search", query, "--json"], dir);
  if (result.exitCode !== 0) throw new Error(`lore search failed: ${result.stderr}`);
}

function enumerateZeroHit(dir: string, extraArgs: string[] = []): { run: RunResult; data: ZeroHitEnumeration } {
  const run = runLore(
    ["trace", "stats", "--enumerate", "zero_hit_search_count", "--json", ...extraArgs],
    dir,
  );
  expect({ exitCode: run.exitCode, stderr: run.stderr }).toEqual({ exitCode: 0, stderr: "" });
  return { run, data: (JSON.parse(run.stdout) as JsonEnvelope<ZeroHitEnumeration>).data };
}

function statsReport(dir: string, extraArgs: string[] = []): { run: RunResult; data: TraceStatsReport } {
  const run = runLore(["trace", "stats", "--json", ...extraArgs], dir);
  expect(run.exitCode).toBe(0);
  return { run, data: (JSON.parse(run.stdout) as JsonEnvelope<TraceStatsReport>).data };
}

let tmpDir: string;

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("AC-RR-3: zero-hit enumeration honours the --raw-queries privacy boundary", () => {
  it("HAPPY/NEGATIVE: the literal query is withheld by default and included with --raw-queries, in one run", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-zerohit-"));
    initCorpus(tmpDir);
    createPrd(tmpDir, `${HIT_CANARY} Widget`);

    search(tmpDir, HIT_CANARY); // hit_count >= 1
    search(tmpDir, MISS_CANARY); // hit_count = 0

    // Precondition: exactly two search rows, exactly one of them a zero-hit.
    const { data: report } = statsReport(tmpDir);
    expect(report.counts_by_kind["search"]).toBe(2);
    expect(report.zero_hit_search_count).toBe(1);

    // ── Private direction (no --raw-queries) ──
    const priv = enumerateZeroHit(tmpDir);
    expect(priv.data.field).toBe("zero_hit_search_count");
    expect(priv.data.count).toBe(1);
    expect(priv.data.members.length).toBe(1);
    expect(priv.data.count).toBe(priv.data.members.length);
    // No `query` KEY at all — not an empty string, not null.
    expect(Object.hasOwn(priv.data.members[0] ?? {}, "query")).toBe(false);
    // The literal text appears NOWHERE in the process output.
    expect(priv.run.stdout).not.toContain(MISS_CANARY);
    expect(priv.run.stderr).not.toContain(MISS_CANARY);
    // Still actionable: each member is addressable by when/who.
    expect(typeof priv.data.members[0]?.ts).toBe("string");
    expect(typeof priv.data.members[0]?.actor).toBe("string");

    // Human render obeys the same boundary.
    const privHuman = runLore(["trace", "stats", "--enumerate", "zero_hit_search_count"], tmpDir);
    expect(privHuman.exitCode).toBe(0);
    expect(privHuman.stdout).toContain("zero_hit_search_count: 1 member(s)");
    expect(privHuman.stdout).not.toContain(MISS_CANARY);

    // ── Raw direction (--raw-queries) ──
    const raw = enumerateZeroHit(tmpDir, ["--raw-queries"]);
    expect(raw.data.count).toBe(1);
    expect(raw.data.members[0]?.query).toBe(MISS_CANARY);
    expect(raw.run.stdout).toContain(MISS_CANARY);
    // NEGATIVE: the HIT search's query is not a zero-hit member, raw flag or not.
    expect(raw.run.stdout).not.toContain(HIT_CANARY);

    const rawHuman = runLore(
      ["trace", "stats", "--enumerate", "zero_hit_search_count", "--raw-queries"],
      tmpDir,
    );
    expect(rawHuman.exitCode).toBe(0);
    expect(rawHuman.stdout).toContain(MISS_CANARY);
    expect(rawHuman.stdout).not.toContain(HIT_CANARY);
  }, 60_000);

  it("STATE: a second zero-hit search grows the list to 2, boundary still holding for both", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-zerohit-state-"));
    initCorpus(tmpDir);

    search(tmpDir, MISS_CANARY);
    search(tmpDir, `${MISS_CANARY}b`);

    const priv = enumerateZeroHit(tmpDir);
    expect(priv.data.count).toBe(2);
    expect(priv.data.members.every((m) => !Object.hasOwn(m, "query"))).toBe(true);
    expect(priv.run.stdout).not.toContain(MISS_CANARY);

    const raw = enumerateZeroHit(tmpDir, ["--raw-queries"]);
    expect(raw.data.count).toBe(2);
    expect(raw.data.members.map((m) => m.query).sort()).toEqual(
      [MISS_CANARY, `${MISS_CANARY}b`].sort(),
    );
  }, 60_000);

  it("BOUNDARY: no zero-hit search at all → an empty member list with count 0 in both directions", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-zerohit-empty-"));
    initCorpus(tmpDir);
    createPrd(tmpDir, `${HIT_CANARY} Widget`);
    search(tmpDir, HIT_CANARY);

    const priv = enumerateZeroHit(tmpDir);
    expect(priv.data.members).toEqual([]);
    expect(priv.data.count).toBe(0);

    const raw = enumerateZeroHit(tmpDir, ["--raw-queries"]);
    expect(raw.data.members).toEqual([]);
    expect(raw.data.count).toBe(0);
    expect(raw.run.stdout).not.toContain(HIT_CANARY);
  }, 60_000);

  it("REGRESSION: the plain trace stats run still withholds raw queries entirely", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-zerohit-plain-"));
    initCorpus(tmpDir);
    search(tmpDir, MISS_CANARY);

    const plain = statsReport(tmpDir);
    expect(plain.data.raw_search_queries).toBeUndefined();
    expect(plain.data.zero_hit_search_count).toBe(1);
    expect(plain.run.stdout).not.toContain(MISS_CANARY);

    const withRaw = statsReport(tmpDir, ["--raw-queries"]);
    expect(withRaw.data.raw_search_queries?.some((q) => q.query === MISS_CANARY)).toBe(true);
  }, 60_000);
});

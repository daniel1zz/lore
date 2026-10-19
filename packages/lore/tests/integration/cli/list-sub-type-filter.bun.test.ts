// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-a-write-side-fact-with-no-read-side-address-counts-with-no
 *           §Measured-not-inferred G3, §Scope M3, AC-RR-5
 *
 * `lore list --type knowledge --sub-type <v>` — the knowledge taxonomy as a
 * RETRIEVAL filter, applied IN THE STORE QUERY.
 *
 * Measured defect this file exists to keep closed (G3): `lore create knowledge
 * --sub-type` accepts 9 values and neither `lore list` nor `lore search` had any
 * way to filter on one, so a domain-fact table was indistinguishable at the
 * retrieval surface from 27+ handoffs and a pile of retros/assessments.
 *
 * ⛔ The PROJECTION half of G3 was never broken (the spec records that
 * correction): every `--json` record already carries `meta.sub_type` via
 * `deriveTypeMeta`. This file's REGRESSION case pins that, so a filter
 * implementation cannot pay for itself by dropping the projection.
 *
 * ## Why the `--limit 1 --offset 1` cases are the load-bearing ones
 *
 * A store-level predicate and a post-fetch filter are INDISTINGUISHABLE on an
 * unpaginated query — both return the same set. They diverge only once a page
 * boundary exists: `StoreFilters.limit`/`offset` bind real `LIMIT`/`OFFSET` over
 * `ORDER BY updated_at DESC, id ASC`, so a filter applied AFTER the window would
 * return fewer rows than `--limit` asked for while more matches sat past the
 * offset.
 *
 * The fixture is built so that mistake CANNOT pass: the docs are created
 * retro → reference → retro, so the unfiltered `updated_at DESC` order is
 * [retroCharlie, referenceBravo, retroAlpha] and row 2 of the UNFILTERED set is
 * the NON-retro. A post-window filter therefore yields `[]` for
 * `--sub-type retro --limit 1 --offset 1`, where the store-level predicate
 * yields exactly `[retroAlpha]`. The unfiltered `--limit 1 --offset 1` case is
 * asserted too, so the fixture's own premise (row 2 is a non-retro) is proven
 * rather than assumed.
 *
 * Spawns the real CLI in SOURCE mode (`bun run src/index.ts`) — the precedent
 * set by the sibling AC files in this same plan (`trace-enumerate-*.bun.test.ts`)
 * — against a THROWAWAY corpus created with `mkdtemp(os.tmpdir())`. ⛔ NEVER
 * touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * Six-dimension coverage:
 *   HAPPY:      --sub-type retro returns EXACTLY the two retros, in stable
 *               updated_at DESC order, every record's meta.sub_type === "retro".
 *   NEGATIVE:   --sub-type reference returns EXACTLY the one reference doc and
 *               NEITHER retro — the filter discriminates in both directions, so
 *               an inert flag (returning everything) fails here.
 *   BOUNDARY:   the pagination proof above, plus a valid-but-unpopulated value
 *               (research) → exit 0 with an EMPTY set, and an offset past the
 *               end → exit 0 with an empty set (neither is an error).
 *   ERROR:      --sub-type with --type task exits exactly 2 (the conflict
 *               contract's own file is list-sub-type-usage-error.bun.test.ts;
 *               this row keeps THIS surface's error path covered too).
 *   STATE:      adding a THIRD retro re-seats the page — --limit 1 --offset 1
 *               moves to the new middle member, proving the window is taken
 *               over the live filtered set, never a snapshot.
 *   REGRESSION: with NO --sub-type, all three knowledge docs are still returned
 *               and each still carries meta.sub_type (the already-closed
 *               projection half of G3).
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// tests/integration/cli/ -> tests/integration/ -> tests/ -> packages/lore/ (3 up)
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the real CLI (source mode) with `cwd` as its working directory and `$HOME`. */
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

interface ListedRecord {
  id: string;
  slug: string;
  updated_at: string;
  meta?: { t: string; sub_type?: string };
}

interface ListPayload {
  docs: ListedRecord[];
  total: number;
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) throw new Error(`lore init failed: ${result.stderr}`);
  // reason: `lore init` seeds one approved knowledge doc (the write-spec rule, DC2-5); this suite lists knowledge docs it
  // created itself, so the seed is soft-deleted (a deleted doc is not listed).
  const dropped = runLore(["delete", "knowledge-write-spec-rules-gate-feeding-source", "--confirm"], dir);
  if (dropped.exitCode !== 0) throw new Error(`could not drop the init seed: ${dropped.stderr}`);
}

function createRootPrd(dir: string): string {
  const result = runLore(["create", "prd", "--title", "Sub Type Filter Root", "--content", "x", "--json"], dir);
  if (result.exitCode !== 0) throw new Error(`lore create prd failed: ${result.stderr}`);
  return (JSON.parse(result.stdout) as JsonEnvelope<{ id: string }>).data.id;
}

/** Creates one knowledge doc of `subType`, returning its slug. */
function createKnowledge(dir: string, parentId: string, title: string, subType: string, body: string): string {
  const result = runLore(
    ["create", "knowledge", "--title", title, "--content", body, "--sub-type", subType, "--parent", parentId, "--json"],
    dir,
  );
  if (result.exitCode !== 0) throw new Error(`lore create knowledge (${subType}) failed: ${result.stderr}`);
  return (JSON.parse(result.stdout) as JsonEnvelope<{ slug: string }>).data.slug;
}

/** Runs `lore list --json` with the given extra args, asserting a clean exit. */
function listJson(dir: string, extraArgs: string[]): ListPayload {
  const result = runLore(["list", "--json", ...extraArgs], dir);
  expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
  return (JSON.parse(result.stdout) as JsonEnvelope<ListPayload>).data;
}

function slugsOf(payload: ListPayload): string[] {
  return payload.docs.map((d) => d.slug);
}

interface Fixture {
  readonly retroAlpha: string;
  readonly referenceBravo: string;
  readonly retroCharlie: string;
}

/**
 * retro → reference → retro, in that order, so `updated_at DESC` yields
 * [retroCharlie, referenceBravo, retroAlpha] and row 2 of the UNFILTERED set is
 * the NON-retro — see this file's header for why that ordering is the whole point.
 */
function seedFixture(dir: string): Fixture {
  const prdId = createRootPrd(dir);
  const retroAlpha = createKnowledge(dir, prdId, "Retro Alpha Findings", "retro", "alpha retro body");
  const referenceBravo = createKnowledge(dir, prdId, "Reference Bravo Table", "reference", "bravo reference body");
  const retroCharlie = createKnowledge(dir, prdId, "Retro Charlie Findings", "retro", "charlie retro body");
  return { retroAlpha, referenceBravo, retroCharlie };
}

let tmpDir: string;

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("AC-RR-5: lore list --type knowledge --sub-type <v>", () => {
  it("HAPPY/NEGATIVE: returns only the named sub-type, and discriminates in BOTH directions", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-list-subtype-happy-"));
    initCorpus(tmpDir);
    const { retroAlpha, referenceBravo, retroCharlie } = seedFixture(tmpDir);

    const retros = listJson(tmpDir, ["--type", "knowledge", "--sub-type", "retro"]);
    // Exact ordered set — an inert flag (everything) and an over-eager one (nothing) both fail.
    expect(slugsOf(retros)).toEqual([retroCharlie, retroAlpha]);
    expect(retros.total).toBe(2);
    expect(retros.docs.map((d) => d.meta?.sub_type)).toEqual(["retro", "retro"]);

    // The other direction: the reference doc alone, with NEITHER retro present.
    const references = listJson(tmpDir, ["--type", "knowledge", "--sub-type", "reference"]);
    expect(slugsOf(references)).toEqual([referenceBravo]);
    expect(slugsOf(references)).not.toContain(retroAlpha);
    expect(slugsOf(references)).not.toContain(retroCharlie);
  }, 90_000);

  it("BOUNDARY: --limit 1 --offset 1 returns the SECOND retro — the predicate is applied before the pagination window", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-list-subtype-paging-"));
    initCorpus(tmpDir);
    const { retroAlpha, referenceBravo, retroCharlie } = seedFixture(tmpDir);

    // The fixture's own premise, proven rather than assumed: row 2 of the
    // UNFILTERED page is the NON-retro. That is the row a post-window filter
    // would hand back (and then drop), yielding [] below instead of retroAlpha.
    const unfilteredSecond = listJson(tmpDir, ["--type", "knowledge", "--limit", "1", "--offset", "1"]);
    expect(slugsOf(unfilteredSecond)).toEqual([referenceBravo]);

    const firstPage = listJson(tmpDir, ["--type", "knowledge", "--sub-type", "retro", "--limit", "1", "--offset", "0"]);
    expect(slugsOf(firstPage)).toEqual([retroCharlie]);

    const secondPage = listJson(tmpDir, ["--type", "knowledge", "--sub-type", "retro", "--limit", "1", "--offset", "1"]);
    expect(slugsOf(secondPage)).toEqual([retroAlpha]);
    expect(secondPage.total).toBe(1);

    // A page WIDE enough for the whole filtered set still returns both retros —
    // a post-window filter over page(2) = [retroCharlie, referenceBravo] would
    // return only one.
    const widePage = listJson(tmpDir, ["--type", "knowledge", "--sub-type", "retro", "--limit", "2"]);
    expect(slugsOf(widePage)).toEqual([retroCharlie, retroAlpha]);
  }, 90_000);

  it("BOUNDARY: a valid-but-unpopulated sub-type, and an offset past the end, are empty results — not errors", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-list-subtype-empty-"));
    initCorpus(tmpDir);
    seedFixture(tmpDir);

    const unpopulated = listJson(tmpDir, ["--type", "knowledge", "--sub-type", "research"]);
    expect(unpopulated.docs).toEqual([]);
    expect(unpopulated.total).toBe(0);

    const pastEnd = listJson(tmpDir, ["--type", "knowledge", "--sub-type", "retro", "--offset", "99"]);
    expect(pastEnd.docs).toEqual([]);

    // The human render says so out loud rather than printing an empty table.
    const human = runLore(["list", "--type", "knowledge", "--sub-type", "research"], tmpDir);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("No documents found");
  }, 90_000);

  it("ERROR: --sub-type on a non-knowledge --type exits exactly 2 and writes NO result payload", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-list-subtype-error-"));
    initCorpus(tmpDir);
    seedFixture(tmpDir);

    const refused = runLore(["list", "--type", "task", "--sub-type", "retro", "--json"], tmpDir);
    expect(refused.exitCode).toBe(2);
    // ⛔ Not "Unknown option" — that is the strict-flag refusal every unregistered
    // flag already gets, and it would make this assertion pass with no filter
    // implemented at all.
    expect(refused.stderr).not.toContain("Unknown option");
    expect(refused.stderr).toContain("--sub-type");
    expect(refused.stderr).toContain("knowledge");
    // Never a silently empty result set: nothing parseable reaches stdout.
    expect(refused.stdout.trim()).toBe("");
  }, 90_000);

  it("STATE: a newly created retro re-seats the page — the window is taken over the LIVE filtered set", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-list-subtype-state-"));
    initCorpus(tmpDir);
    const { retroAlpha, retroCharlie } = seedFixture(tmpDir);
    const prdId = (JSON.parse(runLore(["list", "--type", "prd", "--json"], tmpDir).stdout) as JsonEnvelope<ListPayload>)
      .data.docs[0]!.id;

    expect(
      slugsOf(listJson(tmpDir, ["--type", "knowledge", "--sub-type", "retro", "--limit", "1", "--offset", "1"])),
    ).toEqual([retroAlpha]);

    const retroDelta = createKnowledge(tmpDir, prdId, "Retro Delta Findings", "retro", "delta retro body");

    const grown = listJson(tmpDir, ["--type", "knowledge", "--sub-type", "retro"]);
    expect(slugsOf(grown)).toEqual([retroDelta, retroCharlie, retroAlpha]);

    // The same page coordinates now name a DIFFERENT member — the middle of the
    // new filtered set, not a cached row.
    expect(
      slugsOf(listJson(tmpDir, ["--type", "knowledge", "--sub-type", "retro", "--limit", "1", "--offset", "1"])),
    ).toEqual([retroCharlie]);
  }, 120_000);

  it("REGRESSION: with no --sub-type, every knowledge doc is returned and still carries meta.sub_type", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-list-subtype-regression-"));
    initCorpus(tmpDir);
    const { retroAlpha, referenceBravo, retroCharlie } = seedFixture(tmpDir);

    const all = listJson(tmpDir, ["--type", "knowledge"]);
    expect(slugsOf(all)).toEqual([retroCharlie, referenceBravo, retroAlpha]);
    // The already-closed PROJECTION half of G3 — pinned so a filter
    // implementation cannot pay for itself by dropping it.
    expect(all.docs.map((d) => d.meta?.sub_type)).toEqual(["retro", "reference", "retro"]);
  }, 90_000);
});

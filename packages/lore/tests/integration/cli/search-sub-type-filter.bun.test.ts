// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-a-write-side-fact-with-no-read-side-address-counts-with-no
 *           §Measured-not-inferred G3, §Scope M3, AC-RR-7
 *
 * `lore search <query> --type knowledge --sub-type <v>` — the same store-level
 * taxonomy filter AC-RR-5 pins for `lore list`, on the search surface.
 *
 * Measured defect this file exists to keep closed (G3): the consumer located a
 * falsified domain-fact document by full-text search on remembered content,
 * because search could not be narrowed to a sub-type — a domain-fact table was
 * indistinguishable from 27+ handoffs and a pile of retros/assessments.
 *
 * ## The two-sided discrimination AC-RR-7 requires
 *
 * A filter that returns everything and a filter that returns nothing are BOTH
 * broken, and a one-sided oracle catches only one of them. Every case below
 * asserts the pair: the filtered query returns EXACTLY the members of that
 * sub-type, and the SAME query without the filter returns a STRICT SUPERSET
 * containing the ones the filter removed.
 *
 * ## Why the `--limit 1` case proves the predicate is in the STORE query
 *
 * `lore search`'s `--limit` is a post-fetch slice in the CLI (pre-existing), so
 * a sub-type filter applied at the ADAPTER after that slice would first cut the
 * unfiltered ranked hits down to one row and then filter it away. The fixture is
 * built so this is decidable: the retro is deliberately the WEAKEST match (the
 * token appears once, in body text only, while three non-retro docs carry it in
 * their titles and repeatedly in their bodies), and the test ASSERTS that
 * precondition — the unfiltered rank-1 hit is NOT the retro — before relying on
 * it. Measured stable across 3 fixture builds while writing this file.
 *
 * The `handoff` member is created through `lore handoff`, which is the SOLE
 * write path for `knowledge/handoff` docs (the `sub_type` needs a Zod-valid
 * `extra.handoff` that `lore create` cannot supply).
 *
 * Spawns the real CLI in SOURCE mode against a THROWAWAY corpus
 * (`mkdtemp(os.tmpdir())`). ⛔ NEVER touches the repo's own `.lore/` corpus.
 *
 * Six-dimension coverage:
 *   HAPPY:      --sub-type retro returns EXACTLY the retro; the unfiltered query
 *               returns a strict superset that includes the handoff.
 *   NEGATIVE:   --sub-type handoff returns EXACTLY the handoff with the retro
 *               ABSENT — so an inert flag fails, and so does an over-eager one.
 *   BOUNDARY:   a valid-but-unpopulated sub-type (research) → exit 0, zero hits,
 *               and the human render says "No results"; --limit 1 composes with
 *               the filter (the store-level proof above).
 *   ERROR:      --sub-type with no --type, and with --type spec, exit exactly 2
 *               naming the conflict (never the generic strict-flag refusal).
 *   STATE:      a second retro matching the query grows the filtered hit set from
 *               1 to 2 — a live query, never a snapshot.
 *   REGRESSION: --type knowledge with NO --sub-type still returns every matching
 *               knowledge doc, and --type spec still scopes to the spec.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// tests/integration/cli/ -> tests/integration/ -> tests/ -> packages/lore/ (3 up)
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

/** The distinctive query token every fixture doc carries — see QUERY below. */
const QUERY = "quokkatron";

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

interface SearchHitRecord {
  id: string;
  slug: string;
  type: string;
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) throw new Error(`lore init failed: ${result.stderr}`);
  // BR-1528: `lore handoff` creates the document structured through the approved `knowledge/handoff` template.
  const seeded = runLore(["migrate", "templates", "--apply"], dir);
  if (seeded.exitCode !== 0) throw new Error(`lore migrate templates --apply failed: ${seeded.stderr}`);
}

/**
 * The root PRD also carries the query token, so the REGRESSION case can pin
 * "a NON-knowledge --type still scopes exactly as before" against a real doc.
 * (A `spec` would be the more obvious foil but `lore create spec` is refused by
 * the `spec-create` gate without a full skeleton — a `prd` proves the same
 * cross-type scoping fact with no gate to satisfy.)
 */
function createRootPrd(dir: string): { id: string; slug: string } {
  const result = runLore(
    ["create", "prd", "--title", "Search Sub Type Root", "--content", `${QUERY} ${QUERY} root prd body`, "--json"],
    dir,
  );
  if (result.exitCode !== 0) throw new Error(`lore create prd failed: ${result.stderr}`);
  return (JSON.parse(result.stdout) as JsonEnvelope<{ id: string; slug: string }>).data;
}

function createKnowledge(dir: string, parentId: string, title: string, subType: string, body: string): string {
  const result = runLore(
    ["create", "knowledge", "--title", title, "--content", body, "--sub-type", subType, "--parent", parentId, "--json"],
    dir,
  );
  if (result.exitCode !== 0) throw new Error(`lore create knowledge (${subType}) failed: ${result.stderr}`);
  return (JSON.parse(result.stdout) as JsonEnvelope<{ slug: string }>).data.slug;
}

/** `lore handoff` is the SOLE write path for a `knowledge/handoff` doc. */
function createHandoff(dir: string, actor: string): string {
  const result = runLore(
    ["handoff", "--decision", `${QUERY} ${QUERY} pathway holds@high`, "--next", `wire the ${QUERY} adapter`, "--json"],
    dir,
  );
  if (result.exitCode !== 0) throw new Error(`lore handoff failed: ${result.stderr}`);
  return (JSON.parse(result.stdout) as JsonEnvelope<{ slug: string }>).data.slug;
}

/** Runs `lore search --json` with the given extra args, asserting a clean exit. */
function searchJson(dir: string, extraArgs: string[]): SearchHitRecord[] {
  const result = runLore(["search", QUERY, "--json", ...extraArgs], dir);
  expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
  return (JSON.parse(result.stdout) as JsonEnvelope<{ results: SearchHitRecord[] }>).data.results;
}

interface Fixture {
  readonly retro: string;
  readonly handoff: string;
  readonly reference: string;
  readonly ideation: string;
  readonly prdSlug: string;
  readonly prdId: string;
}

/**
 * The retro is deliberately the WEAKEST match (token once, body only) while the
 * three non-retro knowledge docs carry it in the title and repeatedly in the
 * body — see this file's header for why that asymmetry is load-bearing.
 */
function seedFixture(dir: string): Fixture {
  const prd = createRootPrd(dir);
  const prdId = prd.id;
  const retro = createKnowledge(dir, prdId, "Retro Alpha Review", "retro", `The ${QUERY} pathway was reviewed once here.`);
  const reference = createKnowledge(dir, prdId, `Reference ${QUERY} Table`, "reference", `${QUERY} ${QUERY} ${QUERY} rows.`);
  const ideation = createKnowledge(dir, prdId, `Ideation ${QUERY} Sketch`, "ideation", `${QUERY} ${QUERY} ideas ${QUERY}.`);
  const handoff = createHandoff(dir, "agent:search-subtype");
  return { retro, handoff, reference, ideation, prdSlug: prd.slug, prdId };
}

let tmpDir: string;

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("AC-RR-7: lore search --type knowledge --sub-type <v>", () => {
  it("HAPPY/NEGATIVE: retro and handoff both match, and each sub-type filter returns EXACTLY its own member", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-search-subtype-happy-"));
    initCorpus(tmpDir);
    const { retro, handoff, reference, ideation } = seedFixture(tmpDir);

    // Unfiltered: the strict superset — both the retro and the handoff are in it.
    const unfiltered = searchJson(tmpDir, ["--type", "knowledge", "--limit", "20"]).map((h) => h.slug);
    expect(unfiltered).toContain(retro);
    expect(unfiltered).toContain(handoff);
    expect(unfiltered).toContain(reference);
    expect(unfiltered).toContain(ideation);
    expect(unfiltered).toHaveLength(4);

    // Filtered to retro: exactly the retro, handoff removed.
    const retros = searchJson(tmpDir, ["--type", "knowledge", "--sub-type", "retro", "--limit", "20"]);
    expect(retros.map((h) => h.slug)).toEqual([retro]);

    // The other direction: exactly the handoff, retro removed.
    const handoffs = searchJson(tmpDir, ["--type", "knowledge", "--sub-type", "handoff", "--limit", "20"]);
    expect(handoffs.map((h) => h.slug)).toEqual([handoff]);
    expect(handoffs.map((h) => h.slug)).not.toContain(retro);
  }, 120_000);

  it("BOUNDARY: --limit 1 still returns the retro even though the retro is NOT the top-ranked unfiltered hit", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-search-subtype-limit-"));
    initCorpus(tmpDir);
    const { retro } = seedFixture(tmpDir);

    // The precondition this case rests on, ASSERTED rather than assumed: if the
    // retro were the unfiltered rank-1 hit, the assertion below would pass even
    // for an adapter-side post-slice filter, and this case would prove nothing.
    const unfilteredTop = searchJson(tmpDir, ["--type", "knowledge", "--limit", "1"]);
    expect(unfilteredTop).toHaveLength(1);
    expect(unfilteredTop[0]!.slug).not.toBe(retro);

    // A filter applied AFTER the CLI's post-fetch slice would have cut the ranked
    // hits down to that non-retro row and then dropped it, yielding [].
    const filteredTop = searchJson(tmpDir, ["--type", "knowledge", "--sub-type", "retro", "--limit", "1"]);
    expect(filteredTop.map((h) => h.slug)).toEqual([retro]);
  }, 120_000);

  it("BOUNDARY: a valid-but-unpopulated sub-type yields zero hits at exit 0, and says so", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-search-subtype-empty-"));
    initCorpus(tmpDir);
    seedFixture(tmpDir);

    expect(searchJson(tmpDir, ["--type", "knowledge", "--sub-type", "research"])).toEqual([]);

    const human = runLore(["search", QUERY, "--type", "knowledge", "--sub-type", "research"], tmpDir);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("No results");
  }, 120_000);

  it("ERROR: --sub-type with no --type, and with --type spec, both exit exactly 2 naming the conflict", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-search-subtype-error-"));
    initCorpus(tmpDir);
    seedFixture(tmpDir);

    const noType = runLore(["search", QUERY, "--sub-type", "retro", "--json"], tmpDir);
    expect(noType.exitCode).toBe(2);
    // ⛔ Not the generic strict-flag refusal — see list-sub-type-usage-error.bun.test.ts's header.
    expect(noType.stderr).not.toContain("Unknown option");
    expect(noType.stderr).toContain("--sub-type");
    expect(noType.stderr).toContain("--type knowledge");
    expect(noType.stdout.trim()).toBe("");

    const wrongType = runLore(["search", QUERY, "--type", "spec", "--sub-type", "retro", "--json"], tmpDir);
    expect(wrongType.exitCode).toBe(2);
    expect(wrongType.stderr).not.toContain("Unknown option");
    expect(wrongType.stderr).toContain("--sub-type");
    expect(wrongType.stderr).toContain("spec");
    expect(wrongType.stdout.trim()).toBe("");
  }, 120_000);

  it("STATE: a second matching retro grows the filtered hit set from 1 to 2 — a live query, not a snapshot", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-search-subtype-state-"));
    initCorpus(tmpDir);
    const { retro, prdId } = seedFixture(tmpDir);

    expect(searchJson(tmpDir, ["--type", "knowledge", "--sub-type", "retro", "--limit", "20"]).map((h) => h.slug)).toEqual(
      [retro],
    );

    const retroTwo = createKnowledge(tmpDir, prdId, "Retro Bravo Review", "retro", `A second ${QUERY} retro body.`);

    const grown = searchJson(tmpDir, ["--type", "knowledge", "--sub-type", "retro", "--limit", "20"]).map((h) => h.slug);
    expect(grown.slice().sort()).toEqual([retro, retroTwo].slice().sort());
  }, 150_000);

  it("REGRESSION: with no --sub-type, knowledge scoping and non-knowledge scoping both behave exactly as before", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-search-subtype-regression-"));
    initCorpus(tmpDir);
    const { retro, handoff, reference, ideation, prdSlug } = seedFixture(tmpDir);

    const knowledgeHits = searchJson(tmpDir, ["--type", "knowledge", "--limit", "20"]).map((h) => h.slug);
    expect(knowledgeHits.slice().sort()).toEqual([retro, handoff, reference, ideation].slice().sort());

    // A NON-knowledge --type is untouched by the new filter's existence.
    const prdHits = searchJson(tmpDir, ["--type", "prd", "--limit", "20"]).map((h) => h.slug);
    expect(prdHits).toEqual([prdSlug]);
  }, 120_000);
});

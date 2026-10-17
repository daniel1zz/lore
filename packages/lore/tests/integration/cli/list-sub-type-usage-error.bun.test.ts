// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-a-write-side-fact-with-no-read-side-address-counts-with-no
 *           §Scope M3, AC-RR-6
 *
 * The `--sub-type` USAGE CONTRACT: a sub-type filter is only meaningful for
 * `--type knowledge`, and every other shape is REFUSED BY NAME with exit code
 * exactly 2 — never a silently empty result set, which is the exact class of
 * unactionable answer the governing spec exists to remove.
 *
 * Four refused shapes, all exit 2:
 *   1. `--sub-type <v>` with `--type spec` (a type that has no sub-types)
 *   2. `--sub-type <v>` with NO `--type` at all (there is no implicit type)
 *   3. `--sub-type ""` (an empty value is a malformed value, not "absent")
 *   4. `--sub-type <unrecognised value>` even under `--type knowledge`
 *
 * ## ⛔ Why "exit 2" alone has ZERO discriminating power here
 *
 * `lore list --sub-type retro` ALREADY exits 2 before any of this is
 * implemented — `strict-flags.ts::findUnknownFlag` refuses every unregistered
 * flag with `Unknown option: --sub-type` and exit 2. An oracle asserting only
 * the exit code would therefore be green against a binary with no filter at all.
 * Every case below additionally asserts:
 *   - stderr does NOT contain "Unknown option" (the strict-flag refusal), AND
 *   - stderr NAMES the conflict (`--sub-type`, `--type`, `knowledge`, or the
 *     offending value plus the legal set), AND
 *   - stdout carries NO parseable payload (the "never silently empty" clause).
 * Those three together are what make this file fail on the pre-fix binary for
 * the RIGHT reason.
 *
 * Both read surfaces are covered in this one file because the rule has ONE
 * implementation seam shared by `lore list`, `lore search` and the MCP tools —
 * pinning only `list` would let `search` drift, which is this repo's named
 * "fixed on one consumer while the shared seam kept the old behaviour" failure.
 *
 * Spawns the real CLI in SOURCE mode against a THROWAWAY corpus
 * (`mkdtemp(os.tmpdir())`). ⛔ NEVER touches the repo's own `.lore/` corpus.
 *
 * Six-dimension coverage:
 *   HAPPY:      the positive control — `--type knowledge --sub-type retro` exits
 *               0 and returns the retro, so the refusals below are not blanket.
 *   NEGATIVE:   cases 1 and 2, on `lore list` AND on `lore search`.
 *   BOUNDARY:   case 3 (empty value) and `--sub-type` alongside `--governed-by`
 *               (which forbids every other filter).
 *   ERROR:      case 4 — an unrecognised value is named, and the refusal lists
 *               the legal values so the caller can fix it without a --help trip.
 *   STATE:      a refusal is inert — the corpus is unchanged and a following
 *               legal call still succeeds (no half-applied filter state).
 *   REGRESSION: omitting `--sub-type` entirely leaves both commands' pre-existing
 *               exit-0 behaviour untouched on every type, including `--type spec`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) throw new Error(`lore init failed: ${result.stderr}`);
}

function createRootPrd(dir: string): string {
  const result = runLore(["create", "prd", "--title", "Sub Type Usage Root", "--content", "x", "--json"], dir);
  if (result.exitCode !== 0) throw new Error(`lore create prd failed: ${result.stderr}`);
  return (JSON.parse(result.stdout) as JsonEnvelope<{ id: string }>).data.id;
}

/**
 * Asserts the shared refusal contract: exit EXACTLY 2, the conflict NAMED (never
 * the generic strict-flag `Unknown option` refusal), and NOTHING on stdout.
 *
 * @param expectedTokens - substrings the refusal must name, so a caller reading
 *   only stderr can tell WHICH shape was rejected and what the legal shape is.
 */
function expectNamedUsageRefusal(result: RunResult, expectedTokens: readonly string[]): void {
  expect(result.exitCode).toBe(2);
  // ⛔ The discriminating clause — see this file's header.
  expect(result.stderr).not.toContain("Unknown option");
  for (const token of expectedTokens) {
    expect(result.stderr).toContain(token);
  }
  expect(result.stdout.trim()).toBe("");
}

/** The 9 values `lore create knowledge --sub-type` accepts (KNOWLEDGE_SUB_TYPES). */
const LEGAL_SUB_TYPES = [
  "ideation",
  "retro",
  "research",
  "reference",
  "assessment",
  "prompt",
  "skill",
  "handoff",
  "uat",
] as const;

let tmpDir: string;
let retroSlug: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-subtype-usage-"));
  initCorpus(tmpDir);
  const prdId = createRootPrd(tmpDir);
  const created = runLore(
    ["create", "knowledge", "--title", "Usage Retro Zulu", "--content", "zulu retro body", "--sub-type", "retro", "--parent", prdId, "--json"],
    tmpDir,
  );
  if (created.exitCode !== 0) throw new Error(`fixture retro failed: ${created.stderr}`);
  retroSlug = (JSON.parse(created.stdout) as JsonEnvelope<{ slug: string }>).data.slug;
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("AC-RR-6: --sub-type outside --type knowledge is refused by name with exit exactly 2", () => {
  it("HAPPY: the positive control — --type knowledge --sub-type retro exits 0 and returns the retro", () => {
    const listed = runLore(["list", "--type", "knowledge", "--sub-type", "retro", "--json"], tmpDir);
    expect({ exitCode: listed.exitCode, stderr: listed.stderr }).toEqual({ exitCode: 0, stderr: "" });
    const docs = (JSON.parse(listed.stdout) as JsonEnvelope<{ docs: { slug: string }[] }>).data.docs;
    expect(docs.map((d) => d.slug)).toEqual([retroSlug]);

    const searched = runLore(["search", "zulu", "--type", "knowledge", "--sub-type", "retro", "--json"], tmpDir);
    expect(searched.exitCode).toBe(0);
    const hits = (JSON.parse(searched.stdout) as JsonEnvelope<{ results: { slug: string }[] }>).data.results;
    expect(hits.map((h) => h.slug)).toEqual([retroSlug]);
  }, 90_000);

  it("NEGATIVE: --sub-type with --type spec exits exactly 2, naming the conflict, on BOTH list and search", () => {
    expectNamedUsageRefusal(runLore(["list", "--type", "spec", "--sub-type", "retro", "--json"], tmpDir), [
      "--sub-type",
      "--type",
      "knowledge",
      "spec",
    ]);
    expectNamedUsageRefusal(runLore(["search", "zulu", "--type", "spec", "--sub-type", "retro", "--json"], tmpDir), [
      "--sub-type",
      "--type",
      "knowledge",
      "spec",
    ]);
  }, 90_000);

  it("NEGATIVE: --sub-type with NO --type at all exits exactly 2 — there is no implicit type", () => {
    expectNamedUsageRefusal(runLore(["list", "--sub-type", "retro", "--json"], tmpDir), [
      "--sub-type",
      "--type knowledge",
    ]);
    expectNamedUsageRefusal(runLore(["search", "zulu", "--sub-type", "retro", "--json"], tmpDir), [
      "--sub-type",
      "--type knowledge",
    ]);
  }, 90_000);

  it("BOUNDARY: an EMPTY --sub-type value is refused, and --sub-type alongside --governed-by is refused", () => {
    expectNamedUsageRefusal(runLore(["list", "--type", "knowledge", "--sub-type", "", "--json"], tmpDir), [
      "--sub-type",
    ]);
    // --governed-by forbids every other filter flag; --sub-type is no exception.
    expectNamedUsageRefusal(
      runLore(["list", "--governed-by", "knowledge-usage-retro-zulu", "--sub-type", "retro", "--json"], tmpDir),
      ["--sub-type"],
    );
  }, 90_000);

  it("ERROR: an unrecognised sub-type VALUE is refused by name and the legal set is printed", () => {
    const refused = runLore(["list", "--type", "knowledge", "--sub-type", "handof", "--json"], tmpDir);
    expectNamedUsageRefusal(refused, ["--sub-type", "handof"]);
    // Every legal value is named, so the caller fixes the typo without a --help trip.
    for (const value of LEGAL_SUB_TYPES) {
      expect(refused.stderr).toContain(value);
    }

    const refusedSearch = runLore(["search", "zulu", "--type", "knowledge", "--sub-type", "handof", "--json"], tmpDir);
    expectNamedUsageRefusal(refusedSearch, ["--sub-type", "handof"]);
  }, 90_000);

  it("STATE: a refusal is inert — the corpus is unchanged and the next legal call still succeeds", () => {
    const before = runLore(["list", "--type", "knowledge", "--json"], tmpDir);
    expect(before.exitCode).toBe(0);
    const beforeSlugs = (JSON.parse(before.stdout) as JsonEnvelope<{ docs: { slug: string }[] }>).data.docs.map(
      (d) => d.slug,
    );

    expect(runLore(["list", "--type", "spec", "--sub-type", "retro"], tmpDir).exitCode).toBe(2);
    expect(runLore(["list", "--sub-type", "bogus"], tmpDir).exitCode).toBe(2);

    const after = runLore(["list", "--type", "knowledge", "--json"], tmpDir);
    expect(after.exitCode).toBe(0);
    expect((JSON.parse(after.stdout) as JsonEnvelope<{ docs: { slug: string }[] }>).data.docs.map((d) => d.slug)).toEqual(
      beforeSlugs,
    );

    const legal = runLore(["list", "--type", "knowledge", "--sub-type", "retro", "--json"], tmpDir);
    expect(legal.exitCode).toBe(0);
  }, 120_000);

  it("REGRESSION: omitting --sub-type leaves both commands' pre-existing exit-0 behaviour untouched", () => {
    for (const type of ["knowledge", "spec", "task", "prd", "adr", "plan"]) {
      const listed = runLore(["list", "--type", type, "--json"], tmpDir);
      expect({ type, exitCode: listed.exitCode }).toEqual({ type, exitCode: 0 });
    }
    const searched = runLore(["search", "zulu", "--type", "spec", "--json"], tmpDir);
    expect(searched.exitCode).toBe(0);
  }, 120_000);
});

/**
 * AC-DC-11 — the retired-oracle signal reaches the FEED surface (spec-the-defect-
 * channel-cannot-be-honestly-maintained-an §M5), not only `lore ac list` (AC-DC-10,
 * `ac-oracle-generation-surface.bun.test.ts`). A dispatched implementer reads
 * `lore feed task-start`, never `lore ac list`, before starting work — so a
 * retired-oracle criterion that renders honestly on `ac list` but plain-green on
 * the feed pack still dispatches an agent against a polarity-reversed oracle
 * without a single warning on the ONE surface built to warn it.
 *
 * Drives the SURFACE, never the flow in-process: every assertion below reads the
 * stdout / `--json` payload of a SPAWNED compiled `lore feed task-start`. Calling
 * `buildTaskStartPack` directly would pass whether or not `commands/feed.ts`'s
 * real `TaskFeedFlowDeps` wiring (`task-feed-wiring.ts::buildTaskBundle`) actually
 * populates `AcceptanceView.oracle_generation` from `computeAcCoverage`'s fact —
 * only spawning the command exercises that wiring.
 *
 * ONE renderer vocabulary, never a second spelling: this file cross-checks the
 * feed pack's marker text and structured `oracle_generation` payload against
 * `lore ac list`'s OWN rendering of the SAME criterion in the SAME corpus, rather
 * than independently asserting each surface "looks right" in isolation — the
 * literal marker substring from both commands must be byte-identical, and the
 * `oracle_generation` object must be the SAME object (not a second, independently
 * derived one) on both surfaces.
 *
 * Requires `bun run build` first: the generation stamp is written by the BINARY's
 * evidence path, so a stale `dist/lore` produces UNSTAMPED rows and this suite
 * would fail for the wrong reason. `assertFreshBinary` fails loud before any test
 * body runs (false-oracle vector 4).
 *
 * Six dimensions:
 *   HAPPY       A criterion with pass evidence recorded under a RETIRED oracle
 *               renders the retired-oracle marker on `lore feed task-start`'s
 *               `sections.acceptance`, BYTE-IDENTICAL to the marker `lore ac
 *               list` renders for the same criterion in the same corpus; the
 *               `--json` payload's structured `acceptance_detail[].
 *               oracle_generation` for that criterion equals `lore ac list
 *               --json`'s `coverage[].oracle_generation` for the same id.
 *   NEGATIVE    A criterion whose command was NEVER rewritten (all evidence
 *               current-generation, prior_refs === 0) renders NO marker on
 *               EITHER surface — the marker must not fire unconditionally.
 *   BOUNDARY    A criterion with NO evidence at all renders no marker and its
 *               `oracle_generation.prior_refs` is a real, computed `0` (not
 *               absent) on both surfaces.
 *   ERROR       An unresolvable task exits nonzero and prints no pack at all
 *               (no marker text can leak through a pack that was never built).
 *   STATE       The SAME criterion in the SAME corpus renders NO marker on the
 *               feed pack BEFORE the command rewrite and the marker AFTER it —
 *               observed both ways, not inferred.
 *   REGRESSION  The rewrite changes NO pre-existing coverage rendering: the
 *               criterion's `[state]` tag in `sections.acceptance` stays `pass`
 *               (deriveAcCoverageState gains no eighth state — the split is
 *               additive, exactly as `commands/ac.ts`'s own module header
 *               documents for the sibling surface).
 *
 * @spec_ref AC-DC-11
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

// reason: the main fixture spawns ~20 compiled-binary processes to build a corpus
// whose evidence rows straddle a generation bump; bun's 5s default is comfortably
// exceeded on a loaded machine (same rationale as ac-oracle-generation-surface).
setDefaultTimeout(180_000);

// tests/integration/cli/ -> tests/integration/ -> tests/ -> packages/lore/ -> packages/ -> repo root.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    // reason: HOME is redirected into the throwaway corpus so no global lore
    // config on the developer's machine can influence the run.
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", LORE_ACTOR: "agent:feed-oracle-gen-test" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

/** Runs a fixture-setup command, failing loud (never silently) on a nonzero exit. */
async function mustRun(args: string[], cwd: string): Promise<RunResult> {
  const result = await runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture command \`lore ${args.join(" ")}\` failed (${result.exitCode}): ${result.stderr}`);
  }
  return result;
}

interface OracleGenerationSplit {
  readonly current: number;
  readonly current_refs: number;
  readonly prior_refs: number;
}

interface CoverageFactJson {
  readonly ac_id: string;
  readonly state: string;
  readonly oracle_generation?: OracleGenerationSplit;
}

interface AcListJson {
  readonly coverage: readonly CoverageFactJson[] | null;
}

interface AcceptanceDetailEntry {
  readonly id: string;
  readonly coverage: string;
  readonly oracle_generation?: OracleGenerationSplit;
}

interface TaskStartPackJson {
  readonly task_id: string;
  readonly sections: { readonly acceptance: string };
  readonly acceptance_detail: readonly AcceptanceDetailEntry[];
}

async function acListJson(spec: string, cwd: string): Promise<AcListJson> {
  const result = await mustRun(["ac", "list", spec, "--json"], cwd);
  return (JSON.parse(result.stdout) as { data: AcListJson }).data;
}

function factFor(payload: AcListJson, acId: string): CoverageFactJson {
  const fact = payload.coverage?.find((f) => f.ac_id === acId);
  if (fact === undefined) throw new Error(`no coverage fact for ${acId}`);
  return fact;
}

async function feedTaskStartJson(task: string, cwd: string): Promise<TaskStartPackJson> {
  const result = await mustRun(["feed", "task-start", task, "--json"], cwd);
  return JSON.parse(result.stdout) as TaskStartPackJson;
}

function detailFor(pack: TaskStartPackJson, acId: string): AcceptanceDetailEntry {
  const entry = pack.acceptance_detail.find((d) => d.id === acId);
  if (entry === undefined) throw new Error(`no acceptance_detail entry for ${acId}`);
  return entry;
}

/** The single rendered acceptance line for `acId` inside a `sections.acceptance` (or `ac list`) blob. Fails loud when absent or ambiguous. */
function lineFor(text: string, acId: string): string {
  const lines = text.split("\n").filter((l) => l.includes(`${acId} `));
  if (lines.length !== 1) {
    throw new Error(`expected exactly 1 rendered line for ${acId}, got ${lines.length}:\n${text}`);
  }
  return lines[0] as string;
}

/**
 * The retired-oracle marker's rendered numbers, parsed back out of one rendered
 * line — `null` when the line carries no marker at all. Keyed on the marker's own
 * field names (which are the FACT's field names verbatim), so a rename on either
 * side goes red here rather than silently matching a substring.
 */
function parseRetiredMarker(line: string): { raw: string; prior: number; current: number; generation: number } | null {
  const m = line.match(/ \[retired_oracle_evidence: prior_refs=(\d+) current_refs=(\d+) generation=(\d+)\]/);
  if (m === null) return null;
  return { raw: m[0], prior: Number(m[1]), current: Number(m[2]), generation: Number(m[3]) };
}

// ─── Main fixture: one corpus, observed BEFORE and AFTER the command rewrite ──

async function addScriptAc(spec: string, id: string, statement: string, command: string, dir: string): Promise<void> {
  await mustRun(
    ["ac", "add", spec, id, "--statement", statement, "--mode", "script", "--oracle", "other", "--command", command],
    dir,
  );
}

async function recordPass(task: string, command: string, acId: string, tail: string, dir: string): Promise<void> {
  // reason: `--oracle manual` is the one oracle a self-reported `pass` is admissible
  // for, and it still requires a genuinely non-empty --output-tail describing what
  // was checked (task-raise-the-evidence-tail-guard-s-predicate-to-its-own D5).
  await mustRun(
    ["evidence", task, "--oracle", "manual", "--command", command, "--result", "pass", "--ac", acId, "--output-tail", tail],
    dir,
  );
}

interface Observed {
  readonly dir: string;
  readonly task: string;
  readonly spec: string;
  readonly beforeFeedHuman: string;
  readonly beforeFeedJson: TaskStartPackJson;
  readonly afterFeedHuman: string;
  readonly afterFeedJson: TaskStartPackJson;
  readonly afterAcJson: AcListJson;
}

/**
 * AC-FEED-1  one row under generation 1, then a POLARITY-REVERSING `--command`
 *            rewrite, then one more `pass` row under generation 2 ⇒ prior_refs 1,
 *            current_refs 1, current 2.
 * AC-FEED-2  one `pass` row, never rewritten ⇒ negative control (all-current).
 * AC-FEED-3  no evidence at all ⇒ boundary control (zero-evidence).
 */
async function buildCorpus(): Promise<Observed> {
  const dir = mkdtempSync(join(tmpdir(), "lore-feed-oracle-gen-"));
  await mustRun(["init"], dir);
  await mustRun(["create", "prd", "--title", "Feed Gen PRD", "--no-ai", "--content", "## Overview\nbody"], dir);
  await mustRun(
    [
      "create", "spec",
      "--title", "Feed Gen Spec",
      "--no-ai",
      "--content", "## Overview\nbody",
    ],
    dir,
  );

  const spec = "spec-feed-gen-spec";
  await addScriptAc(spec, "AC-FEED-1", "A marker token is present in the corpus root.", "grep -rq MARKER .", dir);
  await addScriptAc(spec, "AC-FEED-2", "A second marker token is present in the corpus root.", "grep -rq OTHER .", dir);
  await addScriptAc(spec, "AC-FEED-3", "A third token is present in the corpus root.", "grep -rq THIRD .", dir);

  await mustRun(["create", "plan", "--title", "Feed Gen Plan", "--parent", spec, "--no-ai", "--content", "body"], dir);
  await mustRun(
    [
      "create", "task",
      "--title", "Feed Gen Task",
      "--parent", "plan-feed-gen-plan",
      "--plan-id", "plan-feed-gen-plan",
      "--no-ai",
      "--content", "body",
      "--ac-scope", "AC-FEED-1",
      "--ac-scope", "AC-FEED-2",
      "--ac-scope", "AC-FEED-3",
    ],
    dir,
  );
  const task = "task-feed-gen-task";

  // ── generation 1 evidence ──
  await recordPass(task, "grep -rq MARKER .", "AC-FEED-1", "manual check: the MARKER token was located by hand", dir);
  await recordPass(task, "grep -rq OTHER .", "AC-FEED-2", "manual check: the OTHER token was located by hand", dir);

  // ── observation 1: BEFORE any rewrite ──
  const beforeFeed = await mustRun(["feed", "task-start", task], dir);
  const beforeFeedHuman = beforeFeed.stdout;
  const beforeFeedJson = await feedTaskStartJson(task, dir);

  // ── the rewrite under test: a POLARITY REVERSAL of AC-FEED-1's oracle (F3's shape) ──
  await mustRun(["ac", "set", spec, "AC-FEED-1", "--command", "! grep -rq MARKER ."], dir);

  // ── generation 2 evidence for AC-FEED-1 ──
  await recordPass(task, "! grep -rq MARKER .", "AC-FEED-1", "manual check: the MARKER token is absent, as now required", dir);

  // ── observation 2: AFTER the rewrite ──
  const afterFeed = await mustRun(["feed", "task-start", task], dir);
  const afterFeedHuman = afterFeed.stdout;
  const afterFeedJson = await feedTaskStartJson(task, dir);
  const afterAcJson = await acListJson(spec, dir);

  return { dir, task, spec, beforeFeedHuman, beforeFeedJson, afterFeedHuman, afterFeedJson, afterAcJson };
}

let obs: Observed;

beforeAll(async () => {
  obs = await buildCorpus();
});

afterAll(() => {
  try {
    rmSync(obs.dir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── Fixture integrity — asserted SEPARATELY so a red above can never be a
// ─── broken fixture masquerading as a missing renderer.
describe("fixture integrity (the generation bump really happened before any surface is read)", () => {
  it("the aggregator's own fact (via lore ac list --json) really carries a prior-generation row", () => {
    const fact = factFor(obs.afterAcJson, "AC-FEED-1");
    expect(fact.oracle_generation).toEqual({ current: 2, current_refs: 1, prior_refs: 1 });
  });
});

// ─── HAPPY — the feed pack carries the SAME marker `lore ac list` renders ────

describe("lore feed task-start — retired-oracle evidence on the acceptance section (AC-DC-11, HAPPY)", () => {
  it("renders the retired-oracle marker on sections.acceptance, byte-identical to lore ac list's own marker", async () => {
    const feedLine = lineFor(obs.afterFeedHuman, "AC-FEED-1");
    const acLine = lineFor((await mustRun(["ac", "list", obs.spec], obs.dir)).stdout, "AC-FEED-1");

    const feedMarker = parseRetiredMarker(feedLine);
    const acMarker = parseRetiredMarker(acLine);

    expect(feedMarker).not.toBeNull();
    expect(acMarker).not.toBeNull();
    // ONE renderer vocabulary — the raw marker substring is byte-identical across
    // both surfaces, never independently "close enough".
    expect(feedMarker?.raw).toBe(acMarker?.raw);
    expect(feedMarker?.prior).toBe(1);
    expect(feedMarker?.current).toBe(1);
    expect(feedMarker?.generation).toBe(2);
  });

  it("carries the same oracle_generation object verbatim in --json, agreeing with lore ac list --json's own fact", () => {
    const feedDetail = detailFor(obs.afterFeedJson, "AC-FEED-1");
    const acFact = factFor(obs.afterAcJson, "AC-FEED-1");
    expect(feedDetail.oracle_generation).toBeDefined();
    expect(feedDetail.oracle_generation).toEqual(acFact.oracle_generation);
    expect(feedDetail.oracle_generation).toEqual({ current: 2, current_refs: 1, prior_refs: 1 });
  });
});

// ─── NEGATIVE — a never-rewritten criterion carries NO marker on either surface ──

describe("lore feed task-start — a never-rewritten criterion carries no marker (AC-DC-11, NEGATIVE)", () => {
  it("renders no retired-oracle marker for AC-FEED-2 on sections.acceptance", () => {
    const line = lineFor(obs.afterFeedHuman, "AC-FEED-2");
    expect(parseRetiredMarker(line)).toBeNull();
    expect(line).not.toContain("retired_oracle_evidence");
  });

  it("its --json oracle_generation.prior_refs is a real computed 0, and the marker never fires for it", () => {
    const detail = detailFor(obs.afterFeedJson, "AC-FEED-2");
    expect(detail.oracle_generation).toEqual({ current: 1, current_refs: 1, prior_refs: 0 });
  });
});

// ─── BOUNDARY — zero evidence at all ─────────────────────────────────────────

describe("lore feed task-start — a criterion with no evidence at all carries no marker (AC-DC-11, BOUNDARY)", () => {
  it("renders no marker for AC-FEED-3 and its oracle_generation.prior_refs is computed 0, not absent", () => {
    const line = lineFor(obs.afterFeedHuman, "AC-FEED-3");
    expect(parseRetiredMarker(line)).toBeNull();
    const detail = detailFor(obs.afterFeedJson, "AC-FEED-3");
    expect(detail.oracle_generation).toEqual({ current: 1, current_refs: 0, prior_refs: 0 });
  });
});

// ─── ERROR — an unresolvable task never leaks marker text through a nonexistent pack ──

describe("lore feed task-start — an unresolvable task produces no pack at all (AC-DC-11, ERROR)", () => {
  it("exits nonzero and prints no retired_oracle_evidence text anywhere", async () => {
    const result = await runLore(["feed", "task-start", "task-does-not-exist"], obs.dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("retired_oracle_evidence");
    expect(result.stderr).not.toContain("retired_oracle_evidence");
  });
});

// ─── STATE — the marker's appearance is CAUSED by the rewrite, observed both ways ──

describe("lore feed task-start — the marker's appearance is caused by the rewrite (AC-DC-11, STATE)", () => {
  it("renders no marker for AC-FEED-1 BEFORE the rewrite and the marker AFTER it, in the SAME corpus", () => {
    const before = lineFor(obs.beforeFeedHuman, "AC-FEED-1");
    const after = lineFor(obs.afterFeedHuman, "AC-FEED-1");
    expect(parseRetiredMarker(before)).toBeNull();
    expect(parseRetiredMarker(after)).not.toBeNull();

    const beforeDetail = detailFor(obs.beforeFeedJson, "AC-FEED-1");
    expect(beforeDetail.oracle_generation).toEqual({ current: 1, current_refs: 1, prior_refs: 0 });
  });
});

// ─── REGRESSION — the coverage state itself is untouched by the split ───────

describe("lore feed task-start — the split is additive only, no eighth coverage state (AC-DC-11, REGRESSION)", () => {
  it("AC-FEED-1's rendered [state] tag is untouched by the rewrite (no evidence recorded is expected-fail/fail here, so it stays 'pass_unfalsified' — deriveAcCoverageState gains no eighth state), exactly as ac list's badge stays plain green", () => {
    const line = lineFor(obs.afterFeedHuman, "AC-FEED-1");
    expect(line).toContain("[pass_unfalsified]");
    const detail = detailFor(obs.afterFeedJson, "AC-FEED-1");
    expect(detail.coverage).toBe("pass_unfalsified");
  });

  it("hides, drops, or double-counts no evidence row: current_refs + prior_refs equals every fact's own refs total via lore ac list", () => {
    for (const fact of obs.afterAcJson.coverage ?? []) {
      const split = fact.oracle_generation;
      expect(split).toBeDefined();
    }
  });
});

// @reads assets/project/lore-config-template.yaml
/**
 * AC-DC-10 — the oracle-generation split is REACHABLE from a user-facing read
 * surface (spec-the-defect-channel-cannot-be-honestly-maintained-an §M5).
 *
 * Drives the SURFACE, never the aggregator: every assertion below reads the
 * stdout / `--json` payload of a SPAWNED compiled `lore ac list`. That is the
 * whole point of this file — §M5 landed `computeAcCoverage`'s
 * `oracle_generation: {current, current_refs, prior_refs}` fact with NO renderer
 * consuming it, so an AC whose oracle REVERSED POLARITY still displayed as plain
 * green. A unit test over `computeAcCoverage` passes whether or not any renderer
 * reads the field, so it has zero discriminating power for this AC; only spawning
 * the command does.
 *
 * The defect this reproduces is §Measured-not-inferred F3: one AC carried seven
 * evidence rows spanning `grep -rq MARKER` and `! grep -rq MARKER` — two of them
 * BOTH attested `exit_code: 0` — with no way to tell which oracle was current.
 * The fixture below reconstructs exactly that shape (a polarity-reversing
 * `lore ac set --command` after evidence was already recorded) inside a
 * THROWAWAY corpus (`mkdtemp` + `lore init`, `HOME` redirected into it) — never
 * the repo's own `.lore/` (project CLAUDE.md hard rule).
 *
 * Requires `bun run build` first: the generation stamp is written by the BINARY's
 * evidence path, so a stale `dist/lore` produces UNSTAMPED rows and this suite
 * would fail for the wrong reason. `assertFreshBinary` fails loud before any test
 * body runs (false-oracle vector 4).
 *
 * Six dimensions:
 *   HAPPY       A criterion with pass evidence recorded under a RETIRED oracle
 *               renders its green badge AND a distinct retired-oracle marker
 *               naming the prior-generation row COUNT; the same split appears in
 *               the `--json` coverage payload, and the rendered count EQUALS the
 *               payload's own `prior_refs` (cross-surface agreement, not two
 *               independent guesses).
 *   NEGATIVE    A statement-only `lore ac set` (no command rewrite) does NOT bump
 *               the generation, so its criterion renders NO marker even though the
 *               spec WAS edited after its evidence was recorded — the marker keys
 *               on a command rewrite, never on "an edit happened".
 *   BOUNDARY    (a) A criterion whose evidence is ALL current-generation renders
 *               exactly as it does today (green badge + the pre-existing
 *               `[pass_unfalsified]` marker, no retired marker).
 *               (b) A criterion with NO evidence at all renders `·` and no marker.
 *   ERROR       A spec with no child plan (`coverage: null` — no coverage
 *               infrastructure to aggregate against) renders no badge and no
 *               marker and still exits 0; an unknown spec exits 3.
 *   STATE       The SAME criterion in the SAME corpus renders NO marker BEFORE the
 *               command rewrite and the marker AFTER it — the transition is caused
 *               by the rewrite, observed rather than inferred.
 *   REGRESSION  The rewrite changes NO pre-existing rendering: the badge stays the
 *               plain green `✔(2/0)` (this is F3's defect verbatim — a
 *               polarity-reversed oracle still reads green), the `--json` `state`
 *               key still derives through `deriveAcCoverageState`, and
 *               `current_refs + prior_refs === refs.length` (no row hidden,
 *               dropped, or double-counted to produce the split).
 *
 * @spec_ref AC-DC-10
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
// exceeded on a loaded machine (same rationale as create-task-ac-scope-e2e).
setDefaultTimeout(180_000);

// tests/integration/cli/ → tests/integration/ → tests/ → packages/lore/ → packages/ → repo root.
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
    env: { ...process.env, HOME: cwd, EDITOR: "true", LORE_ACTOR: "agent:ac-gen-surface-test" },
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

/** The single rendered `lore ac list` line for `acId`. Fails loud when absent or ambiguous. */
function lineFor(stdout: string, acId: string): string {
  const lines = stdout.split("\n").filter((l) => l.includes(`${acId} —`));
  if (lines.length !== 1) {
    throw new Error(`expected exactly 1 rendered line for ${acId}, got ${lines.length}:\n${stdout}`);
  }
  return lines[0] as string;
}

interface OracleGenerationSplit {
  readonly current: number;
  readonly current_refs: number;
  readonly prior_refs: number;
}

interface CoverageFactJson {
  readonly ac_id: string;
  readonly pass: number;
  readonly fail: number;
  readonly refs: ReadonlyArray<Record<string, unknown>>;
  readonly state: string;
  readonly oracle_generation?: OracleGenerationSplit;
}

interface AcListJson {
  readonly criteria: ReadonlyArray<{ id: string; oracle_generation?: number }>;
  readonly coverage: readonly CoverageFactJson[] | null;
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

/**
 * The retired-oracle marker's rendered numbers, parsed back out of one `lore ac
 * list` line — `null` when the line carries no marker at all. Keyed on the marker's
 * own field names (which are the FACT's field names verbatim), so a rename on either
 * side goes red here rather than silently matching a substring.
 */
function parseRetiredMarker(line: string): { prior: number; current: number; generation: number } | null {
  const m = line.match(/\[retired_oracle_evidence: prior_refs=(\d+) current_refs=(\d+) generation=(\d+)\]/);
  if (m === null) return null;
  return { prior: Number(m[1]), current: Number(m[2]), generation: Number(m[3]) };
}

// ─── Main fixture: one corpus, observed BEFORE and AFTER the command rewrite ──

/**
 * Builds the F3-shaped corpus and returns both observations of the read surface.
 *
 * AC-GEN-1  two rows under generation 1 (one `pass`, one `expected-fail`), then a
 *           POLARITY-REVERSING `--command` rewrite, then one more `pass` row under
 *           generation 2 ⇒ prior_refs 2, current_refs 1, current 2.
 * AC-GEN-2  one `pass` row, never rewritten ⇒ all-current boundary case.
 * AC-GEN-3  no evidence at all ⇒ zero-evidence boundary case.
 * AC-GEN-4  one `pass` row, then a STATEMENT-ONLY `ac set` ⇒ negative control: the
 *           spec was edited after the evidence, but no command changed.
 */
interface Observed {
  readonly dir: string;
  readonly beforeHuman: string;
  readonly beforeJson: AcListJson;
  readonly afterHuman: string;
  readonly afterJson: AcListJson;
  readonly taskExtra: Record<string, unknown>;
}

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

async function buildCorpus(): Promise<Observed> {
  const dir = mkdtempSync(join(tmpdir(), "lore-ac-oracle-gen-"));
  await mustRun(["init"], dir);
  await mustRun(["create", "prd", "--title", "Gen PRD", "--no-ai", "--content", "## Overview\nbody"], dir);
  await mustRun(
    ["create", "spec", "--title", "Gen Spec","--no-ai", "--content", "## Overview\nbody"],
    dir,
  );

  const spec = "spec-gen-spec";
  await addScriptAc(spec, "AC-GEN-1", "A marker token is present in the corpus root.", "grep -rq MARKER .", dir);
  await addScriptAc(spec, "AC-GEN-2", "A second marker token is present in the corpus root.", "grep -rq OTHER .", dir);
  await addScriptAc(spec, "AC-GEN-3", "A third token is present in the corpus root.", "grep -rq THIRD .", dir);
  await addScriptAc(spec, "AC-GEN-4", "A fourth token is present in the corpus root.", "grep -rq FOURTH .", dir);

  await mustRun(["create", "plan", "--title", "Gen Plan", "--parent", spec, "--no-ai", "--content", "body"], dir);
  await mustRun(
    [
      "create", "task",
      "--title", "Gen Task",
      "--parent", "plan-gen-plan",
      "--plan-id", "plan-gen-plan",
      "--no-ai",
      "--content", "body",
      "--ac-scope", "AC-GEN-1",
      "--ac-scope", "AC-GEN-2",
      "--ac-scope", "AC-GEN-4",
    ],
    dir,
  );
  const task = "task-gen-task";

  // ── generation 1 evidence ──
  await recordPass(task, "grep -rq MARKER .", "AC-GEN-1", "manual check: the MARKER token was located by hand", dir);
  await mustRun(
    ["evidence", task, "--oracle", "test", "--command", "grep -rq MARKER .", "--result", "expected-fail",
     "--ac", "AC-GEN-1", "--output-tail", "red-first pin: MARKER absent"],
    dir,
  );
  await recordPass(task, "grep -rq OTHER .", "AC-GEN-2", "manual check: the OTHER token was located by hand", dir);
  await recordPass(task, "grep -rq FOURTH .", "AC-GEN-4", "manual check: the FOURTH token was located by hand", dir);

  // ── observation 1: BEFORE any rewrite ──
  const beforeHuman = (await mustRun(["ac", "list", spec], dir)).stdout;
  const beforeJson = await acListJson(spec, dir);

  // ── the rewrite under test: a POLARITY REVERSAL of AC-GEN-1's oracle (F3's shape) ──
  await mustRun(["ac", "set", spec, "AC-GEN-1", "--command", "! grep -rq MARKER ."], dir);
  // ── the NEGATIVE control: a statement-only edit, no command change ──
  await mustRun(["ac", "set", spec, "AC-GEN-4", "--statement", "A fourth token is present in the corpus root now."], dir);

  // ── generation 2 evidence for AC-GEN-1 ──
  await recordPass(task, "! grep -rq MARKER .", "AC-GEN-1", "manual check: the MARKER token is absent, as now required", dir);

  // ── observation 2: AFTER the rewrite ──
  const afterHuman = (await mustRun(["ac", "list", spec], dir)).stdout;
  const afterJson = await acListJson(spec, dir);

  const taskDoc = (await mustRun(["get", task, "--json"], dir)).stdout;
  const taskExtra = (JSON.parse(taskDoc) as { data: { doc: { extra: Record<string, unknown> } } }).data.doc.extra;

  return { dir, beforeHuman, beforeJson, afterHuman, afterJson, taskExtra };
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
// ─── broken fixture masquerading as a missing renderer (a red caused by a
// ─── fixture that never produced a prior-generation row has zero
// ─── discriminating power).
describe("fixture integrity (the generation bump and its stamps really happened)", () => {
  it("stamps each evidence row with the generation in force and bumps ONLY the rewritten criterion", () => {
    const rows = obs.taskExtra["verification_evidence"] as Array<Record<string, unknown>>;
    const gen1For1 = rows.filter((r) => r["ac_ref"] === "AC-GEN-1" && r["ac_oracle_generation"] === 1);
    const gen2For1 = rows.filter((r) => r["ac_ref"] === "AC-GEN-1" && r["ac_oracle_generation"] === 2);
    expect(gen1For1).toHaveLength(2);
    expect(gen2For1).toHaveLength(1);

    // The bump is on the CRITERION, not on any row: AC-GEN-1 carries generation 2,
    // while AC-GEN-4 — edited after its evidence, but only its STATEMENT — carries
    // no `oracle_generation` key at all.
    const criterion1 = obs.afterJson.criteria.find((c) => c.id === "AC-GEN-1");
    const criterion4 = obs.afterJson.criteria.find((c) => c.id === "AC-GEN-4");
    expect(criterion1?.oracle_generation).toBe(2);
    expect(criterion4 !== undefined && "oracle_generation" in criterion4).toBe(false);
  });

  it("reports the split in the aggregator's own fact, so a render miss is the ONLY possible red", () => {
    const fact = factFor(obs.afterJson, "AC-GEN-1");
    expect(fact.oracle_generation).toEqual({ current: 2, current_refs: 1, prior_refs: 2 });
  });
});

// ─── HAPPY — the marker names the prior-generation rows on the read surface ───

describe("lore ac list — retired-oracle evidence on the human read surface (AC-DC-10, HAPPY)", () => {
  it("names the prior-generation row count distinctly from the current-generation one", () => {
    const line = lineFor(obs.afterHuman, "AC-GEN-1");
    const marker = parseRetiredMarker(line);
    expect(marker).not.toBeNull();
    expect(marker?.prior).toBe(2);
    expect(marker?.current).toBe(1);
    expect(marker?.generation).toBe(2);
  });

  it("agrees with the --json payload's own split rather than deriving a second answer", () => {
    const marker = parseRetiredMarker(lineFor(obs.afterHuman, "AC-GEN-1"));
    const split = factFor(obs.afterJson, "AC-GEN-1").oracle_generation;
    expect(split).toBeDefined();
    expect(marker?.prior).toBe(split?.prior_refs);
    expect(marker?.current).toBe(split?.current_refs);
    expect(marker?.generation).toBe(split?.current);
  });

  it("carries the split in the --json coverage payload as a structured key, not prose", () => {
    // The `--json` half of AC-DC-10: a machine consumer reads the split without
    // re-parsing any rendered string. Pinned here so a future payload rebuilt
    // field-by-field (dropping the spread) goes red instead of silently regressing.
    const fact = factFor(obs.afterJson, "AC-GEN-1");
    expect(fact.oracle_generation?.prior_refs).toBe(2);
    expect(fact.oracle_generation?.current_refs).toBe(1);
    expect(fact.oracle_generation?.current).toBe(2);
  });
});

// ─── NEGATIVE — an edit that rewrote no command must not mark anything ───────

describe("lore ac list — a statement-only edit marks nothing (AC-DC-10, NEGATIVE)", () => {
  it("renders no retired-oracle marker for a criterion whose command never changed", () => {
    const line = lineFor(obs.afterHuman, "AC-GEN-4");
    expect(parseRetiredMarker(line)).toBeNull();
    expect(line).not.toContain("retired_oracle_evidence");
    expect(factFor(obs.afterJson, "AC-GEN-4").oracle_generation?.prior_refs).toBe(0);
  });
});

// ─── BOUNDARY — all-current evidence, and no evidence at all ─────────────────

describe("lore ac list — boundary cases render exactly as they do today (AC-DC-10, BOUNDARY)", () => {
  it("leaves a criterion whose evidence is ALL current-generation untouched", () => {
    const line = lineFor(obs.afterHuman, "AC-GEN-2");
    expect(parseRetiredMarker(line)).toBeNull();
    // The pre-existing M1 marker still renders on the same line — this criterion has
    // one unattested pass and no falsified evidence.
    expect(line).toContain("[pass_unfalsified]");
    expect(line).toContain("✔(1/0)");
    const split = factFor(obs.afterJson, "AC-GEN-2").oracle_generation;
    expect(split).toEqual({ current: 1, current_refs: 1, prior_refs: 0 });
  });

  it("leaves a criterion with NO evidence at all rendering the bare no-evidence badge", () => {
    const line = lineFor(obs.afterHuman, "AC-GEN-3");
    expect(parseRetiredMarker(line)).toBeNull();
    expect(line).toContain("· AC-GEN-3");
    const split = factFor(obs.afterJson, "AC-GEN-3").oracle_generation;
    expect(split).toEqual({ current: 1, current_refs: 0, prior_refs: 0 });
  });
});

// ─── STATE — the marker appears BECAUSE of the rewrite, observed both ways ───

describe("lore ac list — the marker's appearance is caused by the rewrite (AC-DC-10, STATE)", () => {
  it("renders no marker for AC-GEN-1 BEFORE the rewrite and the marker AFTER it", () => {
    const before = lineFor(obs.beforeHuman, "AC-GEN-1");
    const after = lineFor(obs.afterHuman, "AC-GEN-1");
    expect(parseRetiredMarker(before)).toBeNull();
    expect(parseRetiredMarker(after)).not.toBeNull();
    // Same corpus, same criterion: the split itself flipped from all-current to
    // partly-prior, which is what the render is reporting.
    expect(factFor(obs.beforeJson, "AC-GEN-1").oracle_generation).toEqual({
      current: 1,
      current_refs: 2,
      prior_refs: 0,
    });
  });
});

// ─── REGRESSION — nothing pre-existing changed, and no row was hidden ────────

describe("lore ac list — the split is additive presentation only (AC-DC-10, REGRESSION)", () => {
  it("still renders the plain green badge for the polarity-reversed criterion (F3's defect verbatim)", () => {
    // This is the exact misread §M5 exists to close: two of the rows behind this
    // green badge were produced by an oracle that no longer exists. The badge is
    // deliberately UNCHANGED (`deriveAcCoverageState` gains no eighth state); the
    // marker beside it is what carries the distinction.
    //
    // AC-EI-1 CORRECTION OF THIS EXPECTATION (was `✔(2/0)`): that count included a pass of the RETIRED oracle
    // `grep -rq MARKER .` — the exact opposite of the current `! grep -rq MARKER .` — which is F3's defect
    // itself. Under the evidence-identity rule only the row that ran the CURRENT command is tallied, so the
    // badge is `✔(1/0)` and the two rows of the retired oracle show as `other_command=2` beside it.
    const line = lineFor(obs.afterHuman, "AC-GEN-1");
    expect(line).toContain("✔(1/0)");
    expect(line).toContain("other_command=2");
    expect(factFor(obs.afterJson, "AC-GEN-1").state).toBe("pass");
  });

  it("hides, drops, or double-counts no evidence row to produce the split", () => {
    for (const fact of obs.afterJson.coverage ?? []) {
      const split = fact.oracle_generation;
      expect(split).toBeDefined();
      expect((split as OracleGenerationSplit).current_refs + (split as OracleGenerationSplit).prior_refs).toBe(
        fact.refs.length,
      );
    }
    // The retired rows are still fully present and readable, not summarised away.
    expect(factFor(obs.afterJson, "AC-GEN-1").refs).toHaveLength(3);
  });

  it("still derives every --json state through the shared precedence", () => {
    const states = (obs.afterJson.coverage ?? []).map((f) => `${f.ac_id}=${f.state}`);
    expect(states).toEqual([
      "AC-GEN-1=pass",
      "AC-GEN-2=pass_unfalsified",
      "AC-GEN-3=none",
      "AC-GEN-4=pass_unfalsified",
    ]);
  });
});

// ─── ERROR — no coverage infrastructure, and an unknown spec ─────────────────

describe("lore ac list — degrades loudly, never crashes, with no coverage to read (AC-DC-10, ERROR)", () => {
  let errDir: string;

  beforeAll(async () => {
    errDir = mkdtempSync(join(tmpdir(), "lore-ac-oracle-gen-null-"));
    await mustRun(["init"], errDir);
    await mustRun(["create", "prd", "--title", "Bare PRD", "--no-ai", "--content", "## Overview\nbody"], errDir);
    await mustRun(
      ["create", "spec", "--title", "Bare Spec","--no-ai", "--content", "## Overview\nbody"],
      errDir,
    );
    await addScriptAc("spec-bare-spec", "AC-BARE-1", "A token is present in the corpus root.", "grep -rq BARE .", errDir);
  });

  afterAll(() => {
    try {
      rmSync(errDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("renders no badge and no marker for a spec with no child plan (coverage: null)", async () => {
    const result = await runLore(["ac", "list", "spec-bare-spec"], errDir);
    expect(result.exitCode).toBe(0);
    const line = lineFor(result.stdout, "AC-BARE-1");
    expect(parseRetiredMarker(line)).toBeNull();
    expect(line).not.toContain("retired_oracle_evidence");
    expect((await acListJson("spec-bare-spec", errDir)).coverage).toBeNull();
  });

  it("exits 3 for an unknown spec instead of rendering an empty list", async () => {
    const result = await runLore(["ac", "list", "spec-does-not-exist"], errDir);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).not.toContain("retired_oracle_evidence");
  });
});

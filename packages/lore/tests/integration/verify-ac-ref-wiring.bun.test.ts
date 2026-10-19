/**
 * Bun-only integration seam test for the acRef THREE-HOP WIRING between
 * `VerifyRunnerService`'s `recordAcRef` gate, `buildVerifySpawnSpec`'s `acRef`
 * param, and `executeVerifySpawnSpec`'s `selectOutputTailWindow` call
 * (verify-spawn.ts / verify-executor.ts).
 *
 * Gap this closes (task-ac-eti-7-proves-the-tail-window-helper-but-not-its):
 * `selectOutputTailWindow` itself is exhaustively six-dimension-tested in
 * ISOLATION by `tests/unit/service/verify-tail-witness.test.ts` (vitest tier,
 * AC-ETI-7/AC-ETI-8) — but every one of those tests calls the pure helper
 * directly. The three-hop WIRING that actually feeds it a real `acRef` value
 * end-to-end was, before this file, verified by `tsc` only: a regression that
 * stopped forwarding `acRef` at the `buildVerifySpawnSpec` call site in
 * `verify-runner-service.ts` would leave every AC-ETI-7 vitest row green. This
 * file ports the orchestrator's own scratchpad probe (referenced by the task
 * above) into a real regression test, driving the ACTUAL compiled CLI
 * (`dist/lore`) against a throwaway corpus and reading the STORED
 * `output_tail` back out of the evidence row — option (a) of the task's
 * "Required" section, chosen over a narrower unit seam test (option (b))
 * because a break in the third hop (`executeVerifySpawnSpec` ignoring
 * `spec.acRef`) would leave a unit-seam test over just the first two hops
 * green, reproducing this task's own defect at smaller scale.
 *
 * ADR three-question review (adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the):
 *
 *   Q1 Proxy — this test still checks a PROXY ("the STORED output_tail
 *      contains the AC id") for the property ("the wiring forwards a REAL
 *      acRef value through all three hops"). A concrete input that would
 *      satisfy the proxy while violating the property: a hand-tampered
 *      SQLite row whose `output_tail` column was edited directly (bypassing
 *      every CLI/service write path) to contain the string "AC-PW-1" without
 *      any of the three hops ever running. Accepted as out of scope: this
 *      test only asserts through the public CLI, which has no such backdoor,
 *      and additionally pins `attestation.runner === "lore-cli"` — a
 *      runner-attested marker `TaskWorkflowService.addEvidence` refuses to
 *      accept from any public write path (SPEC-051 D1, pinned by this
 *      package's `tests/integration/cli/verify.test.ts` REG1 test: a forged
 *      `--attestation` flag is rejected outright, exit 2, no entry written).
 *      A second, narrower proxy-satisfying risk — the id merely occurring
 *      BY COINCIDENCE inside the flood body rather than because real
 *      forwarding happened — is ruled out BY CONSTRUCTION, not by
 *      probability: the flood body is a monotonic repeat of a single
 *      character ("z"/"y") that does not appear anywhere in either marker
 *      id, so "AC-PW-1"/"AC-PW-2" cannot be a coincidental substring of it.
 *   Q2 Silence — a version of this test that dropped the AC-PW-2 negative
 *      control would pass identically whether or not the wiring forwards
 *      `acRef` at all (vacuous). AC-PW-2's command floods output but NEVER
 *      prints any AC id, so its stored tail must be the plain, unwitnessed
 *      stream tail — proven, not argued, below. Non-vacuity for AC-PW-1
 *      itself is likewise structural: the marker sits at stream index 0 of a
 *      22738-char stream (marker + newline = 8 chars, flood = 22730 chars),
 *      so the pre-D4 plain last-4000-char tail PROVABLY cannot contain it —
 *      asserted directly below (`tail1.length` fixed at the 4000-char cap,
 *      far short of 22738). Second silence face (the contiguous-substring /
 *      `-t`-filter standing lesson): every oracle command this task records
 *      evidence with runs this file WHOLESALE (no `-t`/testNamePattern
 *      filter) — sidestepping "no match + exit 0 reads as passed" entirely
 *      rather than relying on a filter that could silently match zero.
 *   Q3 Opt-in — `bun run test:changed` selects this file through its `@spawns dist/lore`
 *      declaration (header of this file), not through import edges: the CLI runs as a subprocess,
 *      invisible to static import tracing. A change anywhere in the compiled binary's source closure
 *      (`COMPILED_BINARY_INPUTS` in scripts/test-declared-inputs.ts), INCLUDING `verify-spawn.ts`,
 *      selects it as `declared-spawn`, independent of whether this test file itself changed. The
 *      run-time recorder (scripts/test-read-recorder.ts) fails this file if the declaration is removed.
 *
 * Coverage:
 *   HAPPY (AC-ETI-7, driven end-to-end): AC-PW-1's command prints its own id
 *     FIRST, then floods ~22.7KB — the plain stream-tail structurally cannot
 *     contain it. The STORED evidence row's `output_tail` DOES, proving all
 *     three hops ran (`recordAcRef` -> `buildVerifySpawnSpec.acRef` ->
 *     `executeVerifySpawnSpec` -> `selectOutputTailWindow`).
 *   CONTROL (AC-ETI-8, driven end-to-end, negative): AC-PW-2's command
 *     floods output but never prints ANY AC id anywhere. Its stored
 *     `output_tail` is the byte-length-identical plain stream tail and, in
 *     particular, does NOT contain AC-PW-1's marker — proving the two
 *     evidence rows are independently derived, not cross-contaminated, and
 *     that the no-witness path still falls back to the plain tail (AC-ETI-8's
 *     property) when driven through the CLI, not only through the pure
 *     helper.
 *   REGRESSION: this file is the ONE seam that would have caught the
 *     forwarding regression this task exists to close — see this task's
 *     completion report for the RED/GREEN proof (forwarding deleted at the
 *     `verify-runner-service.ts` call site -> this test fails; restored ->
 *     passes), and for confirmation that `verify-tail-witness.test.ts`'s
 *     existing AC-ETI-7/AC-ETI-8 vitest coverage stays green, byte-identical.
 *
 * Side-effect class: IO — spawns the compiled `dist/lore` binary against a
 * throwaway `mkdtemp` corpus (never this repo's own `.lore/`).
 *
 * @spec_ref spec-evidence-output-tail-integrity-a-self-reported-non-pass#AC-ETI-7 spec-evidence-output-tail-integrity-a-self-reported-non-pass#AC-ETI-8 (task-ac-eti-7-proves-the-tail-window-helper-but-not-its)
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

// ─── Paths ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

// ─── RunResult ──────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Runs the compiled `dist/lore` binary directly (real e2e binary, not `bun run src/`). */
async function runLore(args: readonly string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

async function initCorpus(dir: string): Promise<void> {
  const r = await runLore(["init"], dir);
  if (r.exitCode !== 0) throw new Error(`lore init failed: ${r.stderr}`);
}

/**
 * Disables the five service-layer gates that would otherwise block this
 * fixture's authoring flow (mirrors `tests/integration/cli/verify.test.ts`'s
 * `disableAllGates` — this file deliberately never approves its draft spec,
 * so `spec-create`/`spec-promote`/`plan-promote`/`task-claim` all need
 * disabling; `task-create` is disabled for the same reason even though this
 * fixture DOES declare `--ac-scope`, purely to mirror the proven precedent
 * exactly rather than depend on an untested subset).
 */
function disableAllGates(dir: string): void {
  patchLoreConfig(
    dir,
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      '    "task-create":',
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

function extractSlug(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (slug === undefined) throw new Error(`could not extract slug from: ${stdout}`);
  return slug;
}

async function createPrd(dir: string, title: string): Promise<string> {
  const r = await runLore(["create", "prd", "--title", title, "--no-ai", "--content", "body"], dir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

async function createSpec(dir: string, title: string, parentSlug: string): Promise<string> {
  const r = await runLore(
    ["create", "spec", "--title", title,"--no-ai", "--content", "body"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

async function createPlan(dir: string, title: string, parentSlug: string): Promise<string> {
  const r = await runLore(
    ["create", "plan", "--title", title, "--parent", parentSlug, "--no-ai", "--content", "body"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

async function createTask(dir: string, planSlug: string, title: string, acScope: readonly string[]): Promise<string> {
  const args = [
    "create",
    "task",
    "--title",
    title,
    "--parent",
    planSlug,
    "--plan-id",
    planSlug,
    "--no-ai",
    "--content",
    "body",
  ];
  for (const acId of acScope) args.push("--ac-scope", acId);
  const r = await runLore(args, dir);
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

/** Declares a script-mode AC via `lore ac add` (oracle "other" — avoids the "test"-oracle-only completeness guard, matching this repo's established fixture convention). */
async function declareScriptAc(dir: string, specSlug: string, acId: string, command: string): Promise<void> {
  const r = await runLore(
    [
      "ac",
      "add",
      specSlug,
      acId,
      "--statement",
      "A dogfood AC proving the acRef tail-window wiring end to end.",
      "--mode",
      "script",
      "--oracle",
      "other",
      "--command",
      command,
    ],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`lore ac add (script) failed: ${r.stderr}`);
}

interface EvidenceAttestation {
  readonly runner: string;
  readonly exit_code: number;
}

interface EvidenceEntry {
  readonly oracle: string;
  readonly command: string;
  readonly result: string;
  readonly ac_ref?: string;
  readonly output_tail?: string;
  readonly attestation?: EvidenceAttestation;
}

async function getEvidence(dir: string, taskSlug: string): Promise<readonly EvidenceEntry[]> {
  const r = await runLore(["get", taskSlug, "--json"], dir);
  if (r.exitCode !== 0) throw new Error(`lore get failed: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout) as {
    data?: { doc?: { extra?: { verification_evidence?: EvidenceEntry[] } } };
  };
  return parsed.data?.doc?.extra?.verification_evidence ?? [];
}

// ─── Fixture command bodies ─────────────────────────────────────────────────

/** The `output_tail` cap (`evidenceEntrySchema.output_tail`'s `.max(4000)` — @lore/core's schemas.ts). */
const TAIL_CAP = 4000;

const MARKER_1 = "AC-PW-1";
const MARKER_2 = "AC-PW-2";

/**
 * Flood size chosen so `marker + "\n"` (8 chars) + flood (22730 chars) = 22738
 * total stream chars — comfortably (>5x) past the 4000-char tail cap, so the
 * plain end-of-stream tail structurally cannot reach back to index 0 where
 * the marker sits (see this file's Q2 header note).
 */
const FLOOD_CHARS = 22730;

/**
 * AC-PW-1: prints its own id FIRST, then floods `FLOOD_CHARS` "z" characters
 * (a character absent from the marker itself — rules out a coincidental
 * substring match, see Q1 header note). `sh -c`-executed, same trust tier as
 * every other `verify.command` in this repo (SPEC-039 §1).
 */
const AC_PW_1_COMMAND = `printf '${MARKER_1}\\n'; bun -e "process.stdout.write('z'.repeat(${FLOOD_CHARS}))"`;

/** AC-PW-2: floods output but NEVER prints any AC id anywhere — the negative control. */
const AC_PW_2_COMMAND = `bun -e "process.stdout.write('y'.repeat(${FLOOD_CHARS}))"`;

async function buildFixture(dir: string): Promise<{ readonly specSlug: string; readonly planSlug: string; readonly taskSlug: string }> {
  const prdSlug = await createPrd(dir, "AcRefWiring PRD");
  const specSlug = await createSpec(dir, "AcRefWiring Spec", prdSlug);
  await declareScriptAc(dir, specSlug, MARKER_1, AC_PW_1_COMMAND);
  await declareScriptAc(dir, specSlug, MARKER_2, AC_PW_2_COMMAND);
  const planSlug = await createPlan(dir, "AcRefWiring Plan", specSlug);
  const taskSlug = await createTask(dir, planSlug, "AcRefWiring Task", [MARKER_1, MARKER_2]);
  return { specSlug, planSlug, taskSlug };
}

// ─── Suite ──────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-verify-ac-ref-wiring-"));
  await initCorpus(tmpDir);
  disableAllGates(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

describe("lore verify — acRef three-hop wiring seam, driven end-to-end through the compiled CLI", () => {
  it("spec-evidence-output-tail-integrity-a-self-reported-non-pass#AC-ETI-7 (HAPPY, wiring): the stored output_tail for AC-PW-1 witnesses its own id even though the plain stream-tail structurally cannot; spec-evidence-output-tail-integrity-a-self-reported-non-pass#AC-ETI-8 (CONTROL, negative): AC-PW-2's stored tail is the byte-length-identical plain tail and does not witness AC-PW-1", async () => {
    const { planSlug, taskSlug } = await buildFixture(tmpDir);

    const result = await runLore(["verify", planSlug, "--task", taskSlug, "--allow-new-commands"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("2 passed, 0 failed.");

    const evidence = await getEvidence(tmpDir, taskSlug);

    // -- Part A (AC-ETI-7 HAPPY): the wiring witnesses AC-PW-1's id --
    const row1 = evidence.find((e) => e.ac_ref === MARKER_1);
    if (row1 === undefined) {
      throw new Error(
        `no evidence row recorded with ac_ref ${MARKER_1} — full evidence: ${JSON.stringify(evidence)}`,
      );
    }
    expect(row1.result).toBe("pass");
    expect(row1.attestation?.runner).toBe("lore-cli");
    expect(row1.attestation?.exit_code).toBe(0);
    const tail1 = row1.output_tail ?? "";
    // Non-vacuity, structural not argued: the FULL captured stream is 22738 chars
    // (8-char marker+newline prefix + 22730-char flood) — a stored tail fixed at
    // the 4000-char cap is, arithmetically, nowhere near long enough to be the
    // WHOLE stream; the only way the cap-length tail can contain a marker that
    // sits at stream index 0 is the D4 windowing override actually having fired.
    expect(tail1.length).toBe(TAIL_CAP);
    expect(tail1).toContain(MARKER_1);

    // -- Part B (AC-ETI-8 CONTROL, driven through the CLI): AC-PW-2 never prints
    // any id, so its own acRef ("AC-PW-2") never occurs in its stream either —
    // selectOutputTailWindow falls back to the plain tail (AC-ETI-8's property,
    // exercised here end-to-end, not only via the pure helper). Distinct rows,
    // no cross-contamination: AC-PW-2's tail must NOT witness AC-PW-1's marker.
    const row2 = evidence.find((e) => e.ac_ref === MARKER_2);
    if (row2 === undefined) {
      throw new Error(
        `no evidence row recorded with ac_ref ${MARKER_2} — full evidence: ${JSON.stringify(evidence)}`,
      );
    }
    expect(row2.result).toBe("pass");
    const tail2 = row2.output_tail ?? "";
    expect(tail2.length).toBe(TAIL_CAP);
    expect(tail2).not.toContain(MARKER_1);
    expect(tail2).not.toContain(MARKER_2);
  });
});

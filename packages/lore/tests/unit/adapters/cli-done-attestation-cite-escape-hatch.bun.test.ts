// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
/**
 * `lore done --override-attestation-cite <n>` — the CLI end-to-end oracle for
 * task-lore-done-override-attestation-demands-fresh-prose-that, under the done-contract model
 * (spec-done-contract-compiled-at-approve-task-kinds-write-sets, AC-DCS1-7).
 *
 * `--override-attestation-cite` is an ADDED, alternative way to satisfy the SAME attestation floor `--override-attestation
 * "<reason>"` bypasses — citing an existing `extra.verification_evidence` row (1-based index) instead of retyping its
 * measurement as fresh prose. `lore done` now judges a task only by the contract stored at approve, in the fixed floor order of
 * BR-209, and the escape waives the ATTESTED-PASS floor and nothing after it: a task whose contract oracle has no counted pass is
 * still refused, at the first oracle floor ([floor: unfiltered-test-file] for an anchored test file, then [floor: contract-oracles]).
 *
 * Two fixtures, by what each case needs:
 *   - a planless `--adhoc` code task holding no contract, for the cases the command refuses BEFORE any floor (the citation checks
 *     and the usage errors);
 *   - {@link makeOverrideWorld}: a real repository where a code task is approved (red waived), claimed on a branch in a linked
 *     worktree, committed on and landed on main, for the cases that reach the floors.
 * Both are throwaway (mkdtemp + `lore init`, HOME outside the repository); this repository's own `.lore/` is never touched.
 *
 * Retired with the model (spec AC-DCS1-6, named in the commit): the `--declare-no-new-tests` companion flag these cases used to
 * carry, and every case that archived a task through a citation alone (the snapshot of the cited row in the archived record).
 * After an override the contract oracles are judged by counted passes, so no task with a compiled contract is archived by an
 * override; the audit-stamping of an archive through an override is covered at the service layer by a contract with no oracle
 * (task-workflow-service.test.ts).
 *
 * Coverage:
 *   HAPPY:       a valid citation (a pass row with a non-empty tail) passes the citation checks and waives the attestation floor;
 *                the oracle floor then refuses (exit 4), nothing is written and no audit row carries an override marker
 *   NEGATIVE ×3: citing a `fail` row / an empty-`output_tail` row (via a real `--capture` of a silent `true`) / an out-of-range
 *                index each refuse (exit 4), name the row and the exact reason, and write NOTHING (status/version unchanged)
 *   REGRESSION:  the free-text `--override-attestation "<reason>"` path is unaffected by this flag's addition
 *   REGRESSION:  `lore done` with NEITHER escape hatch refuses an unevidenced landed task at attested-pass (exit 4)
 *   BOUNDARY:    index 0 (out of range, 1-based) is refused while index 1 (the first, and only, valid row) passes the citation
 *                checks on the SAME single-row task; a task with ZERO evidence rows refuses citing index 1
 *   USAGE ERROR: a non-integer index (exit 2, before the corpus is touched); supplying BOTH `--override-attestation` and
 *                `--override-attestation-cite` together (exit 2, mutually exclusive)
 *
 * @spec_ref task-lore-done-override-attestation-demands-fresh-prose-that
 * @spec_ref spec-done-contract-compiled-at-approve-task-kinds-write-sets
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through dist/lore.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";
import { makeOverrideWorld, type OverrideWorld } from "./done-override-world";

setDefaultTimeout(180_000);

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

async function mustRun(args: string[], cwd: string): Promise<RunResult> {
  const result = await runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture command \`lore ${args.join(" ")}\` failed (${result.exitCode}): ${result.stderr}`);
  }
  return result;
}

interface DocJson {
  readonly slug: string;
  readonly status: string;
  readonly version: number;
  readonly extra: Record<string, unknown>;
}

async function getDoc(slug: string, cwd: string): Promise<DocJson> {
  const result = await mustRun(["get", slug, "--json"], cwd);
  return (JSON.parse(result.stdout) as { data: { doc: DocJson } }).data.doc;
}

/**
 * Creates a planless (`--adhoc`) code task and returns its slug. `--ac-scope ""` is required on the ad-hoc branch; the task holds
 * no contract (it was never approved), which is all the citation checks and the usage errors need.
 */
async function createAdhocTask(cwd: string, title: string): Promise<string> {
  const created = await mustRun(
    ["create", "task", "--title", title, "--kind", "code", "--adhoc", "--ac-scope", "", "--content", "body", "--no-ai", "--json"],
    cwd,
  );
  return (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}

/** The arguments of ONE self-reported `result:"pass"` evidence row with a real, non-empty `output_tail` — the shape a citation ACCEPTS. */
const CITABLE_PASS_ARGS = [
  "--oracle",
  "manual",
  "--command",
  "manual check: verified in staging",
  "--result",
  "pass",
  "--output-tail",
  "confirmed working via manual QA",
] as const;

/** Records the citable pass row in the `--adhoc` fixture. */
async function recordCitablePass(slug: string, cwd: string): Promise<void> {
  await mustRun(["evidence", slug, ...CITABLE_PASS_ARGS], cwd);
}

/** Records ONE self-reported `result:"fail"` evidence row — a row that must NEVER be citable. */
async function recordCitableFail(slug: string, cwd: string): Promise<void> {
  await mustRun(["evidence", slug, "--oracle", "test", "--command", "bun test", "--result", "fail", "--output-tail", "boom"], cwd);
}

/**
 * Records ONE `--capture`-produced `result:"pass"` row whose `output_tail` is GENUINELY EMPTY (`--capture` spawns `true`, a real
 * command that exits 0 and prints nothing) — a row that must NEVER be citable either, even though it IS runner-captured, because
 * the citation floor refuses an empty tail unconditionally.
 */
async function recordCitablePassWithEmptyTail(slug: string, cwd: string): Promise<void> {
  await mustRun(["evidence", slug, "--oracle", "test", "--command", "true", "--result", "pass", "--capture"], cwd);
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-done-cite-escape-hatch-"));
  await mustRun(["init"], tmpDir);
  // An --adhoc task parents to the corpus root PRD (CorpusService._createImpl) — one must exist first.
  await mustRun(["create", "prd", "--title", "Cite Escape Hatch Root", "--content", "## Overview\nroot", "--no-ai"], tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("NEGATIVE — a fail row is refused; nothing is written", () => {
  it("citing a result:fail row exits 4, names the row, and leaves the task untouched", async () => {
    const slug = await createAdhocTask(tmpDir, "Fail Row Task");
    await recordCitableFail(slug, tmpDir);
    const before = await getDoc(slug, tmpDir);

    const result = await runLore(["done", slug, "--override-attestation-cite", "1"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("verification_evidence[1]");
    expect(result.stderr).toContain('"fail"');
    expect(result.stderr).toContain("not \"pass\"");

    const after = await getDoc(slug, tmpDir);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
  });
});

describe("NEGATIVE — an empty-output_tail pass row is refused; nothing is written", () => {
  it("citing a genuinely-empty-tail (real --capture of `true`) pass row exits 4 and leaves the task untouched", async () => {
    const slug = await createAdhocTask(tmpDir, "Empty Tail Task");
    await recordCitablePassWithEmptyTail(slug, tmpDir);
    // Confirm the fixture actually produced an empty tail before asserting the refusal —
    // a non-empty tail here would make this test vacuously pass for the wrong reason.
    expect(((await getDoc(slug, tmpDir)).extra["verification_evidence"] as Array<{ output_tail?: string }>)[0]?.output_tail).toBe(
      "",
    );
    const before = await getDoc(slug, tmpDir);

    const result = await runLore(["done", slug, "--override-attestation-cite", "1"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("verification_evidence[1]");
    expect(result.stderr).toContain("empty");
    expect(result.stderr).toContain("output_tail");

    const after = await getDoc(slug, tmpDir);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
  });
});

describe("NEGATIVE — an out-of-range index is refused; nothing is written", () => {
  it("citing index 99 on a single-row task exits 4, names the valid range, and leaves the task untouched", async () => {
    const slug = await createAdhocTask(tmpDir, "Out Of Range Task");
    await recordCitablePass(slug, tmpDir);
    const before = await getDoc(slug, tmpDir);

    const result = await runLore(["done", slug, "--override-attestation-cite", "99"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("out of range");
    expect(result.stderr).toContain("1..1");

    const after = await getDoc(slug, tmpDir);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
  });
});

describe("BOUNDARY — index 0 is out of range", () => {
  it("index 0 is refused as out of range, never treated as the first row", async () => {
    const slug = await createAdhocTask(tmpDir, "Off By One Task");
    await recordCitablePass(slug, tmpDir);

    const result = await runLore(["done", slug, "--override-attestation-cite", "0"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("out of range");
    expect((await getDoc(slug, tmpDir)).status).toBe("draft");
  });
});

describe("BOUNDARY — a task with ZERO evidence rows has nothing to cite", () => {
  it("citing index 1 on a task with no evidence at all exits 4, naming the zero-rows condition", async () => {
    const slug = await createAdhocTask(tmpDir, "Zero Evidence Task");

    const result = await runLore(["done", slug, "--override-attestation-cite", "1"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("zero");
    expect(result.stderr).toContain("verification_evidence");
    expect((await getDoc(slug, tmpDir)).status).toBe("draft");
  });
});

describe("USAGE ERROR — a non-integer index is refused before the corpus is touched", () => {
  it("a non-numeric value exits 2 and leaves the task untouched", async () => {
    const slug = await createAdhocTask(tmpDir, "Bad Index Syntax Task");
    await recordCitablePass(slug, tmpDir);
    const before = await getDoc(slug, tmpDir);

    const result = await runLore(["done", slug, "--override-attestation-cite", "abc"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--override-attestation-cite");

    const after = await getDoc(slug, tmpDir);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
  });

  it("a negative value exits 2", async () => {
    const slug = await createAdhocTask(tmpDir, "Negative Index Syntax Task");
    await recordCitablePass(slug, tmpDir);

    const result = await runLore(["done", slug, "--override-attestation-cite", "-1"], tmpDir);
    expect(result.exitCode).toBe(2);
  });
});

describe("USAGE ERROR — --override-attestation and --override-attestation-cite are mutually exclusive", () => {
  it("supplying both flags together exits 2, before the corpus is touched", async () => {
    const slug = await createAdhocTask(tmpDir, "Both Flags Task");
    await recordCitablePass(slug, tmpDir);
    const before = await getDoc(slug, tmpDir);

    const result = await runLore(
      ["done", slug, "--override-attestation", "some reason", "--override-attestation-cite", "1"],
      tmpDir,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("mutually exclusive");

    const after = await getDoc(slug, tmpDir);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
  });
});

describe("the escapes on a landed code task with a stored contract (real repository, linked worktree)", () => {
  let world: OverrideWorld;

  beforeAll(async () => {
    world = await makeOverrideWorld();
  });

  afterAll(() => {
    world.dispose();
  });

  /** Asserts the refusal of an escape: exit 4 at the oracle floor, the attestation floor waived, nothing written. */
  async function expectWaivedThenRefused(slug: string, args: readonly string[]): Promise<void> {
    const before = await world.readTask(slug);
    const result = await world.run(["done", slug, ...args]);
    expect(result.exitCode, `${result.stdout}${result.stderr}`).toBe(4);
    // the landed task anchors one test file, so its contract holds a `test:` oracle, judged right after the red run
    expect(result.stderr).toContain("[floor: unfiltered-test-file]");
    expect(result.stderr).not.toContain("[floor: attested-pass]");
    const after = await world.readTask(slug);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
    const rows = await world.auditRows(slug);
    expect(rows.every((row) => row.details?.["override_reason"] === undefined)).toBe(true);
    expect(rows.every((row) => row.details?.["attestation_overridden"] === undefined)).toBe(true);
  }

  it("HAPPY: citing index 1, a real pass row with a real tail, passes the citation checks and waives the attestation floor; the oracle floor then refuses", async () => {
    const slug = await world.landTask("Citable Pass Task");
    await world.mustRun(["evidence", slug, ...CITABLE_PASS_ARGS]);

    await expectWaivedThenRefused(slug, ["--override-attestation-cite", "1"]);
  });

  it("BOUNDARY: index 1 on the single-row task passes the citation checks (the same task index 0 was refused on)", async () => {
    const slug = await world.landTask("Off By One Task Valid Index");
    await world.mustRun(["evidence", slug, ...CITABLE_PASS_ARGS]);

    const zero = await world.run(["done", slug, "--override-attestation-cite", "0"]);
    expect(zero.exitCode).toBe(4);
    expect(zero.stderr).toContain("out of range");

    await expectWaivedThenRefused(slug, ["--override-attestation-cite", "1"]);
  });

  it("REGRESSION: the free-text --override-attestation path is unaffected — it waives the attestation floor and the oracle floor refuses", async () => {
    const slug = await world.landTask("Free Text Regression Task");
    await world.mustRun(["evidence", slug, ...CITABLE_PASS_ARGS]);

    await expectWaivedThenRefused(slug, ["--override-attestation", "manual browser check: verified in staging"]);
  });

  it("REGRESSION: neither --override-attestation nor --override-attestation-cite refuses [floor: attested-pass] (exit 4), task unchanged", async () => {
    const slug = await world.landTask("No Escape Hatch At All Task");
    await world.mustRun(["evidence", slug, ...CITABLE_PASS_ARGS]);
    const before = await world.readTask(slug);

    const result = await world.run(["done", slug]);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("[floor: attested-pass]");
    expect(result.stderr).toContain("--override-attestation");

    const after = await world.readTask(slug);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
  });
});

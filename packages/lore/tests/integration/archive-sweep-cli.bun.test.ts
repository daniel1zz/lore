/**
 * @spec_ref spec-lifecycle-archival-plan-close-cascade-deterministic
 *   §Design Decisions D3, AC-097-3
 *
 * CLI e2e for `lore archive --sweep`/`--apply` (SOURCE mode — `bun run src/index.ts`,
 * mirrors `cli-outline.bun.test.ts`'s harness): `--sweep` reports current archive
 * candidates with a literal `lore archive --apply` repair line and exits 3; `--apply`
 * archives them (one audited write each); an immediate re-sweep exits 0.
 *
 * ⛔ Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule) —
 * every test operates inside its own `mkdtempSync` directory.
 *
 * A `done_plan_straggler` (R4) candidate is constructed by archiving a plan (with
 * `workflow.gates."plan-close".enabled: false` so the plan-close gate/attestation
 * floor never blocks this fixture's test-scope-irrelevant path) and THEN creating a
 * task under it — the task never existed during the plan's own archival, so it is
 * NOT touched by the R1 cascade, and shows up only via the R2-R4 sweep.
 *
 * Coverage dimensions:
 *   HAPPY:      `--sweep --json` exits 3, lists the straggler with `rule:
 *               "done_plan_straggler"` and `repair: "lore archive --apply"`;
 *               `--apply` archives it (exit 0); an immediate re-`--sweep` exits 0
 *               with an empty candidate list
 *   NEGATIVE:   neither `--sweep` nor `--apply` → exit 2 usage error
 *   BOUNDARY:   both `--sweep` AND `--apply` together → exit 2 usage error
 *   STATE:      after `--apply`, `lore get <task> --json` shows `status: "archived"`
 *   REGRESSION: an empty corpus's `--sweep` exits 0 with zero candidates; PLUS a
 *               dedicated CONTROL pair (task-archive-sweep-gate-disable-is-
 *               silently-inert-a-wholesale) pinning that `disablePlanCloseGate`
 *               genuinely disables the `plan-close` checkpoint. The helper used to
 *               `writeFileSync` (wholesale overwrite) `.lore/config.yaml`,
 *               discarding the `project:` block `lore init` had just written;
 *               `project` is a REQUIRED (non-`.optional()`) field in
 *               `LoreConfigSchema` (`packages/core/src/config.ts`), so the
 *               resulting file failed schema validation and `loadLoreApp`
 *               (`packages/lore/src/adapters/cli/loader.ts`) silently fell back to
 *               `rawConfig = undefined` (a documented SPEC-030 non-goal for
 *               non-`ai` sections, deliberately NOT touched here) — the
 *               gate-disable stanza was therefore never read and the checkpoint
 *               stayed armed the whole time. Every OTHER assertion in this file
 *               happened to pass either way: this suite's plan has no spec-tier
 *               ancestor, so the only plan-close predicate that can ever fire
 *               (the attestation floor) is vacuous regardless of the checkpoint's
 *               enabled state — "gate armed" and "gate disabled" were
 *               indistinguishable here. The CONTROL pair below uses a
 *               `--requires-uat` plan instead (SPEC-054's `uatP0Accepted`
 *               predicate, gated purely by the plan's OWN `extra.requires_uat`,
 *               never by spec ancestry) specifically because it is the one
 *               plan-close deny this suite can reach without any additional
 *               config — it is what actually depends on the disable taking
 *               effect.
 */

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// tests/integration/ -> packages/lore/ (2 levels up).
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: "agent:archive-sweep-cli-test" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from create output: ${stdout}`);
  return slug;
}

/**
 * Disables the plan-close gate — irrelevant to THIS suite's scope (the R2-R4
 * sweep verb, not R1's cascade/gate interplay).
 *
 * APPENDS the override (never a wholesale `writeFileSync` overwrite): by the
 * time any caller runs this, `lore init` has already written `.lore/config.yaml`
 * with a REQUIRED top-level `project:` key (`LoreConfigSchema`, no `.optional()`
 * on that field). An overwrite that omitted it produced a schema-invalid file
 * that `loadLoreApp` silently treats as `rawConfig = undefined` (documented
 * SPEC-030 non-goal) — the override below would then never be read and the
 * checkpoint would stay armed while looking disabled (this file's own
 * task-archive-sweep-gate-disable-is-silently-inert-a-wholesale regression).
 * Appending a single top-level `workflow:` key is safe here specifically
 * because `lore init`'s config never seeds one itself (`commands/init.ts`'s own
 * module doc) — see `cli-drift.bun.test.ts`'s `disableAllGates` for the same
 * precedent. Callers that need this ALONGSIDE another `workflow.*` override on
 * the SAME file must use a parse-merge-rewrite helper instead (two raw
 * `workflow:` keys is invalid YAML) — none of this file's tests do.
 */
function disablePlanCloseGate(dir: string): void {
  const configPath = join(dir, ".lore", "config.yaml");
  appendFileSync(
    configPath,
    ['workflow:', '  gates:', '    "plan-close":', "      enabled: false", ""].join("\n"),
    "utf8",
  );
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-archive-sweep-cli-test-"));
  const initResult = runLore(["init"], tmpDir);
  expect(initResult.exitCode).toBe(0);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("lore archive — HAPPY/STATE (sweep -> apply -> re-sweep)", () => {
  it("AC-097-3: sweep reports a done_plan_straggler with a literal repair, apply archives it, re-sweep is clean", () => {
    disablePlanCloseGate(tmpDir);

    const prdResult = runLore(["create", "prd", "--title", "Archive Sweep PRD", "--content", "root", "--no-ai"], tmpDir);
    expect(prdResult.exitCode).toBe(0);
    const prdSlug = parseSlug(prdResult.stdout);

    const planResult = runLore(
      ["create", "plan", "--title", "Sweep Test Plan", "--parent", prdSlug, "--content", "x", "--no-ai"],
      tmpDir,
    );
    expect(planResult.exitCode).toBe(0);
    const planSlug = parseSlug(planResult.stdout);

    const approveResult = runLore(["set", planSlug, "--status", "approved"], tmpDir);
    expect(approveResult.exitCode).toBe(0);

    const archivePlanResult = runLore(["set", planSlug, "--status", "archived"], tmpDir);
    expect(archivePlanResult.exitCode).toBe(0);

    // Task created AFTER the plan already archived — a genuine R4 straggler, never
    // touched by the R1 cascade (which only ever sees children present AT close time).
    const taskResult = runLore(
      [
        "create",
        "task",
        "--title",
        "Straggler Task",
        "--parent",
        planSlug,
        "--plan-id",
        planSlug,
        "--content",
        "x",
        "--no-ai",
      ],
      tmpDir,
    );
    expect(taskResult.exitCode).toBe(0);
    const taskSlug = parseSlug(taskResult.stdout);

    // RE-BASELINED (task-skill-test-red-archive-apply-leaves-floor-refused, issue #173, BR-1072, spec
    // spec-approval-and-plan-closure-go-through-the-same-checks-on D8): the ORIGINAL straggler here carried NO
    // evidence and the case asserted `archive --apply` archived it and the re-sweep exited 0 (AC-097-3 under
    // D3's "unconditional" sentence). D8 supersedes that sentence — the sweep now archives a straggler only if
    // `lore done` would — so the HAPPY straggler carries a runner-captured pass. The evidence-less path is
    // pinned by the floor-refused case below.
    const evidenceResult = runLore(
      ["evidence", taskSlug, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"],
      tmpDir,
    );
    expect(evidenceResult.exitCode).toBe(0);

    const sweepResult = runLore(["archive", "--sweep", "--json"], tmpDir);
    expect(sweepResult.exitCode).toBe(3);
    const sweepPayload = JSON.parse(sweepResult.stdout) as {
      ok: boolean;
      data: { candidates: Array<{ slug: string; rule: string; reason: string; repair: string }> };
    };
    expect(sweepPayload.ok).toBe(true);
    expect(sweepPayload.data.candidates).toHaveLength(1);
    expect(sweepPayload.data.candidates[0]!.slug).toBe(taskSlug);
    expect(sweepPayload.data.candidates[0]!.rule).toBe("done_plan_straggler");
    expect(sweepPayload.data.candidates[0]!.repair).toBe("lore archive --apply");

    const applyResult = runLore(["archive", "--apply"], tmpDir);
    expect(applyResult.exitCode).toBe(0);
    expect(applyResult.stdout).toContain(taskSlug);
    expect(applyResult.stdout).toContain("OK");

    const reSweepResult = runLore(["archive", "--sweep", "--json"], tmpDir);
    expect(reSweepResult.exitCode).toBe(0);
    const reSweepPayload = JSON.parse(reSweepResult.stdout) as { data: { candidates: unknown[] } };
    expect(reSweepPayload.data.candidates).toEqual([]);

    const getResult = runLore(["get", taskSlug, "--json"], tmpDir);
    expect(getResult.exitCode).toBe(0);
    const getPayload = JSON.parse(getResult.stdout) as { data: { doc: { status: string } } };
    expect(getPayload.data.doc.status).toBe("archived");
  });
});

describe("lore archive — NEGATIVE/STATE (a floor-refused straggler stays open; D8 / BR-1072 / #173)", () => {
  it("an evidence-less straggler is skipped with its floor, stays open, --json carries floor, --sweep still lists it (exit 3), and a handoff still archives", () => {
    disablePlanCloseGate(tmpDir);
    const prdSlug = parseSlug(
      runLore(["create", "prd", "--title", "Floor Sweep PRD", "--content", "root", "--no-ai"], tmpDir).stdout,
    );
    const planSlug = parseSlug(
      runLore(
        ["create", "plan", "--title", "Floor Sweep Plan", "--parent", prdSlug, "--content", "x", "--no-ai"],
        tmpDir,
      ).stdout,
    );
    expect(runLore(["set", planSlug, "--status", "approved"], tmpDir).exitCode).toBe(0);
    expect(runLore(["set", planSlug, "--status", "archived"], tmpDir).exitCode).toBe(0);

    // Straggler with NO evidence: `lore done` would refuse it with floor `attested-pass`.
    const taskSlug = parseSlug(
      runLore(
        ["create", "task", "--title", "Bare Straggler", "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai"],
        tmpDir,
      ).stdout,
    );

    // Expired handoff under the archived plan (created_at backdated past the 7-day default TTL).
    const handoffSlug = parseSlug(runLore(["handoff", "--next", "resume", "--plan", planSlug], tmpDir).stdout);
    const handoffId = (
      JSON.parse(runLore(["get", handoffSlug, "--json"], tmpDir).stdout) as { data: { doc: { id: string } } }
    ).data.doc.id;
    const db = new Database(join(tmpDir, ".lore", "lore.db"));
    try {
      db.query("UPDATE docs SET created_at = ? WHERE id = ?").run(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        handoffId,
      );
    } finally {
      db.close();
    }

    const applyResult = runLore(["archive", "--apply", "--json"], tmpDir);
    expect(applyResult.exitCode).toBe(0);
    const applyPayload = JSON.parse(applyResult.stdout) as {
      data: { outcomes: Array<{ slug: string; ok: boolean; floor?: string }> };
    };
    // --json carries the refusing floor on the straggler's outcome.
    expect(applyPayload.data.outcomes.find((o) => o.slug === taskSlug)?.floor).toBe("attested-pass");
    // A handoff is not a task: it still archives.
    expect(applyPayload.data.outcomes.find((o) => o.slug === handoffSlug)?.ok).toBe(true);

    // The task stayed open.
    const getTask = JSON.parse(runLore(["get", taskSlug, "--json"], tmpDir).stdout) as {
      data: { doc: { status: string } };
    };
    expect(getTask.data.doc.status).not.toBe("archived");

    // Human output names the skipped slug and the floor (a second --apply; the task is still a candidate).
    const humanApply = runLore(["archive", "--apply"], tmpDir);
    expect(humanApply.stdout).toContain(`[SKIPPED] ${taskSlug} — refused by attested-pass`);

    // The re-sweep keeps reporting it (never silent), exit 3.
    const reSweep = runLore(["archive", "--sweep", "--json"], tmpDir);
    expect(reSweep.exitCode).toBe(3);
    const reSweepPayload = JSON.parse(reSweep.stdout) as { data: { candidates: Array<{ slug: string }> } };
    expect(reSweepPayload.data.candidates.map((c) => c.slug)).toEqual([taskSlug]);
  });
});

describe("lore archive — NEGATIVE/BOUNDARY (usage errors)", () => {
  it("AC-097-3: neither --sweep nor --apply exits 2", () => {
    const result = runLore(["archive"], tmpDir);
    expect(result.exitCode).toBe(2);
  });

  it("AC-097-3: both --sweep and --apply together exits 2", () => {
    const result = runLore(["archive", "--sweep", "--apply"], tmpDir);
    expect(result.exitCode).toBe(2);
  });
});

describe("lore archive — REGRESSION (empty corpus)", () => {
  it("AC-097-3: --sweep on an empty corpus exits 0 with zero candidates", () => {
    const result = runLore(["archive", "--sweep", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout) as { data: { candidates: unknown[] } };
    expect(payload.data.candidates).toEqual([]);
  });
});

// ─── REGRESSION — task-archive-sweep-gate-disable-is-silently-inert-a-wholesale ──
//
// A live CONTROL that `disablePlanCloseGate` genuinely disables the plan-close
// checkpoint, not merely that this suite's OTHER tests stay green either way.
// Uses a `--requires-uat` plan (SPEC-054's `uatP0Accepted` predicate, gated
// purely by the plan's own `extra.requires_uat` — never by spec-tier ancestry)
// specifically because it is the one plan-close deny this suite can reach
// without any additional config, so it is the one assertion that actually
// depends on `disablePlanCloseGate`'s override having been read at all.

/** Creates a PRD -> `--requires-uat` plan (approved), with no linked UAT verdict. */
function createRequiresUatPlan(dir: string): { planSlug: string } {
  const prdResult = runLore(
    ["create", "prd", "--title", "Gate Disable Control PRD", "--content", "root", "--no-ai"],
    dir,
  );
  expect(prdResult.exitCode).toBe(0);
  const prdSlug = parseSlug(prdResult.stdout);

  const planResult = runLore(
    [
      "create",
      "plan",
      "--title",
      "Gate Disable Control Plan",
      "--parent",
      prdSlug,
      "--content",
      "x",
      "--no-ai",
      "--requires-uat",
    ],
    dir,
  );
  expect(planResult.exitCode).toBe(0);
  const planSlug = parseSlug(planResult.stdout);

  const approveResult = runLore(["set", planSlug, "--status", "approved"], dir);
  expect(approveResult.exitCode).toBe(0);

  return { planSlug };
}

describe("lore archive — REGRESSION (CONTROL: disablePlanCloseGate genuinely disables plan-close)", () => {
  it("NEGATIVE baseline: WITHOUT disablePlanCloseGate, a --requires-uat plan with no linked UAT verdict is DENIED at archive time (UAT_MISSING) — proves the scenario really would be blocked", () => {
    const { planSlug } = createRequiresUatPlan(tmpDir);

    const archiveResult = runLore(["set", planSlug, "--status", "archived"], tmpDir);

    expect(archiveResult.exitCode).not.toBe(0);
    expect(archiveResult.stderr).toContain("UAT_MISSING");
  });

  it("HAPPY (the control): WITH disablePlanCloseGate applied AFTER approval, the SAME scenario archives cleanly — the checkpoint is genuinely off, not just cosmetically", () => {
    const { planSlug } = createRequiresUatPlan(tmpDir);

    disablePlanCloseGate(tmpDir);

    const archiveResult = runLore(["set", planSlug, "--status", "archived"], tmpDir);

    expect(archiveResult.exitCode).toBe(0);

    const getResult = runLore(["get", planSlug, "--json"], tmpDir);
    expect(getResult.exitCode).toBe(0);
    const getPayload = JSON.parse(getResult.stdout) as { data: { doc: { status: string } } };
    expect(getPayload.data.doc.status).toBe("archived");
  });
});

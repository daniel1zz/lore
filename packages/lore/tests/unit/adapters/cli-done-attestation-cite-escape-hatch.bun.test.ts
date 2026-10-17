/**
 * `lore done --override-attestation-cite <n>` — the CLI author→trip
 * end-to-end oracle for
 * task-lore-done-override-attestation-demands-fresh-prose-that.
 *
 * `--override-attestation-cite` is an ADDED, alternative way to satisfy the
 * SAME attestation floor `--override-attestation "<reason>"` bypasses —
 * citing an existing `extra.verification_evidence` row (1-based index)
 * instead of retyping its measurement as fresh prose. This suite proves the
 * flag reaches the COMPILED binary end to end (argv parsing → doc read →
 * validation → `TaskWorkflowService.done` → the audit write), mirroring
 * `cli-done-attestation-escape-hatch.bun.test.ts`'s own oracle shape for the
 * pre-existing free-text flag — every STATE assertion below reads the ACTUAL
 * `.lore` audit table via `lore audit <doc> --json`, and the free-text
 * regression assertion proves the two paths remain fully independent.
 *
 * Spawns the COMPILED `dist/lore` binary (Bun.spawnSync) against a THROWAWAY
 * corpus (mkdtemp + `lore init`) — never touches the repo's own `.lore/`
 * corpus (project CLAUDE.md hard rule). Requires `bun run build` first;
 * `assertFreshBinary` fails loud before any test runs if `dist/lore` is
 * missing or older than the newest `.ts` source under
 * `packages/{lore,core}/src`.
 *
 * Fixture: `--adhoc` tasks (SPEC-069 D2), same shape the sibling suite uses —
 * structurally unattestable (`lore verify` has no script-mode AC to bind to),
 * so each can only reach `archived` via an override, never a real attested
 * pass.
 *
 * Coverage:
 *   HAPPY:       citing a valid `result:pass` row with a non-empty
 *                `output_tail` archives the task; the audit trail's
 *                `override_reason` carries the row's snapshotted identifying
 *                fields (oracle/command/result/recorded_at/recorded_by/
 *                capture_source) verbatim, and NEVER the word "attested"/
 *                "attestation" (never lets a self-report read as attested)
 *   NEGATIVE ×3: citing a `fail` row / an empty-`output_tail` row (via a real
 *                `--capture` of a silent `true`) / an out-of-range index each
 *                refuse (exit 4), name the row and the exact reason, and
 *                archive NOTHING (status/version unchanged)
 *   REGRESSION:  the pre-existing free-text `--override-attestation
 *                "<reason>"` path behaves exactly as before — unaffected by
 *                this flag's addition
 *   REGRESSION:  `lore done` with NEITHER escape hatch still refuses a
 *                self-reported-only task (exit 4), never a silent default
 *   BOUNDARY:    index 0 (out of range, 1-based) and index 1 (the first, and
 *                only, valid row) on the SAME single-row task; a task with
 *                ZERO evidence rows refuses citing index 1
 *   USAGE ERROR: a non-integer index (exit 2, before the corpus is touched);
 *                supplying BOTH `--override-attestation` and
 *                `--override-attestation-cite` together (exit 2, mutually
 *                exclusive)
 *
 * @spec_ref task-lore-done-override-attestation-demands-fresh-prose-that
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

setDefaultTimeout(60_000);

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/ → packages/ → repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
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

interface AuditEntryJson {
  readonly action: string;
  readonly details?: Record<string, unknown>;
}

/** Every audit row for `slug`, via the REAL `lore audit <doc> --json` CLI verb. */
async function getAuditEntries(slug: string, cwd: string): Promise<AuditEntryJson[]> {
  const result = await mustRun(["audit", slug, "--json"], cwd);
  return (JSON.parse(result.stdout) as { data: { entries: AuditEntryJson[] } }).data.entries;
}

/**
 * Creates a planless (`--adhoc`) task and returns its slug — byte-identical
 * fixture shape to `cli-done-attestation-escape-hatch.bun.test.ts`'s own
 * `createAdhocTask` (not imported from there — that file sits outside this
 * task's declared file anchors, and a shared helper only one of the two call
 * sites could be pointed at is worse than two documented copies).
 *
 * `--ac-scope ""` ALSO arms `lore done`'s INDEPENDENT no-new-tests floor
 * (task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed), so every
 * archiving call below carries {@link NO_NEW_TESTS_REASON} alongside
 * whichever attestation escape it exercises — a DIFFERENT floor with a
 * DIFFERENT escape than this suite's subject.
 */
async function createAdhocTask(cwd: string, title: string): Promise<string> {
  const created = await mustRun(
    ["create", "task", "--title", title, "--adhoc", "--ac-scope", "", "--content", "body", "--no-ai", "--json"],
    cwd,
  );
  return (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}

/** See {@link createAdhocTask}'s own doc comment. */
const NO_NEW_TESTS_REASON = "cite-escape-hatch fixture: no new test, this suite asserts the citation escape";

/**
 * Records ONE self-reported `result:"pass"` evidence row with a real,
 * non-empty `output_tail` — the exact shape `--override-attestation-cite`
 * should ACCEPT. `oracle:"manual"` is the one kind whose self-reported tail
 * `rejectMissingPassOutputTail` still lets through non-empty (mirrors the
 * free-text sibling suite's own `recordSelfReportedPass`).
 */
async function recordCitablePass(slug: string, cwd: string): Promise<void> {
  await mustRun(
    [
      "evidence",
      slug,
      "--oracle",
      "manual",
      "--command",
      "manual check: verified in staging",
      "--result",
      "pass",
      "--output-tail",
      "confirmed working via manual QA",
    ],
    cwd,
  );
}

/** Records ONE self-reported `result:"fail"` evidence row — a row that must NEVER be citable. */
async function recordCitableFail(slug: string, cwd: string): Promise<void> {
  await mustRun(["evidence", slug, "--oracle", "test", "--command", "bun test", "--result", "fail", "--output-tail", "boom"], cwd);
}

/**
 * Records ONE `--capture`-produced `result:"pass"` row whose `output_tail` is
 * GENUINELY EMPTY (`--capture` spawns `true`, a real command that exits 0 and
 * prints nothing) — a row that must NEVER be citable either, even though it
 * IS runner-captured (`capture_source:"runner"`), because the citation floor
 * (task-lore-done-override-attestation-demands-fresh-prose-that) refuses an
 * empty tail unconditionally, mirroring the "empty tail is never AC coverage"
 * rule applied everywhere else in this repo.
 */
async function recordCitablePassWithEmptyTail(slug: string, cwd: string): Promise<void> {
  await mustRun(["evidence", slug, "--oracle", "test", "--command", "true", "--result", "pass", "--capture"], cwd);
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-done-cite-escape-hatch-"));
  await mustRun(["init"], tmpDir);
  // An --adhoc task parents to the corpus root PRD (CorpusService._createImpl) —
  // one must exist first, mirroring every other --adhoc fixture in this repo.
  await mustRun(["create", "prd", "--title", "Cite Escape Hatch Root", "--content", "## Overview\nroot", "--no-ai"], tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("HAPPY — citing a valid pass row with a non-empty tail archives the task", () => {
  it("index 1, a real pass row with a real tail, reaches exit 0 and the task is archived", async () => {
    const slug = await createAdhocTask(tmpDir, "Citable Pass Task");
    await recordCitablePass(slug, tmpDir);

    const result = await mustRun(
      ["done", slug, "--override-attestation-cite", "1", "--declare-no-new-tests", NO_NEW_TESTS_REASON],
      tmpDir,
    );
    expect(result.exitCode).toBe(0);
    expect((await getDoc(slug, tmpDir)).status).toBe("archived");
  });

  it("the archived record snapshots the cited row's identifying fields verbatim, and never reads as attested", async () => {
    const slug = await createAdhocTask(tmpDir, "Snapshot Task");
    await recordCitablePass(slug, tmpDir);

    await mustRun(["done", slug, "--override-attestation-cite", "1", "--declare-no-new-tests", NO_NEW_TESTS_REASON], tmpDir);

    const doneSteps = (await getAuditEntries(slug, tmpDir)).filter((e) => e.details?.["done"] === true);
    expect(doneSteps.length).toBeGreaterThan(0);
    for (const step of doneSteps) {
      const reason = step.details?.["override_reason"];
      expect(typeof reason).toBe("string");
      const text = reason as string;
      // Self-containment (AC-2): every identifying field is present verbatim —
      // an auditor reading ONLY this archived record, never the task, can
      // recover exactly what was cited.
      expect(text).toContain("verification_evidence[1]");
      expect(text).toContain("oracle=manual");
      expect(text).toContain("command=manual check: verified in staging");
      expect(text).toContain("result=pass");
      expect(text).toContain("recorded_by=");
      expect(text).toContain("recorded_at=");
      expect(text).toContain("capture_source=self-report");
      // AC-3: never launders a self-report into something that reads as attested.
      expect(text.toLowerCase()).not.toContain("attested");
      expect(text.toLowerCase()).not.toContain("attestation:");
      // attestation_overridden:true is the PRE-EXISTING, correct signal that an
      // override bypassed the floor — it does not itself claim attestation.
      expect(step.details?.["attestation_overridden"]).toBe(true);
    }
  });
});

describe("NEGATIVE — a fail row is refused; nothing is archived", () => {
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

describe("NEGATIVE — an empty-output_tail pass row is refused; nothing is archived", () => {
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

describe("NEGATIVE — an out-of-range index is refused; nothing is archived", () => {
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

describe("BOUNDARY — index 0 (out of range) vs index 1 (the only valid row) on the same single-row task", () => {
  it("index 0 is refused as out of range, never treated as the first row", async () => {
    const slug = await createAdhocTask(tmpDir, "Off By One Task");
    await recordCitablePass(slug, tmpDir);

    const result = await runLore(["done", slug, "--override-attestation-cite", "0"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("out of range");
    expect((await getDoc(slug, tmpDir)).status).toBe("draft");
  });

  it("index 1 on the SAME single-row task succeeds", async () => {
    const slug = await createAdhocTask(tmpDir, "Off By One Task Valid Index");
    await recordCitablePass(slug, tmpDir);

    const result = await mustRun(
      ["done", slug, "--override-attestation-cite", "1", "--declare-no-new-tests", NO_NEW_TESTS_REASON],
      tmpDir,
    );
    expect(result.exitCode).toBe(0);
    expect((await getDoc(slug, tmpDir)).status).toBe("archived");
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

describe("REGRESSION — the pre-existing free-text --override-attestation path is unaffected", () => {
  it("a real free-text reason still archives an otherwise-blocked self-reported-only task", async () => {
    const slug = await createAdhocTask(tmpDir, "Free Text Regression Task");
    await recordCitablePass(slug, tmpDir);

    const result = await mustRun(
      [
        "done",
        slug,
        "--override-attestation",
        "manual browser check: verified in staging",
        "--declare-no-new-tests",
        NO_NEW_TESTS_REASON,
      ],
      tmpDir,
    );
    expect(result.exitCode).toBe(0);
    expect((await getDoc(slug, tmpDir)).status).toBe("archived");

    // The free-text reason lands VERBATIM, not the citation's composed-snapshot shape.
    const doneSteps = (await getAuditEntries(slug, tmpDir)).filter((e) => e.details?.["done"] === true);
    expect(doneSteps.every((e) => e.details?.["override_reason"] === "manual browser check: verified in staging")).toBe(
      true,
    );
  });
});

describe("REGRESSION — no escape hatch at all still refuses a self-reported-only task", () => {
  it("neither --override-attestation nor --override-attestation-cite → exit 4, task stays draft", async () => {
    const slug = await createAdhocTask(tmpDir, "No Escape Hatch At All Task");
    await recordCitablePass(slug, tmpDir);

    const result = await runLore(["done", slug], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("--override-attestation");
    expect((await getDoc(slug, tmpDir)).status).toBe("draft");
  });
});

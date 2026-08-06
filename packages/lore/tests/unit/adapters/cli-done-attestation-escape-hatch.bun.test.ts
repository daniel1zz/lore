/**
 * `lore done --override-attestation "<reason>"` — the CLI author→trip
 * end-to-end oracle for adr-lore-done-requires-a-runner-attested-pass-the-
 * sixth-false / task-lore-done-accepts-an-unattested-self-reported-pass-as.
 *
 * Proves the escape hatch actually reaches the COMPILED binary end to end —
 * argv parsing → `TaskWorkflowService.done` → the audit write — not just the
 * service layer (already covered by task-workflow-service.test.ts's own
 * "attested-pass floor" suite). This repo's own measured false-oracle #5 is a
 * CLI flag an oracle passes but never proves took effect (`knowledge-retro-a-
 * silently-inert-cli-flag-is-the-fifth-false`) — every STATE assertion below
 * reads the ACTUAL `.lore` audit table via `lore audit <doc> --json`, plus a
 * CONTROL run proving the audit marker is ABSENT without the flag.
 *
 * Spawns the COMPILED `dist/lore` binary (Bun.spawnSync) against a THROWAWAY
 * corpus (mkdtemp + `lore init`) — never touches the repo's own `.lore/`
 * corpus (project CLAUDE.md hard rule). Requires `bun run build` first;
 * `assertFreshBinary` fails loud before any test runs if `dist/lore` is
 * missing or older than the newest `.ts` source under
 * `packages/{lore,core}/src`.
 *
 * Fixture: a single `--adhoc` task (SPEC-069 D2) — sidesteps the plan→spec→
 * ac-scope chain entirely (this suite's subject is the escape hatch itself,
 * not task-create/task-claim, which have their own dedicated coverage
 * elsewhere) — and is, not incidentally, EXACTLY the shape the ADR calls out
 * as structurally unattestable (`lore verify` has no script-mode AC to bind
 * to for an `--adhoc` task), so it can only ever reach `archived` via this
 * escape hatch, never via a real attested pass.
 *
 * Coverage:
 *   HAPPY:      the flag with a real reason archives an otherwise-blocked
 *               self-reported-only task
 *   NEGATIVE:   a blank/whitespace reason is a CLI usage error (exit 2),
 *               BEFORE the corpus is even touched — no evidence/status change
 *   BOUNDARY:   a reason containing internal whitespace (not merely
 *               non-blank) round-trips byte-for-byte through the audit trail
 *   STATE:      the flag's audit side effect — `lore audit <task> --json`
 *               shows `override_reason`/`attestation_overridden` verbatim —
 *               PLUS a CONTROL run without the flag on an equivalent task
 *               proving those keys are ABSENT (never a coincidental false
 *               green from exit-code-only)
 *   ERROR:      omitting the flag entirely on a self-reported-only task still
 *               refuses with exit 4 (the pre-existing, now-attestation-aware
 *               floor) — the escape hatch is opt-in, never a silent default
 *   REGRESSION: `lore done` on an ALREADY-archived task is still an
 *               idempotent no-op (exit 0) even with a stray
 *               `--override-attestation` flag attached — the terminal
 *               short-circuit stays evaluated before this floor
 *
 * @spec_ref adr-lore-done-requires-a-runner-attested-pass-the-sixth-false
 * @spec_ref task-lore-done-accepts-an-unattested-self-reported-pass-as
 */

import { describe, expect, it, beforeAll, beforeEach, afterEach, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "../../integration/helpers/assert-fresh-binary";

setDefaultTimeout(60_000);

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/ → packages/ → repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function mustRun(args: string[], cwd: string): RunResult {
  const result = runLore(args, cwd);
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

function getDoc(slug: string, cwd: string): DocJson {
  const result = mustRun(["get", slug, "--json"], cwd);
  return (JSON.parse(result.stdout) as { data: { doc: DocJson } }).data.doc;
}

interface AuditEntryJson {
  readonly action: string;
  readonly details?: Record<string, unknown>;
}

/** Every audit row for `slug`, via the REAL `lore audit <doc> --json` CLI verb. */
function getAuditEntries(slug: string, cwd: string): AuditEntryJson[] {
  const result = mustRun(["audit", slug, "--json"], cwd);
  return (JSON.parse(result.stdout) as { data: { entries: AuditEntryJson[] } }).data.entries;
}

/**
 * Creates a planless (`--adhoc`) task and returns its slug.
 *
 * `--ac-scope ""` is REQUIRED on the ad-hoc branch (task-an-ad-hoc-task-can-
 * never-reach-the-attestation-path-that) — an ad-hoc creation without it now
 * exits 4. The EMPTY form keeps this fixture's "structurally unattestable, no
 * declared AC" shape intact, which is exactly what makes
 * `--override-attestation` the only archival route it can take.
 *
 * ⛔ That explicit-empty declaration also ARMS `lore done`'s INDEPENDENT
 * no-new-tests floor (task-the-ac-scope-re-keying-left-the-red-first-floor-
 * unarmed: the floor keys on the declaration's PRESENCE, not the array's
 * length), so every archiving call below carries {@link NO_NEW_TESTS_REASON}
 * alongside `--override-attestation`. The two are DIFFERENT floors with
 * DIFFERENT escapes; needing both here is the correct outcome for a fixture
 * that neither attests a pass nor records a red run, and this suite's subject
 * remains the attestation escape alone.
 */
function createAdhocTask(cwd: string, title: string): string {
  const created = mustRun(
    ["create", "task", "--title", title, "--adhoc", "--ac-scope", "", "--content", "body", "--no-ai", "--json"],
    cwd,
  );
  return (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}

/**
 * The no-new-tests escape this suite's fixtures need for the reason documented
 * on {@link createAdhocTask} — deliberately a DISTINCT string from every
 * `--override-attestation` reason below, so an assertion about one escape's
 * audit key can never be satisfied by the other's value.
 */
const NO_NEW_TESTS_REASON = "escape-hatch fixture: no new test, this suite asserts the attestation escape";

/** Records one SELF-REPORTED (never attested — no `lore verify`/`recordVerifiedEvidence`
 *  CLI/MCP surface exists) passing evidence row — the exact shape every `lore evidence`
 *  write produces, and the shape this feature's floor now refuses as insufficient alone. */
function recordSelfReportedPass(slug: string, cwd: string): void {
  mustRun(
    ["evidence", slug, "--oracle", "test", "--command", "bun run typecheck", "--result", "pass", "--output-tail", "ok"],
    cwd,
  );
}

let tmpDir: string;

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-done-escape-hatch-"));
  mustRun(["init"], tmpDir);
  // An --adhoc task parents to the corpus root PRD (CorpusService._createImpl) —
  // one must exist first, mirroring every other --adhoc fixture in this repo.
  mustRun(["create", "prd", "--title", "Escape Hatch Root", "--content", "## Overview\nroot", "--no-ai"], tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("HAPPY — --override-attestation archives an otherwise-blocked self-reported-only task", () => {
  it("a real, non-blank reason reaches exit 0 and the task is archived", () => {
    const slug = createAdhocTask(tmpDir, "Manually Verified Task");
    recordSelfReportedPass(slug, tmpDir);

    const result = mustRun(
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
    expect(getDoc(slug, tmpDir).status).toBe("archived");
  });
});

describe("NEGATIVE — a blank/whitespace reason is a CLI usage error (exit 2), before the corpus is touched", () => {
  it("an empty-string reason exits 2 and leaves the task's status/evidence untouched", () => {
    const slug = createAdhocTask(tmpDir, "Blank Reason Task");
    recordSelfReportedPass(slug, tmpDir);
    const before = getDoc(slug, tmpDir);

    const result = runLore(["done", slug, "--override-attestation", ""], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--override-attestation");

    const after = getDoc(slug, tmpDir);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
  });

  it("a whitespace-only reason ('   ') is refused identically", () => {
    const slug = createAdhocTask(tmpDir, "Whitespace Reason Task");
    recordSelfReportedPass(slug, tmpDir);

    const result = runLore(["done", slug, "--override-attestation", "   "], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(getDoc(slug, tmpDir).status).toBe("draft"); // unchanged — never archived
  });
});

describe("BOUNDARY — a reason with internal whitespace round-trips byte-for-byte", () => {
  it("a multi-word reason is neither trimmed nor mangled in the audit trail", () => {
    const slug = createAdhocTask(tmpDir, "Multiword Reason Task");
    recordSelfReportedPass(slug, tmpDir);
    const REASON = "manual browser check: verified in staging, screenshot attached to PR #123";

    mustRun(["done", slug, "--override-attestation", REASON, "--declare-no-new-tests", NO_NEW_TESTS_REASON], tmpDir);

    const doneSteps = getAuditEntries(slug, tmpDir).filter((e) => e.details?.["done"] === true);
    expect(doneSteps.length).toBeGreaterThan(0);
    expect(doneSteps.every((e) => e.details?.["override_reason"] === REASON)).toBe(true);
    // The two escapes stay distinguishable on the SAME row — neither key adopts
    // the other's value now that this fixture legitimately needs both.
    expect(doneSteps.every((e) => e.details?.["no_new_tests_reason"] === NO_NEW_TESTS_REASON)).toBe(true);
  });
});

describe("STATE — the audit side effect is real, with a CONTROL run proving its absence without the flag", () => {
  it("using the flag stamps every lifecycle-step audit row with override_reason + attestation_overridden:true", () => {
    const slug = createAdhocTask(tmpDir, "Audited Escape Task");
    recordSelfReportedPass(slug, tmpDir);
    const REASON = "verified via manual QA session 2026-08-01";

    mustRun(["done", slug, "--override-attestation", REASON, "--declare-no-new-tests", NO_NEW_TESTS_REASON], tmpDir);

    const doneSteps = getAuditEntries(slug, tmpDir).filter((e) => e.details?.["done"] === true);
    expect(doneSteps.length).toBeGreaterThan(0);
    expect(doneSteps.every((e) => e.details?.["override_reason"] === REASON)).toBe(true);
    expect(doneSteps.every((e) => e.details?.["attestation_overridden"] === true)).toBe(true);
  });

  it("CONTROL — an equivalent task archived WITHOUT the flag (via a genuinely attested evidence set the `red-first` fixture already proves reachable is unavailable here, so this control instead asserts absence is the DEFAULT rather than requiring a successful non-override archive) carries neither key on ANY audit row it does produce", () => {
    // reason: this repo's CLI has no attestation-producing surface at all
    // (recordVerifiedEvidence is VerifyRunnerService-only, never wired to any
    // CLI/MCP command — see commands/done.ts's own module header) — so the
    // only CLI-reachable control for "the escape hatch was never used" is a
    // task that never even attempts `lore done` successfully. The control
    // therefore asserts on the CLAIM/EVIDENCE audit rows a normal EXECUTE loop
    // already produces (claim, evidence) — none of which EVER carry
    // override_reason/attestation_overridden, proving those keys are not
    // some ambient default the store stamps onto every row regardless of the
    // flag, but are written ONLY by the done() escape-hatch code path.
    const slug = createAdhocTask(tmpDir, "Unaudited Control Task");
    mustRun(["claim", slug, "--worktree", tmpDir], tmpDir);
    recordSelfReportedPass(slug, tmpDir);
    mustRun(["release", slug], tmpDir);

    // The done() call itself is refused (no attestation, no override) — exit 4,
    // never reaching the audit-stamping code path at all.
    const refusal = runLore(["done", slug], tmpDir);
    expect(refusal.exitCode).toBe(4);

    const entries = getAuditEntries(slug, tmpDir);
    expect(entries.length).toBeGreaterThan(0); // claim/release/evidence rows exist
    expect(entries.every((e) => e.details?.["override_reason"] === undefined)).toBe(true);
    expect(entries.every((e) => e.details?.["attestation_overridden"] === undefined)).toBe(true);
  });
});

describe("ERROR — omitting the flag on a self-reported-only task still refuses (opt-in, never a silent default)", () => {
  it("no --override-attestation at all → exit 4, task stays draft", () => {
    const slug = createAdhocTask(tmpDir, "No Escape Hatch Task");
    recordSelfReportedPass(slug, tmpDir);

    const result = runLore(["done", slug], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("lore verify");
    expect(result.stderr).toContain("--override-attestation");
    expect(getDoc(slug, tmpDir).status).toBe("draft");
  });
});

describe("REGRESSION — an already-archived task stays an idempotent no-op even with a stray override flag", () => {
  it("a second `lore done --override-attestation <reason>` on an already-archived task exits 0 without a new audit row", () => {
    const slug = createAdhocTask(tmpDir, "Already Archived Task");
    recordSelfReportedPass(slug, tmpDir);
    mustRun(
      [
        "done",
        slug,
        "--override-attestation",
        "first pass, legitimately overridden",
        "--declare-no-new-tests",
        NO_NEW_TESTS_REASON,
      ],
      tmpDir,
    );
    const auditCountAfterFirst = getAuditEntries(slug, tmpDir).length;

    const second = runLore(
      ["done", slug, "--override-attestation", "second call, should be a pure no-op"],
      tmpDir,
    );
    expect(second.exitCode).toBe(0);
    expect(getDoc(slug, tmpDir).status).toBe("archived");
    // idempotent no-op writes NOTHING — the audit table must not have grown.
    expect(getAuditEntries(slug, tmpDir).length).toBe(auditCountAfterFirst);
  });
});
